// The card's face maths against numbers from xy-bench itself
// (tests/golden_face.json, made by running xy-bench's figures.py).
// Run by ./dev test under node; no packages needed.
import fs from "node:fs";
import * as F from "../custom_components/alfie/frontend/alfie-face.js";

const gold = JSON.parse(fs.readFileSync(new URL("./golden_face.json", import.meta.url)));
const face = JSON.parse(fs.readFileSync(new URL("../custom_components/alfie/frontend/alfie-face.json", import.meta.url)));
let failures = 0, checks = 0;

function close(a, b, what, tol = 1e-5) {
  checks++;
  const fa = a.flat(3), fb = b.flat(3);
  const bad = fa.length !== fb.length || fa.some((v, i) => Math.abs(v - fb[i]) > tol);
  if (bad) {
    failures++;
    if (failures <= 10) console.error(`FAIL ${what}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`);
  }
}

for (const [name, want] of Object.entries(gold.moods)) {
  const pose = F.poseOf(face.expressions[name]);
  close(pose, want, `pose ${name}`);
  const o = gold.outlines[name];
  const l = F.eyeOutline(pose.slice(0, 4), 1), r = F.eyeOutline(pose.slice(4, 8), -1);
  close(l.lap, o.left, `left outline ${name}`);
  close(r.lap, o.right, `right outline ${name}`);
  close([l.right, r.right], [o.left_k, o.right_k], `outline right index ${name}`, 0);
}
for (const [name, want] of Object.entries(gold.animations)) {
  const anim = F.compileAnimation(face.animations[name]);
  close([anim.length], [want.length], `length ${name}`);
  for (const s of want.samples) {
    const got = F.animated(F.poseOf(face.expressions[s.base]), anim.script(s.u));
    close([got.pose, got.eyes, got.face], [s.pose, s.eyes, s.face], `${name} on ${s.base} at ${s.u}`);
  }
}
for (const [t, v] of gold.spring) close([F.spring(t)], [v], `spring ${t}`);
for (const [t, v] of gold.ease) close([F.ease(t)], [v], `ease ${t}`);
for (const [t, v] of gold.blink) close([F.blink(t)], [v], `blink ${t}`);
close(F.uncrossed([0.2, 0.3, 0.5, -0.1, -0.2, 0.0, 0.1, 0.4, 1.0, 0, 0]), gold.uncrossed[0], "uncrossed");

console.log(`face maths: ${checks - failures}/${checks} checks match xy-bench`);
process.exit(failures ? 1 : 0);
