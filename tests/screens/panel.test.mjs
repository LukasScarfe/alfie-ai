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
// Stories and triggers.
const stepDefaults = {
  expression: { kind: "expression", name: "@mood", hold: 1.5, blend: 0 },
  animation: { kind: "animation", name: "nod", wait: true },
  screen: { kind: "screen", screen: "@why", seconds: 15, present: "card", transition: "" },
};
const steps = P.compileTemplate({ expression: "happy", animation: "", screen: "@wrong", seconds: 8, present: "corner", transition: "", closing: "shake" }, stepDefaults);
check(JSON.stringify(steps.map((x) => x.name || x.screen)) === '["happy","@wrong","shake"]', "template compiles");
check(steps[1].seconds === 8 && steps[1].present === "corner" && steps[0].hold === 1, "template fields carried");
const dr = { triggers: [{ story: "a" }, { story: "b" }], signals: [{ repeat: { story: "a" } }],
  behaviour: { appear_story_bad: "a", appear_story_ok: "b" },
  stories: [{ template: { screen: "p" }, steps: [{ kind: "screen", screen: "p" }, { kind: "wait" }] }] };
P.renameStoryRefs(dr, "a", "c");
check(dr.triggers[0].story === "c" && dr.signals[0].repeat.story === "c" && P.storyUses(dr, "c") === 1, "story refs");
check(dr.behaviour.appear_story_bad === "c" && dr.behaviour.appear_story_ok === "b", "appear story refs");
P.renameScreenRefs(dr, "p", "q");
check(dr.stories[0].template.screen === "q" && dr.stories[0].steps[0].screen === "q", "story screen rename");
P.dropScreenRefs(dr, "q");
check(dr.stories[0].template.screen === "" && dr.stories[0].steps.length === 1, "story screen drop");
const tk = P.changeTriggerKind({ id: "t", kind: "entity", story: "s", priority: 70, entities: ["x"], op: "changes", value: "" },
  { id: "", kind: "wake", story: "", priority: 50, edge: "wakes" });
check(tk.kind === "wake" && tk.priority === 70 && tk.story === "s" && !("entities" in tk) && tk.edge === "wakes", "trigger kind change");
check(P.triggerSummary({ kind: "mood", direction: "worse", from: [], to: ["miserable"] }) === "mood gets worse to miserable", "summary");
check(P.triggerSummary({ kind: "mode", modes: ["away"], edge: "leave" }) === "away ends", "mode trigger summary");

// House modes: summary, and ids followed on rename.
const mode = { condition: { entities: ["zone.home"], match: "any", op: "below", value: 1 }, presence: "idle",
  hold_back: "none", mood_fixed: "", mood_floor: "", personality: "", rotation: "pause", triggers_off: ["a", "b"] };
check(P.modeSummary(mode) === "zone.home below 1 → idle, rotation paused, 2 triggers off", "mode summary");
check(P.modeSummary({ ...mode, condition: null, presence: "normal", rotation: "", triggers_off: [] }) === "picked by hand → no changes", "hand mode summary");
const md = { modes: [{ ...mode, rotation: "r1" }], triggers: [{ kind: "mode", modes: ["away"] }, { kind: "wake" }] };
P.renameModeRefs(md, "trigger", "a", "z");
P.renameModeRefs(md, "rotation", "r1", "r2");
P.renameModeRefs(md, "mode", "away", "out");
check(md.modes[0].triggers_off.join() === "z,b" && md.modes[0].rotation === "r2" && md.triggers[0].modes[0] === "out", "mode refs");

if (failures) process.exit(1);
console.log("panel forms ok");
