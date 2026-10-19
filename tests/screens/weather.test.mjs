// The weather screen: pure helpers, then draw() on invented data.
import fs from "node:fs";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";
import W, { group, smooth, convert, rainMode, isNight, nowTemp, nowCondition } from "../../custom_components/alfie/frontend/screens/weather.js";

let failures = 0, checks = 0;
function check(ok, what) { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } }
S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));
const info = JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/screens/weather.json", import.meta.url)));
const defaults = Object.fromEntries(info.options.filter((o) => "default" in o).map((o) => [o.key, o.default]));
const opts = (o = {}) => ({ ...defaults, weather: "weather.home", ...o });

check(group([1, 5, 2, null, null, null, 4], 3).join() === "5,,4", "group max, gap stays a gap");
check(group([1, 2, 3, 4], 2, "sum").join() === "3,7", "group sum");
check(smooth([1, 5, 1]).join() === "1,3,1" && smooth([1, null, 1]).join() === "1,,1", "smooth keeps ends and gaps");
check(smooth([0, 4, 0, 4, 0], 0).join() === "0,4,0,4,0", "zero passes is identity");
check(convert(0, "°C", "fahrenheit") === 32 && convert(212, "°F", "celsius") === 100 && convert(5, "°C", "auto") === 5 && convert(null, "°C", "celsius") === null, "unit conversion");
check(rainMode("auto", { pop: [null], precip: [1] }) === "precip" && rainMode("auto", { pop: [3] }) === "pop", "auto rain: probability else amount");
check(rainMode("probability", { precip: [1] }) === null && rainMode("off", { pop: [1] }) === null, "forced rain modes");
check(isNight({ "sun.sun": { state: "above_horizon", attributes: { elevation: 3 } } }, null) === false, "day is not night");
check(isNight({ "sun.sun": { state: "below_horizon", attributes: { elevation: -20 } } }, null) === true, "night from sun.sun");
check(isNight({}, { now: { night: true } }) === true, "night falls back to provider data");
const states = { "weather.home": { state: "rainy", attributes: { temperature: 11, temperature_unit: "°C" } }, "sensor.out": { state: "9.5", attributes: { unit_of_measurement: "°C" } } };
check(nowTemp(opts(), states, null, S)[0] === 11, "temperature from the weather entity");
check(nowTemp(opts({ sensor: "sensor.out" }), states, null, S)[0] === 9.5, "sensor overrides");
check(nowTemp(opts(), {}, { now: { temperature: 7 } }, S)[0] === 7, "provider fallback temperature");
check(nowCondition(opts(), { "weather.home": { state: "unavailable" } }, { now: { condition: "cloudy" } }) === "cloudy", "unavailable falls back");

function valid(strokes) {
  return Array.isArray(strokes) && strokes.length > 0 && strokes.every((s) => Array.isArray(s.pts) && s.pts.length >= 1 && s.pts.every((p) => p.length === 2 && p.every(Number.isFinite))
    && ["line", "text", "accent", "dim"].includes(s.role) && Number.isFinite(s.w) && typeof s.closed === "boolean" && typeof s.fill === "boolean");
}
const inBox = (strokes, w, h) => strokes.every((s) => s.pts.every(([x, y]) => Math.abs(x) <= w + 1e-6 && Math.abs(y) <= h + 1e-6));

const T0 = 1792317600;
const hourly = (n, extra = {}) => ({
  type: "hourly", unit: "°C", times: Array.from({ length: n }, (_, i) => T0 + 3600 * i),
  temp: Array.from({ length: n }, (_, i) => 10 + 5 * Math.sin(i / 4)), low: [], pop: Array.from({ length: n }, (_, i) => (i * 7) % 100),
  precip: [], cond: Array(n).fill("rainy"), now: { temperature: 11, condition: "rainy", night: false }, ...extra,
});
const dailyData = (n) => ({ type: "daily", unit: "°C", times: Array.from({ length: n }, (_, i) => T0 + 86400 * i), temp: Array.from({ length: n }, (_, i) => 14 + i), low: Array.from({ length: n }, (_, i) => 5 + i),
  pop: Array.from({ length: n }, (_, i) => i * 20), precip: [], cond: ["sunny", "partlycloudy", "cloudy", "rainy", "snowy", "fog", "windy", "pouring", "lightning", "sunny"].slice(0, n), now: {} });

for (const [w, h] of [[1, 1], [1.6, 1], [0.5, 0.35]]) {
  const draw = (data, o, st = states) => W.draw({ w, h, t: 3, data, options: opts(o), states: st, config: { time_zone: "Europe/Berlin" }, memo: {}, S });
  for (const [name, data, o] of [
    ["hourly", hourly(24), {}], ["hourly 48 amount", hourly(48, { pop: [], precip: Array.from({ length: 48 }, (_, i) => (i % 9) / 3) }), { hours: 48 }],
    ["hourly short data", hourly(10), {}], ["no rain", hourly(24, { pop: [] }), {}], ["daily", dailyData(5), { forecast: "daily" }], ["daily 10", dailyData(10), { forecast: "daily", days: 10 }],
    ["fahrenheit", hourly(24), { unit: "fahrenheit", decimals: 1 }], ["not animated", hourly(24), { animate: false, time_labels: false, smooth: 0, title: "Home" }],
    ["daily fallback", dailyData(3), {}], ["gaps", hourly(24, { temp: hourly(24).temp.map((v, i) => (i % 5 ? v : null)) }), {}],
  ]) {
    const s = draw(data, o);
    check(valid(s), `${name} @${w}x${h}: valid strokes`);
    check(inBox(s, w, h), `${name} @${w}x${h}: inside the box`);
  }
  check(valid(draw(null, {}, {})), `no data @${w}x${h}: placeholder`);
  check(valid(draw(null, { title: "Outside" }, {})), `no data with title @${w}x${h}`);
  check(valid(draw(null, {})), `states only @${w}x${h}`);
  check(valid(draw({ type: "hourly", times: [], temp: [], low: [], pop: [], precip: [], cond: [] }, {})), `empty forecast @${w}x${h}`);
  const a = draw(hourly(24), {}), b = W.draw({ w, h, t: 9, data: hourly(24), options: opts(), states, config: {}, memo: {}, S });
  check(a.length === b.length, `animation keeps the stroke count @${w}x${h}`);
}
const memo = {};
const d = hourly(24);
const a1 = W.draw({ w: 1.6, h: 1, t: 0, data: d, options: opts(), states, config: {}, memo, S });
const a2 = W.draw({ w: 1.6, h: 1, t: 5, data: d, options: opts({ animate: false }), states, config: {}, memo, S });
check(a1.length === a2.length, "same strokes with or without animation");

console.log(`weather: ${checks - failures}/${checks} checks pass`);
process.exit(failures ? 1 : 0);
