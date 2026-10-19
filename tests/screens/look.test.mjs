// The card's look precedence: own config > scene look (empty skipped) > defaults.
import { effectiveConfig, lookKey } from "../../custom_components/alfie/frontend/alfie-look.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };

const D = { style: "neon", face_color: null, glow: null, padding: 0.08, eye_fill: false, shapes: null, fps: 30 };
const look = { style: "crt", face_color: "", glow: null, padding: 0.2, eye_fill: true,
  shapes: { head: { type: "star" } }, bogus: 1, fps: 99 };

let e = effectiveConfig(D, look, {});
check(e.style === "crt" && e.padding === 0.2 && e.eye_fill === true, "look beats defaults");
check(e.face_color === null && e.glow === null, "empty look values are skipped");
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

if (failures) process.exit(1);
console.log("look ok");
