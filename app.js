// app.js: Terminator console.
// Reads precomputed NASA/JPL Horizons data (data/sites/*.json) and, where available,
// LOLA terrain skylines (data/horizons/*.json) to show Sun & Earth visibility
// for lunar landing sites.
// Code written with assistance from Claude (Anthropic AI assistant).

const HOUR = 3600 * 1000;
const START = Date.UTC(2026, 10, 1, 0, 0); // must match fetch_all.py START
const WINDOW_BEFORE_H = 3 * 24;
const WINDOW_AFTER_H = 27 * 24;
const GROUP_LABEL = {
  "equator": "EQUATORIAL",
  "mid-south": "MID-SOUTH",
  "far side": "FAR SIDE",
  "south pole": "SOUTH POLE",
};
const C = {
  sun: "#ffb020", earth: "#4fb7ff", both: "#7ee3a1", bg: "#0a0d12",
  line: "#243041", line2: "#2f3d52", dim: "#7f8e9e", faint: "#4a5869", ink: "#dbe3ec", alert: "#ff5a4f",
  terrain: "#6b5a46",
};
const FONT = 'font-family="IBM Plex Mono, Consolas, monospace"';

const state = { sites: [], data: {}, t: START, a: "shackleton", b: null, terrain: true, playing: false, timer: null, n: 0 };

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const pad = (n, w = 2) => String(n).padStart(w, "0");
const clampIdx = (f) => Math.max(0, Math.min(state.n - 1, f));
const idxOf = (t) => (t - START) / HOUR;
const timeOf = (f) => START + f * HOUR;
const shortName = (s) => s.name.replace(/ \(.*\)/, "");

function valAt(arr, f) {
  const i = Math.floor(f), j = Math.min(i + 1, arr.length - 1), fr = f - i;
  return arr[i] + (arr[j] - arr[i]) * fr;
}
function azAt(arr, f) { // azimuth interpolation that handles the 360 -> 0 wrap
  const i = Math.floor(f), j = Math.min(i + 1, arr.length - 1), fr = f - i;
  let d = arr[j] - arr[i];
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (arr[i] + d * fr + 360) % 360;
}
// next time (fractional index) the value goes positive (wantUp=true) or not
function nextEvent(arr, f, wantUp) {
  for (let k = Math.floor(f) + 1; k < arr.length; k++) {
    const a = arr[k - 1], b = arr[k];
    if ((a > 0) !== (b > 0) && (b > 0) === wantUp) {
      const tc = (k - 1) + a / (a - b);
      if (tc > f) return tc;
    }
  }
  return null;
}
function durCode(h) {
  const m = Math.round(h * 60);
  const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
  return `${pad(d)}D ${pad(hh)}H ${pad(mm)}M`;
}
function durPlain(h) {
  const m = Math.round(h * 60);
  const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
  const parts = [];
  if (d) parts.push(`${d} day${d > 1 ? "s" : ""}`);
  if (hh) parts.push(`${hh} hour${hh > 1 ? "s" : ""}`);
  if (!d && mm) parts.push(`${mm} min`);
  return parts.join(" ") || "under a minute";
}
const sgn = (v, w = 5) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2).padStart(w, "0");
const deg1 = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}°`;
function coordStr(s) {
  const lat = `${Math.abs(s.lat).toFixed(2)}°${s.lat >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(s.lon).toFixed(2)}°${s.lon >= 0 ? "E" : "W"}`;
  return `${lat} ${lon}`;
}
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
function fmtDate(t, withTime = true) {
  const d = new Date(t);
  const s = `${d.getUTCFullYear()}-${MONTHS[d.getUTCMonth()]}-${pad(d.getUTCDate())}`;
  return withTime ? `${s} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` : s;
}

// ---------- terrain ----------
// "clearance" = how far a body is above the local skyline (terrain) in its direction.
// With a flat horizon, clearance is just the elevation.
const mode = () => (state.terrain ? "terrain" : "flat");
const usesTerrain = (d) => state.terrain && !!d.horizon;
const vis = (d, body) => (state.terrain ? d[body].clr : d[body].el);
function skyAt(d, az) {
  if (!d.horizon) return 0;
  const h = d.horizon.horizon_deg;
  return h[Math.round(az / d.horizon.az_step) % h.length];
}
function prep(d) {
  for (const body of ["sun", "earth"]) {
    const el = d[body].el, az = d[body].az;
    d[body].clr = d.horizon ? el.map((v, i) => v - skyAt(d, az[i])) : el;
    d[body].sky = d.horizon ? az.map((a) => skyAt(d, a)) : null;
  }
  d.flags = {};
  for (const m of ["flat", "terrain"]) {
    const k = m === "flat" ? "el" : "clr";
    d.flags[m] = {
      sunEver: d.sun[k].some((v) => v > 0),
      earthEver: d.earth[k].some((v) => v > 0),
      earthAlways: d.earth[k].every((v) => v > 0),
    };
  }
  if (d.horizon) d.horizon.max = Math.max(...d.horizon.horizon_deg);
}

// ---------- data ----------
async function load() {
  state.sites = await (await fetch("sites.json")).json();
  await Promise.all(state.sites.map(async (s) => {
    state.data[s.id] = await (await fetch(`data/sites/${s.id}.json`)).json();
    try {
      const r = await fetch(`data/horizons/${s.id}.json`);
      if (r.ok) state.data[s.id].horizon = await r.json();
    } catch (e) { /* no terrain for this site */ }
  }));
  state.n = Math.min(...Object.values(state.data).map((d) => d.n));
  Object.values(state.data).forEach(prep);
  const anyTerrain = Object.values(state.data).some((d) => d.horizon);
  if (!anyTerrain) { state.terrain = false; $("#terrain").style.display = "none"; }
  syncTerrainBtn();
  const now = Date.now();
  state.t = Math.min(timeOf(state.n - 1), Math.max(START, Math.floor(now / HOUR) * HOUR));
  $("#loading").classList.add("hide");
  render();
}

// ---------- body status ----------
function bodyStatus(d, body, f) {
  const el = valAt(d[body].el, f), az = azAt(d[body].az, f);
  const useT = usesTerrain(d);
  const sky = useT ? skyAt(d, az) : 0;
  const arr = vis(d, body);
  const up = el - sky > 0;
  const fl = d.flags[mode()];
  const ever = body === "sun" ? fl.sunEver : fl.earthEver;
  let next = null, after = null;
  if (ever) {
    next = nextEvent(arr, f, !up);
    if (next !== null) {
      const back = nextEvent(arr, next, up);
      after = back !== null ? back - next : null; // how long the next state lasts
    }
  }
  return {
    el, az, up, ever, sky, useT,
    blocked: useT && el > 0 && !up,
    inH: next !== null ? next - f : null, afterH: after,
  };
}

// ---------- render: strip ----------
function renderStrip() {
  const f = clampIdx(idxOf(state.t));
  const groups = [];
  for (const s of state.sites) {
    let g = groups.find((x) => x.key === s.group);
    if (!g) groups.push((g = { key: s.group, items: [] }));
    g.items.push(s);
  }
  $("#strip").innerHTML = groups.map((g) => `
    <div class="group">
      <div class="group-name">${GROUP_LABEL[g.key] || g.key.toUpperCase()}</div>
      <div class="group-cells">
        ${g.items.map((s) => {
          const d = state.data[s.id];
          const sun = bodyStatus(d, "sun", f), earth = bodyStatus(d, "earth", f);
          const cls = s.id === state.a ? "selA" : s.id === state.b ? "selB" : "";
          const tag = s.id === state.a
            ? `<span class="tag">A</span>`
            : `<button class="bbtn ${s.id === state.b ? "on" : ""}" data-b="${s.id}" title="${s.id === state.b ? "Remove from compare" : "Compare as site B"}">${s.id === state.b ? "B ×" : "+B"}</button>`;
          const sunDot = sun.up ? "sun" : sun.blocked ? "blk-sun" : "off";
          const earthDot = earth.up ? "earth" : earth.blocked ? "blk-earth" : "off";
          const earthTxt = earth.up ? "LINK" : earth.blocked ? "BLOCKED" : "NO LINK";
          return `<div class="cell ${cls}" data-id="${s.id}" role="button" tabindex="0" title="${s.name}">
            ${tag}
            <div class="cell-name">${shortName(s)}</div>
            <div class="cell-coord">${coordStr(s)}${d.horizon ? ` · <span class="tchip ${state.terrain ? "on" : ""}">TERRAIN</span>` : ""}</div>
            <div class="cell-lights">
              <span title="${sun.blocked ? "Sun above flat horizon but blocked by terrain" : ""}"><i class="dot ${sunDot}"></i>${deg1(sun.el)}</span>
              <span><i class="dot ${earthDot}"></i>${earthTxt}</span>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>`).join("");
}

// ---------- render: readout card ----------
function renderCard(slot) {
  const el = $(slot === "a" ? "#cardA" : "#cardB");
  const id = state[slot];
  if (!id) {
    el.innerHTML = `<div class="empty"><div class="lbl">SITE B · COMPARE</div>
      <p>Press <span class="mono">+B</span> on any site in the strip to compare it with site A.<br>
      Its curves appear dashed on the 30-day chart.</p></div>`;
    return;
  }
  const s = state.sites.find((x) => x.id === id), d = state.data[id];
  const f = clampIdx(idxOf(state.t));
  const sun = bodyStatus(d, "sun", f), earth = bodyStatus(d, "earth", f);
  const fl = d.flags[mode()];
  const horizonWord = sun.useT ? "the local terrain" : "the horizon";

  const sunLine = (() => {
    if (!sun.ever) return { tag: "NEVER LIT", plain: `The Sun never clears ${horizonWord} here in the data range: permanent shadow.` };
    if (sun.up) {
      const tail = sun.inH !== null ? `SUNSET IN ${durCode(sun.inH)}` : "NO SUNSET IN DATA RANGE";
      const how = sun.useT
        ? `Sun is up, ${sun.el.toFixed(1)}° high and ${(sun.el - sun.sky).toFixed(1)}° above the terrain in its direction. `
        : `Sun is up, ${sun.el.toFixed(1)}° above the horizon. `;
      const plain = how +
        (sun.inH !== null ? `It ${sun.useT ? "drops behind terrain or sets" : "sets"} in ${durPlain(sun.inH)}` : "It stays up through the data range") +
        (sun.afterH ? `, then stays hidden for ${durPlain(sun.afterH)}.` : ".");
      return { tag: tail, plain };
    }
    const tail = sun.inH !== null ? `${sun.blocked ? "CLEARS TERRAIN" : "SUNRISE"} IN ${durCode(sun.inH)}` : "NO SUNRISE IN DATA RANGE";
    const plain = sun.blocked
      ? `Sun is ${sun.el.toFixed(1)}° above a flat horizon, but terrain in that direction rises to ${sun.sky.toFixed(1)}°, so the site is in shadow. ` +
        (sun.inH !== null ? `Sunlight returns in ${durPlain(sun.inH)}.` : "")
      : `Sun is ${Math.abs(sun.el).toFixed(1)}° below the horizon: no solar power. ` +
        (sun.inH !== null ? `Sunlight returns in ${durPlain(sun.inH)}.` : "");
    return { tag: tail, plain };
  })();

  const earthLine = (() => {
    if (!earth.ever) return { tag: "NEVER VISIBLE", plain: `Earth never clears ${horizonWord} here: no direct-to-Earth comms at all. A relay satellite is required.` };
    if (fl.earthAlways) return { tag: "ALWAYS IN VIEW", plain: "Earth never sets here: on the near side it hangs in roughly the same spot all the time, so direct comms are always possible." };
    if (earth.up) {
      const tail = earth.inH !== null ? `LOS IN ${durCode(earth.inH)}` : "NO LOS IN DATA RANGE";
      const plain = `Earth is visible, so direct-to-Earth comms are possible. ` +
        (earth.inH !== null ? `Signal is lost in ${durPlain(earth.inH)}` : "It stays up through the data range") +
        (earth.afterH ? `, then Earth is out of view for ${durPlain(earth.afterH)}.` : ".");
      return { tag: tail, plain };
    }
    const tail = earth.inH !== null ? `AOS IN ${durCode(earth.inH)}` : "NO AOS IN DATA RANGE";
    const plain = earth.blocked
      ? `Earth is ${earth.el.toFixed(1)}° above a flat horizon, but terrain in that direction rises to ${earth.sky.toFixed(1)}°: no direct comms. ` +
        (earth.inH !== null ? `Link returns in ${durPlain(earth.inH)}.` : "")
      : `Earth is ${Math.abs(earth.el).toFixed(1)}° below the horizon: no direct comms. ` +
        (earth.inH !== null ? `Earth rises in ${durPlain(earth.inH)}.` : "");
    return { tag: tail, plain };
  })();

  const terrainNote = d.horizon
    ? (state.terrain
        ? `TERRAIN ON · LOLA ${d.horizon.dem.includes("240") ? "240 m" : ""} skyline · ground ${d.horizon.ground_elev_m >= 0 ? "+" : ""}${Math.round(d.horizon.ground_elev_m).toLocaleString("en-US")} m · terrain up to ${d.horizon.max.toFixed(1)}°`
        : `TERRAIN OFF · flat horizon (switch terrain on in the top bar)`)
    : `FLAT HORIZON · terrain not modelled for this site`;
  const sunBadge = sun.up ? ["up", "LIT"] : sun.blocked ? ["blk", "SHADOW"] : ["down", "DARK"];
  const earthBadge = earth.up ? ["up", "ACQUIRED"] : earth.blocked ? ["blk", "BLOCKED"] : ["down", "NO LINK"];

  el.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-slot">SITE ${slot.toUpperCase()} · ${(GROUP_LABEL[s.group] || s.group).toUpperCase()}</div>
        <div class="card-name">${s.name}</div>
      </div>
      <div class="card-coord">${coordStr(s)}${slot === "b" ? `<br><button data-clearb>CLEAR B</button>` : ""}</div>
    </div>
    <div class="card-note">${s.note}<div class="card-terrain ${d.horizon && state.terrain ? "on" : ""}">${terrainNote}</div></div>
    <div class="readout">
      <div class="ro-line">
        <span class="ro-key sun">SOLAR ELEV</span>
        <span class="ro-val">${sgn(sun.el)}°</span>
        <span class="ro-status ${sunBadge[0]} sun">${sunBadge[1]}</span>
        <span class="ro-meta">AZ ${sun.az.toFixed(1).padStart(5, "0")}°${sun.useT ? ` · TERRAIN ${deg1(sun.sky)}` : ""} · ${sunLine.tag}</span>
      </div>
      <div class="ro-plain">${sunLine.plain}</div>
    </div>
    <div class="readout">
      <div class="ro-line">
        <span class="ro-key earth">EARTH LINK</span>
        <span class="ro-val">${sgn(earth.el)}°</span>
        <span class="ro-status ${earthBadge[0]} earth">${earthBadge[1]}</span>
        <span class="ro-meta">AZ ${earth.az.toFixed(1).padStart(5, "0")}°${earth.useT ? ` · TERRAIN ${deg1(earth.sky)}` : ""} · ${earthLine.tag}</span>
      </div>
      <div class="ro-plain">${earthLine.plain}</div>
    </div>
    <div class="gauge">${gaugeSVG(d, f, slot)}</div>`;
}

// ---------- horizon gauge (panorama of the sky, az 0-360) ----------
function gaugeSVG(d, f, slot) {
  const W = 640, H = 190, L = 40, R = 10, T = 14, B = 26;
  const useT = usesTerrain(d);
  const i0 = Math.max(0, Math.floor(f - WINDOW_BEFORE_H)), i1 = Math.min(state.n - 1, Math.ceil(f + WINDOW_AFTER_H));
  let ymax = 4, ymin = 0;
  for (let i = i0; i <= i1; i++) ymax = Math.max(ymax, d.sun.el[i], d.earth.el[i]);
  if (useT) { ymax = Math.max(ymax, d.horizon.max); ymin = Math.min(...d.horizon.horizon_deg); }
  ymax = Math.min(90, niceCeil(ymax + 1));
  ymin = Math.min(ymin - 1, -Math.max(3, niceCeil(ymax * 0.35)));
  const x = (az) => L + (az / 360) * (W - L - R);
  const y = (el) => T + (ymax - Math.max(ymin, Math.min(ymax, el))) / (ymax - ymin) * (H - T - B);
  const y0 = y(0);
  const pid = `hatch-${slot}`;

  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sky panorama showing Sun and Earth relative to the horizon">
    <defs><pattern id="${pid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="${useT ? C.terrain : C.line}" stroke-width="2"/></pattern></defs>`;
  if (useT) {
    const h = d.horizon.horizon_deg, st = d.horizon.az_step;
    let p = `M${x(0)},${H - B}`;
    for (let k = 0; k <= h.length; k++) p += `L${x(k * st).toFixed(1)},${y(h[k % h.length]).toFixed(1)}`;
    p += `L${x(360)},${H - B}Z`;
    out += `<path d="${p}" fill="url(#${pid})" stroke="${C.terrain}" stroke-width="1.2"/>`;
  } else {
    out += `<rect x="${L}" y="${y0}" width="${W - L - R}" height="${H - B - y0}" fill="url(#${pid})"/>`;
  }
  // grid
  for (const t of ticks(ymin, ymax, 4)) {
    out += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? C.dim : C.line}" stroke-width="1" ${t === 0 ? (useT ? 'stroke-dasharray="5 3"' : "") : 'stroke-dasharray="2 4"'}/>
      <text x="${L - 6}" y="${y(t) + 3}" fill="${C.dim}" font-size="10" text-anchor="end" ${FONT}>${t > 0 ? "+" : ""}${t}°</text>`;
  }
  ["N", "E", "S", "W", "N"].forEach((c, k) => {
    const xx = x(k * 90);
    out += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${H - B}" stroke="${C.line}" stroke-width="1"/>
      <text x="${xx}" y="${H - 8}" fill="${C.dim}" font-size="10" text-anchor="middle" ${FONT}>${c} ${k * 90 % 360}°</text>`;
  });
  out += `<text x="${W - R - 4}" y="${y0 - 4}" fill="${C.dim}" font-size="9" text-anchor="end" ${FONT}>FLAT HORIZON 0°</text>`;
  if (useT) out += `<text x="${L + 4}" y="${H - B - 4}" fill="#a08a6c" font-size="9" ${FONT}>LOLA TERRAIN SKYLINE</text>`;
  // 30-day tracks
  for (const body of ["sun", "earth"]) {
    let path = "", prevAz = null;
    for (let i = i0; i <= i1; i += 2) {
      const az = d[body].az[i], el = d[body].el[i];
      const cmd = prevAz === null || Math.abs(az - prevAz) > 180 ? "M" : "L";
      path += `${cmd}${x(az).toFixed(1)},${y(el).toFixed(1)}`;
      prevAz = az;
    }
    out += `<path d="${path}" fill="none" stroke="${C[body]}" stroke-width="1" opacity=".35"/>`;
  }
  // current positions
  for (const body of ["earth", "sun"]) {
    const st = bodyStatus(d, body, f);
    const cx = x(st.az), cy = y(st.el), clipped = st.el < ymin;
    const r = body === "sun" ? 7 : 6;
    out += st.up
      ? `<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="${C[body]}" opacity=".18"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${C[body]}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.bg}" stroke="${C[body]}" stroke-width="1.5" stroke-dasharray="2 2"/>`;
    const label = `${body.toUpperCase()} ${deg1(st.el)}${clipped ? " ↓" : ""}${st.blocked ? " · BEHIND TERRAIN" : ""}`;
    const anchor = cx > W - 160 ? "end" : "start";
    out += `<text x="${cx + (anchor === "start" ? 11 : -11)}" y="${cy - 9}" fill="${C[body]}" font-size="11" font-weight="600" text-anchor="${anchor}" ${FONT}>${label}</text>`;
  }
  return out + `</svg>`;
}

function niceCeil(v) {
  const steps = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90];
  return steps.find((s) => s >= v) || 90;
}
function ticks(lo, hi, want) {
  const raw = (hi - lo) / want;
  const step = [0.5, 1, 2, 5, 10, 15, 20, 30, 45].find((s) => s >= raw) || 45;
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(+t.toFixed(2));
  if (!out.includes(0) && lo < 0 && hi > 0) out.push(0);
  return out.sort((a, b) => a - b);
}

// ---------- 30-day timeline ----------
function windowRange() {
  const f = clampIdx(idxOf(state.t));
  let i0 = Math.floor(f - WINDOW_BEFORE_H), i1 = i0 + WINDOW_BEFORE_H + WINDOW_AFTER_H;
  if (i0 < 0) { i1 -= i0; i0 = 0; }
  if (i1 > state.n - 1) { i0 -= i1 - (state.n - 1); i1 = state.n - 1; i0 = Math.max(0, i0); }
  return [i0, i1, f];
}

function renderTimeline() {
  const box = $("#timeline");
  const W = Math.max(560, box.clientWidth - 8);
  const [i0, i1, f] = windowRange();
  const shown = [state.a, state.b].filter(Boolean).map((id) => ({ id, d: state.data[id], s: state.sites.find((x) => x.id === id) }));
  const A = shown[0].d;
  const showSky = usesTerrain(A);

  const L = 56, R = 14, T = showSky ? 62 : 48, chartH = W < 700 ? 230 : 300;
  const trackH = 11, trackGap = 4;
  const trackRows = shown.length * 3;
  const tracksTop = T + chartH + 30;
  const H = tracksTop + trackRows * (trackH + trackGap) + (shown.length > 1 ? 8 : 0) + 6;

  let ymax = 4, ymin = 0;
  for (const { d } of shown) for (let i = i0; i <= i1; i++) ymax = Math.max(ymax, d.sun.el[i], d.earth.el[i]);
  if (showSky) for (let i = i0; i <= i1; i++) { ymax = Math.max(ymax, A.sun.sky[i], A.earth.sky[i]); ymin = Math.min(ymin, A.sun.sky[i]); }
  ymax = Math.min(90, niceCeil(ymax + 1));
  ymin = Math.min(ymin - 1, -Math.max(3, niceCeil(ymax * 0.3)));
  const x = (i) => L + ((i - i0) / (i1 - i0)) * (W - L - R);
  const y = (el) => T + (ymax - el) / (ymax - ymin) * chartH;
  const y0 = y(0);

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs><clipPath id="clipT"><rect x="${L}" y="${T}" width="${W - L - R}" height="${chartH}"/></clipPath></defs>`;
  // night / shadow bands for site A
  s += `<g clip-path="url(#clipT)">`;
  for (const [a, b] of runs(vis(A, "sun"), i0, i1, (v) => v <= 0)) {
    s += `<rect x="${x(a)}" y="${T}" width="${Math.max(1, x(b) - x(a))}" height="${chartH}" fill="#000" opacity=".35"/>`;
  }
  s += `<rect x="${L}" y="${y0}" width="${W - L - R}" height="${T + chartH - y0}" fill="#05070a" opacity=".55"/>`;
  s += `</g>`;
  // y grid
  for (const t of ticks(ymin, ymax, 6)) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? C.dim : C.line}" ${t === 0 ? "" : 'stroke-dasharray="2 4"'}/>
      <text x="${L - 8}" y="${y(t) + 3.5}" fill="${C.dim}" font-size="10.5" text-anchor="end" ${FONT}>${t > 0 ? "+" : ""}${t}°</text>`;
  }
  s += `<text x="${W - R - 4}" y="${y0 + 13}" fill="${C.dim}" font-size="9.5" text-anchor="end" ${FONT}>BELOW FLAT HORIZON</text>`;
  // x grid: days
  const labelEvery = W < 800 ? 5 : W < 1100 ? 3 : 2;
  const firstMidnight = Math.ceil(i0 / 24) * 24;
  for (let i = firstMidnight; i <= i1; i += 24) {
    const dt = new Date(timeOf(i));
    const major = dt.getUTCDate() % labelEvery === 0;
    s += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${T + chartH}" stroke="${C.line}" opacity="${major ? 1 : .45}"/>`;
    if (major) s += `<text x="${x(i)}" y="${T + chartH + 15}" fill="${C.dim}" font-size="10" text-anchor="middle" ${FONT}>${MONTHS[dt.getUTCMonth()]} ${pad(dt.getUTCDate())}</text>`;
  }
  // curves
  s += `<g clip-path="url(#clipT)">`;
  if (showSky) { // terrain height in the direction of each body (site A)
    for (const body of ["earth", "sun"]) {
      let p = "";
      for (let i = i0; i <= i1; i++) p += `${i === i0 ? "M" : "L"}${x(i).toFixed(1)},${y(A[body].sky[i]).toFixed(1)}`;
      s += `<path d="${p}" fill="none" stroke="${C[body]}" stroke-width="1.2" stroke-dasharray="1.5 3" opacity=".9"/>`;
    }
  }
  shown.forEach(({ d }, k) => {
    for (const body of ["earth", "sun"]) {
      let p = "";
      for (let i = i0; i <= i1; i++) p += `${i === i0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[body].el[i]).toFixed(1)}`;
      s += `<path d="${p}" fill="none" stroke="${C[body]}" stroke-width="${k ? 1.6 : 2}" ${k ? 'stroke-dasharray="6 4" opacity=".9"' : ""}/>`;
    }
  });
  s += `</g>`;
  // legend
  shown.forEach(({ s: site }, k) => {
    let lx = L;
    for (const body of ["sun", "earth"]) {
      s += `<line x1="${lx}" x2="${lx + 18}" y1="${10 + k * 15}" y2="${10 + k * 15}" stroke="${C[body]}" stroke-width="2" ${k ? 'stroke-dasharray="5 3"' : ""}/>`;
      lx += 22;
    }
    s += `<text x="${lx}" y="${13.5 + k * 15}" fill="${C.ink}" font-size="10.5" ${FONT}>${k ? "B" : "A"} · ${shortName(site).toUpperCase()} · elevation</text>`;
  });
  if (showSky) {
    const ky = 10 + shown.length * 15;
    let lx = L;
    for (const body of ["sun", "earth"]) {
      s += `<line x1="${lx}" x2="${lx + 18}" y1="${ky}" y2="${ky}" stroke="${C[body]}" stroke-width="1.4" stroke-dasharray="1.5 3"/>`;
      lx += 22;
    }
    s += `<text x="${lx}" y="${ky + 3.5}" fill="${C.ink}" font-size="10.5" ${FONT}>A · terrain height in that body's direction (body is hidden when its line is below this)</text>`;
  }
  // window tracks
  let ty = tracksTop;
  shown.forEach(({ d }, k) => {
    const sv = vis(d, "sun"), ev = vis(d, "earth");
    const rows = [
      ["SUN", C.sun, (i) => sv[i] > 0],
      ["EARTH", C.earth, (i) => ev[i] > 0],
      ["BOTH", C.both, (i) => sv[i] > 0 && ev[i] > 0],
    ];
    for (const [lab, col, test] of rows) {
      s += `<text x="${L - 8}" y="${ty + trackH - 2}" fill="${col}" font-size="9.5" text-anchor="end" ${FONT}>${k ? "B" : "A"}·${lab}</text>`;
      s += `<rect x="${L}" y="${ty}" width="${W - L - R}" height="${trackH}" fill="none" stroke="${C.line}"/>`;
      for (const [a, b] of runsIdx(i0, i1, test)) {
        s += `<rect x="${x(a)}" y="${ty + 1}" width="${Math.max(1, x(b) - x(a))}" height="${trackH - 2}" fill="${col}" opacity="${k ? .55 : .85}"/>`;
      }
      ty += trackH + trackGap;
    }
    ty += 8;
  });
  // cursor
  const cx = x(f);
  s += `<line x1="${cx}" x2="${cx}" y1="${T - 6}" y2="${ty - 10}" stroke="${C.ink}" stroke-width="1.2"/>
    <text x="${cx}" y="${T - 4}" fill="${C.ink}" font-size="10" text-anchor="${cx > W - 140 ? "end" : "start"}" dx="${cx > W - 140 ? -5 : 5}" ${FONT}>${fmtDate(state.t)}</text>`;
  s += `<line id="hover" x1="0" x2="0" y1="${T}" y2="${ty - 10}" stroke="${C.dim}" stroke-dasharray="3 3" visibility="hidden"/>`;
  s += `</svg><div class="tip" id="tip"></div>`;
  box.innerHTML = s;

  const svg = box.querySelector("svg");
  const toIdx = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    return Math.max(i0, Math.min(i1, i0 + ((px - L) / (W - L - R)) * (i1 - i0)));
  };
  svg.addEventListener("click", (ev) => { setTime(timeOf(Math.round(toIdx(ev)))); });
  svg.addEventListener("mousemove", (ev) => {
    const i = Math.round(toIdx(ev)), hv = svg.querySelector("#hover"), tip = box.querySelector("#tip");
    hv.setAttribute("x1", x(i)); hv.setAttribute("x2", x(i)); hv.setAttribute("visibility", "visible");
    tip.innerHTML = `${fmtDate(timeOf(i))}<br>` + shown.map(({ d }, k) => {
      const tag = (body) => usesTerrain(d) ? (d[body].clr[i] > 0 ? "" : d[body].el[i] > 0 ? " (terrain)" : "") : "";
      return `<span style="color:${C.sun}">${k ? "B" : "A"} SUN ${sgn(d.sun.el[i])}°${tag("sun")}</span>  <span style="color:${C.earth}">EARTH ${sgn(d.earth.el[i])}°${tag("earth")}</span>`;
    }).join("<br>");
    const r = box.getBoundingClientRect();
    tip.style.display = "block";
    const left = ev.clientX - r.left + 14;
    tip.style.left = Math.min(left, r.width - tip.offsetWidth - 6) + "px";
    tip.style.top = (ev.clientY - r.top + 14) + "px";
  });
  svg.addEventListener("mouseleave", () => {
    svg.querySelector("#hover").setAttribute("visibility", "hidden");
    box.querySelector("#tip").style.display = "none";
  });
}

function runs(arr, i0, i1, test) { return runsIdx(i0, i1, (i) => test(arr[i])); }
function runsIdx(i0, i1, test) {
  const out = [];
  let start = null;
  for (let i = i0; i <= i1; i++) {
    const on = test(i);
    if (on && start === null) start = i;
    if ((!on || i === i1) && start !== null) { out.push([start, i]); start = null; }
  }
  return out;
}

// ---------- summary table ----------
function stats(d, i0, i1, key) {
  const sa = d.sun[key], ea = d.earth[key];
  let sun = 0, earth = 0, both = 0, maxSun = -90, dark = 0, longDark = 0, black = 0, longBlack = 0;
  const n = i1 - i0 + 1;
  for (let i = i0; i <= i1; i++) {
    const s = sa[i] > 0, e = ea[i] > 0;
    if (s) sun++; if (e) earth++; if (s && e) both++;
    maxSun = Math.max(maxSun, d.sun.el[i]);
    dark = s ? 0 : dark + 1; longDark = Math.max(longDark, dark);
    black = e ? 0 : black + 1; longBlack = Math.max(longBlack, black);
  }
  return { sun: 100 * sun / n, earth: 100 * earth / n, both: 100 * both / n, maxSun, longDark, longBlack };
}

function renderSummary() {
  const f = Math.floor(clampIdx(idxOf(state.t)));
  const i0 = f, i1 = Math.min(state.n - 1, f + 30 * 24);
  const ids = [state.a, state.b].filter(Boolean);
  const st = ids.map((id) => stats(state.data[id], i0, i1, state.terrain ? "clr" : "el"));
  const flat = ids.map((id) => stats(state.data[id], i0, i1, "el"));
  const terr = ids.map((id) => usesTerrain(state.data[id]));
  const rows = [
    ["Sunlight", "sun", (v) => `${v.toFixed(1)}%`, "hi", "share of time the Sun is visible (solar power)"],
    ["Max solar elevation", "maxSun", (v) => `${sgn(v)}°`, "hi", "higher Sun = more power from fixed panels"],
    ["Longest continuous darkness", "longDark", (v) => v ? durCode(v) : "NONE", "lo", "how long batteries must last without sunlight"],
    ["Earth visible", "earth", (v) => `${v.toFixed(1)}%`, "hi", "share of time direct-to-Earth comms are possible"],
    ["Longest Earth blackout", "longBlack", (v) => v ? durCode(v) : "NONE", "lo", "longest gap with no direct link"],
    ["Power + comms together", "both", (v) => `${v.toFixed(1)}%`, "hi", "Sun AND Earth visible: the best operating windows"],
  ];
  const head = ids.map((id, k) => `<th>${k ? "B" : "A"} · ${shortName(state.sites.find((s) => s.id === id)).toUpperCase()}${terr[k] ? " · TERRAIN" : ""}</th>`).join("");
  $("#summary").innerHTML = `<table class="sum"><thead><tr><th>${fmtDate(timeOf(i0), false)} → ${fmtDate(timeOf(i1), false)}</th>${head}</tr></thead><tbody>
    ${rows.map(([lab, key, fmt, better, why]) => {
      const vals = st.map((x) => x[key]);
      let best = -1;
      if (vals.length === 2 && Math.abs(vals[0] - vals[1]) > 0.05) best = (better === "hi") === (vals[0] > vals[1]) ? 0 : 1;
      return `<tr><td>${lab}<span class="why">${why}</span></td>${vals.map((v, k) => {
        const diff = terr[k] && key !== "maxSun" && Math.abs(flat[k][key] - v) > 0.05;
        return `<td class="${k === best ? "better" : ""}">${fmt(v)}${diff ? `<span class="flatv">flat horizon: ${fmt(flat[k][key])}</span>` : ""}</td>`;
      }).join("")}</tr>`;
    }).join("")}
  </tbody></table>`;
}

// ---------- controls ----------
function syncInputs() {
  const d = new Date(state.t);
  $("#date").value = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  $("#time").value = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  $("#date").min = "2026-11-01";
  $("#date").max = new Date(timeOf(state.n - 1)).toISOString().slice(0, 10);
}
function syncTerrainBtn() {
  const b = $("#terrain");
  b.classList.toggle("on", state.terrain);
  b.textContent = state.terrain ? "TERRAIN: ON" : "TERRAIN: OFF";
  $("#tl-label").textContent = state.terrain
    ? "30-DAY EPHEMERIS · ELEVATION · WINDOWS USE REAL TERRAIN WHERE AVAILABLE"
    : "30-DAY EPHEMERIS · ELEVATION ABOVE FLAT HORIZON";
}
function setTime(t) {
  state.t = Math.max(START, Math.min(timeOf(state.n - 1), t));
  render();
}
function render() {
  syncInputs();
  renderStrip();
  renderCard("a");
  renderCard("b");
  renderTimeline();
  renderSummary();
}

// Strip actions fire on pointerdown (not click): during PLAY the strip is
// redrawn many times a second, and a click needs press + release on the same
// element, so clicks there could get lost.
function stripAction(target) {
  const bb = target.closest("[data-b]");
  if (bb) { state.b = state.b === bb.dataset.b ? null : bb.dataset.b; render(); return true; }
  const cell = target.closest(".cell");
  if (cell) {
    const id = cell.dataset.id;
    if (id === state.b) state.b = state.a;
    state.a = id;
    render();
    return true;
  }
  return false;
}
document.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  if (ev.target.closest("#strip")) { ev.preventDefault(); stripAction(ev.target); }
});
document.addEventListener("click", (ev) => {
  if (ev.target.closest("#strip")) return; // handled on pointerdown
  if (ev.target.closest("[data-clearb]")) { state.b = null; render(); return; }
  const st = ev.target.closest("[data-step]");
  if (st) setTime(state.t + Number(st.dataset.step) * HOUR);
});
document.addEventListener("keydown", (ev) => {
  if ((ev.key === "Enter" || ev.key === " ") && ev.target.closest && ev.target.closest("#strip")) {
    ev.preventDefault();
    stripAction(ev.target);
  }
});
$("#now").addEventListener("click", () => setTime(Math.floor(Date.now() / HOUR) * HOUR));
$("#terrain").addEventListener("click", () => { state.terrain = !state.terrain; syncTerrainBtn(); render(); });
function readInputs() {
  const [y, m, d] = $("#date").value.split("-").map(Number);
  const [hh, mm] = ($("#time").value || "00:00").split(":").map(Number);
  if (y && m && d) setTime(Date.UTC(y, m - 1, d, hh || 0, mm || 0));
}
$("#date").addEventListener("change", readInputs);
$("#time").addEventListener("change", readInputs);
$("#play").addEventListener("click", () => {
  state.playing = !state.playing;
  $("#play").classList.toggle("on", state.playing);
  $("#play").textContent = state.playing ? "❚❚ PAUSE" : "▶ PLAY";
  clearInterval(state.timer);
  if (state.playing) state.timer = setInterval(() => {
    if (state.t >= timeOf(state.n - 1)) { $("#play").click(); return; }
    setTime(state.t + 2 * HOUR);
  }, 60);
});
let resizeT;
window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(renderTimeline, 120); });

load().catch((e) => {
  $("#loading").textContent = "COULD NOT LOAD DATA: open this page through a web server (see README).";
  console.error(e);
});
