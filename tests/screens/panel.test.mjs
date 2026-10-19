// The panel's pure form helpers.
import * as P from "../../custom_components/alfie/frontend/alfie-panel-forms.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };

const ctx = { i: 0, type: "map", list: () => "ent-0" };
const h = P.optionField({ key: "allow_network", kind: "bool", label: "Net", default: false }, undefined, "screens.0.options", ctx);
check(h.includes("Privacy") && h.includes('data-path="screens.0.options.allow_network"'), "map network note");
check(P.optionField({ key: "x", kind: "number", label: "X", default: 5, min: 1, max: 9 }, undefined, "p", ctx).includes('placeholder="5"'), "default placeholder");
check(P.optionField({ key: "e", kind: "entity", label: "E", required: true }, "", "p", ctx).includes("req"), "required marker");
check(P.optionField({ key: "c", kind: "color", label: "C" }, "#abc", "p", ctx).includes('value="#aabbcc"'), "swatch expands short hex");

let s = P.setShapeParam({ type: "polygon" }, "sides", 6);
check(s.sides === 6, "param set");
s = P.setShapeParam(s, "sides", 4);
check(!("sides" in s), "default dropped");
s = P.setShapeParam(s, "stretch_x", 1.5);
check(s.stretch[0] === 1.5 && P.shapeParam(s, "stretch_y") === 1, "stretch");
check(!("stretch" in P.setShapeParam(s, "stretch_x", 1)), "stretch default dropped");
check(P.changeShapeType({ type: "star", points: 7, rotation: 10 }, "polygon").rotation === 10, "type change keeps rotation");

const d = { screens: [{ id: "a" }], rotations: [{ steps: [{ screen: "a", seconds: 5 }, { screen: "b", seconds: 5 }] }], signals: [{ screen: "a" }] };
P.renameScreenRefs(d, "a", "z");
check(d.rotations[0].steps[0].screen === "z" && d.signals[0].screen === "z", "rename refs");
check(P.dropScreenRefs(d, "z") === 1 && d.signals[0].screen === null, "drop refs");
check(P.uniqueId([{ id: "plot" }], "plot") === "plot_2", "unique id");
if (failures) process.exit(1);
console.log("panel forms ok");
