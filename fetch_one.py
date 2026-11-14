# fetch_one.py
# Lunar Sites: first test. Gets Sun and Earth position (azimuth + elevation)
# as seen from ONE spot on the Moon, using NASA JPL Horizons.
# Code written with help from Claude (Anthropic AI assistant).

import json
from pathlib import Path

import requests

API = "https://ssd.jpl.nasa.gov/api/horizons.api"

SITE = {
    "name": "Chandrayaan-3 (Shiv Shakti Point)",
    "lat": -69.373,   # degrees, negative = south
    "lon": 32.319,    # degrees, east longitude
    "alt_km": 0.0,
}
START = "2026-11-14"
STOP = "2026-12-14"
STEP = "1h"

BODIES = {"sun": "10", "earth": "399"}


def query(body_id):
    params = {
        "format": "json",
        "COMMAND": f"'{body_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",          # 301 = the Moon
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{SITE['lon']},{SITE['lat']},{SITE['alt_km']}'",
        "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{STOP}'",
        "STEP_SIZE": f"'{STEP}'",
        "QUANTITIES": "'4'",              # 4 = apparent azimuth & elevation
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
    }
    r = requests.get(API, params=params, timeout=60)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    return data["result"]


def parse(result):
    lines = result.splitlines()
    if "$$SOE" not in lines or "$$EOE" not in lines:
        print(result[:3000])
        raise RuntimeError("No data block in the Horizons reply (printed above)")
    soe, eoe = lines.index("$$SOE"), lines.index("$$EOE")

    header = None
    for line in reversed(lines[:soe]):
        if "Date" in line and "Azi" in line:
            header = [h.strip() for h in line.split(",")]
            break
    if header is None:
        print("\n".join(lines[:soe]))
        raise RuntimeError("Couldn't find the column header (printed above)")

    i_az = next(i for i, h in enumerate(header) if h.startswith("Azi"))
    i_el = next(i for i, h in enumerate(header) if h.startswith("Elev"))

    rows = []
    for line in lines[soe + 1:eoe]:
        parts = [p.strip() for p in line.split(",")]
        rows.append({
            "time_utc": parts[0],
            "az": float(parts[i_az]),
            "el": float(parts[i_el]),
        })
    return rows


def summarize(name, rows):
    els = [r["el"] for r in rows]
    up = sum(1 for e in els if e > 0)
    print(f"\n=== {name.upper()} ===")
    print(f"rows: {len(rows)}")
    print(f"elevation min/max: {min(els):.2f} / {max(els):.2f} deg")
    print(f"above flat horizon: {up}/{len(rows)} hours ({100 * up / len(rows):.1f}%)")
    print("first 3 rows (check these against the Horizons website):")
    for r in rows[:3]:
        print(f"  {r['time_utc']}  az={r['az']:.3f}  el={r['el']:.3f}")


def main():
    out = {"site": SITE, "start": START, "stop": STOP, "step": STEP}
    for name, body_id in BODIES.items():
        print(f"Asking Horizons for {name}...")
        rows = parse(query(body_id))
        out[name] = rows
        summarize(name, rows)

    Path("data").mkdir(exist_ok=True)
    path = Path("data") / "test_site.json"
    path.write_text(json.dumps(out, indent=1))
    print(f"\nSaved -> {path}")


if __name__ == "__main__":
    main()
