// The sky maths (alfie-sky.js) against xy-bench's sky.py, and the sky and stars
// screens. Run by ./dev test under node. tests/golden_sky.json holds sky.py's output
// for 24 places and times; the JS port must agree to 0.01 degrees.
import fs from "node:fs";
import * as K from "../../custom_components/alfie/frontend/alfie-sky.js";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";

const F = "../../custom_components/alfie/frontend/";
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
let failures = 0, checks = 0;
function check(ok, what) { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } }
const angle = (a, b) => Math.abs(((a - b + 540) % 360 + 360) % 360 - 180);
// Altitude differences are plain; azimuth wraps, and near the zenith it is ill-defined.
function same(got, want, what) {
  const da = Math.abs(got[0] - want[0]);
  const dz = angle(got[1], want[1]) * Math.cos(want[0] * Math.PI / 180);
  check(da < 0.01 && dz < 0.01, `${what}: ${got.map((x) => x.toFixed(4))} vs ${want.map((x) => x.toFixed(4))}`);
}

S.setFont(read(`${F}alfie-font.json`));
const cons = K.setConstellations(read(`${F}alfie-constellations.json`));

// ---------------------------------------------------------------- golden
const golden = read("../golden_sky.json");
for (const c of golden.cases) {
  const tag = `${c.place} t=${c.t}`;
  same(K.sun(c.lat, c.lon, c.t), c.sun, `sun ${tag}`);
  same(K.moon(c.lat, c.lon, c.t), c.moon, `moon ${tag}`);
  check(Math.abs(K.moonPhase(c.t) - c.phase) < 1e-6, `phase ${tag}`);
  for (const p of K.PLANETS) same(K.planet(p, c.lat, c.lon, c.t), c.planets[p], `${p} ${tag}`);
  K.stars(golden.star_points, c.lat, c.lon, c.t).forEach((aa, i) => same(aa, c.stars[i], `star ${i} ${tag}`));
}
check(golden.cases.length >= 24, "enough golden cases");

// ----------------------------------------------------- catalogue and helpers
check(cons.length === 23 && cons.reduce((n, c) => n + c.lines.flat().length, 0) === 286, "23 constellations, 286 vertices");
check(cons.every((c) => c.name && c.lines.every((l) => l.every((p) => p.length === 3))), "constellation shape");
check(K.PLANETS.join() === "mercury,venus,mars,jupiter,saturn", "five planets");
check(K.clock(6.4833) === "6:29" && K.clock(null) === "--" && K.clock(23.999) === "0:00", "clock text");

const t0 = Date.UTC(2026, 6, 1, 12) / 1000;
check(K.tzOffset(t0, "Europe/London") === 3600 && K.tzOffset(t0, "UTC") === 0, "zone offset follows DST");
check(K.localMidnight(t0, "Europe/London") === Date.UTC(2026, 5, 30, 23) / 1000, "local midnight in London");
check(Math.abs(K.localHours(t0, "Europe/London") - 13) < 1e-9, "local hours");
// 2026-03-29 is the spring-forward day: its local midnight is still 00:00 GMT.
const dst = Date.UTC(2026, 2, 29, 12) / 1000;
check(K.localMidnight(dst, "Europe/London") === Date.UTC(2026, 2, 29, 0) / 1000, "local midnight on a DST day");

// London midsummer: the sun rises about 03:43 UTC and sets about 20:21 UTC.
const mid = K.localMidnight(t0, "UTC");
const rs = K.riseSet((t) => K.sun(51.5, -0.1, t)[0], mid, -0.833);
const hr = (x) => (x - mid) / 3600;
check(Math.abs(hr(rs.rise) - 3.72) < 0.1 && Math.abs(hr(rs.set) - 20.35) < 0.1, `London midsummer rise/set ${hr(rs.rise)} ${hr(rs.set)}`);
const polar = K.riseSet((t) => K.sun(78, 15, t)[0], mid, -0.833);
check(polar.rise === null && polar.set === null, "midnight sun: no rise or set");
check(K.location({}, { latitude: 51, longitude: -1, time_zone: "UTC" }).lat === 51, "location from HA");
check(K.location({ latitude: "10", longitude: "20" }, { latitude: 51, longitude: -1 }).lon === 20, "location override");
check(K.location({}, {}) === null && K.location({ latitude: "99", longitude: "0" }, {}) === null, "no location");

// ---------------------------------------------------------------- screens
const valid = (s) => Array.isArray(s.pts) && s.pts.length >= 1 && s.pts.every((p) => p.length === 2 && p.every(Number.isFinite))
  && typeof s.closed === "boolean" && Number.isFinite(s.w) && ["line", "text", "accent", "dim"].includes(s.role) && typeof s.fill === "boolean";
const defaults = (file) => Object.fromEntries(read(`${F}screens/${file}.json`).options.map((o) => [o.key, o.default]));
const night = Date.UTC(2026, 9, 18, 22, 10) / 1000;

for (const type of ["sky", "stars"]) {
  const mod = (await import(`${F}screens/${type}.js`)).default;
  const meta = read(`${F}screens/${type}.json`);
  check(mod.type === type && meta.type === type && meta.needs === null, `${type}: type and needs`);
  const opts = { ...defaults(type), latitude: "51.5", longitude: "-0.1" };
  for (const [w, h] of [[1, 1], [1.6, 1], [0.7, 0.7]]) {
    const memo = {};
    const a = mod.draw({ w, h, t: night, data: null, options: opts, states: {}, config: {}, memo, S });
    check(a.length > 5 && a.every(valid), `${type} ${w}x${h}: valid strokes`);
    check(a.every((s) => s.pts.every(([x, y]) => Math.abs(x) <= w * 1.01 && Math.abs(y) <= h * 1.05)), `${type} ${w}x${h}: inside the box`);
    check(mod.draw({ w, h, t: night + 20, data: null, options: opts, states: {}, config: {}, memo, S }) === a, `${type}: same minute reuses memo`);
    check(mod.draw({ w, h, t: night + 90, data: null, options: opts, states: {}, config: {}, memo, S }) !== a, `${type}: next minute recomputes`);
  }
  const none = mod.draw({ w: 1, h: 1, t: night, data: null, options: defaults(type), states: {}, config: {}, memo: {}, S });
  check(none.length > 0 && none.every(valid), `${type}: placeholder with no location`);
  const home = mod.draw({ w: 1, h: 1, t: night, data: null, options: defaults(type), states: {}, config: { latitude: 51.5, longitude: -0.1, time_zone: "Europe/London" }, memo: {}, S });
  check(home.length > none.length, `${type}: uses HA's home location`);
}

const stars = (await import(`${F}screens/stars.js`)).default;
const draw = (o, t = night) => stars.draw({ w: 1.6, h: 1, t, data: null, options: { ...defaults("stars"), latitude: "51.5", longitude: "-0.1", ...o }, states: {}, config: {}, memo: {}, S });
check(draw({ constellations: 0, planets: false, moon: false, labels: false, times: false }).length === 1, "stars: nothing but the horizon when all are off");
check(draw({ constellations: 5 }).length < draw({ constellations: 23 }).length, "stars: the constellation count is an option");
check(draw({ star_dots: false }).reduce((n, s) => n + s.pts.length, 0) < draw({ star_dots: true }).reduce((n, s) => n + s.pts.length, 0), "stars: dots add points");
check(draw({ facing: "south" }).length !== draw({ facing: "north" }).length, "stars: facing changes the view");
// Auto holds its bearing within a 15 minute slot, whatever the minute.
const slot = Math.floor(night / 900) * 900;
const memoA = {};
const auto = (t) => stars.draw({ w: 1, h: 1, t, data: null, options: { ...defaults("stars"), latitude: "51.5", longitude: "-0.1", facing: "auto" }, states: {}, config: {}, memo: memoA, S });
auto(slot + 5); const f1 = memoA.facing; auto(slot + 800);
check(memoA.facing === f1 && f1 % 15 === 0, "stars: auto bearing is a multiple of 15 and holds for the slot");

const sky = (await import(`${F}screens/sky.js`)).default;
const text = (o) => sky.draw({ w: 1, h: 1, t: night, data: null, options: { ...defaults("sky"), latitude: "51.5", longitude: "-0.1", ...o }, states: {}, config: {}, memo: {}, S });
check(text({ times: false }).length < text({ times: true }).length, "sky: times are an option");
check(text({ labels: false }).length < text({ labels: true }).length, "sky: letters are an option");
check(text({ rings: false }).length === text({ rings: true }).length - 2, "sky: rings are an option");

if (failures) { console.error(`${failures} of ${checks} checks failed`); process.exit(1); }
console.log(`sky: ${checks} checks ok`);
