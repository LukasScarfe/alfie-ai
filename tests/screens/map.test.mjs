// The map and text screens' pure parts, under node.
import fs from "node:fs";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";
import map, * as M from "../../custom_components/alfie/frontend/screens/map.js";
import text, * as T from "../../custom_components/alfie/frontend/screens/text.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };
S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));
const valid = (s) => Array.isArray(s.pts) && s.pts.length >= 1 && s.pts.every((p) => p.every(Number.isFinite)) && typeof s.w === "number";

// ---- geometry
check(M.clipSegment([-5, 0], [5, 0], 2, 2)[0][0] === -2, "segment cut at the box");
check(M.clipSegment([-5, 9], [5, 9], 2, 2) === null, "segment outside is gone");
check(M.clip([[-1, 0], [3, 0]], 2, 2).length === 1, "clip keeps the inside run");
const k = 1 / 100;
const p1 = M.place([51.5009, -0.12], [51.5, -0.12], k, 1, 1);
check(Math.abs(p1[1] - (0.0009 * 111320 * k)) < 1e-9 && Math.abs(p1[0]) < 1e-9, "north is up");
const far = M.place([52, -0.12], [51.5, -0.12], k, 1.4, 0.9, true);
check(Math.abs(far[1] - 0.9) < 1e-9, "a far point is pinned to the edge");
check(M.autoRadius([51.5, -0.12], [[51.5, -0.12]]) === 150, "auto radius has a floor");
check(M.autoRadius([51.5, -0.12], [[51.5 + 400 / 111320, -0.12]]) === 500, "auto radius grows to hold a far tracker");
check(M.initials(["Lukas", "Lena", "!!"], S).join("") === "LE3", "initials are distinct, digit fallback");

// ---- drawing
const fixture = { cell: [51.5, -0.12], ways: [["primary", [51.499, -0.12, 51.501, -0.12]], ["alley", [51.5, -0.121, 51.5, -0.119]], ["residential", [51.6, -0.1, 51.61, -0.1]]] };
const states = { "device_tracker.a": { state: "home", attributes: { latitude: 51.5002, longitude: -0.1198, friendly_name: "Anna" } } };
const opts = { trackers: ["device_tracker.a"], radius: 0, labels: true, show_home: true, title: "" };
const args = { w: 1.6, h: 1, t: 0, data: fixture, options: opts, states, config: { latitude: 51.5, longitude: -0.12 }, memo: {}, S };
const strokes = map.draw(args);
check(strokes.length > 3 && strokes.every(valid), "map draws valid strokes");
check(strokes.some((s) => s.w < 0.3), "alleys are dotted");
check(strokes.flatMap((s) => s.pts).every(([x, y]) => Math.abs(x) <= 1.6 && Math.abs(y) <= 1), "everything stays inside the box");
check(map.draw({ ...args, data: null, memo: {} }).length > 0, "no streets: markers still draw");
check(map.draw({ ...args, states: {}, config: {}, memo: {} }).length > 0, "nothing known: a placeholder");
const m = {};
map.draw({ ...args, memo: m }); const first = m.streets;
map.draw({ ...args, memo: m });
check(m.streets === first, "streets are cached on memo");
check(map.draw({ ...args, options: { ...opts, labels: false }, memo: {} }).length < strokes.length, "labels can be turned off");

// ---- text
const o = { source: "calendar", days: 1, events: "all", template: "Happy birthday {name}!", seconds: 6, max_lines: 4, size: 0.3, empty: "--", fixed: "", attribute: "" };
const ev = (t, a = true, d = 0) => ({ t, a, d });
check(T.titles(o, { events: [ev("Kat"), ev("Bins", true, 1), ev("Dentist", false)] }).join() === "Kat,Dentist", "calendar: today only");
check(T.titles({ ...o, events: "all_day", days: 2 }, { events: [ev("Kat"), ev("Bins", true, 1), ev("Dentist", false)] }).join() === "Kat,Bins", "calendar: all-day, two days");
check(T.titles({ ...o, source: "entity", entity: "sensor.x" }, null, { "sensor.x": { state: "Hello", attributes: {} } }).join() === "Hello", "entity state");
check(T.titles({ ...o, source: "entity", entity: "sensor.x", attribute: "names" }, null, { "sensor.x": { state: "on", attributes: { names: ["A", "B"] } } }).join() === "A,B", "entity attribute list");
check(T.titles({ ...o, source: "entity", entity: "sensor.x" }, null, { "sensor.x": { state: "unavailable", attributes: {} } }).length === 0, "unavailable is not shown");
check(T.titles({ ...o, source: "fixed", fixed: "a|b" }).join() === "a,b", "fixed text splits on |");
check(T.applyTemplate("Happy birthday {name}!", "Kat") === "Happy birthday Kat!", "template");
check(T.applyTemplate("Hi", "Kat") === "Hi Kat", "template without {name} is a prefix");
const long = "Happy birthday to the wonderful Bartholomew Featherstonehaugh-Cholmondeley and family!";
for (const [bw, bh] of [[1.4, 0.9], [0.9, 0.9], [0.3, 0.3]]) {
  const f = T.fit(S, long, bw, bh, 0.3, 4);
  check(f.lines.every((l) => S.width(l, f.h) <= 2 * bw + 1e-9) || f.h < 0.05, `long title fits width ${bw}`);
}
check(T.fit(S, "Kat", 1.4, 0.9, 0.3, 4).h === 0.3, "a short title uses the largest size");
check(T.fit(S, long, 1.4, 0.9, 0.3, 2).lines.length <= 2, "max lines is honoured");
const td = (extra, t = 0, data = { events: [ev("Zoë 😀 Müller"), ev("Kat")] }) =>
  text.draw({ w: 1.6, h: 1, t, data, options: { ...o, ...extra }, states: {}, memo: {}, S });
check(td({}).length > 0 && td({}).every(valid), "text draws valid strokes");
check(JSON.stringify(td({}, 0)) !== JSON.stringify(td({}, 6)), "titles cycle with time");
check(JSON.stringify(td({}, 0)) === JSON.stringify(td({}, 12)), "and wrap around");
check(td({}, 0, null).length > 0, "no data: the placeholder");

if (failures) { console.error(`${failures} map/text check(s) failed`); process.exit(1); }
console.log("map/text ok");
