// The card's look precedence: own config > scene look (empty skipped) > defaults.
import { effectiveConfig, lookKey, renameOld, THEMES, THEME_KEYS, themeOf, STYLE_TEXT } from "../../custom_components/alfie/frontend/alfie-look.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };

const D = { style: "neon", ring_color: null, glow: null, padding: 0.08, eye_fill: false, shapes: null, fps: 30 };
const look = { style: "crt", ring_color: "", glow: null, padding: 0.2, eye_fill: true,
  shapes: { head: { type: "star" } }, bogus: 1, fps: 99 };

let e = effectiveConfig(D, look, {});
check(e.style === "crt" && e.padding === 0.2 && e.eye_fill === true, "look beats defaults");
check(e.ring_color === null && e.glow === null, "empty look values are skipped");
check(e.shapes.head.type === "star", "look shapes apply");
check(!("bogus" in e) && e.fps === 30, "keys outside the look are ignored");
e = effectiveConfig(D, look, { style: "flat", padding: 0.1 });
check(e.style === "flat" && e.padding === 0.1, "the card's own keys win");
check(e.eye_fill === true, "other look keys still apply");
e = effectiveConfig(D, null, { style: "theme" });
check(e.style === "theme" && e.padding === 0.08, "no look gives defaults plus own");
check(effectiveConfig(D, look, { glow: 0 }).glow === 0, "own falsy value wins");
check(D.style === "neon", "defaults not mutated");
check(lookKey(look) === lookKey({ ...look }) && lookKey(null) === "" && lookKey(look) !== lookKey({ ...look, padding: 0.3 }), "lookKey");

// Card YAML from before config v4 still works.
const old = renameOld({ mode: "rotation", face_color: "#f00", style: "flat" });
check(old.display === "rotation" && old.ring_color === "#f00" && !("mode" in old) && !("face_color" in old) && old.style === "flat", "old keys renamed");
check(renameOld({ mode: "rotation", display: "companion" }).display === "companion", "a new key wins over its old name");

// Themes: each names a known style and every themed key; a look wearing one is recognised,
// and one changed colour (or none of a theme's) is its own.
for (const [k, t] of Object.entries(THEMES)) {
  check(t.style in STYLE_TEXT && THEME_KEYS.every((x) => x in t), `theme ${k} complete`);
  check(themeOf({ ...t, padding: 0.1 }) === k, `theme ${k} recognised`);
}
check(themeOf({ ...THEMES.ocean, ring_color: "#123456" }) === "", "a changed colour is its own");
check(themeOf({ style: "neon", ring_color: "", background: "none" }) === "classic", "an untouched look is classic");

if (failures) process.exit(1);
console.log("look ok");
