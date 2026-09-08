#!/usr/bin/env python3
"""
fetch_fg_pitcher_splits.py
============================
Precomputes pitcher vs-LHB / vs-RHB raw rate stats via FanGraphs' splits API
(reverse-engineered this session — see scripts/fetch_fg_split_reference.py
for the original discovery/validation against Pete Alonso's real 2025
vs-LHP split). Run by a dedicated daily cron (not called live from the
browser) specifically so production traffic never hits this undocumented
FanGraphs endpoint directly — see .github/workflows/refresh-pitcher-hand-splits.yml.

Only RAW rate stats are stored (ERA, FIP, xFIP, WHIP, K/9, BB/9, wOBA-against).
FanGraphs itself returns null for ERA-/FIP-/xFIP- on ad-hoc splits — there's
no split-specific league baseline to normalize against (same root cause we
found and validated for batter wRC+ splits: this diagnosis showed season-wide
context beats split-specific context by ~5x MAE). The client applies the
existing computeFipMinus()/computeFipPlus() from wrcConstants.ts using
season-wide lgFIP + park factor — the same validated-best-accuracy approach,
not a new one.

Usage:
    python scripts/fetch_fg_pitcher_splits.py [--season 2026] [--out public/data]
"""
import argparse
import json
from datetime import date, datetime, timezone
from pathlib import Path

import requests

SPLITS_URL = "https://www.fangraphs.com/api/leaders/splits/data"
SPLIT_IDS = {"vsLHB": 5, "vsRHB": 6}
RATE_FIELDS = ["IP", "ERA", "FIP", "xFIP", "WHIP", "K/9", "BB/9", "wOBA", "TBF"]
OUT_KEYS = {"IP": "ip", "ERA": "era", "FIP": "fip", "xFIP": "xfip", "WHIP": "whip",
            "K/9": "k9", "BB/9": "bb9", "wOBA": "woba", "TBF": "pa"}


def fetch_split(season: int, split_id: int) -> list[dict]:
    payload = {
        "playerId": None,
        "playerIds": None,
        "position": "P",
        "statType": "player",
        "groupBy": "season",
        "startDate": f"{season}-03-01",
        "endDate": f"{season}-11-01",
        "splits": [split_id],
        "splitTeams": False,
        "autoPt": True,
        "filters": [],
        "weather": {"temperature": None, "pressure": None, "airDensity": None, "elevation": None, "windSpeed": None},
    }
    resp = requests.post(
        SPLITS_URL, json=payload,
        headers={"User-Agent": "okhttp/4.12.0", "Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=date.today().year)
    ap.add_argument("--out", default="public/data")
    args = ap.parse_args()

    pitchers: dict[str, dict] = {}
    for split_name, split_id in SPLIT_IDS.items():
        print(f"Fetching {split_name} (split id={split_id}) for {args.season}...", flush=True)
        rows = fetch_split(args.season, split_id)
        print(f"  {len(rows)} pitchers.", flush=True)
        for r in rows:
            mlbam_id = r.get("xMLBAMID")
            if not mlbam_id:
                continue
            entry = pitchers.setdefault(str(mlbam_id), {})
            entry[split_name] = {OUT_KEYS[f]: r.get(f) for f in RATE_FIELDS if r.get(f) is not None}

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"pitcher_hand_splits_{args.season}.json"
    result = {
        "season": args.season,
        "generated": datetime.now(timezone.utc).isoformat(),
        "source": "FanGraphs splits API (id=5 vs LHH, id=6 vs RHH) — raw rate stats only, "
                  "no park/league adjustment (apply computeFipMinus/computeFipPlus client-side "
                  "with season-wide context — see module docstring)",
        "pitchers": pitchers,
    }
    out_file.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"\nWrote {out_file} — {len(pitchers)} pitchers.", flush=True)


if __name__ == "__main__":
    main()
