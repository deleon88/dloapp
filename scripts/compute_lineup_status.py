#!/usr/bin/env python3
"""
compute_lineup_status.py
=========================
Tracks Confirmed/Projected lineup status per game/team, computed server-side
exactly once. The UI only ever reads this file — it never triggers this
computation itself, so there's no double-compute race: this script's own
cron run (chained after the stats prefetch in prefetch-daily-stats.yml) is
the only place that ever writes computedStats, and it runs as a single
sequential job, never concurrently with itself.

Schema written to public/data/lineup_status_{date}.json:
  {
    "<gamePk>": {
      "homeTeam": {
        "goToLineup":    [ {playerId, battingOrder, position}, ... ] | [],
        "todaysLineup":  null | [ {playerId, battingOrder, position}, ... ],
        "status":        "projected" | "confirmed",
        "confirmedAt":   null | ISO timestamp,
        "computedStats": null | { "<playerId>": {wrcPlus, xwoba, pa} | null }
      },
      "awayTeam": { ... }
    }
  }

Once a game/team side is "confirmed", its entry is copied through UNCHANGED
on every later run in the same day — the computation happens exactly once,
on the first run that observes a populated batting order.

computedStats sourcing: players who match the daily stats cache (built by
prefetch_daily_stats.py for the day's probable pitchers / active roster
batters — i.e. essentially everyone, matched or not vs. goToLineup) get
their season wRC+ copied straight from it. A player NOT in that cache (rare
— a surprise call-up prefetch_daily_stats.py didn't know about) gets `null`
here; the same "falls back to live" contract dailyCache.ts already documents
for the existing same-day cache applies here too — no separate live-compute
path is built for that rare case in this script.

Each confirmed batter's entry also carries `vsL`/`vsR` (wRC+, xwOBA, PA) —
the vs-LHP/vs-RHP hand splits — computed HERE, once, at the moment a side
first flips to confirmed (same "computed exactly once" contract as the base
stats). This exists because the live client-side equivalent
(wrcComputed.ts's season path: MLB hydrate type=[season,statSplits],
sitCodes=[vl,vr]) is a genuinely slow endpoint, and the browser was re-running
it on every hand-filter toggle for every batter in every lineup on screen.
wRC+ comes from one batched MLB hydrate call per confirmed side (mirrors
wrcComputed.ts's fetchChunk exactly, same hydrate string, same park-factor
convention — the side's own team acts as "home" for park factor, matching
playerHomeTeamMap in LiveGamePage.tsx/SchedulePage.tsx); xwOBA comes from two
Baseball Savant CSV fetches per batter (pitcher_throws=L / pitcher_throws=R —
the same verified param savantStats.ts uses live). Only fires for the ~9
batters of a newly-confirmed side, never for the full roster, so the added
cost is small and one-time per side per day.

Sources:
  - public/data/go_to_lineups.json      (scripts/refresh-go-to-lineups.ts)
  - public/data/daily_stats_{date}.json (scripts/prefetch_daily_stats.py)
  - MLB Stats API schedule/boxscore/people (live, for today's actual state)

Usage:
    python scripts/compute_lineup_status.py [--date YYYY-MM-DD] [--out public/data]
"""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compute_linear_weights import MLB_API, _get  # noqa: E402
from prefetch_daily_stats import (  # noqa: E402
    SAVANT, compute_wrc_plus, compute_woba_raw, compute_xwoba_from_rows, fetch_url,
    load_live_constants, parse_savant_csv,
)


def fetch_schedule(date_str: str) -> list[dict]:
    url = (
        f"{MLB_API}/schedule?sportId=1&date={date_str}&gameType=R"
        f"&hydrate=probablePitcher"
        f"&fields=dates,games,gamePk,teams,away,home,team,id,probablePitcher"
    )
    data = _get(url)
    games = []
    for d in data.get('dates', []):
        games.extend(d.get('games', []))
    return games


def fetch_pitch_hands(pitcher_ids: list[int]) -> dict[int, str]:
    if not pitcher_ids:
        return {}
    ids = ','.join(str(i) for i in pitcher_ids)
    url = f"{MLB_API}/people?personIds={ids}&hydrate=pitchHand&fields=people,id,pitchHand,code"
    data = _get(url)
    out = {}
    for p in data.get('people', []):
        code = p.get('pitchHand', {}).get('code')
        if code:
            out[p['id']] = code
    return out


def fetch_boxscore_lineup(game_pk: int) -> dict[str, list[dict]]:
    """Returns {'away': [...], 'home': [...]} of {playerId, battingOrder, position} — empty list if not confirmed yet."""
    try:
        data = _get(
            f"{MLB_API}/game/{game_pk}/boxscore"
            f"?fields=teams,away,home,battingOrder,players,person,id,position,abbreviation"
        )
    except Exception:
        return {'away': [], 'home': []}

    out: dict[str, list[dict]] = {}
    for side in ('away', 'home'):
        team = data.get('teams', {}).get(side, {})
        order = team.get('battingOrder', [])
        players = team.get('players', {})
        slots = []
        for i, pid in enumerate(order[:9]):
            entry = players.get(f'ID{pid}', {})
            pos = entry.get('position', {}).get('abbreviation', '')
            slots.append({'playerId': pid, 'battingOrder': i + 1, 'position': pos})
        out[side] = slots
    return out


def fetch_batter_hand_splits(batter_ids: list[int], season: int) -> dict[int, dict]:
    """Batch MLB hydrate for season vs-LHP/vs-RHP raw stat splits — same hydrate
    string as wrcComputed.ts's fetchChunk season path, so the cached number
    matches what the live client would have computed."""
    if not batter_ids:
        return {}
    ids = ','.join(str(i) for i in batter_ids)
    try:
        data = _get(
            f"{MLB_API}/people?personIds={ids}&season={season}"
            f"&hydrate=stats(group=[hitting],type=[season,statSplits],"
            f"sitCodes=[vl,vr],season={season})"
        )
    except Exception as e:
        print(f"  WARNING: hand-split batch fetch failed: {e}", flush=True)
        return {}

    out: dict[int, dict] = {}
    for person in data.get('people', []):
        pid = person['id']
        vs_l = vs_r = None
        for blk in person.get('stats', []):
            if blk.get('type', {}).get('displayName') != 'statSplits':
                continue
            for s in blk.get('splits', []):
                code = s.get('split', {}).get('code')
                if code == 'vl':
                    vs_l = s.get('stat', {})
                elif code == 'vr':
                    vs_r = s.get('stat', {})
        out[pid] = {'vsL': vs_l, 'vsR': vs_r}
    return out


def fetch_batter_savant_hand_xwoba(player_id: int, season: int, hand: str) -> float | None:
    """Season xwOBA filtered by opposing-pitcher hand — same verified
    pitcher_throws= param savantStats.ts uses live."""
    url = (f"{SAVANT}/statcast_search/csv?type=batter&player_id={player_id}"
           f"&year={season}&hfSea={season}%7C&hfGT=R%7C&pitcher_throws={hand}")
    try:
        rows = parse_savant_csv(fetch_url(url, timeout=30))
        return compute_xwoba_from_rows(rows)
    except Exception:
        return None


def compute_batter_hand_stats(batter_ids: list[int], season: int, home_team_id: int | None) -> dict[str, dict]:
    """Returns {"<playerId>": {"vsL": {wrcPlus?, xwoba?, pa?, ops?, woba?, hr?,
    rbi?}, "vsR": {...}}} for a newly-confirmed side's batters. wRC+/OPS/wOBA/
    HR/RBI all come from the same one batched MLB hydrate call (the split stat
    block already carries ops/homeRuns/rbi — no extra request needed); xwOBA
    from two Savant CSV fetches per batter, parallelized. Populating all of
    these together (not just wrcPlus/xwoba) is what lets the OPS/wOBA/HR/RBI
    shown in the UI stay real numbers instead of "—" for confirmed lineups
    under a hand filter, matching the live-fetch path in wrcComputed.ts."""
    if not batter_ids:
        return {}

    splits = fetch_batter_hand_splits(batter_ids, season)

    jobs = [(pid, hand) for pid in batter_ids for hand in ('L', 'R')]
    xwoba: dict[tuple[int, str], float | None] = {}
    with ThreadPoolExecutor(max_workers=min(len(jobs), 16)) as ex:
        futures = {
            ex.submit(fetch_batter_savant_hand_xwoba, pid, season, hand): (pid, hand)
            for pid, hand in jobs
        }
        for fut in as_completed(futures):
            key = futures[fut]
            try:
                xwoba[key] = fut.result()
            except Exception:
                xwoba[key] = None

    out: dict[str, dict] = {}
    for pid in batter_ids:
        entry: dict = {}
        s = splits.get(pid, {})
        for hand, key in (('L', 'vsL'), ('R', 'vsR')):
            stat = s.get(key)
            side: dict = {}
            if stat:
                wrc = compute_wrc_plus(stat, season, home_team_id)
                if wrc is not None:
                    side['wrcPlus'] = wrc
                pa = int(stat.get('plateAppearances') or 0)
                if pa:
                    side['pa'] = pa
                woba = compute_woba_raw(stat, season)
                if woba is not None:
                    side['woba'] = round(woba, 3)
                ops_raw = stat.get('ops')
                if ops_raw not in (None, '', '-.--'):
                    try:
                        side['ops'] = round(float(ops_raw), 3)
                    except (TypeError, ValueError):
                        pass
                hr = stat.get('homeRuns')
                if hr is not None:
                    side['hr'] = int(hr)
                rbi = stat.get('rbi')
                if rbi is not None:
                    side['rbi'] = int(rbi)
            xw = xwoba.get((pid, hand))
            if xw is not None:
                side['xwoba'] = round(xw, 3)
            if side:
                entry[key] = side
        if entry:
            out[str(pid)] = entry
    return out


def go_to_slots(go_to_entry: dict | None, opp_hand: str | None) -> list[dict]:
    """Maps a predictedLineup.ts-shaped PlayerPrediction[] into {playerId, battingOrder, position}."""
    if not go_to_entry:
        return []
    lineup = go_to_entry.get('vsLHP') if opp_hand == 'L' else go_to_entry.get('vsRHP')
    if not lineup:
        lineup = go_to_entry.get('vsRHP') or go_to_entry.get('vsLHP') or []
    return [
        {
            'playerId':     p['id'],
            'battingOrder': p.get('battingSpot', i + 1),
            'position':     p.get('pos', ''),
        }
        for i, p in enumerate(lineup)
    ]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--date', default=date.today().isoformat())
    ap.add_argument('--out',  default='public/data')
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f'lineup_status_{args.date}.json'

    existing: dict = {}
    if out_file.exists():
        try:
            existing = json.loads(out_file.read_text(encoding='utf-8'))
        except Exception as e:
            print(f"  WARNING: could not read existing {out_file}: {e} — starting fresh", flush=True)

    go_to_path = out_dir / 'go_to_lineups.json'
    go_to = json.loads(go_to_path.read_text(encoding='utf-8')) if go_to_path.exists() else {}
    if not go_to:
        print(f"  WARNING: {go_to_path} not found — goToLineup will be empty for all games.", flush=True)

    daily_path = out_dir / f'daily_stats_{args.date}.json'
    daily = json.loads(daily_path.read_text(encoding='utf-8')) if daily_path.exists() else {}
    season_batters = daily.get('batters', {}).get('season', {})
    if not season_batters:
        print(f"  WARNING: {daily_path} not found/empty — computedStats will be null until it's available.", flush=True)

    season = date.fromisoformat(args.date).year
    load_live_constants(season, out_dir)  # must happen before any compute_wrc_plus call below

    games = fetch_schedule(args.date)
    print(f"{len(games)} games for {args.date}.", flush=True)

    pitcher_ids = sorted({
        g['teams'][side]['probablePitcher']['id']
        for g in games for side in ('away', 'home')
        if g['teams'][side].get('probablePitcher')
    })
    hands = fetch_pitch_hands(pitcher_ids)

    result: dict = {}
    newly_confirmed = 0

    for g in games:
        pk = str(g['gamePk'])
        prev = existing.get(pk, {})
        away_team_id  = g['teams']['away']['team']['id']
        home_team_id  = g['teams']['home']['team']['id']
        away_pitcher  = g['teams']['away'].get('probablePitcher', {}).get('id')
        home_pitcher  = g['teams']['home'].get('probablePitcher', {}).get('id')

        boxscore = None  # lazy-fetched — skip entirely if both sides are already confirmed
        entry: dict = {}

        for side, team_id, opp_pitcher_id, out_key in (
            ('away', away_team_id, home_pitcher, 'awayTeam'),
            ('home', home_team_id, away_pitcher, 'homeTeam'),
        ):
            prev_side = prev.get(out_key)
            if prev_side and prev_side.get('status') == 'confirmed':
                entry[out_key] = prev_side  # computed exactly once already — copy through, never recompute
                continue

            if boxscore is None:
                boxscore = fetch_boxscore_lineup(g['gamePk'])

            opp_hand      = hands.get(opp_pitcher_id) if opp_pitcher_id else None
            go_to_lineup  = go_to_slots(go_to.get(str(team_id)), opp_hand)
            confirmed_slots = boxscore[side]

            if confirmed_slots:
                hand_stats = compute_batter_hand_stats(
                    [slot['playerId'] for slot in confirmed_slots], season, team_id,
                )
                computed_stats = {}
                for slot in confirmed_slots:
                    pid = str(slot['playerId'])
                    base = season_batters.get(pid)   # None if not in cache — rare call-up
                    hs = hand_stats.get(pid)
                    computed_stats[pid] = {**(base or {}), **(hs or {})} if (base or hs) else None
                entry[out_key] = {
                    'goToLineup':    go_to_lineup,
                    'todaysLineup':  confirmed_slots,
                    'status':        'confirmed',
                    'confirmedAt':   datetime.now(timezone.utc).isoformat(),
                    'computedStats': computed_stats,
                }
                newly_confirmed += 1
            else:
                entry[out_key] = {
                    'goToLineup':    go_to_lineup,
                    'todaysLineup':  None,
                    'status':        'projected',
                    'confirmedAt':   None,
                    'computedStats': None,
                }

        result[pk] = entry

    out_file.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(f"Wrote {out_file} — {len(result)} games, {newly_confirmed} newly confirmed this run.", flush=True)


if __name__ == '__main__':
    main()
