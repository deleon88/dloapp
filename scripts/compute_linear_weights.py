#!/usr/bin/env python3
"""
compute_linear_weights.py
=========================
Compute FanGraphs-style wOBA linear weights from MLB Stats API play-by-play.

Algorithm:
  1. Fetch all completed regular-season game PKs via /schedule
  2. Fetch PBP for each game concurrently via /game/{gamePk}/playByPlay
  3. Build RE24 -- correct pre-state: outs = previous play's count.outs (post),
     reset to 0 at each half-inning start; runners from runners[].movement.start
  4. Linear weight = mean(RE[post] - RE[pre] + runs_scored) per event type
  5. Center at avg out value, scale to OBP scale -> wOBA weights + wOBAScale

Usage:
    python scripts/compute_linear_weights.py [--season 2026] [--out data] [--workers 15]

Output: data/linear_weights_<season>.json
"""
import argparse
import json
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

MLB_API = "https://statsapi.mlb.com/api/v1"

# MLB Stats API result.event names (verified against actual API responses)
WOBA_EVENTS = {
    'Walk', 'Intent Walk', 'Hit By Pitch',
    'Single', 'Double', 'Triple', 'Home Run',
}
ALL_PA_EVENTS = WOBA_EVENTS | {
    # Standard outs
    'Strikeout', 'Groundout', 'Flyout', 'Lineout', 'Pop Out',
    'Forceout', 'Grounded Into DP', 'Double Play', 'Triple Play',
    # Strikeout variants
    'Strikeout Double Play',
    # Fielder's choice
    'Fielders Choice', 'Fielders Choice Out',
    # Sacrifice plays
    'Sac Fly', 'Sac Fly Double Play',
    'Sac Bunt', 'Sac Bunt Double Play',
    # Interference / errors
    'Catcher Interference', 'Batter Interference', 'Field Error',
}
NON_AB = {
    'Walk', 'Intent Walk', 'Hit By Pitch',
    'Sac Fly', 'Sac Fly Double Play',
    'Sac Bunt', 'Sac Bunt Double Play',
    'Catcher Interference', 'Batter Interference',
}

FG_2026 = {
    'wBB': 0.702, 'wHBP': 0.734, 'w1B': 0.898,
    'w2B': 1.278, 'w3B': 1.621, 'wHR': 2.090,
    'lgwOBA': 0.316, 'wOBAScale': 1.267, 'lgRPA': 0.116,
}


# ── HTTP helper ───────────────────────────────────────────────────────────────

def _get(url: str, retries: int = 3) -> dict:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "re24-lw/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(1.5 ** attempt)
    return {}


# ── Data fetch ────────────────────────────────────────────────────────────────

def fetch_game_pks(season: int) -> list[int]:
    """All completed regular-season game PKs for the season."""
    url = (
        f"{MLB_API}/schedule?sportId=1&season={season}&gameType=R"
        f"&fields=dates,games,gamePk,status,abstractGameState"
    )
    data = _get(url)
    pks = []
    for d in data.get('dates', []):
        for g in d.get('games', []):
            if g.get('status', {}).get('abstractGameState') == 'Final':
                pks.append(g['gamePk'])
    return pks


def _update_bases(current: set, runners: list) -> tuple[set, int]:
    """
    Compute (new_bases, runs_scored) from runner movements.

    Non-moving runners do NOT appear in the runners list — they persist
    implicitly because nothing removes them from `current`.

    For multi-movement runners (e.g. 1B→2B then 2B→3B), the last entry's
    `end` value wins (overwrites the intermediate position).

    Formula: new_bases = (current - moved_from) | moved_to
    """
    last_end: dict = {}
    for r in runners:
        mv = r.get('movement', {})
        last_end[mv.get('originBase')] = mv.get('end')

    moved_from = {ob  for ob  in last_end         if ob  in ('1B', '2B', '3B')}
    moved_to   = {end for end in last_end.values() if end in ('1B', '2B', '3B')}
    runs       = sum(1 for end in last_end.values() if end == 'score')
    return (current - moved_from) | moved_to, runs


def fetch_game_plays(game_pk: int) -> list[dict]:
    """
    Fetch PBP for one game. Returns one dict per play (PA-ending AND
    action plays like steals/wild-pitches) with:
      is_pa, event, game_pk, inning, half,
      pre_outs, on_1b, on_2b, on_3b, runs_scored,
      batter_id, pitcher_id, pitch_hand, bat_side, outs_recorded, rbi

    batter_id/pitcher_id/pitch_hand/bat_side/outs_recorded/rbi come from the
    play's matchup/result objects — used by compute_role_splits.py for
    vs-SP/vs-RP and vs-hand bucketing, not by the RE24 weight derivation
    below (which ignores them). pitch_hand is the PITCHER's throwing hand;
    bat_side is the BATTER's own batting hand (needed to bucket pitchers by
    opposing batter hand — pitch_hand alone only covers bucketing batters by
    opposing pitcher hand). outs_recorded = outs added by this specific play
    (handles double/triple plays correctly, unlike assuming 1 out per PA).

    Uses forward state-tracking instead of originBase so that non-moving
    runners (who don't appear in the runners list) are correctly captured.

    count.outs = outs AFTER the play; prev_outs tracks pre-state outs.
    """
    try:
        data = _get(f"{MLB_API}/game/{game_pk}/playByPlay")
    except Exception:
        return []

    all_plays   = data.get('allPlays', [])
    result      = []
    prev_outs   = 0
    cur_bases: set = set()
    cur_inning  = None
    cur_half    = None

    for play in all_plays:
        about  = play.get('about', {})
        inning = about.get('inning', 0)
        half   = about.get('halfInning', '')

        if (inning, half) != (cur_inning, cur_half):
            prev_outs = 0
            cur_bases = set()
            cur_inning, cur_half = inning, half

        count     = play.get('count', {})
        post_outs = count.get('outs', prev_outs)
        runners   = play.get('runners', [])
        event     = play.get('result', {}).get('event', '').strip()
        is_pa     = event in ALL_PA_EVENTS
        matchup   = play.get('matchup', {})

        new_bases, runs = _update_bases(cur_bases, runners)

        result.append({
            'is_pa':       is_pa,
            'event':       event,
            'game_pk':     game_pk,
            'inning':      inning,
            'half':        half,
            'pre_outs':    prev_outs,
            'on_1b':       '1B' in cur_bases,
            'on_2b':       '2B' in cur_bases,
            'on_3b':       '3B' in cur_bases,
            'runs_scored': runs,
            'batter_id':     matchup.get('batter', {}).get('id'),
            'pitcher_id':    matchup.get('pitcher', {}).get('id'),
            'pitch_hand':    matchup.get('pitchHand', {}).get('code'),
            'bat_side':      matchup.get('batSide', {}).get('code'),
            'outs_recorded': post_outs - prev_outs,
            'rbi':           play.get('result', {}).get('rbi', 0) or 0,
        })

        cur_bases = new_bases
        prev_outs = post_outs

    return result


def fetch_all_plays(season: int, workers: int = 15) -> list[dict]:
    """Fetch PBP for all completed games in the season concurrently."""
    print(f"Fetching {season} schedule...", flush=True)
    pks = fetch_game_pks(season)
    print(f"  {len(pks)} completed games.", flush=True)

    all_plays: list[dict] = []
    done = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_game_plays, pk): pk for pk in pks}
        for fut in as_completed(futures):
            plays = fut.result()
            all_plays.extend(plays)
            done += 1
            if done % 100 == 0 or done == len(pks):
                print(f"  {done}/{len(pks)} games  ({len(all_plays):,} PA)...", flush=True)

    print(f"  Done: {len(pks)} games, {len(all_plays):,} PA plays.", flush=True)
    return all_plays


# ── RE24 + linear weights ─────────────────────────────────────────────────────

def _group_by_half_inning(plays: list[dict]) -> dict[tuple, list[dict]]:
    hi: dict[tuple, list[dict]] = defaultdict(list)
    for p in plays:
        hi[(p['game_pk'], p['inning'], p['half'])].append(p)
    return hi


def build_re24(plays: list[dict]) -> dict[tuple, float]:
    """
    Backwards pass through each half-inning using ALL plays (PA + action).
    Runs from action plays (wild pitches, steals of home, etc.) are included
    in the run total so RE24 reflects all ways runs are scored.
    State observations are recorded only for PA-ending plays.
    """
    totals: dict[tuple, float] = defaultdict(float)
    counts: dict[tuple, int]   = defaultdict(int)

    for hi in _group_by_half_inning(plays).values():
        runs_rem = 0.0
        for p in reversed(hi):
            runs_rem += p['runs_scored']
            if p['is_pa']:
                state = (p['pre_outs'], p['on_1b'], p['on_2b'], p['on_3b'])
                totals[state] += runs_rem
                counts[state] += 1

    return {s: totals[s] / counts[s] for s in counts}


def compute_run_values(plays: list[dict], RE24: dict[tuple, float]) -> dict[str, float]:
    """
    Forward pass over PA plays only.
    run_value = RE24[post_state] - RE24[pre_state] + runs_scored
    post_state = next PA's pre_state within same half-inning; 0 at inning end.
    """
    # Filter to PA plays; group by half-inning preserving order
    pa_by_hi: dict[tuple, list[dict]] = defaultdict(list)
    for p in plays:
        if p['is_pa']:
            pa_by_hi[(p['game_pk'], p['inning'], p['half'])].append(p)

    samples: dict[str, list[float]] = defaultdict(list)

    for hi in pa_by_hi.values():
        for i, p in enumerate(hi):
            pre_state = (p['pre_outs'], p['on_1b'], p['on_2b'], p['on_3b'])
            if i + 1 < len(hi):
                nxt = hi[i + 1]
                post_state = (nxt['pre_outs'], nxt['on_1b'], nxt['on_2b'], nxt['on_3b'])
                re_post = RE24.get(post_state, 0.0)
            else:
                re_post = 0.0
            re_pre = RE24.get(pre_state, 0.0)
            samples[p['event']].append(re_post - re_pre + p['runs_scored'])

    return {ev: sum(v) / len(v) for ev, v in samples.items() if v}


def scale_to_woba(lw_raw: dict[str, float], plays: list[dict]) -> dict:
    """
    Scale run values to wOBA (OBP) scale:
      1. Center at average out value (subtract lw_out)
      2. lgwOBA_unscaled from centered weights + counting stats
      3. scale = lgOBP / lgwOBA_unscaled
      4. wOBAScale = 1/scale
    """
    ab = h1 = h2 = h3 = hr = bb = ibb = hbp = sf = pa = total_runs = 0
    for p in plays:
        if not p.get('is_pa'):
            continue
        ev = p['event']
        if ev not in ALL_PA_EVENTS:
            continue
        pa         += 1
        total_runs += p['runs_scored']
        if ev not in NON_AB:
            ab += 1
        if   ev == 'Single':        h1  += 1
        elif ev == 'Double':        h2  += 1
        elif ev == 'Triple':        h3  += 1
        elif ev == 'Home Run':      hr  += 1
        elif ev == 'Walk':          bb  += 1
        elif ev == 'Intent Walk':   bb  += 1; ibb += 1
        elif ev == 'Hit By Pitch':  hbp += 1
        elif ev in ('Sac Fly', 'Sac Fly Double Play'): sf += 1

    ubb = bb - ibb
    h   = h1 + h2 + h3 + hr

    lw_out = lw_raw.get('Groundout') or lw_raw.get('Flyout') or lw_raw.get('Strikeout') or -0.27

    c = {
        'wBB':  lw_raw.get('Walk', 0)          - lw_out,
        'wHBP': lw_raw.get('Hit By Pitch', 0)  - lw_out,
        'w1B':  lw_raw.get('Single', 0)        - lw_out,
        'w2B':  lw_raw.get('Double', 0)        - lw_out,
        'w3B':  lw_raw.get('Triple', 0)        - lw_out,
        'wHR':  lw_raw.get('Home Run', 0)      - lw_out,
    }

    denom      = ab + ubb + hbp + sf
    lgwOBA_raw = (
        c['wBB'] * ubb + c['wHBP'] * hbp +
        c['w1B'] * h1  + c['w2B']  * h2  +
        c['w3B'] * h3  + c['wHR']  * hr
    ) / denom if denom else 0.0

    obp_denom = ab + bb + hbp + sf
    lgOBP     = (h + bb + hbp) / obp_denom if obp_denom else 0.0

    scale = lgOBP / lgwOBA_raw if lgwOBA_raw else 1.0

    weights = {k: round(v * scale, 3) for k, v in c.items()}
    weights['lgwOBA']     = round(lgOBP, 3)
    weights['wOBAScale']  = round(scale, 3)          # = lgOBP / lgwOBA_raw
    weights['lgwOBA_raw'] = round(lgwOBA_raw, 4)     # for diagnostics
    weights['lgRPA']      = round(total_runs / pa, 3) if pa else 0.0

    return weights


# ── lgHR/FB from PBP ─────────────────────────────────────────────────────────

_HR_EVENT      = 'Home Run'
_FB_OUT_EVENTS = {'Flyout', 'Sac Fly', 'Sac Fly Double Play'}   # outfield only; Pop Out = infield popup, excluded

def compute_lghrfb(plays: list[dict]) -> float | None:
    """
    League HR/FB rate from PBP events.
    FanGraphs definition: HR / (HR + outfield fly ball outs).
    Pop Outs (infield popups) are excluded to match FanGraphs.
    """
    hr = fb_out = 0
    for p in plays:
        if not p.get('is_pa'):
            continue
        ev = p['event']
        if ev == _HR_EVENT:
            hr += 1
        elif ev in _FB_OUT_EVENTS:
            fb_out += 1
    denom = hr + fb_out
    return hr / denom if denom else None


# ── FIP constants ─────────────────────────────────────────────────────────────

def _ip_to_dec(ip: str | float) -> float:
    """'15.1' → 15.333…  (the .N suffix means N/3 of an inning, not tenths)."""
    try:
        whole, frac = str(ip).split('.')
        return int(whole) + int(frac) / 3
    except ValueError:
        return float(ip)


def compute_fip_constants(season: int) -> dict:
    """
    Fetch team pitching totals and compute cFIP, lgFIP, lgHRFB.

    FIP = (13·HR + 3·(BB+HBP) - 2·K) / IP + cFIP
    cFIP  = lgERA - (13·ΣHR + 3·Σ(BB+HBP) - 2·ΣK) / ΣIP  (so lgFIP = lgERA)
    lgHRFB = ΣHR / (ΣHR + ΣflyOuts)   (fly-ball HR rate; flyOuts excludes HR)
    """
    url = (
        f"{MLB_API}/teams/stats"
        f"?group=pitching&season={season}&sportIds=1&gameType=R&stats=season"
        f"&fields=stats,splits,stat,earnedRuns,inningsPitched,homeRuns,"
        f"baseOnBalls,hitByPitch,strikeOuts,flyOuts"
    )
    try:
        data = _get(url)
    except Exception as e:
        print(f"  WARNING: could not fetch pitching stats: {e}")
        return {}

    tot_er = tot_ip = tot_hr = tot_bb = tot_hbp = tot_k = tot_fly = 0.0
    for sg in data.get('stats', []):
        for sp in sg.get('splits', []):
            s = sp.get('stat', {})
            tot_er  += s.get('earnedRuns',    0) or 0
            tot_ip  += _ip_to_dec(s.get('inningsPitched', 0) or 0)
            tot_hr  += s.get('homeRuns',      0) or 0
            tot_bb  += s.get('baseOnBalls',   0) or 0
            tot_hbp += s.get('hitByPitch',    0) or 0
            tot_k   += s.get('strikeOuts',    0) or 0
            tot_fly += s.get('flyOuts',       0) or 0

    if tot_ip == 0:
        print("  WARNING: no pitching IP — skipping FIP constants.")
        return {}

    lg_era   = 9.0 * tot_er / tot_ip
    fip_raw  = (13 * tot_hr + 3 * (tot_bb + tot_hbp) - 2 * tot_k) / tot_ip
    c_fip    = lg_era - fip_raw
    # fly_balls = flyOuts (outs on fly balls, HR excluded) + HR
    lg_hrfb  = tot_hr / (tot_hr + tot_fly) if (tot_hr + tot_fly) > 0 else 0.0

    return {
        'lgFIP':   round(lg_era, 3),
        'cFIP':    round(c_fip, 3),
        'lgHRFB':  round(lg_hrfb, 3),
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--season',  type=int, default=date.today().year)
    ap.add_argument('--out',     default='data')
    ap.add_argument('--workers', type=int, default=15)
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    plays = fetch_all_plays(args.season, args.workers)
    pa_plays = [p for p in plays if p['is_pa']]
    print(f"\n{len(plays):,} total plays ({len(pa_plays):,} PA-ending).", flush=True)

    if len(pa_plays) < 5_000:
        print("WARNING: very few PA plays -- check season/network.")

    print(f"Computing RE24...", flush=True)
    RE24 = build_re24(plays)
    print(f"  {len(RE24)} / 24 base-out states observed.", flush=True)

    print("Computing event run values...", flush=True)
    lw_raw = compute_run_values(plays, RE24)

    print("Scaling to wOBA scale...", flush=True)
    weights = scale_to_woba(lw_raw, plays)

    print("Computing lgHR/FB from PBP events...", flush=True)
    lghrfb = compute_lghrfb(plays)
    if lghrfb is not None:
        print(f"  lgHRFB={lghrfb:.4f}  ({lghrfb*100:.1f}%)", flush=True)

    print("Computing FIP constants (cFIP, lgFIP) from team pitching totals...", flush=True)
    fip_consts = compute_fip_constants(args.season)
    if fip_consts:
        print(f"  lgFIP={fip_consts['lgFIP']}  cFIP={fip_consts['cFIP']}", flush=True)
    if lghrfb is not None:
        fip_consts['lgHRFB'] = round(lghrfb, 4)

    result = {
        'season':      args.season,
        'source':      'MLB Stats API PBP + RE24',
        'pa_count':    len(pa_plays),
        're24_states': len(RE24),
        **weights,
        **fip_consts,
        '_raw_lw': {k: round(v, 4) for k, v in sorted(lw_raw.items())},
    }

    out_file = out_dir / f'linear_weights_{args.season}.json'
    out_file.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(f"\nWrote {out_file}", flush=True)

    print(f"\n-- {args.season} wOBA constants (computed vs FanGraphs) --")
    for key in ('wBB', 'wHBP', 'w1B', 'w2B', 'w3B', 'wHR', 'lgwOBA', 'wOBAScale', 'lgRPA'):
        computed = weights.get(key, '?')
        fg_val   = FG_2026.get(key, '?')
        try:
            diff = f"  delta={computed - fg_val:+.3f}"
        except Exception:
            diff = ''
        print(f"  {key:<12} {computed}{diff}  (FanGraphs: {fg_val})")

    print(f"\n-- RE24 sample (0 outs) --")
    for bases in [
        (False, False, False),
        (True,  False, False),
        (False, True,  False),
        (False, False, True),
    ]:
        state = (0, *bases)
        lbl = (''.join([
            '1B' if bases[0] else '',
            '2B' if bases[1] else '',
            '3B' if bases[2] else '',
        ]) or '---')
        re_val = RE24.get(state)
        if re_val is not None:
            print(f"  0 out {lbl:<6}: {re_val:.3f} RE")
        else:
            print(f"  0 out {lbl:<6}: n/a")


if __name__ == '__main__':
    main()
