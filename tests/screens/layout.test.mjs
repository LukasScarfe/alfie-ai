// The Layout option on every screen type: each element can be hidden or put in
// a box of its own, the drawing stays valid and inside the screen, a boxed
// element lands in its box, and every type reports its elements' boxes.
// Run by ./dev test under node.
import fs from "node:fs";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";
import * as K from "../../custom_components/alfie/frontend/alfie-sky.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };
S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));
K.setConstellations(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-constellations.json", import.meta.url))));
const meta = (n) => JSON.parse(fs.readFileSync(new URL(`../../custom_components/alfie/frontend/screens/${n}.json`, import.meta.url)));
const defaults = (n) => Object.fromEntries(meta(n).options.filter((x) => x.default !== undefined).map((x) => [x.key, x.default]));
const valid = (strokes) => strokes.every((s) => s.pts.length >= 1 && s.pts.every((p) => p.every(Number.isFinite)));
const inBox = (strokes, w, h) => strokes.every((s) => s.pts.every(([x, y]) => Math.abs(x) <= w + 0.03 && Math.abs(y) <= h + 0.03));

const T0 = 1792317600;
const ramp = (a, b, n = 30) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const states = {
  "sensor.a": { state: "42", attributes: { friendly_name: "Basil", unit_of_measurement: "%" } },
  "sensor.b": { state: "17", attributes: { friendly_name: "Fern", unit_of_measurement: "%" } },
  "sensor.in": { state: "21.4", attributes: {} }, "sensor.out": { state: "8.2", attributes: {} },
  "device_tracker.a": { state: "home", attributes: { latitude: 51.5002, longitude: -0.1198, friendly_name: "Anna" } },
  "switch.c": { state: "on", attributes: { friendly_name: "Coffee maker" } },
  "media_player.v": { state: "playing", attributes: { friendly_name: "Record player", volume_level: 0.4 } },
  "media_player.m": { state: "playing", attributes: { app_id: "music_assistant", media_title: "Mr. Blue Sky", media_artist: "ELO",
    media_album_name: "Out of the Blue", media_duration: 303, media_position: 40, media_position_updated_at: "2026-10-23T00:35:21Z" } },
};
const config = { latitude: 51.5, longitude: -0.12, time_zone: "Europe/London" };
const hourly = { type: "hourly", unit: "°C", times: Array.from({ length: 24 }, (_, i) => T0 + 3600 * i),
  temp: Array.from({ length: 24 }, (_, i) => 10 + 5 * Math.sin(i / 4)), low: [], pop: Array.from({ length: 24 }, (_, i) => (i * 7) % 100),
  precip: [], cond: Array(24).fill("rainy"), now: { temperature: 11, condition: "rainy", night: false } };
const daily = { type: "daily", unit: "°C", times: Array.from({ length: 5 }, (_, i) => T0 + 86400 * i), temp: [14, 15, 16, 17, 18],
  low: [5, 6, 7, 8, 9], pop: [0, 20, 40, 60, 80], precip: [], cond: ["sunny", "cloudy", "rainy", "snowy", "fog"], now: {} };

const cases = [
  ["plot", { entities: ["sensor.a", "sensor.b"], title: "Plants", legend: true },
    { series: [{ entity_id: "sensor.a", name: "Basil", unit: "%", values: ramp(20, 42) }, { entity_id: "sensor.b", name: "Fern", unit: "%", values: ramp(50, 17) }] }],
  ["bars", { entities: ["sensor.a", "sensor.b"] }, null],
  ["bars", { entities: ["sensor.a", "sensor.b"], direction: "horizontal" }, null],
  ["value", { entity: "sensor.a" }, null],
  ["clock", { inside: "sensor.in", outside: "sensor.out" }, null],
  ["clock", { inside: "sensor.in", style: "digital" }, null],
  ["weather", { title: "Home" }, hourly],
  ["weather", { forecast: "daily" }, daily],
  ["sky", { moon_times: true }, null],
  ["stars", {}, null],
  ["map", { trackers: ["device_tracker.a"], title: "Anna" }, null],
];

cases.push(["label", { text: "Hello there" }, null], ["text", { source: "fixed", fixed: "Happy birthday Anna" }, null],
  ["value", { entity: "sensor.a", label: "Basil" }, null], ["picture", { picture: "p", caption: "Plan" }, { svg: '<svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"/></svg>' }],
  ["weather", { forecast: "daily", title: "Home" }, daily], ["toggle", { entities: ["switch.c"], title: "Kitchen", action: true, from: "off" }, null],
  ["nowplaying", {}, null], ["volume", { entity: "media_player.v", show_percent: true, show_name: true }, null]);
const BOX = [55, 10, 40, 30];   // % of the screen from the top left
for (const [type, o, data] of cases) {
  const mod = (await import(`../../custom_components/alfie/frontend/screens/${type}.js`)).default;
  const lay = meta(type).options.find((x) => x.kind === "layout");
  check(lay && lay.elements.length > 0, `${type}: has a Layout option`);
  if (!lay) continue;
  const [w, h] = [1.6, 1];
  const draw = (layout) => {
    const memo = {};
    const out = mod.draw({ w, h, t: T0 + 72000, data, options: { ...defaults(type), ...o, layout }, states, config, memo, S });
    return { out, memo };
  };
  const base = draw({});
  check(valid(base.out) && base.out.length > 0, `${type}: draws with the default layout`);
  check(base.memo.boxes && Object.keys(base.memo.boxes).length > 0, `${type}: reports its elements' boxes`);
  for (const el of lay.elements) {
    const hid = draw({ [el.key]: { show: false } });
    check(valid(hid.out) && inBox(hid.out, w, h), `${type}: ${el.key} hidden`);
    check(!(el.key in hid.memo.boxes), `${type}: ${el.key} hidden has no box`);
    const own = draw({ [el.key]: { box: BOX, size: 1.5, align: "left" } });
    check(valid(own.out) && inBox(own.out, w, h), `${type}: ${el.key} boxed stays on screen`);
    const got = own.memo.boxes[el.key];
    if (got) check(got.every((v, i) => Math.abs(v - BOX[i]) < 0.2), `${type}: ${el.key} lands in its box (${got})`);
  }
}

if (failures) { console.error(`layout: ${failures} failed`); process.exit(1); }
console.log("layout: ok");
