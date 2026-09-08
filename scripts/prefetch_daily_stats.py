#!/usr/bin/env python3
"""
prefetch_daily_stats.py
=======================
Pre-computes all split stats for every probable pitcher and active-roster
batter in today's MLB games, then writes:

    public/data/daily_stats_{YYYY-MM-DD}.json

Runs via GitHub Actions before first pitch (and periodically after to catch
confirmed lineups).  The browser reads this file and skips all live Savant
requests, making page loads near-instant.

Stat sources:
  Pitchers (all periods):
    - Counting stats (IP, ERA, WHIP, K, BB, HR, HBP, flyOuts, qualityStarts)
      from MLB Stats API /people with type=[byDateRange] or type=[season]
    - FIP / xFIP / FIP- / FIP+  computed here using wrcConstants formula
    - xwOBA from MLB Stats API expectedStatistics — season entry only. Verified
      empirically that expectedStatistics silently ignores startDate/endDate even
      combined with byDateRange (returns the season-wide value unchanged regardless
      of the window requested), so it is NOT fetched for the date-range periods —
      the client (pitcherStats.ts) computes a real, period-scoped wOBA-against
      instead, from that same byDateRange call's own raw counting stats

  Batters (all periods):
    - xwOBA: one Savant pitch-by-pitch CSV per batter (full season), then
      filter rows by game_date in Python for each period — 1 request total
    - wRC+: MLB Stats API /people with type=[byDateRange], computed here

Usage:
    python scripts/prefetch_daily_stats.py [--date YYYY-MM-DD] [--out public/data] [--workers 30]
"""
import argparse
import csv
import io
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

MLB_API = "https://statsapi.mlb.com/api/v1"
SAVANT  = "https://baseballsavant.mlb.com"
UA      = "dlopicks-prefetch/1.0"

PERIOD_DAYS: dict[str, int | None] = {
    "season": None,
    "60days": 60,
    "30days": 30,
    "14days": 14,
    "7days":  7,
}

MIN_IP_PITCHER = 3   # minimum IP for FIP to be meaningful in a date range
MIN_PA_BATTER  = 10  # minimum PA for wRC+ to be meaningful

# ── wOBA / wRC+ constants — finalized historical values (FanGraphs guts page) ──
# Current season is loaded at runtime from public/data/linear_weights_{year}.json,
# which is committed daily by refresh-constants.yml.  These rows are immutable.
SEED: dict[int, dict] = {
    2022: dict(wBB=0.693, wHBP=0.722, w1B=0.880, w2B=1.247, w3B=1.578, wHR=1.985,
               lgwOBA=0.308, wOBAScale=1.146, lgRPA=0.112, cFIP=3.180, lgFIP=3.96, lgHRFB=0.118),
    2023: dict(wBB=0.697, wHBP=0.728, w1B=0.895, w2B=1.267, w3B=1.594, wHR=2.058,
               lgwOBA=0.320, wOBAScale=1.157, lgRPA=0.119, cFIP=3.026, lgFIP=4.33, lgHRFB=0.120),
    2024: dict(wBB=0.689, wHBP=0.720, w1B=0.881, w2B=1.248, w3B=1.571, wHR=2.005,
               lgwOBA=0.317, wOBAScale=1.155, lgRPA=0.118, cFIP=3.023, lgFIP=4.18, lgHRFB=0.112),
    # 2025 sourced directly from the FanGraphs Guts page (Bright Data Web Unlocker,
    # verified — see scripts/test_brightdata_fangraphs.py). Mirrors wrcConstants.ts.
    2025: dict(wBB=0.691, wHBP=0.722, w1B=0.882, w2B=1.252, w3B=1.584, wHR=2.037,
               lgwOBA=0.313, wOBAScale=1.232, lgRPA=0.118, cFIP=3.135, lgFIP=4.151, lgHRFB=0.115),
}

# ── Park factors (run, for wRC+) ───────────────────────────────────────────────
RUN_PF: dict[int, float] = {
    108:1.01, 109:1.01, 110:0.99, 111:1.04, 112:0.98, 113:1.05, 114:0.99,
    115:1.13, 116:1.00, 117:0.99, 118:1.03, 119:0.99, 120:1.00, 121:0.96,
    133:1.03, 134:1.02, 135:0.96, 136:0.94, 137:0.97, 138:0.98, 139:1.01,
    140:0.99, 141:0.99, 142:1.01, 143:1.01, 144:1.00, 145:1.00, 146:1.01,
    147:0.99, 158:0.99,
}

# ── FIP park factors ───────────────────────────────────────────────────────────
FIP_PF: dict[int, float] = {
    108:1.01, 109:0.97, 110:0.99, 111:1.00, 112:0.98, 113:1.05, 114:0.99,
    115:1.05, 116:1.00, 117:1.00, 118:1.00, 119:1.03, 120:1.00, 121:0.99,
    133:1.02, 134:1.00, 135:0.99, 136:0.96, 137:0.96, 138:0.98, 139:1.02,
    140:1.01, 141:1.01, 142:1.00, 143:1.02, 144:0.98, 145:1.03, 146:1.00,
    147:1.02, 158:1.00,
}


def get_constants(season: int) -> dict:
    known = {y: c for y, c in SEED.items() if y <= season}
    return SEED[max(known)] if known else SEED[2025]


_LIVE_KEYS = {"wBB", "wHBP", "w1B", "w2B", "w3B", "wHR",
              "lgwOBA", "wOBAScale", "lgRPA", "cFIP", "lgFIP", "lgHRFB"}

def load_live_constants(season: int, data_dir: Path) -> bool:
    """
    Reads public/data/linear_weights_{season}.json (written by refresh-constants.yml)
    and injects it into SEED so all get_constants() calls use the live values.
    Returns True on success, False if the file is missing or malformed.
    """
    path = data_dir / f"linear_weights_{season}.json"
    if not path.exists():
        print(f"  Warning: {path} not found — using hardcoded fallback for {season}")
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not _LIVE_KEYS.issubset(data.keys()):
            missing = _LIVE_KEYS - data.keys()
            print(f"  Warning: {path} missing keys {missing} — using hardcoded fallback")
            return False
        SEED[season] = {k: float(data[k]) for k in _LIVE_KEYS}
        print(f"  Loaded live constants for {season}: lgwOBA={data['lgwOBA']}  lgFIP={data['lgFIP']}")
        return True
    except Exception as e:
        print(f"  Warning: could not parse {path}: {e} — using hardcoded fallback")
        return False


def ip_to_decimal(ip_str: str) -> float:
    """'15.1' → 15.333 (thirds, not tenths)."""
    parts = str(ip_str).split(".")
    if len(parts) == 1:
        return float(parts[0])
    return int(parts[0]) + int(parts[1]) / 3


def fetch_url(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def mlb_get(path: str, params: dict) -> dict:
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{MLB_API}{path}?{qs}"
    return json.loads(fetch_url(url))


def parse_savant_csv(raw: bytes) -> list[dict]:
    text = raw.decode("utf-8-sig", errors="replace")
    if not text.strip() or text.strip().startswith("<"):
        return []
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


# ── Schedule / roster helpers ─────────────────────────────────────────────────

def get_todays_games(game_date: str, season: int) -> list[dict]:
    data = mlb_get("/schedule", {
        "sportId": 1, "date": game_date,
        "hydrate": "probablePitcher,team",
        "gameType": "R",
    })
    games = []
    for date_entry in data.get("dates", []):
        for g in date_entry.get("games", []):
            games.append(g)
    return games


def get_active_roster(team_id: int) -> list[int]:
    try:
        data = mlb_get(f"/teams/{team_id}/roster", {"rosterType": "active"})
        return [p["person"]["id"] for p in data.get("roster", [])]
    except Exception:
        return []


# ── wRC+ computation ──────────────────────────────────────────────────────────

def compute_woba_raw(s: dict, season: int) -> float | None:
    """Raw wOBA from a stat dict's counting stats — no MIN_PA gate (matches
    wrcConstants.ts's computeWoba, which is also gate-free; compute_wrc_plus
    below applies its own MIN_PA_BATTER gate on top of this)."""
    ab  = int(s.get("atBats") or 0)
    h   = int(s.get("hits") or 0)
    d   = int(s.get("doubles") or 0)
    t   = int(s.get("triples") or 0)
    hr  = int(s.get("homeRuns") or 0)
    bb  = int(s.get("baseOnBalls") or 0)
    ibb = int(s.get("intentionalWalks") or 0)
    hbp = int(s.get("hitByPitch") or 0)
    sf  = int(s.get("sacFlies") or 0)

    c    = get_constants(season)
    s1b  = h - d - t - hr
    ubb  = bb - ibb
    denom = ab + ubb + hbp + sf
    if not denom:
        return None
    return (c["wBB"]*ubb + c["wHBP"]*hbp + c["w1B"]*s1b +
            c["w2B"]*d   + c["w3B"]*t    + c["wHR"]*hr) / denom


def compute_wrc_plus(s: dict, season: int, home_team_id: int | None) -> int | None:
    pa = int(s.get("plateAppearances") or 0)
    if pa < MIN_PA_BATTER:
        return None
    woba = compute_woba_raw(s, season)
    if woba is None:
        return None
    c  = get_constants(season)
    pf = RUN_PF.get(home_team_id, 1.00) if home_team_id else 1.00
    wraa_pa = (woba - c["lgwOBA"]) / c["wOBAScale"]
    return round((wraa_pa / c["lgRPA"] + 2 - pf) * 100)


# ── FIP / xFIP helpers ────────────────────────────────────────────────────────

def compute_fip(s: dict, season: int, home_team_id: int | None) -> dict:
    """Compute FIP, xFIP, FIP-, FIP+ from raw pitcher counting stats."""
    ip  = ip_to_decimal(s.get("inningsPitched") or "0")
    if ip < MIN_IP_PITCHER:
        return {}
    hr  = int(s.get("homeRuns") or 0)
    bb  = int(s.get("baseOnBalls") or 0)
    hbp = int(s.get("hitByPitch") or 0)
    k   = int(s.get("strikeOuts") or 0)
    fly = s.get("flyOuts")  # may be absent

    c        = get_constants(season)
    fip_raw  = (13*hr + 3*(bb + hbp) - 2*k) / ip + c["cFIP"]
    fip_pf   = FIP_PF.get(home_team_id, 1.00) if home_team_id else 1.00
    fip_minus = round(100 * fip_raw / (c["lgFIP"] * fip_pf))
    fip_plus  = 200 - fip_minus

    result = dict(
        fip=round(fip_raw, 2),
        fipMinus=fip_minus,
        fipPlus=fip_plus,
    )

    if fly is not None:
        fly_balls   = int(fly) + hr
        expected_hr = fly_balls * c["lgHRFB"]
        xfip_raw    = (13*expected_hr + 3*(bb + hbp) - 2*k) / ip + c["cFIP"]
        result["xfip"] = round(xfip_raw, 2)

    return result


# ── Savant batter CSV helpers ─────────────────────────────────────────────────

def compute_xwoba_from_rows(rows: list[dict], cutoff: str | None = None) -> float | None:
    xw_num = xw_den = 0.0
    for row in rows:
        if cutoff and (row.get("game_date") or "") < cutoff:
            continue
        try:
            wd = float(row.get("woba_denom") or 0)
        except (ValueError, TypeError):
            wd = 0.0
        if not wd:
            continue
        try:
            wv = float(row.get("woba_value") or 0)
        except (ValueError, TypeError):
            wv = 0.0
        xv_raw = (row.get("estimated_woba_using_speedangle") or "").strip().lower()
        if xv_raw and xv_raw not in ("null", "none", "na", ""):
            try:
                xv = float(xv_raw)
            except ValueError:
                xv = wv
        else:
            xv = wv
        xw_num += xv
        xw_den += wd
    return (xw_num / xw_den) if xw_den else None


def fetch_batter_savant_rows(player_id: int, season: int) -> list[dict]:
    url = (f"{SAVANT}/statcast_search/csv"
           f"?type=batter&player_id={player_id}"
           f"&year={season}&hfSea={season}%7C&hfGT=R%7C")
    try:
        raw = fetch_url(url, timeout=30)
        return parse_savant_csv(raw)
    except Exception:
        return []


# ── Per-player fetch functions ────────────────────────────────────────────────

def process_batter(player_id: int, season: int, home_team_id: int | None,
                   today: date, all_mlb_stats: dict) -> dict:
    """
    Returns dict keyed by period name with wrcPlus, xwoba, pa.
    all_mlb_stats[player_id][period] already contains the MLB API stat dict.
    We fetch Savant once for xwOBA, compute all period slices in Python.
    """
    savant_rows = fetch_batter_savant_rows(player_id, season)

    result: dict[str, dict] = {}
    for period, days in PERIOD_DAYS.items():
        cutoff = (today - timedelta(days=days)).strftime("%Y-%m-%d") if days else None
        entry: dict = {}

        # wRC+ from pre-fetched MLB API stats
        mlb_s = all_mlb_stats.get(player_id, {}).get(period)
        if mlb_s:
            wrc = compute_wrc_plus(mlb_s, season, home_team_id)
            if wrc is not None:
                entry["wrcPlus"] = wrc
            entry["pa"] = int(mlb_s.get("plateAppearances") or 0)

        # xwOBA from Savant CSV (filtered by cutoff date)
        xwoba = compute_xwoba_from_rows(savant_rows, cutoff)
        if xwoba is not None and entry.get("pa", 0) >= MIN_PA_BATTER:
            entry["xwoba"] = round(xwoba, 3)

        if entry:
            result[period] = entry

    return result


def fetch_pitcher_all_periods(player_id: int, season: int,
                               home_team_id: int | None, today: date) -> dict:
    """Fetch counting stats + expectedStatistics for all periods."""
    result: dict[str, dict] = {}

    # Full season + sabermetrics + expectedStatistics in one call
    try:
        data = mlb_get(f"/people/{player_id}", {
            "season": season,
            "hydrate": (
                f"stats(group=[pitching],"
                f"type=[season,sabermetrics,expectedStatistics],"
                f"season={season})"
            ),
        })
        by_type: dict[str, dict] = {}
        for blk in data.get("people", [{}])[0].get("stats", []):
            splits = blk.get("splits", [])
            if splits:
                by_type[blk["type"]["displayName"]] = splits[0].get("stat", {})

        ss  = by_type.get("season", {})
        sb  = by_type.get("sabermetrics", {})
        ex  = by_type.get("expectedStatistics", {})

        fip_data = compute_fip(ss, season, home_team_id)
        season_entry: dict = dict(
            era=ss.get("era"),
            whip=ss.get("whip"),
            wins=ss.get("wins"),
            losses=ss.get("losses"),
            ip=ss.get("inningsPitched"),
            qs=by_type.get("seasonAdvanced", {}).get("qualityStarts"),
            strikeOuts=ss.get("strikeOuts"),
            baseOnBalls=ss.get("baseOnBalls"),
            homeRuns=ss.get("homeRuns"),
            hitByPitch=ss.get("hitByPitch"),
            battersFaced=ss.get("battersFaced"),
            # Sabermetrics from API (full season)
            fip_api=sb.get("fip"),
            xfip_api=sb.get("xfip"),
            # Computed
            **fip_data,
            # xwOBA from expectedStatistics — full season (no period-specific available)
            xwoba=ex.get("woba"),
        )
        result["season"] = {k: v for k, v in season_entry.items() if v is not None}
    except Exception as e:
        print(f"  pitcher {player_id} season fetch error: {e}")

    # Date-range periods
    for period, days in PERIOD_DAYS.items():
        if days is None:
            continue
        start = (today - timedelta(days=days)).strftime("%Y-%m-%d")
        end   = today.strftime("%Y-%m-%d")
        try:
            data = mlb_get(f"/people/{player_id}", {
                "season": season,
                "hydrate": (
                    f"stats(group=[pitching],"
                    f"type=[byDateRange],"
                    f"season={season},"
                    f"startDate={start},endDate={end})"
                ),
            })
            by_type_r: dict[str, dict] = {}
            for blk in data.get("people", [{}])[0].get("stats", []):
                splits = blk.get("splits", [])
                if splits:
                    by_type_r[blk["type"]["displayName"]] = splits[0].get("stat", {})

            rs  = by_type_r.get("byDateRange", {})
            fip_d = compute_fip(rs, season, home_team_id)
            entry: dict = dict(
                era=rs.get("era"),
                whip=rs.get("whip"),
                wins=rs.get("wins"),
                losses=rs.get("losses"),
                ip=rs.get("inningsPitched"),
                strikeOuts=rs.get("strikeOuts"),
                baseOnBalls=rs.get("baseOnBalls"),
                homeRuns=rs.get("homeRuns"),
                hitByPitch=rs.get("hitByPitch"),
                battersFaced=rs.get("battersFaced"),
                **fip_d,
                # xwoba deliberately NOT set here — verified empirically that MLB's
                # expectedStatistics silently ignores startDate/endDate even combined
                # with byDateRange (battersFaced changed 576→28 across two different
                # windows, expectedStatistics.woba stayed byte-identical at .272 both
                # times), so a value fetched this way would be the season-wide number
                # mislabeled as period-specific. pitcherStats.ts's client-side fallback
                # (wobaAgainstComputed, from this same byDateRange block's own raw
                # counts — genuinely period-scoped) is what covers this period instead.
            )
            result[period] = {k: v for k, v in entry.items() if v is not None}
        except Exception as e:
            print(f"  pitcher {player_id} {period} fetch error: {e}")

    return result


# ── Batch MLB API batter stats ────────────────────────────────────────────────

def fetch_batter_mlb_stats_batch(player_ids: list[int], season: int,
                                  period: str, days: int | None,
                                  today: date) -> dict[int, dict]:
    """Fetch MLB API counting stats for up to 60 batters at once."""
    if not player_ids:
        return {}

    if days is None:
        hydrate = (f"stats(group=[hitting],type=[season],season={season})")
        stat_key = "season"
    else:
        start = (today - timedelta(days=days)).strftime("%Y-%m-%d")
        end   = today.strftime("%Y-%m-%d")
        hydrate = (
            f"stats(group=[hitting],type=[byDateRange],"
            f"season={season},startDate={start},endDate={end})"
        )
        stat_key = "byDateRange"

    try:
        data = mlb_get("/people", {
            "personIds": ",".join(str(i) for i in player_ids),
            "season": season,
            "hydrate": hydrate,
        })
    except Exception as e:
        print(f"  batter batch fetch error ({period}): {e}")
        return {}

    result: dict[int, dict] = {}
    for person in data.get("people", []):
        pid = person["id"]
        for blk in person.get("stats", []):
            if blk["type"]["displayName"] == stat_key:
                splits = blk.get("splits", [])
                if splits:
                    result[pid] = splits[0].get("stat", {})
                break
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date",    default=date.today().strftime("%Y-%m-%d"))
    parser.add_argument("--out",     default="public/data")
    parser.add_argument("--workers", type=int, default=30)
    args = parser.parse_args()

    game_date = args.date
    today     = date.fromisoformat(game_date)
    season    = today.year
    out_dir   = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path  = out_dir / f"daily_stats_{game_date}.json"

    print(f"Prefetching stats for {game_date} (season {season}) …")
    t0 = time.time()

    # Load live constants from the file committed by refresh-constants.yml.
    # Must happen before any compute_fip / compute_wrc_plus calls.
    load_live_constants(season, out_dir)

    # ── 1. Today's schedule ───────────────────────────────────────────────────
    games = get_todays_games(game_date, season)
    print(f"  {len(games)} games today")

    # Collect pitcher IDs and team IDs
    pitcher_home_team: dict[int, int] = {}   # pitcher_id → their team_id (home venue)
    team_home_team: dict[int, int] = {}       # team_id → home_team_id (for park factor)
    team_ids: set[int] = set()

    for g in games:
        away_team = g.get("teams", {}).get("away", {}).get("team", {})
        home_team = g.get("teams", {}).get("home", {}).get("team", {})
        away_id = away_team.get("id")
        home_id = home_team.get("id")
        if away_id: team_ids.add(away_id)
        if home_id: team_ids.add(home_id)

        # Park factor: pitcher is credited with their HOME team's park
        for side, team in [("away", away_team), ("home", home_team)]:
            tid = team.get("id")
            pitcher = g.get("teams", {}).get(side, {}).get("probablePitcher")
            if pitcher and tid:
                pid = pitcher["id"]
                pitcher_home_team[pid] = tid
        if away_id and home_id:
            team_home_team[away_id] = away_id   # park factor = own home park
            team_home_team[home_id] = home_id

    print(f"  {len(pitcher_home_team)} probable pitchers, {len(team_ids)} teams")

    # ── 2. Active rosters for all teams ──────────────────────────────────────
    all_batter_ids: set[int] = set()
    batter_home_team: dict[int, int] = {}   # batter_id → their home team_id

    with ThreadPoolExecutor(max_workers=min(len(team_ids), 15)) as ex:
        futures = {ex.submit(get_active_roster, tid): tid for tid in team_ids}
        for fut in as_completed(futures):
            tid = futures[fut]
            roster = fut.result()
            for pid in roster:
                all_batter_ids.add(pid)
                batter_home_team[pid] = tid

    # Remove probable pitchers from batter set
    all_batter_ids -= set(pitcher_home_team.keys())
    batter_list = sorted(all_batter_ids)
    print(f"  {len(batter_list)} batters across all rosters")

    # ── 3. Batch-fetch batter MLB API stats for all periods ───────────────────
    print("  Fetching batter MLB API stats …")
    # all_mlb: player_id → period → stat dict
    all_mlb: dict[int, dict[str, dict]] = {pid: {} for pid in batter_list}

    CHUNK = 60
    chunks = [batter_list[i:i+CHUNK] for i in range(0, len(batter_list), CHUNK)]

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {}
        for period, days in PERIOD_DAYS.items():
            for chunk in chunks:
                fut = ex.submit(fetch_batter_mlb_stats_batch, chunk, season, period, days, today)
                futures[fut] = period
        for fut in as_completed(futures):
            period = futures[fut]
            stats_map = fut.result()
            for pid, s in stats_map.items():
                all_mlb.setdefault(pid, {})[period] = s

    # ── 4. Fetch pitcher stats (all periods, including FIP computation) ───────
    print("  Fetching pitcher stats …")
    pitcher_results: dict[int, dict] = {}
    pitcher_list = list(pitcher_home_team.keys())

    with ThreadPoolExecutor(max_workers=min(len(pitcher_list), args.workers)) as ex:
        futures_p = {
            ex.submit(fetch_pitcher_all_periods, pid, season, pitcher_home_team.get(pid), today): pid
            for pid in pitcher_list
        }
        for fut in as_completed(futures_p):
            pid = futures_p[fut]
            try:
                pitcher_results[pid] = fut.result()
                print(f"  ✓ pitcher {pid}")
            except Exception as e:
                print(f"  ✗ pitcher {pid}: {e}")

    # ── 5. Fetch batter Savant CSV + compute everything ───────────────────────
    print(f"  Fetching Savant CSV for {len(batter_list)} batters …")
    batter_results: dict[str, dict[str, dict]] = {p: {} for p in PERIOD_DAYS}

    completed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures_b = {
            ex.submit(process_batter, pid, season, batter_home_team.get(pid), today, all_mlb): pid
            for pid in batter_list
        }
        for fut in as_completed(futures_b):
            pid = futures_b[fut]
            try:
                per_period = fut.result()
                for period, entry in per_period.items():
                    batter_results.setdefault(period, {})[str(pid)] = entry
                completed += 1
                if completed % 50 == 0:
                    print(f"  … {completed}/{len(batter_list)} batters done")
            except Exception as e:
                print(f"  ✗ batter {pid}: {e}")

    # ── 6. Write output ───────────────────────────────────────────────────────
    output = {
        "date":      game_date,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "season":    season,
        "pitchers":  {str(k): v for k, v in pitcher_results.items()},
        "batters":   batter_results,
    }

    out_path.write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nWrote {out_path}  ({out_path.stat().st_size // 1024} KB)  [{elapsed:.1f}s]")


if __name__ == "__main__":
    main()
