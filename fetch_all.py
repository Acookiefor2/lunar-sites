# fetch_all.py
# Lunar Sites: pulls Sun and Earth azimuth/elevation for every site in sites.json
# from NASA JPL Horizons, and saves one compact JSON file per site in data/sites/.
# Run once; the web app only reads the saved files (no live API calls in the demo).
# Code written with help from Claude (Anthropic AI assistant).

import json
import time
from pathlib import Path

import requests

API = "https://ssd.jpl.nasa.gov/api/horizons.api"

START = "2026-11-01"
STOP = "2028-12-31"   # covers the Artemis-era window
STEP_HOURS = 1

BODIES = {"sun": "10", "earth": "399"}
OUT_DIR = Path("data") / "sites"


def east_lon(lon):
    """Horizons wants east longitude; convert -180..180 to 0..360."""
    return lon % 360


def query(site, body_id, retries=3):
    params = {
        "format": "json",
        "COMMAND": f"'{body_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",          # 301 = the Moon
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{east_lon(site['lon'])},{site['lat']},0'",
        "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{STOP}'",
        "STEP_SIZE": f"'{STEP_HOURS}h'",
        "QUANTITIES": "'4'",              # apparent azimuth & elevation
        "ANG_FORMAT": "'DEG'",
        "CSV_FORMAT": "'YES'",
    }
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(API, params=params, timeout=120)
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                raise RuntimeError(data["error"])
            return data["result"]
        except Exception as e:
            if attempt == retries:
                raise
            print(f"    attempt {attempt} failed ({e}), retrying in 5s...")
            time.sleep(5)


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
        raise RuntimeError("Couldn't find the column header")

    i_az = next(i for i, h in enumerate(header) if h.startswith("Azi"))
    i_el = next(i for i, h in enumerate(header) if h.startswith("Elev"))

    times, az, el = [], [], []
    for line in lines[soe + 1:eoe]:
        parts = [p.strip() for p in line.split(",")]
        times.append(parts[0])
        az.append(round(float(parts[i_az]), 2))
        el.append(round(float(parts[i_el]), 3))
    return times, az, el


def main():
    sites = json.loads(Path("sites.json").read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Fetching {len(sites)} sites, {START} to {STOP}, every {STEP_HOURS}h\n")
    print(f"{'site':<14}{'sun up %':>10}{'sun max el':>12}{'earth up %':>12}{'earth el range':>18}")

    for site in sites:
        out = {
            "site": site,
            "start_utc": START + " 00:00",
            "step_hours": STEP_HOURS,
        }
        n_rows = None
        for name, body_id in BODIES.items():
            times, az, el = parse(query(site, body_id))
            if n_rows is None:
                n_rows = len(times)
                out["first_time"] = times[0]
                out["last_time"] = times[-1]
            elif len(times) != n_rows:
                raise RuntimeError(f"{site['id']}: sun and earth row counts differ")
            out[name] = {"az": az, "el": el}
            time.sleep(1)  # be polite to JPL
        out["n"] = n_rows

        (OUT_DIR / f"{site['id']}.json").write_text(json.dumps(out, separators=(",", ":")))

        s, e = out["sun"]["el"], out["earth"]["el"]
        sun_up = 100 * sum(x > 0 for x in s) / len(s)
        earth_up = 100 * sum(x > 0 for x in e) / len(e)
        print(f"{site['id']:<14}{sun_up:>9.1f}%{max(s):>11.2f}°{earth_up:>11.1f}%"
              f"{min(e):>9.2f}° to {max(e):.2f}°")

    print(f"\nSaved {len(sites)} files to {OUT_DIR}/")
    print("NOTE: these are FLAT-horizon numbers (no terrain yet).")


if __name__ == "__main__":
    main()
