# terrain.py
# Builds a real terrain horizon ("skyline") for each south-polar site from the
# NASA LOLA elevation map, then compares Sun/Earth visibility: flat horizon vs real terrain.
#
# DEM: LDEM_60S_240MPP_ADJ.TIF (LOLA, 240 m/pixel, 60-90 S, NASA GSFC PGDA)
#      https://pgda.gsfc.nasa.gov/products/90
# Put it at dem/LDEM_60S_240MPP_ADJ.TIF (dem/ is gitignored, the file is ~210 MB).
#
# Code written with help from Claude (Anthropic AI assistant).

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from scipy.ndimage import map_coordinates

DEM_PATH = Path("dem") / "LDEM_60S_240MPP_ADJ.TIF"
R = 1737400.0          # lunar reference radius (m); LOLA heights are relative to this
OBSERVER_H = 2.0       # lander height above ground (m)
AZ_STEP = 0.5          # degrees between skyline samples
MAX_DIST = 250_000.0   # how far out to look for terrain (m)
OUT_DIR = Path("data") / "horizons"


def load_dem():
    ds = rasterio.open(DEM_PATH)
    print(f"DEM: {DEM_PATH.name}  {ds.width}x{ds.height} px  pixel={ds.res[0]:.1f} m")
    dem = ds.read(1).astype(np.float32)
    if ds.nodata is not None:
        dem[dem == ds.nodata] = np.nan
    # LOLA heights are sometimes stored in km; we want metres
    finite = dem[np.isfinite(dem)]
    if np.nanmax(np.abs(finite)) < 50:
        print("  heights look like km, converting to m")
        dem *= 1000.0

    crs = CRS.from_wkt(ds.crs.to_wkt())
    geo = crs.geodetic_crs
    to_xy = Transformer.from_crs(geo, crs, always_xy=True)
    inv = ~ds.transform
    return ds, dem, to_xy, inv


def sample(dem, inv, x, y):
    col, row = inv * (x, y)
    # rasterio maps pixel corners; map_coordinates wants pixel centres at integers
    coords = np.vstack([np.ravel(row) - 0.5, np.ravel(col) - 0.5])
    vals = map_coordinates(dem, coords, order=1, mode="constant", cval=np.nan)
    return vals.reshape(np.shape(x))


def destination(lat, lon, bearing, dist):
    """Great-circle destination point. Angles in degrees, dist in metres."""
    p1, l1 = math.radians(lat), math.radians(lon)
    th = np.radians(bearing)[:, None]
    dl = (dist / R)[None, :]
    p2 = np.arcsin(math.sin(p1) * np.cos(dl) + math.cos(p1) * np.sin(dl) * np.cos(th))
    l2 = l1 + np.arctan2(np.sin(th) * np.sin(dl) * math.cos(p1), np.cos(dl) - math.sin(p1) * np.sin(p2))
    return np.degrees(p2), np.degrees(l2)


def skyline(site, dem, to_xy, inv, pixel):
    x0, y0 = to_xy.transform(site["lon"], site["lat"])
    h0 = float(sample(dem, inv, np.array([x0]), np.array([y0]))[0])
    if not np.isfinite(h0):
        raise RuntimeError(f"{site['id']}: site is outside the DEM")

    az = np.arange(0, 360, AZ_STEP)
    dist = np.arange(pixel * 0.75, MAX_DIST, pixel * 0.75)
    lat2, lon2 = destination(site["lat"], site["lon"], az, dist)
    x, y = to_xy.transform(lon2, lat2)
    h = sample(dem, inv, np.asarray(x), np.asarray(y))

    theta = dist[None, :] / R
    rs = R + h0 + OBSERVER_H
    rt = R + h
    elev = np.degrees(np.arctan2(rt * np.cos(theta) - rs, rt * np.sin(theta)))
    horizon = np.nanmax(elev, axis=1)
    return h0, horizon


def visibility(site_id, horizon):
    d = json.loads((Path("data") / "sites" / f"{site_id}.json").read_text())
    out = {}
    for body in ("sun", "earth"):
        el = np.array(d[body]["el"])
        azs = np.array(d[body]["az"])
        idx = np.round(azs / AZ_STEP).astype(int) % len(horizon)
        mask = horizon[idx]
        out[body] = (100 * np.mean(el > 0), 100 * np.mean(el > mask))
    return out


def main():
    sites = json.loads(Path("sites.json").read_text(encoding="utf-8"))
    ds, dem, to_xy, inv = load_dem()
    pixel = ds.res[0]

    # sanity check: the south pole should land near the middle of the map
    px, py = to_xy.transform(0.0, -90.0)
    col, row = inv * (px, py)
    print(f"  south pole -> x={px:.0f} m, y={py:.0f} m, pixel=({col:.0f},{row:.0f}) of ({ds.width},{ds.height})")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"\n{'site':<14}{'ground elev':>12}{'max skyline':>13}"
          f"{'sun flat':>10}{'sun terrain':>13}{'earth flat':>12}{'earth terrain':>15}")

    for s in sites:
        if s["lat"] > -60.5:
            continue  # outside this DEM: stays flat-horizon
        h0, hz = skyline(s, dem, to_xy, inv, pixel)
        vis = visibility(s["id"], hz)
        out = {
            "site_id": s["id"],
            "az_step": AZ_STEP,
            "horizon_deg": [round(float(v), 3) for v in hz],
            "ground_elev_m": round(h0, 1),
            "observer_height_m": OBSERVER_H,
            "max_dist_km": MAX_DIST / 1000,
            "dem": DEM_PATH.name,
        }
        (OUT_DIR / f"{s['id']}.json").write_text(json.dumps(out, separators=(",", ":")))
        print(f"{s['id']:<14}{h0:>10.0f} m{hz.max():>11.2f}°"
              f"{vis['sun'][0]:>9.1f}%{vis['sun'][1]:>12.1f}%"
              f"{vis['earth'][0]:>11.1f}%{vis['earth'][1]:>14.1f}%")

    print(f"\nSaved skylines to {OUT_DIR}/")


if __name__ == "__main__":
    main()
