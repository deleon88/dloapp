#!/usr/bin/env python3
"""
test_brightdata_fangraphs.py
=============================
Isolated validation script for brightdata_fangraphs.py's fetch/parse logic —
NOT part of the production pipeline (see fetch_fangraphs_brightdata.py for
that). Kept around to re-verify against a known season whenever something
about the Bright Data integration is in doubt (zone changes, FanGraphs page
changes, etc).

Checks whether Bright Data's Web Unlocker API can fetch FanGraphs' Guts and
Park Factors pages (Cloudflare-protected, React-rendered tables) well enough
to power the app's wOBA constants.

Does three things:
  1. Calls the Web Unlocker API for the Guts (type=cn) and Park Factors
     (type=pf) pages for a given season.
  2. Saves the raw HTML response to data/ for manual inspection.
  3. Parses the tables and compares the Guts row against known-correct
     validated 2025 constants.

Usage:
    python scripts/test_brightdata_fangraphs.py [--season 2025] [--out data]

Requires BRIGHTDATA_API_KEY in the environment or a .env file at the repo
root. Optionally BRIGHTDATA_ZONE (defaults to "web_unlocker1").

Exit code: 0 if both pages parsed AND the Guts row matches validated values
within tolerance (only meaningful for --season 2025). Non-zero otherwise —
inspect the saved HTML.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from brightdata_fangraphs import (  # noqa: E402
    load_dotenv, unlocker_fetch, looks_like_cloudflare_challenge,
    extract_largest_table, guts_url, park_factors_url,
)

REPO_ROOT = Path(__file__).resolve().parent.parent

# Known-correct 2025 values, manually validated against the real FanGraphs
# wRC+ leaderboard (MAE ~0.4 pts).
VALIDATED_2025 = {
    "wOBA": 0.313, "wOBAScale": 1.232, "wBB": 0.691, "wHBP": 0.722,
    "w1B": 0.882, "w2B": 1.252, "w3B": 1.584, "wHR": 2.037,
}
TOLERANCE = 0.0005  # ~5th decimal on wOBA-scale components


def main() -> int:
    load_dotenv(REPO_ROOT / ".env")
    import os

    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2025)
    ap.add_argument("--out", default="data")
    args = ap.parse_args()

    api_key = os.environ.get("BRIGHTDATA_API_KEY", "").strip()
    zone = os.environ.get("BRIGHTDATA_ZONE", "web_unlocker1").strip()
    if not api_key:
        print("ERROR: BRIGHTDATA_API_KEY not set (checked .env and environment).", file=sys.stderr)
        return 2

    out_dir = REPO_ROOT / args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    overall_pass = True

    # ── Guts constants (type=cn) ────────────────────────────────────────────
    print(f"[1/2] Guts constants — fetching via Bright Data (zone={zone})", flush=True)
    print(f"  URL: {guts_url(args.season)}", flush=True)
    try:
        guts_html = unlocker_fetch(guts_url(args.season), api_key, zone)
    except Exception as e:
        print(f"FAIL: Web Unlocker request errored: {e}", file=sys.stderr)
        return 1

    guts_html_path = out_dir / "test_brightdata_response.html"
    guts_html_path.write_text(guts_html, encoding="utf-8")
    print(f"  saved raw HTML -> {guts_html_path} ({len(guts_html):,} bytes)", flush=True)

    if looks_like_cloudflare_challenge(guts_html):
        print("FAIL: response looks like a Cloudflare challenge page.", file=sys.stderr)
        print(f"  Inspect {guts_html_path} manually. Stopping.", file=sys.stderr)
        return 1

    guts_rows = extract_largest_table(guts_html)
    if not guts_rows:
        print("FAIL: no table found in the response (React may not have rendered).", file=sys.stderr)
        print(f"  Inspect {guts_html_path} manually.", file=sys.stderr)
        return 1
    print(f"  {len(guts_rows)} rows extracted, columns: {list(guts_rows[0].keys())}", flush=True)

    season_row = next(
        (r for r in guts_rows if str(r.get("Season", "")).strip() == str(args.season)),
        None,
    )
    if season_row is None:
        print(f"FAIL: no row for season={args.season} in extracted table.", file=sys.stderr)
        available = [r.get("Season") for r in guts_rows[:10]]
        print(f"  Available seasons (first 10): {available}", file=sys.stderr)
        overall_pass = False
    elif args.season == 2025:
        print(f"\n  -- {args.season} extracted vs validated --", flush=True)
        for key, expected in VALIDATED_2025.items():
            raw = str(season_row.get(key, "")).strip()
            try:
                got = float(raw)
            except ValueError:
                print(f"  {key:<10} could not parse {raw!r}", flush=True)
                overall_pass = False
                continue
            diff = got - expected
            ok = abs(diff) <= TOLERANCE
            overall_pass = overall_pass and ok
            mark = "OK" if ok else "MISMATCH"
            print(f"  {key:<10} got={got:<8} expected={expected:<8} diff={diff:+.4f}  [{mark}]", flush=True)
    else:
        print(f"  (no validated reference values for season={args.season} — parsing check only)", flush=True)
        print(f"  row: {season_row}", flush=True)

    # ── Park factors (type=pf) ──────────────────────────────────────────────
    print(f"\n[2/2] Park factors — fetching via Bright Data", flush=True)
    print(f"  URL: {park_factors_url(args.season)}", flush=True)
    try:
        pf_html = unlocker_fetch(park_factors_url(args.season), api_key, zone)
    except Exception as e:
        print(f"FAIL: Web Unlocker request errored: {e}", file=sys.stderr)
        return 1

    pf_html_path = out_dir / "test_brightdata_response_pf.html"
    pf_html_path.write_text(pf_html, encoding="utf-8")
    print(f"  saved raw HTML -> {pf_html_path} ({len(pf_html):,} bytes)", flush=True)

    if looks_like_cloudflare_challenge(pf_html):
        print("FAIL: response looks like a Cloudflare challenge page.", file=sys.stderr)
        print(f"  Inspect {pf_html_path} manually. Stopping.", file=sys.stderr)
        return 1

    pf_rows = extract_largest_table(pf_html)
    if not pf_rows:
        print("FAIL: no table found in park factors response.", file=sys.stderr)
        print(f"  Inspect {pf_html_path} manually.", file=sys.stderr)
        overall_pass = False
    else:
        print(f"  {len(pf_rows)} team rows extracted, columns: {list(pf_rows[0].keys())}", flush=True)
        for row in pf_rows[:5]:
            basic = row.get("Basic (5yr)", row.get("Basic", "?"))
            print(f"    {row.get('Team', '?'):<6} Basic(5yr)={basic}  FIP={row.get('FIP', '?')}", flush=True)

    print("\n" + "=" * 60)
    if overall_pass:
        print("PASS — Bright Data Web Unlocker matches validated FanGraphs values.")
    else:
        print("FAIL — see mismatches / warnings above. Inspect the saved HTML files:")
        print(f"  {guts_html_path}")
        print(f"  {pf_html_path}")
    print("=" * 60)

    return 0 if overall_pass else 1


if __name__ == "__main__":
    sys.exit(main())
