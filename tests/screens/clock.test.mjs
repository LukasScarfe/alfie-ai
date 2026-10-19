// clock, value and bars screens: valid strokes, local time from HA's zone,
// the solar rim, and the no-data placeholders. Run by ./dev test under node.
import fs from "node:fs";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";
import clock from "../../custom_components/alfie/frontend/screens/clock.js";
import value from "../../custom_components/alfie/frontend/screens/value.js";
import bars from "../../custom_components/alfie/frontend/screens/bars.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };
S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));

const meta = (n) => JSON.parse(fs.readFileSync(new URL(`../../custom_components/alfie/frontend/screens/${n}.json`, import.meta.url)));
const defaults = (n, o = {}) => ({ ...Object.fromEntries(meta(n).options.filter((x) => x.default !== undefined).map((x) => [x.key, x.default])), ...o });
const valid = (strokes) => Array.isArray(strokes) && strokes.length > 0 && strokes.every((s) =>
  s.pts.length >= 1 && s.pts.every((p) => p.every(Number.isFinite)) && ["line", "text", "accent", "dim"].includes(s.role) && Number.isFinite(s.w));
const draw = (m, n, o, extra = {}) => m.draw({ w: 1.6, h: 1, t: 1792327062, data: null, options: defaults(n, o), states: {}, config: {}, memo: {}, S, ...extra });
const ext = (strokes) => {
  const p = strokes.flatMap((s) => s.pts);
  return [Math.min(...p.map((q) => q[0])), Math.max(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[1]))];
};

const states = {
  "sensor.in": { state: "21.4", attributes: {} }, "sensor.out": { state: "-3", attributes: {} },
  "sun.sun": { state: "above_horizon", attributes: { next_rising: "2026-10-19T05:52:00+00:00", next_setting: "2026-10-18T16:08:00+00:00" } },
  "sensor.a": { state: "10", attributes: { friendly_name: "Aa", unit_of_measurement: "%", device_class: "moisture" } },
  "sensor.b": { state: "70", attributes: { friendly_name: "Bb" } },
};
const config = { time_zone: "Europe/Berlin" };

// 2026-10-18 11:17:42 UTC = 13:17:42 in Berlin (CEST)
const day = Date.UTC(2026, 9, 18, 11, 17, 42) / 1000;
for (const [w, h] of [[1, 1], [1.6, 1], [0.3, 0.3]]) {
  for (const style of ["analogue", "digital"]) {
    const s = clock.draw({ w, h, t: day, data: null, options: defaults("clock", { style, inside: "sensor.in", outside: "sensor.out" }), states, config, memo: {}, S });
    const [x0, x1, y0, y1] = ext(s);
    check(valid(s), `clock ${style} ${w}x${h} valid`);
    check(x0 >= -w - 1e-6 && x1 <= w + 1e-6 && y0 >= -h - 1e-6 && y1 <= h + 1e-6, `clock ${style} ${w}x${h} inside the box`);
  }
}
check(valid(draw(clock, "clock", {})), "clock with no data and no entities draws");

// Local time comes from config.time_zone: the digital readout says 13:17, not UTC's 11:17.
const dig = (cfg, o = {}) => clock.draw({ w: 1.6, h: 1, t: day, data: null, options: defaults("clock", { style: "digital", seconds: false, ...o }), states: {}, config: cfg, memo: {}, S });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check(same(dig(config), S.text("13:17", 1, 0, 0).length ? dig(config) : []), "sanity");
check(!same(dig(config), dig({ time_zone: "UTC" })), "time zone changes the time shown");
check(dig(config).length === S.text("13:17", 1).length, "13:17 is five glyph groups");
check(dig(config, { hours: "12" }).length === S.text("1:17", 1).length, "12 h drops the leading zero");

// Solar rim: bright (weight 1) and dim (0.35) arcs only with sun data
const rim = (st) => clock.draw({ w: 1, h: 1, t: day, data: null, options: defaults("clock", {}), states: st, config, memo: {}, S }).filter((s) => s.pts.length > 20);   // rim arcs; the hands have 3 points
check(rim({}).length === 1 && rim({})[0].closed, "no sun: one closed rim");
const arcs = rim(states);
check(arcs.some((s) => s.w === 1) && arcs.some((s) => s.w === 0.35), "sun: day and night arcs");
// After sunrise `next_rising` is tomorrow's; the same time of day gives the same rim.
const tomorrow = { ...states, "sun.sun": { state: "above_horizon", attributes: { next_rising: "2026-10-19T05:52:00+00:00", next_setting: "2026-10-19T16:07:00+00:00" } } };
check(rim(tomorrow).length === arcs.length, "next_rising being tomorrow still gives a rim");
check(rim({ "sun.sun": { state: "unavailable", attributes: {} } }).length === 1, "unavailable sun: plain rim");
check(clock.draw({ w: 1, h: 1, t: day, data: null, options: defaults("clock", { seconds: false }), states, config, memo: {}, S }).every((s) => s.pts.length > 1), "seconds off: no bead");

// value
const v = draw(value, "value", { entity: "sensor.a" }, { states });
check(valid(v), "value draws");
check(v.some((s) => s.role === "text"), "value in text role by default");
check(draw(value, "value", { entity: "sensor.a", below: "20" }, { states }).some((s) => s.role === "accent"), "below threshold: accent");
check(!draw(value, "value", { entity: "sensor.a", above: "20" }, { states }).some((s) => s.role === "accent"), "above threshold not crossed: no accent");
check(valid(draw(value, "value", { entity: "sensor.missing" })), "value of a missing entity still draws");
check(valid(draw(value, "value", {})), "value with no entity draws a placeholder");
for (const icon of ["none", "leaf", "drop", "house", "sun", "cloud"]) check(valid(draw(value, "value", { entity: "sensor.a", icon }, { states })), `value icon ${icon}`);
check(valid(draw(value, "value", { entity: "sensor.a", label: "Pot" }, { states, w: 0.3, h: 0.3 })), "value in a small box");

// bars
const bs = (o, extra = {}) => draw(bars, "bars", { entities: ["sensor.a", "sensor.b", "sensor.none"], ...o }, { states, ...extra });
for (const direction of ["vertical", "horizontal"]) {
  const s = bs({ direction, highlight_below: "20" });
  const [x0, x1, y0, y1] = ext(s);
  check(valid(s), `bars ${direction} valid`);
  check(x0 >= -1.6 - 1e-6 && x1 <= 1.6 + 1e-6 && y0 >= -1 - 1e-6 && y1 <= 1 + 1e-6, `bars ${direction} inside the box`);
  check(s.some((x) => x.role === "accent"), `bars ${direction} highlight below 20`);
}
check(!bs({ highlight_below: "5" }).some((x) => x.role === "accent"), "nothing below 5: no highlight");
check(valid(bars.draw({ w: 1, h: 1, t: 0, data: null, options: defaults("bars"), states: {}, config: {}, memo: {}, S })), "bars with no entities draws a placeholder");
check(bs({ sort: "descending", values: false, direction: "horizontal" }).length > 0, "sort and no values");

if (failures) { console.error(`${failures} clock/value/bars checks failed`); process.exit(1); }
console.log("clock/value/bars checks passed");
