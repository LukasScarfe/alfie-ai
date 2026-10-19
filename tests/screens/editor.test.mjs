// The card editor's pure config round-trip: only non-default keys are written.
import * as E from "../../custom_components/alfie/frontend/alfie-card-editor.js";

let failures = 0;
function check(ok, what) { if (!ok) { failures++; console.error(`FAIL ${what}`); } }

let c = { type: "custom:alfie-card" };
c = E.applyChange(c, "style", "crt");
check(c.style === "crt", "non-default is written");
c = E.applyChange(c, "style", "neon");
check(!("style" in c) && c.type, "default removes the key, keeps type");
c = E.applyChange(c, "face_color", "#ff0000");
c = E.applyChange(c, "face_color", "");
check(!("face_color" in c), "empty removes a null-default key");
c = E.applyChange(c, "eye_fill", false);
check(!("eye_fill" in c), "false default is not written");
c = E.applyChange(c, "breathing", false);
check(c.breathing === false, "false against a true default is written");
c = E.applyChange(c, "glow", 0);
check(c.glow === 0, "0 is a real value, not empty");
check(E.applyChange({}, "background", "none").background === undefined, "background none is the default");

let s = E.setShapePart(null, "head", { type: "polygon" });
s = E.setShapePart(s, "head", E.setShapeParam(s.head, "sides", 6));
check(s.head.sides === 6, "param set");
s = E.setShapePart(s, "head", E.setShapeParam(s.head, "sides", 4));
check(!("sides" in s.head), "param at default dropped");
check(E.setShapePart(s, "head", undefined) === null, "no parts left means no shapes key");
check(Object.keys(E.SLIDERS).every((k) => !("fidget_rate" in E.SLIDERS)), "fidget_rate is engine only");

if (failures) process.exit(1);
console.log("editor: ok");
