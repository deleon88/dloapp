#!/usr/bin/env python3
"""
compute_role_splits.py
=======================
PBP-derived matchup splits, computed incrementally from a single MLB Stats
API play-by-play walk, producing three outputs:

1. role_splits_{season}.json — per-batter raw counts vs-SP / vs-RP (starter
   vs reliever), season-cumulative. Unchanged in shape/behavior from the
   original version of this script.

2. hand_splits_daily_{season}.json — per-batter (bucketed by opposing
   PITCHER hand) and per-pitcher (bucketed by opposing BATTER hand) raw
   counts, bucketed by calendar DATE, pruned to the trailing
   HAND_SPLITS_PRUNE_DAYS. Internal/incremental — not fetched by the
   browser, only read by step 3 below.

3. hand_splits_rolling_{season}.json — the client-facing rollup: for each of
   the 4 rolling windows (60/30/14/7 days) as of today, sums (2)'s date
   buckets that fall inside that window. Fully recomputed from (2) every
   run — cheap, pure aggregation, no network calls.

Why PBP at all, for hand splits: MLB Stats API's native sitCodes=[vl,vr]
hitting split (see src/api/mlb/endpoints/wrcComputed.ts) works fine at
season granularity, but silently returns season-to-date totals even when
combined with byDateRange — verified empirically that it CANNOT answer "vs
LHP over the last 30 days". PBP is the only way to get a real, date-scoped
hand split.

Why bat_side is needed alongside pitch_hand: pitch_hand (the pitcher's own
throwing hand) is enough to bucket BATTERS by opposing pitcher hand. But
bucketing PITCHERS by opposing batter hand needs the batter's own hand for
that specific PA (bat_side) — correctly reflects what a switch-hitter
actually batted as on that play, no special-casing needed.

Incremental, no separate backfill flag needed: hand_new_pks is always
bounded to the trailing HAND_SPLITS_PRUNE_DAYS, so the FIRST run naturally
backfills exactly that window (bounded cost, ~900 games), and every
subsequent run only has genuinely new games left to process (already-seen
games stay marked done in processedGamePks even after their date bucket
ages out of the 60-day window — they're never re-fetched).

Usage:
    python scripts/compute_role_splits.py [--season 2026] [--out public/data] [--workers 15]
"""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compute_linear_weights import (  # noqa: E402
    MLB_API, ALL_PA_EVENTS, NON_AB, _get, fetch_game_pks, fetch_game_plays,
)

BATTER_FIELDS  = ('ab', 'h1', 'h2', 'h3', 'hr', 'bb', 'ibb', 'hbp', 'sf', 'pa', 'rbi')
PITCHER_FIELDS = ('ab', 'h1', 'h2', 'h3', 'hr', 'bb', 'ibb', 'hbp', 'sf', 'pa', 'so', 'outs')
ROLLING_WINDOWS = {'60days': 60, '30days': 30, '14days': 14, '7days': 7}
HAND_SPLITS_PRUNE_DAYS = 60


def _empty_counts(fields: tuple) -> dict:
    return {k: 0 for k in fields}


def _tally_event(counts: dict, event: str) -> None:
    """Mutates counts in place from a single PA-ending event. Shared by
    batter (BATTER_FIELDS) and pitcher (PITCHER_FIELDS) buckets — the 'so'
    key's presence signals a pitcher bucket (strikeouts aren't tracked on
    the batter side, which uses `so` implicitly via NON_AB instead)."""
    counts['pa'] += 1
    if event not in NON_AB:
        counts['ab'] += 1
    if event == 'Single':
        counts['h1'] += 1
    elif event == 'Double':
        counts['h2'] += 1
    elif event == 'Triple':
        counts['h3'] += 1
    elif event == 'Home Run':
        counts['hr'] += 1
    elif event == 'Walk':
        counts['bb'] += 1
    elif event == 'Intent Walk':
        counts['bb'] += 1
        counts['ibb'] += 1
    elif event == 'Hit By Pitch':
        counts['hbp'] += 1
    elif event in ('Sac Fly', 'Sac Fly Double Play'):
        counts['sf'] += 1
    if 'so' in counts and event in ('Strikeout', 'Strikeout Double Play'):
        counts['so'] += 1


def _sum_counts(dicts: list[dict], fields: tuple) -> dict:
    out = _empty_counts(fields)
    for d in dicts:
        for k in fields:
            out[k] += d.get(k, 0)
    return out


# ── Boxscore: who started for each side ────────────────────────────────────

def fetch_starters(game_pk: int) -> dict[str, int | None]:
    """Returns {'away': starterId|None, 'home': starterId|None}."""
    try:
        data = _get(
            f"{MLB_API}/game/{game_pk}/boxscore"
            f"?fields=teams,away,home,pitchers"
        )
    except Exception:
        return {'away': None, 'home': None}
    teams = data.get('teams', {})
    out: dict[str, int | None] = {}
    for side in ('away', 'home'):
        pitchers = teams.get(side, {}).get('pitchers', [])
        out[side] = pitchers[0] if pitchers else None
    return out


# ── Schedule: gamePk -> date (needed for hand-split date bucketing) ────────

def fetch_game_pks_with_dates(season: int) -> dict[int, str]:
    """All completed regular-season game PKs for the season, mapped to their date."""
    url = (
        f"{MLB_API}/schedule?sportId=1&season={season}&gameType=R"
        f"&fields=dates,date,games,gamePk,status,abstractGameState"
    )
    data = _get(url)
    out: dict[int, str] = {}
    for d in data.get('dates', []):
        game_date = d.get('date')
        for g in d.get('games', []):
            if g.get('status', {}).get('abstractGameState') == 'Final':
                out[g['gamePk']] = game_date
    return out


# ── Per-game processing ─────────────────────────────────────────────────────

def process_game(game_pk: int) -> list[dict]:
    """
    Returns one dict per PA play in this game:
      {batter_id, pitcher_id, event, role, pitch_hand, bat_side, outs_recorded, rbi}
    role is None if the starter couldn't be determined (dropped by role-split
    tallying, but still usable for hand-split tallying, which doesn't need it).
    """
    plays = fetch_game_plays(game_pk)
    if not plays:
        return []
    starters = fetch_starters(game_pk)

    out = []
    for p in plays:
        if not p['is_pa'] or p['batter_id'] is None or p['pitcher_id'] is None:
            continue
        pitching_side = 'home' if p['half'] == 'top' else 'away'
        starter_id = starters.get(pitching_side)
        role = None if starter_id is None else ('SP' if p['pitcher_id'] == starter_id else 'RP')
        out.append({
            'batter_id':     p['batter_id'],
            'pitcher_id':    p['pitcher_id'],
            'event':         p['event'],
            'role':          role,
            'pitch_hand':    p.get('pitch_hand'),
            'bat_side':      p.get('bat_side'),
            'outs_recorded': p.get('outs_recorded', 0),
            'rbi':           p.get('rbi', 0),
        })
    return out


def fetch_all_games(game_pks: list[int], workers: int) -> dict[int, list[dict]]:
    """Fetches + parses each game exactly once. Returns {gamePk: [pa_event, ...]}."""
    out: dict[int, list[dict]] = {}
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process_game, pk): pk for pk in game_pks}
        for fut in as_completed(futures):
            pk = futures[fut]
            try:
                out[pk] = fut.result()
            except Exception as e:
                print(f"  WARNING: game {pk} failed: {e}", flush=True)
                out[pk] = []
            done += 1
            if done % 50 == 0 or done == len(game_pks):
                print(f"  {done}/{len(game_pks)} games fetched...", flush=True)
    return out


def _merge_counts(a: dict, b: dict, fields: tuple) -> dict:
    return {k: a.get(k, 0) + b.get(k, 0) for k in fields}


# ── role_splits_{season}.json (unchanged shape/behavior) ───────────────────

def build_role_splits_delta(pa_by_game: dict[int, list[dict]]) -> dict[int, dict]:
    delta: dict[int, dict[str, dict]] = {}
    for pa_events in pa_by_game.values():
        for ev in pa_events:
            if ev['role'] not in ('SP', 'RP'):
                continue
            bucket = delta.setdefault(ev['batter_id'], {'vsSP': _empty_counts(BATTER_FIELDS), 'vsRP': _empty_counts(BATTER_FIELDS)})
            _tally_event(bucket[f"vs{ev['role']}"], ev['event'])
            bucket[f"vs{ev['role']}"]['rbi'] += ev['rbi']
    return delta


# ── hand_splits_daily_{season}.json ─────────────────────────────────────────

def build_hand_splits_by_date(pa_by_game: dict[int, list[dict]], game_dates: dict[int, str]) -> dict[str, dict]:
    """Returns {date: {'batters': {id: {vsL, vsR}}, 'pitchers': {id: {vsLHB, vsRHB}}}}."""
    by_date: dict[str, dict] = {}
    for pk, pa_events in pa_by_game.items():
        game_date = game_dates.get(pk)
        if not game_date:
            continue
        bucket = by_date.setdefault(game_date, {'batters': {}, 'pitchers': {}})
        for ev in pa_events:
            # Batter side: bucket by the opposing PITCHER's throwing hand.
            if ev['pitch_hand'] in ('L', 'R'):
                bkey = 'vsL' if ev['pitch_hand'] == 'L' else 'vsR'
                bp = bucket['batters'].setdefault(str(ev['batter_id']), {'vsL': _empty_counts(BATTER_FIELDS), 'vsR': _empty_counts(BATTER_FIELDS)})
                _tally_event(bp[bkey], ev['event'])
                bp[bkey]['rbi'] += ev['rbi']

            # Pitcher side: bucket by the opposing BATTER's hand for this specific PA
            # (bat_side reflects what a switch-hitter actually batted as on this play).
            if ev['bat_side'] in ('L', 'R'):
                pkey = 'vsLHB' if ev['bat_side'] == 'L' else 'vsRHB'
                pp = bucket['pitchers'].setdefault(str(ev['pitcher_id']), {'vsLHB': _empty_counts(PITCHER_FIELDS), 'vsRHB': _empty_counts(PITCHER_FIELDS)})
                _tally_event(pp[pkey], ev['event'])
                pp[pkey]['outs'] += ev['outs_recorded']
    return by_date


def merge_hand_splits_dates(existing: dict, delta: dict) -> dict:
    """Merges delta's per-date buckets into existing (additive per date —
    a date should only ever be touched once, but this stays correct even
    if a date somehow gets re-processed)."""
    merged = {k: v for k, v in existing.items()}
    for game_date, buckets in delta.items():
        cur = merged.setdefault(game_date, {'batters': {}, 'pitchers': {}})
        for bid, counts in buckets['batters'].items():
            existing_b = cur['batters'].setdefault(bid, {'vsL': _empty_counts(BATTER_FIELDS), 'vsR': _empty_counts(BATTER_FIELDS)})
            cur['batters'][bid] = {
                'vsL': _merge_counts(existing_b['vsL'], counts['vsL'], BATTER_FIELDS),
                'vsR': _merge_counts(existing_b['vsR'], counts['vsR'], BATTER_FIELDS),
            }
        for pid, counts in buckets['pitchers'].items():
            existing_p = cur['pitchers'].setdefault(pid, {'vsLHB': _empty_counts(PITCHER_FIELDS), 'vsRHB': _empty_counts(PITCHER_FIELDS)})
            cur['pitchers'][pid] = {
                'vsLHB': _merge_counts(existing_p['vsLHB'], counts['vsLHB'], PITCHER_FIELDS),
                'vsRHB': _merge_counts(existing_p['vsRHB'], counts['vsRHB'], PITCHER_FIELDS),
            }
    return merged


def prune_old_dates(dates: dict, today: date, keep_days: int) -> dict:
    cutoff = (today - timedelta(days=keep_days)).isoformat()
    return {d: v for d, v in dates.items() if d >= cutoff}


# ── hand_splits_rolling_{season}.json ───────────────────────────────────────

def build_rolling_rollup(dates: dict, today: date) -> dict:
    windows_out = {}
    for label, days in ROLLING_WINDOWS.items():
        cutoff = (today - timedelta(days=days)).isoformat()
        in_window = [v for d, v in dates.items() if d >= cutoff]

        batters: dict[str, dict] = {}
        pitchers: dict[str, dict] = {}
        for bucket in in_window:
            for bid, counts in bucket['batters'].items():
                acc = batters.setdefault(bid, {'vsL': [], 'vsR': []})
                acc['vsL'].append(counts['vsL'])
                acc['vsR'].append(counts['vsR'])
            for pid, counts in bucket['pitchers'].items():
                acc = pitchers.setdefault(pid, {'vsLHB': [], 'vsRHB': []})
                acc['vsLHB'].append(counts['vsLHB'])
                acc['vsRHB'].append(counts['vsRHB'])

        windows_out[label] = {
            'asOf': today.isoformat(),
            'batters': {
                bid: {'vsL': _sum_counts(v['vsL'], BATTER_FIELDS), 'vsR': _sum_counts(v['vsR'], BATTER_FIELDS)}
                for bid, v in batters.items()
            },
            'pitchers': {
                pid: {'vsLHB': _sum_counts(v['vsLHB'], PITCHER_FIELDS), 'vsRHB': _sum_counts(v['vsRHB'], PITCHER_FIELDS)}
                for pid, v in pitchers.items()
            },
        }
    return windows_out


# ── Main ──────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--season',  type=int, default=date.today().year)
    ap.add_argument('--out',     default='public/data')
    ap.add_argument('--workers', type=int, default=15)
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    today = date.today()

    role_file = out_dir / f'role_splits_{args.season}.json'
    hand_daily_file = out_dir / f'hand_splits_daily_{args.season}.json'
    hand_rolling_file = out_dir / f'hand_splits_rolling_{args.season}.json'

    role_existing = {'season': args.season, 'splits': {}, 'processedGamePks': []}
    if role_file.exists():
        try:
            role_existing = json.loads(role_file.read_text(encoding='utf-8'))
        except Exception as e:
            print(f"  WARNING: could not read existing {role_file}: {e} — starting fresh", flush=True)

    hand_existing = {'season': args.season, 'processedGamePks': [], 'dates': {}}
    if hand_daily_file.exists():
        try:
            hand_existing = json.loads(hand_daily_file.read_text(encoding='utf-8'))
        except Exception as e:
            print(f"  WARNING: could not read existing {hand_daily_file}: {e} — starting fresh", flush=True)

    role_done = set(role_existing.get('processedGamePks', []))
    hand_done = set(hand_existing.get('processedGamePks', []))

    print(f"Fetching {args.season} completed game list (with dates)...", flush=True)
    game_dates = fetch_game_pks_with_dates(args.season)
    print(f"  {len(game_dates)} completed games total.", flush=True)

    role_new_pks = [pk for pk in game_dates if pk not in role_done]

    # hand_splits_daily only ever needs the trailing HAND_SPLITS_PRUNE_DAYS —
    # on the very first run this naturally IS the backfill (bounded, ~900
    # games max); on every later run it's just last night's new games, since
    # older games stay marked done even after their date bucket gets pruned.
    hand_cutoff = (today - timedelta(days=HAND_SPLITS_PRUNE_DAYS)).isoformat()
    hand_new_pks = [pk for pk, d in game_dates.items() if pk not in hand_done and d >= hand_cutoff]

    fetch_pks = sorted(set(role_new_pks) | set(hand_new_pks))
    print(f"  {len(role_new_pks)} new for role_splits, {len(hand_new_pks)} new for hand_splits "
          f"(trailing {HAND_SPLITS_PRUNE_DAYS}d) — {len(fetch_pks)} games to fetch.", flush=True)

    if not fetch_pks:
        print("Nothing new to process.", flush=True)
        return

    pa_by_game = fetch_all_games(fetch_pks, args.workers)

    # ── role_splits_{season}.json ───────────────────────────────────────────
    role_pa = {pk: pa_by_game[pk] for pk in role_new_pks}
    role_delta = build_role_splits_delta(role_pa)
    splits = {str(k): v for k, v in role_existing.get('splits', {}).items()}
    for batter_id, buckets in role_delta.items():
        key = str(batter_id)
        if key not in splits:
            splits[key] = {'vsSP': _empty_counts(BATTER_FIELDS), 'vsRP': _empty_counts(BATTER_FIELDS)}
        splits[key]['vsSP'] = _merge_counts(splits[key]['vsSP'], buckets['vsSP'], BATTER_FIELDS)
        splits[key]['vsRP'] = _merge_counts(splits[key]['vsRP'], buckets['vsRP'], BATTER_FIELDS)

    role_result = {
        'season': args.season,
        'source': 'MLB Stats API playByPlay + boxscore (starter = pitchers[0])',
        'processedGamePks': sorted(role_done | set(role_new_pks)),
        'splits': splits,
    }
    role_file.write_text(json.dumps(role_result, indent=2), encoding='utf-8')
    print(f"Wrote {role_file} — {len(splits)} batters, {len(role_result['processedGamePks'])} games processed total.", flush=True)

    # ── hand_splits_daily_{season}.json ─────────────────────────────────────
    hand_pa = {pk: pa_by_game[pk] for pk in hand_new_pks}
    hand_delta = build_hand_splits_by_date(hand_pa, game_dates)
    merged_dates = merge_hand_splits_dates(hand_existing.get('dates', {}), hand_delta)
    pruned_dates = prune_old_dates(merged_dates, today, HAND_SPLITS_PRUNE_DAYS)

    hand_daily_result = {
        'season': args.season,
        'processedGamePks': sorted(hand_done | set(hand_new_pks)),
        'dates': pruned_dates,
    }
    hand_daily_file.write_text(json.dumps(hand_daily_result, indent=2), encoding='utf-8')
    n_batters = len({bid for v in pruned_dates.values() for bid in v['batters']})
    n_pitchers = len({pid for v in pruned_dates.values() for pid in v['pitchers']})
    print(f"Wrote {hand_daily_file} — {len(pruned_dates)} dates kept, "
          f"{n_batters} batters / {n_pitchers} pitchers seen in that window.", flush=True)

    # ── hand_splits_rolling_{season}.json ───────────────────────────────────
    rolling_result = {
        'season': args.season,
        'generated': datetime.now(timezone.utc).isoformat(),
        'windows': build_rolling_rollup(pruned_dates, today),
    }
    hand_rolling_file.write_text(json.dumps(rolling_result, indent=2), encoding='utf-8')
    for label in ROLLING_WINDOWS:
        w = rolling_result['windows'][label]
        print(f"  {label}: {len(w['batters'])} batters, {len(w['pitchers'])} pitchers", flush=True)
    print(f"Wrote {hand_rolling_file}", flush=True)


if __name__ == '__main__':
    main()
