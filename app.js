// app.js: Lunar Sites console.
// Reads precomputed NASA/JPL Horizons data (data/sites/*.json) and shows
// Sun & Earth visibility for lunar landing sites.
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
  sun: "#ffb020", earth: "#4fb7ff", both: "#7ee3a1",
  line: "#243041", line2: "#2f3d52", dim: "#7f8e9e", faint: "#4a5869", ink: "#dbe3ec", alert: "#ff5a4f",
};

const state = { sites: [], data: {}, t: START, a: "shackleton", b: null, playing: false, timer: null, n: 0 };

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const pad = (n, w = 2) => String(n).padStart(w, "0");
const clampIdx = (f) => Math.max(0, Math.min(state.n - 1, f));
const idxOf = (t) => (t - START) / HOUR;
const timeOf = (f) => START + f * HOUR;

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
// next time (fractional index) the body goes up (wantUp=true) or down
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

// ---------- data ----------
async function load() {
  state.sites = await (await fetch("sites.json")).json();
  await Promise.all(state.sites.map(async (s) => {
    state.data[s.id] = await (await fetch(`data/sites/${s.id}.json`)).json();
  }));
  state.n = Math.min(...Object.values(state.data).map((d) => d.n));
  for (const s of state.sites) {
    const d = state.data[s.id];
    d.earthEver = d.earth.el.some((v) => v > 0);
    d.sunEver = d.sun.el.some((v) => v > 0);
    d.earthAlways = d.earth.el.every((v) => v > 0);
  }
  const now = Date.now();
  state.t = Math.min(timeOf(state.n - 1), Math.max(START, Math.floor(now / HOUR) * HOUR));
  $("#loading").classList.add("hide");
  render();
}

// ---------- body status ----------
function bodyStatus(d, body, f) {
  const arr = d[body].el;
  const el = valAt(arr, f), az = azAt(d[body].az, f);
  const up = el > 0;
  let next = null, after = null;
  const ever = body === "sun" ? d.sunEver : d.earthEver;
  if (ever) {
    next = nextEvent(arr, f, !up);
    if (next !== null) {
      const back = nextEvent(arr, next, up);
      after = back !== null ? back - next : null; // how long the next state lasts
    }
  }
  return { el, az, up, ever, inH: next !== null ? next - f : null, afterH: after };
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
          const se = valAt(d.sun.el, f), ee = valAt(d.earth.el, f);
          const cls = s.id === state.a ? "selA" : s.id === state.b ? "selB" : "";
          const tag = s.id === state.a
            ? `<span class="tag">A</span>`
            : `<button class="bbtn ${s.id === state.b ? "on" : ""}" data-b="${s.id}" title="${s.id === state.b ? "Remove from compare" : "Compare as site B"}">${s.id === state.b ? "B ×" : "+B"}</button>`;
          return `<div class="cell ${cls}" data-id="${s.id}" role="button" tabindex="0" title="${s.name}">
            ${tag}
            <div class="cell-name">${s.name.replace(/ \(.*\)/, "")}</div>
            <div class="cell-coord">${coordStr(s)}</div>
            <div class="cell-lights">
              <span><i class="dot ${se > 0 ? "sun" : "off"}"></i>${se >= 0 ? "+" : "−"}${Math.abs(se).toFixed(1)}°</span>
              <span><i class="dot ${ee > 0 ? "earth" : "off"}"></i>${ee > 0 ? "LINK" : "NO LINK"}</span>
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

  const sunLine = (() => {
    if (!sun.ever) return { tag: "NEVER", plain: "The Sun never rises above the flat horizon here in the data range." };
    if (sun.up) {
      const tail = sun.inH !== null ? `SUNSET IN ${durCode(sun.inH)}` : "NO SUNSET IN DATA RANGE";
      const plain = `Sun is up, ${sun.el.toFixed(1)}° above the horizon. ` +
        (sun.inH !== null ? `It sets in ${durPlain(sun.inH)}` : "It stays up through the data range") +
        (sun.afterH ? `, then stays down for ${durPlain(sun.afterH)}.` : ".");
      return { tag: tail, plain };
    }
    const tail = sun.inH !== null ? `SUNRISE IN ${durCode(sun.inH)}` : "NO SUNRISE IN DATA RANGE";
    const plain = `Sun is ${Math.abs(sun.el).toFixed(1)}° below the horizon: no solar power. ` +
      (sun.inH !== null ? `Sunrise in ${durPlain(sun.inH)}.` : "");
    return { tag: tail, plain };
  })();

  const earthLine = (() => {
    if (!earth.ever) return { tag: "NEVER VISIBLE", plain: "Earth never rises here: no direct-to-Earth comms at all. A relay satellite is required." };
    if (d.earthAlways) return { tag: "ALWAYS IN VIEW", plain: "Earth never sets here: on the near side it hangs in roughly the same spot all the time, so direct comms are always possible." };
    if (earth.up) {
      const tail = earth.inH !== null ? `LOS IN ${durCode(earth.inH)}` : "NO LOS IN DATA RANGE";
      const plain = `Earth is visible, so direct-to-Earth comms are possible. ` +
        (earth.inH !== null ? `Earth sets in ${durPlain(earth.inH)}` : "It stays up through the data range") +
        (earth.afterH ? `, then is out of view for ${durPlain(earth.afterH)}.` : ".");
      return { tag: tail, plain };
    }
    const tail = earth.inH !== null ? `AOS IN ${durCode(earth.inH)}` : "NO AOS IN DATA RANGE";
    const plain = `Earth is ${Math.abs(earth.el).toFixed(1)}° below the horizon: no direct comms. ` +
      (earth.inH !== null ? `Earth rises in ${durPlain(earth.inH)}.` : "");
    return { tag: tail, plain };
  })();

  el.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-slot">SITE ${slot.toUpperCase()} · ${(GROUP_LABEL[s.group] || s.group).toUpperCase()}</div>
        <div class="card-name">${s.name}</div>
      </div>
      <div class="card-coord">${coordStr(s)}${slot === "b" ? `<br><button data-clearb>CLEAR B</button>` : ""}</div>
    </div>
    <div class="card-note">${s.note}</div>
    <div class="readout">
      <div class="ro-line">
        <span class="ro-key sun">SOLAR ELEV</span>
        <span class="ro-val">${sgn(sun.el)}°</span>
        <span class="ro-status ${sun.up ? "up" : "down"} sun">${sun.up ? "LIT" : "DARK"}</span>
        <span class="ro-meta">AZ ${sun.az.toFixed(1).padStart(5, "0")}° · ${sunLine.tag}</span>
      </div>
      <div class="ro-plain">${sunLine.plain}</div>
    </div>
    <div class="readout">
      <div class="ro-line">
        <span class="ro-key earth">EARTH LINK</span>
        <span class="ro-val">${sgn(earth.el)}°</span>
        <span class="ro-status ${earth.up ? "up" : "down"} earth">${earth.up ? "ACQUIRED" : "NO LINK"}</span>
        <span class="ro-meta">AZ ${earth.az.toFixed(1).padStart(5, "0")}° · ${earthLine.tag}</span>
      </div>
      <div class="ro-plain">${earthLine.plain}</div>
    </div>
    <div class="gauge">${gaugeSVG(d, f)}</div>`;
}

// ---------- horizon gauge (panorama of the sky, az 0-360) ----------
function gaugeSVG(d, f) {
  const W = 640, H = 190, L = 40, R = 10, T = 14, B = 26;
  const i0 = Math.max(0, Math.floor(f - WINDOW_BEFORE_H)), i1 = Math.min(state.n - 1, Math.ceil(f + WINDOW_AFTER_H));
  let ymax = 4;
  for (let i = i0; i <= i1; i++) ymax = Math.max(ymax, d.sun.el[i], d.earth.el[i]);
  ymax = Math.min(90, niceCeil(ymax + 1));
  const ymin = -Math.max(3, niceCeil(ymax * 0.35));
  const x = (az) => L + (az / 360) * (W - L - R);
  const y = (el) => T + (ymax - Math.max(ymin, Math.min(ymax, el))) / (ymax - ymin) * (H - T - B);
  const y0 = y(0);

  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sky panorama showing Sun and Earth relative to the horizon">
    <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="${C.line}" stroke-width="2"/></pattern></defs>
    <rect x="${L}" y="${y0}" width="${W - L - R}" height="${H - B - y0}" fill="url(#hatch)"/>`;
  // grid
  for (const t of ticks(ymin, ymax, 4)) {
    out += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? C.dim : C.line}" stroke-width="1" ${t === 0 ? "" : 'stroke-dasharray="2 4"'}/>
      <text x="${L - 6}" y="${y(t) + 3}" fill="${C.dim}" font-size="10" text-anchor="end" font-family="IBM Plex Mono, Consolas, monospace">${t > 0 ? "+" : ""}${t}°</text>`;
  }
  ["N", "E", "S", "W", "N"].forEach((c, k) => {
    const xx = x(k * 90);
    out += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${H - B}" stroke="${C.line}" stroke-width="1"/>
      <text x="${xx}" y="${H - 8}" fill="${C.dim}" font-size="10" text-anchor="middle" font-family="IBM Plex Mono, Consolas, monospace">${c} ${k * 90 % 360}°</text>`;
  });
  out += `<text x="${W - R - 4}" y="${y0 - 4}" fill="${C.dim}" font-size="9" text-anchor="end" font-family="IBM Plex Mono, Consolas, monospace">FLAT HORIZON 0°</text>`;
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
    const el = valAt(d[body].el, f), az = azAt(d[body].az, f);
    const cx = x(az), cy = y(el), up = el > 0, clipped = el < ymin;
    const r = body === "sun" ? 7 : 6;
    out += up
      ? `<circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="${C[body]}" opacity=".18"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${C[body]}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.bg || "#0a0d12"}" stroke="${C[body]}" stroke-width="1.5" stroke-dasharray="2 2"/>`;
    const label = `${body.toUpperCase()} ${el >= 0 ? "+" : "−"}${Math.abs(el).toFixed(1)}°${clipped ? " ↓" : ""}`;
    const anchor = cx > W - 90 ? "end" : "start";
    out += `<text x="${cx + (anchor === "start" ? 11 : -11)}" y="${cy - 9}" fill="${C[body]}" font-size="11" font-weight="600" text-anchor="${anchor}" font-family="IBM Plex Mono, Consolas, monospace">${label}</text>`;
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

  const L = 56, R = 14, T = 48, chartH = W < 700 ? 230 : 300;
  const trackH = 11, trackGap = 4;
  const trackRows = shown.length * 3;
  const tracksTop = T + chartH + 30;
  const H = tracksTop + trackRows * (trackH + trackGap) + (shown.length > 1 ? 8 : 0) + 6;

  let ymax = 4;
  for (const { d } of shown) for (let i = i0; i <= i1; i++) ymax = Math.max(ymax, d.sun.el[i], d.earth.el[i]);
  ymax = Math.min(90, niceCeil(ymax + 1));
  const ymin = -Math.max(3, niceCeil(ymax * 0.3));
  const x = (i) => L + ((i - i0) / (i1 - i0)) * (W - L - R);
  const y = (el) => T + (ymax - el) / (ymax - ymin) * chartH;
  const y0 = y(0);
  const A = shown[0].d;

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs><clipPath id="clipT"><rect x="${L}" y="${T}" width="${W - L - R}" height="${chartH}"/></clipPath></defs>`;
  // night bands for site A
  s += `<g clip-path="url(#clipT)">`;
  for (const [a, b] of runs(A.sun.el, i0, i1, (v) => v <= 0)) {
    s += `<rect x="${x(a)}" y="${T}" width="${Math.max(1, x(b) - x(a))}" height="${chartH}" fill="#000" opacity=".35"/>`;
  }
  s += `<rect x="${L}" y="${y0}" width="${W - L - R}" height="${T + chartH - y0}" fill="#05070a" opacity=".55"/>`;
  s += `</g>`;
  // y grid
  for (const t of ticks(ymin, ymax, 6)) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? C.dim : C.line}" ${t === 0 ? "" : 'stroke-dasharray="2 4"'}/>
      <text x="${L - 8}" y="${y(t) + 3.5}" fill="${C.dim}" font-size="10.5" text-anchor="end" font-family="IBM Plex Mono, Consolas, monospace">${t > 0 ? "+" : ""}${t}°</text>`;
  }
  s += `<text x="${W - R - 4}" y="${y0 + 13}" fill="${C.dim}" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono, Consolas, monospace">BELOW HORIZON</text>`;
  // x grid: days
  const days = (i1 - i0) / 24, labelEvery = W < 800 ? 5 : W < 1100 ? 3 : 2;
  const firstMidnight = Math.ceil(i0 / 24) * 24;
  let dayCount = 0;
  for (let i = firstMidnight; i <= i1; i += 24, dayCount++) {
    const dt = new Date(timeOf(i));
    const major = dt.getUTCDate() % labelEvery === 0;
    s += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${T + chartH}" stroke="${C.line}" opacity="${major ? 1 : .45}"/>`;
    if (major) s += `<text x="${x(i)}" y="${T + chartH + 15}" fill="${C.dim}" font-size="10" text-anchor="middle" font-family="IBM Plex Mono, Consolas, monospace">${MONTHS[dt.getUTCMonth()]} ${pad(dt.getUTCDate())}</text>`;
  }
  // curves
  s += `<g clip-path="url(#clipT)">`;
  shown.forEach(({ d }, k) => {
    for (const body of ["earth", "sun"]) {
      let p = "";
      for (let i = i0; i <= i1; i++) p += `${i === i0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[body].el[i]).toFixed(1)}`;
      s += `<path d="${p}" fill="none" stroke="${C[body]}" stroke-width="${k ? 1.6 : 2}" ${k ? 'stroke-dasharray="6 4" opacity=".9"' : ""}/>`;
    }
  });
  s += `</g>`;
  // legend
  let lx = L;
  shown.forEach(({ s: site }, k) => {
    const nm = site.name.replace(/ \(.*\)/, "").toUpperCase();
    for (const body of ["sun", "earth"]) {
      s += `<line x1="${lx}" x2="${lx + 18}" y1="${10 + k * 15}" y2="${10 + k * 15}" stroke="${C[body]}" stroke-width="2" ${k ? 'stroke-dasharray="5 3"' : ""}/>`;
      lx += 22;
    }
    s += `<text x="${lx}" y="${13.5 + k * 15}" fill="${C.ink}" font-size="10.5" font-family="IBM Plex Mono, Consolas, monospace">${k ? "B" : "A"} · ${nm}</text>`;
    lx = L;
  });
  // window tracks
  let ty = tracksTop;
  shown.forEach(({ d, s: site }, k) => {
    const rows = [
      ["SUN", C.sun, (i) => d.sun.el[i] > 0],
      ["EARTH", C.earth, (i) => d.earth.el[i] > 0],
      ["BOTH", C.both, (i) => d.sun.el[i] > 0 && d.earth.el[i] > 0],
    ];
    for (const [lab, col, test] of rows) {
      s += `<text x="${L - 8}" y="${ty + trackH - 2}" fill="${col}" font-size="9.5" text-anchor="end" font-family="IBM Plex Mono, Consolas, monospace">${k ? "B" : "A"}·${lab}</text>`;
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
    <text x="${cx}" y="${T - 4}" fill="${C.ink}" font-size="10" text-anchor="${cx > W - 140 ? "end" : "start"}" dx="${cx > W - 140 ? -5 : 5}" font-family="IBM Plex Mono, Consolas, monospace">${fmtDate(state.t)}</text>`;
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
    tip.innerHTML = `${fmtDate(timeOf(i))}<br>` + shown.map(({ d }, k) =>
      `<span style="color:${C.sun}">${k ? "B" : "A"} SUN ${sgn(d.sun.el[i])}°</span>  <span style="color:${C.earth}">EARTH ${sgn(d.earth.el[i])}°</span>`).join("<br>");
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
    if ((!on || i === i1) && start !== null) { out.push([start, on ? i : i]); start = null; }
  }
  return out;
}

// ---------- summary table ----------
function stats(d, i0, i1) {
  let sun = 0, earth = 0, both = 0, maxSun = -90, dark = 0, longDark = 0, black = 0, longBlack = 0;
  const n = i1 - i0 + 1;
  for (let i = i0; i <= i1; i++) {
    const s = d.sun.el[i] > 0, e = d.earth.el[i] > 0;
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
  const st = ids.map((id) => stats(state.data[id], i0, i1));
  const rows = [
    ["Sunlight", "sun", (v) => `${v.toFixed(1)}%`, "hi", "share of time the Sun is above the horizon (solar power)"],
    ["Max solar elevation", "maxSun", (v) => `${sgn(v)}°`, "hi", "higher Sun = more power from fixed panels"],
    ["Longest continuous darkness", "longDark", (v) => v ? durCode(v) : "NONE", "lo", "how long batteries must last without sunlight"],
    ["Earth visible", "earth", (v) => `${v.toFixed(1)}%`, "hi", "share of time direct-to-Earth comms are possible"],
    ["Longest Earth blackout", "longBlack", (v) => v ? durCode(v) : "NONE", "lo", "longest gap with no direct link"],
    ["Power + comms together", "both", (v) => `${v.toFixed(1)}%`, "hi", "Sun up AND Earth visible: the best operating windows"],
  ];
  const head = ids.map((id, k) => `<th>${k ? "B" : "A"} · ${state.sites.find((s) => s.id === id).name.replace(/ \(.*\)/, "").toUpperCase()}</th>`).join("");
  $("#summary").innerHTML = `<table class="sum"><thead><tr><th>${fmtDate(timeOf(i0), false)} → ${fmtDate(timeOf(i1), false)}</th>${head}</tr></thead><tbody>
    ${rows.map(([lab, key, fmt, better, why]) => {
      const vals = st.map((x) => x[key]);
      let best = -1;
      if (vals.length === 2 && Math.abs(vals[0] - vals[1]) > 0.05) best = (better === "hi") === (vals[0] > vals[1]) ? 0 : 1;
      return `<tr><td>${lab}<span class="why">${why}</span></td>${vals.map((v, k) => `<td class="${k === best ? "better" : ""}">${fmt(v)}</td>`).join("")}</tr>`;
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
