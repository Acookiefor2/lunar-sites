# check_dem.py
# Sanity checks for the LOLA DEM + site coordinates.
# 1) Is the longitude direction right? (Shackleton crater must be a deep hole at 129.8 E, not at 129.8 W)
# 2) Where is the local high point (crest/summit) near each pole site?
# Code written with help from Claude (Anthropic AI assistant).

import json
from pathlib import Path

import numpy as np
from terrain import load_dem, sample

ds, dem, to_xy, inv = load_dem()
to_ll = to_xy.__class__.from_crs(to_xy.target_crs, to_xy.source_crs, always_xy=True)
print("CRS:", ds.crs.to_proj4() if hasattr(ds.crs, "to_proj4") else ds.crs)


def elev(lat, lon):
    x, y = to_xy.transform(lon, lat)
    return float(sample(dem, inv, np.array([x]), np.array([y]))[0])


print("\n--- longitude direction check ---")
for name, lat, lon in [("Shackleton crater centre", -89.66, 129.78), ("de Gerlache crater centre", -88.5, -87.1)]:
    print(f"{name:<27} at lon {lon:+8.2f}: {elev(lat, lon):8.0f} m   |  mirrored lon {-lon:+8.2f}: {elev(lat, -lon):8.0f} m")
print("(crater centres should be much LOWER than their mirrored points)")

print("\n--- local high point near each site ---")
sites = json.loads(Path("sites.json").read_text(encoding="utf-8"))
radius_km = {"shackleton": 4, "malapert": 15, "monsmouton": 10, "haworth": 0, "chandrayaan3": 0}
px = ds.res[0]
for s in sites:
    r = radius_km.get(s["id"], 0)
    if not r:
        continue
    x0, y0 = to_xy.transform(s["lon"], s["lat"])
    col0, row0 = inv * (x0, y0)
    n = int(r * 1000 / px) + 2
    r0, c0 = int(row0), int(col0)
    win = dem[r0 - n:r0 + n + 1, c0 - n:c0 + n + 1]
    rr, cc = np.mgrid[-n:n + 1, -n:n + 1]
    win = np.where((rr ** 2 + cc ** 2) * px ** 2 <= (r * 1000) ** 2, win, np.nan)
    k = np.nanargmax(win)
    dr, dc = np.unravel_index(k, win.shape)
    x, y = ds.transform * (c0 - n + dc + 0.5, r0 - n + dr + 0.5)
    lon, lat = to_ll.transform(x, y)
    dist = np.hypot(x - x0, y - y0) / 1000
    print(f"{s['id']:<12} site {elev(s['lat'], s['lon']):6.0f} m  ->  highest within {r} km: {np.nanmax(win):6.0f} m"
          f" at {lat:.4f}, {lon:.4f}  ({dist:.1f} km away)")
