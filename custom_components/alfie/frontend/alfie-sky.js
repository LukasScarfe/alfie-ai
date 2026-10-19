// Where the sun, the moon, the five naked-eye planets and the stars are, computed
// in the browser. A port of xy-bench's xy/sky.py: Paul Schlyter's low-precision
// formulas ("How to compute planetary positions"), good to a fraction of a degree.
// Pure ES module, no DOM, so node can test it (tests/screens/sky.test.mjs).
//
// Altitude and azimuth are in degrees, azimuth from north through east. Times are
// Unix seconds. Latitude is north-positive and longitude east-positive.

const V = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const D = Math.PI / 180;
const sin = (deg) => Math.sin(deg * D);
const cos = (deg) => Math.cos(deg * D);
const rev = (x) => x - 360 * Math.floor(x / 360);

// Days since Schlyter's epoch (1999 Dec 31.0).
const day = (t) => t / 86400 + 2440587.5 - 2451543.5;
const utHours = (t) => (t - 86400 * Math.floor(t / 86400)) / 3600;

// Eccentric anomaly (degrees) from the mean anomaly m (degrees).
function kepler(m, e) {
  let E = m + (e / D) * sin(m) * (1 + e * cos(m));
  for (let i = 0; i < 5; i++) E -= (E - (e / D) * sin(E) - m) / (1 - e * cos(E));
  return E;
}

// [ecliptic longitude, distance in AU, mean longitude, mean anomaly], degrees.
function sunPos(d) {
  const w = 282.9404 + 4.70935e-5 * d;
  const e = 0.016709 - 1.151e-9 * d;
  const M = rev(356.047 + 0.9856002585 * d);
  const E = kepler(M, e);
  const xv = cos(E) - e;
  const yv = Math.sqrt(1 - e * e) * sin(E);
  return [rev(Math.atan2(yv, xv) / D + w), Math.hypot(xv, yv), rev(M + w), M];
}

// [ecliptic longitude, latitude in degrees, distance in Earth radii].
function moonPos(d) {
  const N = 125.1228 - 0.0529538083 * d;
  const i = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = 60.2666, e = 0.0549;
  const M = rev(115.3654 + 13.0649929509 * d);
  const E = kepler(M, e);
  const xv = a * (cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sin(E);
  const v = Math.atan2(yv, xv) / D;
  let r = Math.hypot(xv, yv);
  const vw = (v + w) * D;
  const xh = r * (cos(N) * Math.cos(vw) - sin(N) * Math.sin(vw) * cos(i));
  const yh = r * (sin(N) * Math.cos(vw) + cos(N) * Math.sin(vw) * cos(i));
  const zh = r * Math.sin(vw) * sin(i);
  let lon = Math.atan2(yh, xh) / D;
  let lat = Math.atan2(zh, Math.hypot(xh, yh)) / D;

  // The largest perturbations, from the sun's pull.
  const [, , Ls, Ms] = sunPos(d);
  const Mm = M, Lm = M + w + N, Dd = Lm - Ls, F = Lm - N;
  lon += -1.274 * sin(Mm - 2 * Dd) + 0.658 * sin(2 * Dd) - 0.186 * sin(Ms)
    - 0.059 * sin(2 * Mm - 2 * Dd) - 0.057 * sin(Mm - 2 * Dd + Ms)
    + 0.053 * sin(Mm + 2 * Dd) + 0.046 * sin(2 * Dd - Ms)
    + 0.041 * sin(Mm - Ms) - 0.035 * sin(Dd) - 0.031 * sin(Mm + Ms)
    - 0.015 * sin(2 * F - 2 * Dd) + 0.011 * sin(Mm - 4 * Dd);
  lat += -0.173 * sin(F - 2 * Dd) - 0.055 * sin(Mm - F - 2 * Dd)
    - 0.046 * sin(Mm + F - 2 * Dd) + 0.033 * sin(F + 2 * Dd) + 0.017 * sin(2 * Mm + F);
  r += -0.58 * cos(Mm - 2 * Dd) - 0.46 * cos(2 * Dd);
  return [rev(lon), lat, r];
}

// Ecliptic (lon, lat) to [right ascension, declination], degrees.
function equatorial(lon, lat, d) {
  const ecl = (23.4393 - 3.563e-7 * d) * D;
  const x = cos(lon) * cos(lat), y = sin(lon) * cos(lat), z = sin(lat);
  const ye = y * Math.cos(ecl) - z * Math.sin(ecl);
  const ze = y * Math.sin(ecl) + z * Math.cos(ecl);
  return [rev(Math.atan2(ye, x) / D), Math.atan2(ze, Math.hypot(x, ye)) / D];
}

// [altitude, azimuth] in degrees, azimuth from north through east.
function horizontal(ra, dec, d, ut, lat, lon) {
  const Ls = sunPos(d)[2];
  const ha = (rev(Ls + 180 + ut * 15 + lon) - ra) * D;
  const x = Math.cos(ha) * cos(dec), y = Math.sin(ha) * cos(dec), z = sin(dec);
  const xh = x * sin(lat) - z * cos(lat);
  const zh = x * cos(lat) + z * sin(lat);
  return [Math.asin(Math.max(-1, Math.min(1, zh))) / D, rev(Math.atan2(y, xh) / D + 180)];
}

export function sun(lat, lon, t) {
  const d = day(t);
  const [ra, dec] = equatorial(sunPos(d)[0], 0, d);
  return horizontal(ra, dec, d, utHours(t), lat, lon);
}

// As seen from the ground: parallax lowers the moon by up to a degree.
export function moon(lat, lon, t) {
  const d = day(t);
  const [mlon, mlat, r] = moonPos(d);
  const [ra, dec] = equatorial(mlon, mlat, d);
  const [alt, az] = horizontal(ra, dec, d, utHours(t), lat, lon);
  return [alt - (Math.asin(1 / r) / D) * cos(alt), az];
}

// 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter, from the sun-moon angle.
export function moonPhase(t) {
  const d = day(t);
  return rev(moonPos(d)[0] - sunPos(d)[0]) / 360;
}

// ----------------------------------------------------------------- planets

// Schlyter's orbital elements, each [value at day 0, change per day]:
// N node, i inclination, w perihelion argument, a axis (AU), e eccentricity, M mean anomaly.
const ELEMENTS = {
  mercury: [[48.3313, 3.24587e-5], [7.0047, 5e-8], [29.1241, 1.01444e-5], [0.387098, 0], [0.205635, 5.59e-10], [168.6562, 4.0923344368]],
  venus: [[76.6799, 2.4659e-5], [3.3946, 2.75e-8], [54.891, 1.38374e-5], [0.72333, 0], [0.006773, -1.302e-9], [48.0052, 1.6021302244]],
  mars: [[49.5574, 2.11081e-5], [1.8497, -1.78e-8], [286.5016, 2.92961e-5], [1.523688, 0], [0.093405, 2.516e-9], [18.6021, 0.5240207766]],
  jupiter: [[100.4542, 2.76854e-5], [1.303, -1.557e-7], [273.8777, 1.64505e-5], [5.20256, 0], [0.048498, 4.469e-9], [19.895, 0.0830853001]],
  saturn: [[113.6634, 2.3898e-5], [2.4886, -1.081e-7], [339.3939, 2.97661e-5], [9.55475, 0], [0.055546, -9.499e-9], [316.967, 0.0334442282]],
};
export const PLANETS = Object.keys(ELEMENTS);

// [ecliptic longitude, latitude, distance in AU] from the sun.
function heliocentric(name, d) {
  const [N, i, w, a, e, M0] = ELEMENTS[name].map(([v0, dv]) => v0 + dv * d);
  const M = rev(M0);
  const E = kepler(M, e);
  const xv = a * (cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sin(E);
  const v = Math.atan2(yv, xv) / D;
  const r = Math.hypot(xv, yv);
  const vw = (v + w) * D;
  const xh = r * (cos(N) * Math.cos(vw) - sin(N) * Math.sin(vw) * cos(i));
  const yh = r * (sin(N) * Math.cos(vw) + cos(N) * Math.sin(vw) * cos(i));
  const zh = r * Math.sin(vw) * sin(i);
  let lon = Math.atan2(yh, xh) / D;
  let lat = Math.atan2(zh, Math.hypot(xh, yh)) / D;
  if (name === "jupiter" || name === "saturn") {
    // Each tugs the other by up to a degree, near their 5:2 resonance.
    const Mj = ELEMENTS.jupiter[5][0] + ELEMENTS.jupiter[5][1] * d;
    const Ms = ELEMENTS.saturn[5][0] + ELEMENTS.saturn[5][1] * d;
    if (name === "jupiter") {
      lon += -0.332 * sin(2 * Mj - 5 * Ms - 67.6) - 0.056 * sin(2 * Mj - 2 * Ms + 21)
        + 0.042 * sin(3 * Mj - 5 * Ms + 21) - 0.036 * sin(Mj - 2 * Ms)
        + 0.022 * cos(Mj - Ms) + 0.023 * sin(2 * Mj - 3 * Ms + 52)
        - 0.016 * sin(Mj - 5 * Ms - 69);
    } else {
      lon += 0.812 * sin(2 * Mj - 5 * Ms - 67.6) - 0.229 * cos(2 * Mj - 4 * Ms - 2)
        + 0.119 * sin(Mj - 2 * Ms - 3) + 0.046 * sin(2 * Mj - 6 * Ms - 69)
        + 0.014 * sin(Mj - 3 * Ms + 32);
      lat += -0.02 * cos(2 * Mj - 4 * Ms - 2) + 0.018 * sin(2 * Mj - 6 * Ms - 49);
    }
  }
  return [lon, lat, r];
}

export function planet(name, lat, lon, t) {
  const d = day(t);
  const [plon, plat, r] = heliocentric(name, d);
  const [slon, rs] = sunPos(d);
  const x = r * cos(plon) * cos(plat) + rs * cos(slon);
  const y = r * sin(plon) * cos(plat) + rs * sin(slon);
  const z = r * sin(plat);
  const [ra, dec] = equatorial(Math.atan2(y, x) / D, Math.atan2(z, Math.hypot(x, y)) / D, d);
  return horizontal(ra, dec, d, utHours(t), lat, lon);
}

// ------------------------------------------------------------------- stars

// J2000 (ra, dec) to the ecliptic (lon, lat) of day d: the equinox creeps 50
// arc seconds a year, a third of a degree since 2000.
function precessed(ra, dec, d) {
  const ecl = 23.4393 * D;
  const x = cos(ra) * cos(dec), y = sin(ra) * cos(dec), z = sin(dec);
  const ye = y * Math.cos(ecl) + z * Math.sin(ecl);
  const ze = -y * Math.sin(ecl) + z * Math.cos(ecl);
  return [Math.atan2(ye, x) / D + 3.82394e-5 * d, Math.atan2(ze, Math.hypot(x, ye)) / D];
}

// [altitude, azimuth] of each J2000 [ra, dec, ...] in `points`.
export function stars(points, lat, lon, t) {
  const d = day(t), ut = utHours(t);
  return points.map((p) => {
    const [ra, dec] = equatorial(...precessed(p[0], p[1], d), d);
    return horizontal(ra, dec, d, ut, lat, lon);
  });
}

// ------------------------------------------------------------ constellations

let CONST = null;
let constPromise = null;

// Install alfie-constellations.json (parsed): [{name, lines: [[[ra, dec, mag], ...], ...]}], most
// prominent first. From d3-celestial's figure lines (BSD), see THIRD_PARTY.md.
export function setConstellations(data) { CONST = data; return CONST; }
export const constellations = () => CONST;

export function loadConstellations() {
  constPromise ??= fetch(new URL(`./alfie-constellations.json${V}`, import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error(`alfie-constellations.json: HTTP ${r.status}`);
      return r.json();
    })
    .then(setConstellations);
  return constPromise;
}

// ------------------------------------------------------------ local time

const FMT = new Map();

// Seconds the zone `tz` is ahead of UTC at time t. Falls back to the browser's zone.
export function tzOffset(t, tz) {
  try {
    if (!tz) throw new Error("no zone");
    let f = FMT.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
      FMT.set(tz, f);
    }
    const p = {};
    for (const x of f.formatToParts(new Date(t * 1000))) p[x.type] = Number(x.value);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) / 1000 - Math.floor(t);
  } catch (_) {
    return -new Date(t * 1000).getTimezoneOffset() * 60;
  }
}

// Epoch seconds of local midnight at or before t, in zone tz.
export function localMidnight(t, tz) {
  const off = tzOffset(t, tz);
  const m = t - ((((t + off) % 86400) + 86400) % 86400);
  // A DST change between midnight and t shifts the offset: correct once.
  return m + off - tzOffset(m, tz);
}

// Local hours (0..24) at time t.
export function localHours(t, tz) {
  const x = t + tzOffset(t, tz);
  return (((x % 86400) + 86400) % 86400) / 3600;
}

// "H:MM" for hours, or "--" when unknown.
export function clock(hours) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return "--";
  const m = Math.round(hours * 60) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------- rise and set

// Rising and setting times of a body during the local day starting at
// `midnight`. `altFn(t)` gives its altitude; it counts as up above `limit`
// degrees (sun -0.833 for refraction and radius, moon 0 because altFn already
// has parallax). Scans every 10 minutes and interpolates the crossing. Returns
// {rise, set} in epoch seconds, each null when it does not happen that day.
export function riseSet(altFn, midnight, limit = 0, step = 600, span = 86400) {
  let rise = null, set = null;
  let prevT = midnight, prev = altFn(prevT) - limit;
  for (let k = 1; k * step <= span; k++) {
    const tt = midnight + k * step;
    const a = altFn(tt) - limit;
    if (prev < 0 && a >= 0 && rise === null) rise = prevT + (step * -prev) / (a - prev);
    if (prev >= 0 && a < 0 && set === null) set = prevT + (step * prev) / (prev - a);
    prevT = tt; prev = a;
  }
  return { rise, set };
}

// ------------------------------------------------------------------- marks

// Drawn marks as contract strokes (y up), ported from xy figures.py. Sizes are
// radii in whatever units the caller draws in.
const st = (pts, o = {}) => ({ pts, closed: o.closed ?? false, w: o.w ?? 1, role: o.role ?? "line", fill: o.fill ?? false });
const circle = (cx, cy, r, n = 24) => Array.from({ length: n }, (_, i) => [cx + r * Math.sin((2 * Math.PI * i) / n), cy + r * Math.cos((2 * Math.PI * i) / n)]);

// The lit part of the moon as one closed stroke: the bright limb (right while
// waxing, left while waning) out and the terminator back, an elliptical arc
// whose width follows the phase. Then, when `dark`, the whole disc dotted so
// a thin crescent still reads as a moon. `flip` mirrors it for the southern sky.
export function moonStrokes(cx, cy, r, phase, { role = "line", dark = true, fill = false, flip = false } = {}) {
  const side = (phase < 0.5 ? 1 : -1) * (flip ? -1 : 1);
  const k = Math.cos(2 * Math.PI * phase);
  const n = 24, pts = [];
  for (let i = 0; i <= n; i++) pts.push([cx + side * r * Math.sin((Math.PI * i) / n), cy + r * Math.cos((Math.PI * i) / n)]);
  for (let i = n - 1; i > 0; i--) pts.push([cx + side * k * r * Math.sin((Math.PI * i) / n), cy + r * Math.cos((Math.PI * i) / n)]);
  const out = [st(pts, { closed: true, role, fill })];
  if (dark) out.push(st(circle(cx, cy, r), { closed: true, w: 0.15, role: "dim" }));
  return out;
}

// The sun: a ring with eight short rays, spiked out and back from the ring so
// it is still one closed stroke.
export function sunMark(cx, cy, r, { role = "accent" } = {}) {
  const pts = [], n = 48;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const p = [cx + r * Math.sin(a), cy + r * Math.cos(a)];
    pts.push(p);
    if (i % (n / 8) === 0) pts.push([cx + 1.5 * r * Math.sin(a), cy + 1.5 * r * Math.cos(a)], p);
  }
  return [st(pts, { closed: true, role })];
}

// Each planet's own mark, one closed stroke: Venus and Mars their symbols,
// Jupiter a banded disc, Saturn ringed, Mercury a small diamond.
export function planetMark(name, cx, cy, r = 0.024, { role = "accent" } = {}) {
  const ring = (start = 0, n = 24) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.sin(start + (2 * Math.PI * i) / n), cy + r * Math.cos(start + (2 * Math.PI * i) / n)]);
  let pts;
  if (name === "mercury") {
    const q = 0.8 * r;
    pts = [[cx, cy - q], [cx + q, cy], [cx, cy + q], [cx - q, cy]];
  } else if (name === "venus") {
    const bar = cy - 1.65 * r;
    pts = [...ring(Math.PI), [cx, cy - 2.3 * r], [cx, bar], [cx - 0.6 * r, bar], [cx + 0.6 * r, bar], [cx, bar], [cx, cy - r]];
  } else if (name === "mars") {
    const a = Math.PI / 4;
    const e = [cx + r * Math.sin(a), cy + r * Math.cos(a)];
    const tip = [cx + 2.2 * r * Math.sin(a), cy + 2.2 * r * Math.cos(a)];
    pts = [...ring(a), tip, [tip[0] - 0.8 * r, tip[1]], tip, [tip[0], tip[1] - 0.8 * r], tip, e];
  } else if (name === "jupiter") {
    const w = r * Math.sqrt(1 - 0.35 ** 2);
    pts = [...ring(Math.PI / 2 + Math.asin(0.35)).slice(0, -1),
      [cx + w, cy + 0.35 * r], [cx - w, cy + 0.35 * r], [cx - w, cy - 0.35 * r], [cx + w, cy - 0.35 * r],
      [cx - w, cy - 0.35 * r], [cx - w, cy + 0.35 * r], [cx + w, cy + 0.35 * r]];
  } else {
    // Saturn: the ring round the disc, out from its left edge and back.
    const t = -20 * D, ell = [];
    for (let i = 0; i <= 28; i++) {
      const u = Math.PI + (2 * Math.PI * i) / 28;
      const ex = 2 * r * Math.cos(u), ey = 0.55 * r * Math.sin(u);
      ell.push([cx + ex * Math.cos(t) - ey * Math.sin(t), cy + ex * Math.sin(t) + ey * Math.cos(t)]);
    }
    const edge = [cx - 0.75 * r, cy + 0.75 * r * Math.tan(t)];
    const disc = Array.from({ length: 25 }, (_, i) => [cx + 0.75 * r * Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / 24), cy + 0.75 * r * Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / 24)]);
    pts = [...disc, edge, ...ell, edge];
  }
  return [st(pts, { closed: true, role })];
}

// ---------------------------------------------------------------- options

const num = (v) => (v === null || v === undefined || (typeof v === "string" && v.trim() === "") ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// Where we are: the screen's own latitude/longitude options when both are set,
// else Home Assistant's. null when neither gives a valid place.
export function location(options, config) {
  let lat = num(options?.latitude), lon = num(options?.longitude);
  if (lat === null || lon === null) { lat = num(config?.latitude); lon = num(config?.longitude); }
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 360) return null;
  return { lat, lon, tz: config?.time_zone || null };
}
