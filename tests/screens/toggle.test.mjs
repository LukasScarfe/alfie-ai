// The toggle screen (voice screens): one entity or a grid, inside its box at
// any aspect, the knob sliding from `from` to the state, and things that
// aren't on or off shown by their state alone. Run by ./dev test under node.
import fs from "node:fs";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";
import mod, { isOn, iconFor } from "../../custom_components/alfie/frontend/screens/toggle.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };
S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));
const meta = JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/screens/toggle.json", import.meta.url)));
const defaults = Object.fromEntries(meta.options.filter((x) => x.default !== undefined).map((x) => [x.key, x.default]));
const inBox = (strokes, w, h) => strokes.every((s) => s.pts.every(([x, y]) => Math.abs(x) <= w + 0.03 && Math.abs(y) <= h + 0.03));
const valid = (strokes) => strokes.length > 0 && strokes.every((s) => s.pts.length >= 1 && s.pts.every((p) => p.every(Number.isFinite)));

const states = {};
for (let i = 0; i < 12; i++) states[`light.l${i}`] = { state: i % 2 ? "on" : "off", attributes: { friendly_name: `Lamp ${i}` } };
states["sensor.t"] = { state: "21.4", attributes: { friendly_name: "Office temperature", unit_of_measurement: "°C", device_class: "temperature" } };
states["switch.c"] = { state: "on", attributes: { friendly_name: "Coffee maker" } };
const draw = (o, { w = 1.6, h = 1, shown = 60, memo = {} } = {}) =>
  mod.draw({ w, h, t: 1000 + shown, shown, data: null, options: { ...defaults, ...o }, states, memo, S });

for (let n = 1; n <= 12; n++) {
  const ents = Array.from({ length: n }, (_, i) => `light.l${i}`);
  for (const [w, h] of [[1.6, 1], [1, 1], [0.7, 1], [1.6, 0.6]]) {
    const out = draw({ entities: ents, more: n === 12 ? 4 : 0, title: n > 3 ? "Lights" : "" }, { w, h });
    check(valid(out), `${n} cells at ${w}x${h}: valid strokes`);
    check(inBox(out, w, h), `${n} cells at ${w}x${h}: inside the screen`);
  }
}

// The knob: at `from` while the screen comes in, home once it has slid.
const knobX = (out) => {
  const fills = out.filter((s) => s.closed && s.pts.length === 20);   // the knob is the 20-point circle
  return fills.length ? fills[0].pts.reduce((t, p) => t + p[0], 0) / 20 : null;
};
const o = { entities: ["switch.c"], action: true, from: "off" };
const start = knobX(draw(o, { shown: 0 })), home = knobX(draw(o, { shown: 60 })), mid = knobX(draw(o, { shown: 0.6 }));
check(start !== null && home !== null && start < home, `knob slides right to on (${start} -> ${home})`);
check(mid > start && mid < home, `knob part way at 0.6 s (${mid})`);
const live = {}, a = knobX(draw(o, { shown: 0.2, memo: live }));
check(Math.abs(a - start) < 1e-9, "knob waits at from before sliding");
check(knobX(draw({ entities: ["switch.c"] }, { shown: 0 })) === home, "no from: the knob starts home");

// Words off: a switch alone draws less, and a sensor still shows its state.
const words = draw({ entities: ["switch.c"] }), bare = draw({ entities: ["switch.c"], show_name: false, show_state: false });
check(valid(bare) && inBox(bare, 1.6, 1) && bare.length < words.length, "names and state off draw less");
check(knobX(bare) !== null, "the switch stays");
const sensorBare = draw({ entities: ["sensor.t"], show_name: false, show_state: false });
check(sensorBare.length > draw({ entities: ["sensor.t"], show_name: false, show_state: false, layout: { state: { show: false } } }).length, "a sensor keeps its state");

// A number has no switch, just its state.
const t = draw({ entities: ["sensor.t"] });
check(knobX(t) === null, "a sensor shows no switch");
check(valid(t) && inBox(t, 1.6, 1), "a sensor cell draws inside the screen");
check(valid(draw({ entities: ["light.missing"] })), "a missing entity draws something");
check(valid(draw({ entities: [] })), "no entities: a placeholder");

check(isOn("on") && isOn("open") && isOn("playing") && !isOn("off") && !isOn("unavailable") && !isOn("closed"), "isOn");
check(iconFor("switch.dining_coffee_maker_outlet", states["switch.c"], true) === "mdi:coffee-maker", "coffee maker icon by name");
check(iconFor("light.tv_grow", { attributes: { friendly_name: "TV grow lights" } }, true) === "mdi:sprout", "grow words beat tv");
check(iconFor("light.x", { attributes: { friendly_name: "X", icon: "mdi:heart" } }, true) === "mdi:heart", "the entity's own icon wins");
check(iconFor("light.x", { attributes: { friendly_name: "X" } }, false) === "mdi:lightbulb-outline", "an off light");

if (failures) { console.error(`toggle: ${failures} failures`); process.exit(1); }
console.log("toggle: ok");
