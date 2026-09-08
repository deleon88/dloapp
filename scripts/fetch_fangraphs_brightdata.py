#!/usr/bin/env python3
"""
fetch_fangraphs_brightdata.py
==============================
PRIMARY source for public/data/linear_weights_{season}.json — scrapes
FanGraphs' real Guts page via Bright Data Web Unlocker (validated in
scripts/test_brightdata_fangraphs.py: exact match against manually-verified
2025 constants) instead of approximating wOBA weights from play-by-play.

compute_linear_weights.py's RE24 method is kept only as a fallback for when
Bright Data is unavailable (missing credentials, Cloudflare block, zone
quota, network error) — see .github/workflows/refresh-constants.yml, which
tries this script first and falls back to RE24 on any failure.

lgFIP is NOT a Guts-page column — computed separately via
compute_linear_weights.py's compute_fip_constants(), which aggregates MLB
Stats API team pitching totals directly (no PBP, no RE24, deterministic).
lgHRFB has no reliable non-PBP source yet; kept at a fallback value with a
TODO, same approach already used for the 2025 constants fix.

Usage:
    python scripts/fetch_fangraphs_brightdata.py [--season 2026] [--out public/data]

Requires BRIGHTDATA_API_KEY (and optionally BRIGHTDATA_ZONE, default
"web_unlocker1") in the environment or a .env file at the repo root.

Exit code 0 on success, non-zero on any failure — callers (the CI workflow)
should fall back to compute_linear_weights.py when this exits non-zero.
"""
import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from brightdata_fangraphs import (  # noqa: E402
    load_dotenv, unlocker_fetch, looks_like_cloudflare_challenge,
    extract_largest_table, guts_url,
)
from compute_linear_weights import compute_fip_constants  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent

# FanGraphs' Guts page doesn't publish an HR/FB rate, and computing it without
# PBP isn't possible — kept at the same fallback used for the 2025 fix until
# a real source is wired in.
_LGHRFB_FALLBACK = 0.115

GUTS_FIELDS = {
    'wBB': 'wBB', 'wHBP': 'wHBP', 'w1B': 'w1B', 'w2B': 'w2B',
    'w3B': 'w3B', 'wHR': 'wHR', 'lgwOBA': 'wOBA',
    'wOBAScale': 'wOBAScale', 'lgRPA': 'R/PA', 'cFIP': 'cFIP',
}


def main() -> int:
    load_dotenv(REPO_ROOT / '.env')

    ap = argparse.ArgumentParser()
    ap.add_argument('--season', type=int, default=date.today().year)
    ap.add_argument('--out',    default='public/data')
    args = ap.parse_args()

    api_key = os.environ.get('BRIGHTDATA_API_KEY', '').strip()
    zone = os.environ.get('BRIGHTDATA_ZONE', 'web_unlocker1').strip()
    if not api_key:
        print("ERROR: BRIGHTDATA_API_KEY not set (checked .env and environment).", file=sys.stderr)
        return 2

    print(f"Fetching FanGraphs Guts (season={args.season}) via Bright Data (zone={zone})...", flush=True)
    try:
        html = unlocker_fetch(guts_url(args.season), api_key, zone)
    except Exception as e:
        print(f"ERROR: Web Unlocker request failed: {e}", file=sys.stderr)
        return 1

    if looks_like_cloudflare_challenge(html):
        print("ERROR: response looks like a Cloudflare challenge page.", file=sys.stderr)
        return 1

    rows = extract_largest_table(html)
    if not rows:
        print("ERROR: no table found in the response (React may not have rendered).", file=sys.stderr)
        return 1

    row = next((r for r in rows if str(r.get('Season', '')).strip() == str(args.season)), None)
    if row is None:
        available = [r.get('Season') for r in rows[:10]]
        print(f"ERROR: no row for season={args.season}. Available (first 10): {available}", file=sys.stderr)
        return 1

    weights: dict[str, float] = {}
    missing = []
    for out_key, fg_key in GUTS_FIELDS.items():
        raw = str(row.get(fg_key, '')).strip()
        try:
            weights[out_key] = float(raw)
        except ValueError:
            missing.append(fg_key)
    if missing:
        print(f"ERROR: could not parse fields {missing} from the Guts row: {row}", file=sys.stderr)
        return 1

    print("Computing lgFIP from MLB team pitching totals (not PBP/RE24)...", flush=True)
    fip_consts = compute_fip_constants(args.season)
    lg_fip = fip_consts.get('lgFIP')
    if lg_fip is None:
        print("  WARNING: could not compute lgFIP for this season — field will be omitted.", flush=True)

    result = {
        'season': args.season,
        'source': 'FanGraphs Guts page (Bright Data Web Unlocker)',
        **weights,
        **({'lgFIP': lg_fip} if lg_fip is not None else {}),
        'lgHRFB': _LGHRFB_FALLBACK,
    }

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f'linear_weights_{args.season}.json'
    out_file.write_text(json.dumps(result, indent=2), encoding='utf-8')

    print(f"\nWrote {out_file}", flush=True)
    print(f"  lgwOBA={weights['lgwOBA']}  wOBAScale={weights['wOBAScale']}  lgRPA={weights['lgRPA']}", flush=True)
    print(f"  wBB={weights['wBB']}  wHBP={weights['wHBP']}  w1B={weights['w1B']}  "
          f"w2B={weights['w2B']}  w3B={weights['w3B']}  wHR={weights['wHR']}", flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
