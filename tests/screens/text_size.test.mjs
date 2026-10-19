// The shared Text size option: at 1 every screen draws as it did without it,
// and other sizes change the drawing but keep it valid and in its box.
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
const valid = (strokes) => strokes.length > 0 && strokes.every((s) => s.pts.length >= 1 && s.pts.every((p) => p.every(Number.isFinite)));
const inBox = (strokes, w, h) => strokes.every((s) => s.pts.every(([x, y]) => Math.abs(x) <= w + 0.02 && Math.abs(y) <= h + 0.02));

const T0 = 1792317600;
const ramp = (a, b, n = 30) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const states = {
  "sensor.a": { state: "42", attributes: { friendly_name: "Basil", unit_of_measurement: "%" } },
  "sensor.b": { state: "17", attributes: { friendly_name: "Fern", unit_of_measurement: "%" } },
  "sensor.in": { state: "21.4", attributes: {} }, "sensor.out": { state: "8.2", attributes: {} },
  "device_tracker.a": { state: "home", attributes: { latitude: 51.5002, longitude: -0.1198, friendly_name: "Anna" } },
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

for (const [type, o, data] of cases) {
  const mod = (await import(`../../custom_components/alfie/frontend/screens/${type}.js`)).default;
  check(meta(type).options.some((x) => x.key === "text_size" && x.default === 1), `${type}: has the Text size option`);
  for (const [w, h] of [[1.6, 1], [1, 1], [0.5, 0.35]]) {
    const draw = (extra) => mod.draw({ w, h, t: T0 + 72000, data, options: { ...defaults(type), ...o, ...extra }, states, config, memo: {}, S });
    const what = `${type} ${JSON.stringify(o)} @${w}x${h}`;
    const one = draw({});
    const { text_size: _, ...without } = { ...defaults(type), ...o };
    const bare = mod.draw({ w, h, t: T0 + 72000, data, options: without, states, config, memo: {}, S });
    check(JSON.stringify(one) === JSON.stringify(bare), `${what}: text size 1 draws as without it`);
    for (const ts of [0.5, 2]) {
      const s = draw({ text_size: ts });
      check(valid(s), `${what}: valid at text size ${ts}`);
      check(JSON.stringify(s) !== JSON.stringify(one), `${what}: text size ${ts} changes the drawing`);
      check(inBox(s, w, h), `${what}: in its box at text size ${ts}`);
    }
  }
}

if (failures) { console.error(`text_size: ${failures} failed`); process.exit(1); }
console.log("text_size: ok");
