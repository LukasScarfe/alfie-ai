// The volume screen (voice screens): a speaker icon and a slider at the
// player's volume, inside its box at any aspect, the knob easing to a new
// level, and a player with no volume still drawing. Run by ./dev test under node.
import fs from "node:fs";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";
import mod, { level, iconFor } from "../../custom_components/alfie/frontend/screens/volume.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };
S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));
const meta = JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/screens/volume.json", import.meta.url)));
const defaults = Object.fromEntries(meta.options.filter((x) => x.default !== undefined).map((x) => [x.key, x.default]));
const inBox = (strokes, w, h) => strokes.every((s) => s.pts.every(([x, y]) => Math.abs(x) <= w + 0.03 && Math.abs(y) <= h + 0.03));
const valid = (strokes) => strokes.length > 0 && strokes.every((s) => s.pts.length >= 1 && s.pts.every((p) => p.every(Number.isFinite)));

const states = {
  "media_player.r": { state: "playing", attributes: { friendly_name: "Record player", volume_level: 0.4, is_volume_muted: false } },
  "media_player.m": { state: "playing", attributes: { friendly_name: "Muted", volume_level: 0.7, is_volume_muted: true } },
  "media_player.n": { state: "off", attributes: { friendly_name: "TV" } },
};
const draw = (o, { w = 1.6, h = 1, t = 1000, memo = {} } = {}) =>
  mod.draw({ w, h, t, data: null, options: { ...defaults, ...o }, states, memo, S });
const knobX = (out) => {
  const k = out.find((s) => s.closed && s.fill && s.pts.length === 16);
  return k ? k.pts.reduce((a, p) => a + p[0], 0) / 16 : null;
};

for (const e of ["media_player.r", "media_player.m", "media_player.n", "media_player.gone"])
  for (const slider of ["line", "dotted", "blocks"])
    for (const extra of [{}, { show_percent: true, show_name: true }])
      for (const [w, h] of [[1.6, 1], [1, 1], [0.7, 1], [1.6, 0.6], [0.5, 0.35]]) {
        const out = draw({ entity: e, slider, ...extra }, { w, h });
        check(valid(out) && inBox(out, w, h), `${e} ${slider} ${JSON.stringify(extra)} at ${w}x${h}`);
      }

// The knob sits at the volume, and eases to a new one.
const memo = {}, at40 = knobX(draw({ entity: "media_player.r" }, { memo }));
states["media_player.r"].attributes.volume_level = 0.8;
const soon = knobX(draw({ entity: "media_player.r" }, { memo, t: 1000.05 }));
let later;
for (let i = 1; i <= 40; i++) later = knobX(draw({ entity: "media_player.r" }, { memo, t: 1000.05 + i * 0.05 }));
const at80 = knobX(draw({ entity: "media_player.r" }));
check(at40 < soon && soon < at80, `knob on its way (${at40} -> ${soon} -> ${at80})`);
check(Math.abs(later - at80) < 1e-9, "knob gets home");

check(level(states["media_player.n"]).v === null && level(states["media_player.m"]).muted, "level");
check(iconFor(0.8, false) === "mdi:volume-high" && iconFor(0.5, false) === "mdi:volume-medium"
  && iconFor(0.1, false) === "mdi:volume-low" && iconFor(0.5, true) === "mdi:volume-off" && iconFor(0, false) === "mdi:volume-off", "icon by level");

if (failures) { console.error(`volume: ${failures} failures`); process.exit(1); }
console.log("volume: ok");
