"""
brightdata_fangraphs.py
========================
Shared Bright Data Web Unlocker client + FanGraphs Guts/Park-Factors table
extraction. Used by both fetch_fangraphs_brightdata.py (production — writes
linear_weights_{season}.json) and test_brightdata_fangraphs.py (isolated
validation script). Kept as a single module so the two never drift apart.

Validated against real FanGraphs data — see test_brightdata_fangraphs.py's
comparison against manually-verified 2025 constants.
"""
import json
import os
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

FANGRAPHS_GUTS = "https://www.fangraphs.com/tools/guts"
UNLOCKER_ENDPOINT = "https://api.brightdata.com/request"

CF_MARKERS = [
    "Just a moment", "cf-browser-verification", "cf-chl", "cf-mitigated",
    "Attention Required! | Cloudflare", "challenge-platform",
    "Enable JavaScript and cookies to continue",
]


def guts_url(season: int) -> str:
    return f"{FANGRAPHS_GUTS}?season={season}&teamid=0&type=cn&sortcol=&sortdir="


def park_factors_url(season: int) -> str:
    return f"{FANGRAPHS_GUTS}?season={season}&teamid=0&type=pf&sortcol=&sortdir="


# ── .env loader (no external dependency) ───────────────────────────────────

def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


# ── Bright Data Web Unlocker call ───────────────────────────────────────────

def unlocker_fetch(url: str, api_key: str, zone: str, retries: int = 2) -> str:
    """POST to the Web Unlocker API, return raw HTML. Raises on hard failure."""
    body = json.dumps({"zone": zone, "url": url, "format": "raw"}).encode("utf-8")
    last_err = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            UNLOCKER_ENDPOINT,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            last_err = f"HTTP {e.code}: {err_body[:500]}"
        except Exception as e:
            last_err = str(e)
        if attempt < retries:
            import time
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Web Unlocker request failed: {last_err}")


def looks_like_cloudflare_challenge(html: str) -> bool:
    head = html[:5000]
    return any(marker in head for marker in CF_MARKERS)


# ── Table extraction (stdlib port of fetch_fangraphs.py's in-browser JS extractor) ─

class TableExtractor(HTMLParser):
    """Finds every <table>, keeps the one with the most <tbody><tr> rows."""

    def __init__(self):
        super().__init__()
        self.tables: list[dict] = []
        self._depth = 0
        self._cur: dict | None = None
        self._in_thead = False
        self._in_tbody = False
        self._in_tr = False
        self._in_cell = False
        self._cell_is_th = False
        self._cell_colspan = 1
        self._cell_chunks: list[str] = []
        self._row: list[str] = []
        self._thead_row: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self._depth += 1
            if self._depth == 1:
                self._cur = {"thead": [], "rows": []}
        elif tag == "thead" and self._depth:
            self._in_thead = True
        elif tag == "tbody" and self._depth:
            self._in_tbody = True
        elif tag == "tr" and self._depth == 1:
            self._in_tr = True
            self._row = []
        elif tag in ("th", "td") and self._in_tr:
            self._in_cell = True
            self._cell_is_th = tag == "th"
            self._cell_chunks = []
            try:
                self._cell_colspan = max(1, int(a.get("colspan", "1")))
            except ValueError:
                self._cell_colspan = 1

    def handle_data(self, data):
        if self._in_cell:
            self._cell_chunks.append(data)

    def handle_endtag(self, tag):
        if tag in ("th", "td") and self._in_cell:
            text = "".join(self._cell_chunks).strip()
            if self._in_thead:
                for _ in range(self._cell_colspan):
                    self._thead_row.append(text)
            else:
                self._row.append(text)
            self._in_cell = False
        elif tag == "tr" and self._depth == 1:
            if self._in_thead and self._thead_row:
                self._cur["thead"] = self._thead_row
                self._thead_row = []
            elif self._in_tbody and self._row:
                self._cur["rows"].append(self._row)
            self._in_tr = False
        elif tag == "thead":
            self._in_thead = False
        elif tag == "tbody":
            self._in_tbody = False
        elif tag == "table":
            self._depth -= 1
            if self._depth == 0 and self._cur:
                self.tables.append(self._cur)
                self._cur = None


def extract_largest_table(html: str) -> list[dict]:
    parser = TableExtractor()
    parser.feed(html)
    if not parser.tables:
        return []
    best = max(parser.tables, key=lambda t: len(t["rows"]))
    headers = best["thead"]
    if not headers:
        return []
    rows_out = []
    for row in best["rows"]:
        d = {}
        for i, val in enumerate(row):
            label = headers[i] if i < len(headers) else f"col{i}"
            d[label] = val
        rows_out.append(d)
    return rows_out
