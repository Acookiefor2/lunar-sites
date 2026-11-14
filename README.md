# Terminator

**Compare lunar landing sites and dates by the two things a lander needs: sunlight for power and a line of sight to Earth for direct communication.**

🌗 **Live app:** https://acookiefor2.github.io/lunar-sites/

Built solo for the **NASA Space Apps Challenge 2026** (lunar landing site Sun/Earth visibility challenge).

> On the Moon, the line between day and night is called the *terminator*. At the south pole, a landing site can sit right on it for weeks.

---

## What it does

Pick a site and a date (Nov 2026 – Dec 2028) and Terminator shows:

- **Where the Sun and Earth are** in the site's sky (elevation + azimuth), as numbers and as a 360° sky panorama
- **Whether real terrain blocks them.** For south-polar sites, the panorama draws the actual skyline (crater rims, ridges) from NASA LOLA elevation data
- **How long until sunset / Earthset** (or sunrise / Earthrise), and how long the next dark or no-link period lasts
- **A 30-day timeline** of Sun and Earth elevation, with bars for sunlight, Earth visibility and *both together* (the best operating windows)
- **Side-by-side comparison** of two sites: site B is drawn dashed on the same chart
- **A 30-day summary**: sunlight %, longest continuous darkness (battery sizing), Earth visibility %, longest Earth blackout, and power + comms together. For terrain sites, each value also shows the flat-horizon number so the difference is obvious
- A **status strip** with all 9 sites at once: Sun up / Earth visible / blocked by terrain, at a glance
- **▶ PLAY** to animate time, and a **TERRAIN ON/OFF** toggle

## Why terrain matters: results

A flat (smooth-sphere) horizon says every south-polar site gets roughly 50% sunlight. Real terrain changes that completely. Sun and Earth visibility over Nov 2026 – Dec 2028, hourly:

| Site | Ground elevation | Sun (flat) | **Sun (terrain)** | Earth (flat) | **Earth (terrain)** |
|---|---:|---:|---:|---:|---:|
| Shackleton connecting ridge | +1,954 m | 54.6% | **92.4%** | 47.6% | **53.7%** |
| Malapert Massif (summit) | +5,170 m | 50.8% | **79.8%** | 69.6% | **77.6%** |
| Mons Mouton (IM-2 target) | +5,312 m | 50.5% | **45.3%** | 73.7% | **82.1%** |
| Chandrayaan-3 (Shiv Shakti) | +529 m | 50.0% | **47.9%** | 100.0% | **100.0%** |
| Haworth crater (floor) | −1,571 m | 51.1% | **0.0%** | 64.6% | **0.0%** |

- **Haworth's floor never sees the Sun or Earth** in the whole period: its walls rise up to 17.6°. It is a known permanently shadowed region, and the terrain model reproduces that.
- **The Shackleton ridge crest is lit 92% of the time**, because it is high enough to see past the Moon's curvature. Published LOLA-based illumination studies put the best points on this ridge at roughly 90%.
- **High sites gain Earth visibility** (Mons Mouton, Malapert): from a 5 km summit you can see beyond the flat horizon.
- **Chang'e 4 (far side) never sees Earth**, terrain or not. Direct comms are impossible there and a relay satellite is required.

At the south pole the Sun never gets more than ~2–7° above the horizon, so a ridge a few km away decides everything. That is why small changes in landing location have large effects.

## How it works

1. **Ephemeris (`fetch_all.py`).** For each site, the [NASA/JPL Horizons API](https://ssd.jpl.nasa.gov/horizons/) is queried with the site as a surface observer on the Moon (`coord@301`), returning apparent azimuth and elevation of the Sun and Earth every hour from Nov 2026 to Dec 2028. Results are saved as compact JSON in `data/sites/`. The web app never calls an API live.
2. **Terrain skylines (`terrain.py`).** Using the LOLA south-pole DEM (`LDEM_60S_240MPP_ADJ`, 240 m/pixel), each site gets a horizon mask: from a point 2 m above the ground, the script walks out 250 km along great circles in 720 directions (every 0.5°) and keeps the highest elevation angle, accounting for the Moon's curvature. Results are saved in `data/horizons/`.
3. **Visibility.** A body is "visible" when its elevation is above the skyline in its own direction (`elevation − skyline(azimuth) > 0`). With terrain off, the skyline is 0°.
4. **Web app** (`index.html`, `style.css`, `app.js`): plain HTML/CSS/JavaScript, no framework, hosted on GitHub Pages. Charts and the sky panorama are hand-drawn SVG.

### Validation

- **Physics checks:** the maximum solar elevation at each site matches `90° − |latitude| + 1.54°` (the Moon's axial tilt to the ecliptic), e.g. Shackleton expected ~2.09°, computed 2.07°.
- **Terrain maths test:** on a synthetic map with a 3 km mountain placed 20 km due east, the skyline peaked at exactly 90° azimuth and 8.28° elevation (hand calculation ~8.2°).
- **Map orientation check (`check_dem.py`):** Shackleton crater's centre samples at −2,778 m at 129.8°E vs +742 m at the mirrored longitude, so the projection is not flipped.
- **Site placement:** Shackleton and Malapert were snapped to the local LOLA high point (2.1 km and 4.4 km from the first coordinates). The Shackleton point lands at 89.45°S, 222.69°E, which matches the frequently cited most-illuminated point on that ridge.

## Sites

| Site | Lat, Lon | Group | Terrain |
|---|---|---|---|
| Apollo 11 (Tranquility Base) | 0.67°N, 23.47°E | Equatorial | flat |
| Apollo 17 (Taurus-Littrow) | 20.19°N, 30.77°E | Equatorial | flat |
| Clavius crater | 58.40°S, 14.40°W | Mid-south | flat |
| Chang'e 4 (Von Kármán) | 45.44°S, 177.60°E | Far side | flat |
| Chandrayaan-3 (Shiv Shakti Point) | 69.37°S, 32.32°E | South pole | LOLA |
| Mons Mouton (IM-2 target) | 84.78°S, 29.13°E | South pole | LOLA |
| Malapert Massif (summit) | 85.99°S, 2.09°E | South pole | LOLA |
| Haworth crater | 86.90°S, 4.00°W | South pole | LOLA |
| Shackleton connecting ridge | 89.45°S, 137.31°W | South pole | LOLA |

## Limitations

- Sites outside 60°S (Apollo 11/17, Clavius, Chang'e 4) use a flat horizon.
- The Sun is treated as a point (its centre); partial sunrise across the 0.5° solar disc is not modelled.
- 240 m/pixel terrain can miss small nearby slopes and boulders; numbers are good estimates, not mission-grade.
- Custom coordinates are not supported yet: data is precomputed per site.
- Lander height is fixed at 2 m; taller masts or solar arrays would see more.

## Run it yourself

Requires Python 3.10+.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1          # macOS/Linux: source .venv/bin/activate
pip install requests rasterio pyproj scipy numpy

# 1. Sun/Earth positions from JPL Horizons (all sites, or pass ids)
python fetch_all.py
python fetch_all.py shackleton malapert

# 2. Terrain: download the LOLA DEM (~210 MB) into dem/, then build skylines
mkdir dem
curl -L -o dem/LDEM_60S_240MPP_ADJ.TIF https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF
python check_dem.py                 # optional sanity checks
python terrain.py

# 3. View the app (it must be served, not opened as a file)
python -m http.server 8000          # then open http://localhost:8000
```

## Repository layout

```
index.html, style.css, app.js   web app
sites.json                      site list (coordinates + notes)
fetch_all.py                    JPL Horizons → data/sites/*.json
terrain.py                      LOLA DEM → data/horizons/*.json
check_dem.py                    DEM orientation + crest-finding checks
fetch_one.py                    first single-site test
data/sites/                     hourly Sun/Earth az/el per site
data/horizons/                  terrain skyline per south-polar site
```

## Data and references

**NASA data**
- **JPL Horizons System**: Sun and Earth ephemerides for surface observers on the Moon. https://ssd.jpl.nasa.gov/horizons/
- **LRO LOLA south-pole DEM** (`LDEM_60S_240MPP_ADJ.TIF`), NASA GSFC Planetary Geodesy Data Archive, "A New View of the Lunar South Pole from LOLA". https://pgda.gsfc.nasa.gov/products/90
- **LROC** (Arizona State University, LRO camera team): IM-2 target coordinates. https://lroc.im-ldi.com/images/1401

**Other references**
- Site coordinates: Chang'e 4, Clavius, Haworth (Wikipedia / the-moon.us lunar wiki), Mons Malapert (ILOA, *Moonbase Mons Malapert*), Apollo landing sites (standard published coordinates).
- Space agency partner context: CSA Moon Exploration portal. https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/
- Fonts: IBM Plex Mono and IBM Plex Sans (SIL Open Font License), via Google Fonts.
- Python libraries: requests, NumPy, SciPy, rasterio, pyproj.

## AI disclosure

This project was built with help from **Claude** (Anthropic's AI assistant), as allowed by the Space Apps rules.

- **Code:** all code in this repository (Python scripts and the web app) was written with Claude's assistance; files carry a note saying so.
- **Research and checks:** Claude helped look up site coordinates, suggested the terrain-horizon method, and wrote the validation checks.
- **The author** chose the challenge, picked the sites (from a suggested list, plus Clavius), chose the design direction and the name, ran every script, checked the outputs, and decided what went into the final app.

No AI-generated images, video or audio are used. No NASA logos or branding are used.

## License

MIT, see [LICENSE](LICENSE).
