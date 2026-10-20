// The plot screen: layout of N series, options, placeholders. Run by ./dev test under node.
import fs from "node:fs";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";
import plot, { spread } from "../../custom_components/alfie/frontend/screens/plot.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };
S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));
const meta = JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/screens/plot.json", import.meta.url)));
const defaults = Object.fromEntries(meta.options.filter((o) => o.default !== undefined).map((o) => [o.key, o.default]));

const ramp = (a, b, n = 30) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const row = (id, values, unit = "%") => ({ entity_id: `sensor.${id}`, name: id.toUpperCase(), unit, values });
const run = (data, options = {}, box = { w: 1.4, h: 0.85 }) =>
  plot.draw({ ...box, t: 0, data, options: { ...defaults, entities: [], ...options }, states: {}, config: {}, memo: {}, S });
const valid = (strokes) => strokes.every((s) => s.pts.length && s.pts.every((p) => p.every(Number.isFinite)));
const bounds = (strokes) => {
  const p = strokes.flatMap((s) => s.pts);
  return [Math.min(...p.map((q) => q[0])), Math.max(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[1]))];
};

check(meta.needs === "history" && meta.options.some((o) => o.key === "entities" && o.required), "json asks for history and entities");

// No data: the title (or "Plot"), never nothing.
check(run(null).length > 0 && run(null, { title: "Plants" }).length > 0, "placeholder without data");
check(run({ series: [] }).length > 0 && valid(run({ series: [] })), "placeholder with no series");

// Two series: axis, two lines, two markers, two readouts.
const two = { series: [row("a", ramp(20, 60)), row("b", ramp(50, 30))] };
const s2 = run(two);
check(valid(s2), "strokes are finite");
check(s2.filter((s) => s.role === "line" && s.w === 1 && !s.closed).length >= 2, "two solid lines");
check(s2.filter((s) => s.closed).length >= 2, "two closed markers");
const [x0, x1, y0, y1] = bounds(s2);
check(x0 >= -1.4 && x1 <= 1.4 && y0 >= -0.85 && y1 <= 0.85, "everything stays inside the box");
check(run(two, { axis: false }).length < s2.length, "axis off draws less");
check(run(two, { now: false }).length < s2.length, "readouts off draws less");

// The line's end and readout follow the live state, not the cached history.
{
  const one = { series: [row("a", ramp(48, 50))] };
  const at = (states) => plot.draw({ w: 1.4, h: 0.85, t: 0, data: one, options: { ...defaults, entities: [], range: "fixed", y_min: 0, y_max: 100 }, states, config: {}, memo: {}, S });
  const lowY = (strokes) => Math.min(...strokes.filter((s) => s.role === "line" && s.w === 1).flatMap((s) => s.pts.map((p) => p[1])));
  const stale = at({}), live = at({ "sensor.a": { state: "12" } });
  check(lowY(live) < lowY(stale) - 0.2, "the live state pulls the line's end down");
  check(JSON.stringify(at({ "sensor.a": { state: "unavailable" } })) === JSON.stringify(stale), "an unavailable state keeps the history");
  const memo = {}, ctx = (st) => ({ w: 1.4, h: 0.85, t: 0, data: one, options: { ...defaults, entities: [] }, states: st, config: {}, memo, S });
  const a1 = plot.draw(ctx({ "sensor.a": { state: "40" } })), a2 = plot.draw(ctx({ "sensor.a": { state: "12" } }));
  check(a1 !== a2, "a state change rebuilds the memo");
}

// Dotted, per series.
const dot = run(two, { styles: "solid, dotted" });
check(dot.filter((s) => s.w === S.DOTTED).length === 1, "one dotted series");
check(run(two, { styles: "dotted" }).filter((s) => s.w === S.DOTTED).length === 1, "a missing style is solid, as each series is set on its own");

// Six series, a missing series, gaps, all-null.
const six = { series: Array.from({ length: 6 }, (_, i) => row("s" + i, ramp(10 * i, 10 * i + 8))) };
const s6 = run(six, { legend: true });
check(valid(s6) && s6.filter((s) => s.closed).length >= 6, "six series with legend");
check(valid(run({ series: [row("a", [null, 1, null, null, 3, null]), row("b", [null, null, null])] })), "gaps and an empty series");
check(valid(run({ series: [row("a", [null, null])] })), "all-null series draws readout, not an error");
check(valid(run({ series: [row("a", [5])] })), "single-point series");
check(valid(run({ series: [row("a", ["x", true, undefined, 3])] })), "malformed values");

// Range: fixed keeps the axis to y_min..y_max and labels the top; auto min span widens flat data.
const fixed = run(two, { range: "fixed", y_min: 0, y_max: 100 });
const axisTop = Math.max(...fixed[0].pts.map((p) => p[1]));
check(valid(fixed) && axisTop > 0.5, "fixed range runs the axis full height");
check(valid(run({ series: [row("a", ramp(5, 5))] })), "flat data");

// Unit: option over the sensor's; mixed units drop it.
const labelCount = (o, d = two) => run(d, o).filter((s) => s.role === "text").length;
check(labelCount({ unit: "%" }) >= labelCount({ unit: "" }), "unit adds glyphs");

// Spread (xy _labels): order kept, gaps met, near ends.
const sp = spread([0.1, 0.11, 0.12, 0.5], 0.16);
check(sp.every((v, i) => i === 0 || sp[i] - sp[i - 1] >= 0.16 - 1e-9), "labels pushed apart");
check(sp[3] === 0.5, "distant label untouched");
check(spread([0.3], 0.16)[0] === 0.3, "single label untouched");

// Cache: the same inputs give the same array; a new box redraws. Options compare by value.
const memo = {};
const o = () => ({ ...defaults, entities: [] });
const a = plot.draw({ w: 1, h: 1, data: two, options: o(), memo, S });
check(plot.draw({ w: 1, h: 1, data: two, options: o(), memo, S }) === a, "cached across frames");
check(plot.draw({ w: 1.6, h: 1, data: two, options: o(), memo, S }) !== a, "redraws when the box changes");

// Small corner box stays legible: bounded and nonempty.
const tiny = run(two, {}, { w: 0.5, h: 0.3 });
const [tx0, tx1, ty0, ty1] = bounds(tiny);
check(valid(tiny) && tx0 >= -0.5 && tx1 <= 0.5 && ty0 >= -0.3 && ty1 <= 0.3, "corner box fits");

// Every built-in marker shape (and none) draws, any of them on any series.
const sixS = { series: ["a", "b", "c", "d", "e", "f"].map((k, i) => row(k, ramp(10 * i, 10 * i + 5))) };
for (let k = 0; k < S.MARKER_SHAPES.length; k += 5) {
  const marks = [...S.MARKER_SHAPES.slice(k, k + 5), "none"].join(", ");
  let out = [];
  try { out = run(sixS, { markers: marks, styles: "dotted, solid" }); } catch (e) { check(false, `markers ${marks} threw ${e}`); }
  check(out.length && valid(out), `markers ${marks} draw`);
}

if (failures) { console.error(`${failures} plot check(s) failed`); process.exit(1); }
console.log("plot checks ok");
