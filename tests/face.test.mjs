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
  // xy-bench cut a 64-gon; Alfie samples finer by default.
  const l = F.eyeOutline(pose.slice(0, 4), 1, null, 64), r = F.eyeOutline(pose.slice(4, 8), -1, null, 64);
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

// ------------------------------------------------------------------ shapes
function check(ok, what) {
  checks++;
  if (!ok) { failures++; console.error(`FAIL ${what}`); }
}
const SPECS = [
  { type: "circle" }, { type: "polygon", sides: 4 }, { type: "polygon", sides: 3, roundness: 0.4 },
  { type: "star", points: 5, inner: 0.45 }, { type: "superellipse", n: 4 },
  { type: "polygon", sides: 6, rotation: 15 },
  { type: "path", points: [[0, 1], [1, -1], [-1, -1]] },
];
for (const spec of SPECS) {
  const pts = F.outline(spec, 120);
  const what = JSON.stringify(spec);
  check(pts.length === 120, `${what}: 120 points`);
  const box = Math.max(...pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  check(Math.abs(box - 1) < 1e-9 || spec.type === "circle", `${what}: fits the unit box exactly (${box})`);
  check(pts.every(([x, y]) => Math.abs(x) <= 1 + 1e-9 && Math.abs(y) <= 1 + 1e-9), `${what}: inside the box`);
  // Counter-clockwise: positive signed area.
  let area = 0;
  pts.forEach(([x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; area += x * v - u * y; });
  check(area > 0, `${what}: counter-clockwise`);
}
const sq = F.outline({ type: "polygon", sides: 4 }, 120);
check(sq.some(([x, y]) => Math.abs(Math.abs(x) - 1) < 1e-9 && Math.abs(Math.abs(y) - 1) < 1e-9), "square reaches its corners");
check(sq.filter(([x, y]) => Math.abs(Math.abs(x) - 1) < 1e-9 && Math.abs(Math.abs(y) - 1) < 1e-9).length === 4, "square has 4 corners");
const st = F.outline({ type: "star", points: 5, inner: 0.5 }, 120);
const radii = st.map(([x, y]) => Math.hypot(x, y));
const rmax = Math.max(...radii), rmin = Math.min(...radii);
check(Math.abs(rmin / rmax - 0.5) < 0.01, `star inner ratio ${rmin / rmax}`);
check(Math.abs(st[30][0]) < 1e-9 && Math.abs(st[30][1] / rmax - 1) < 1e-9, "star tip points straight up");
const a = F.outline({ type: "circle" }, 120), b = F.outline({ type: "star" }, 120);
close(F.blendOutlines(a, b, 0), a, "morph at 0");
close(F.blendOutlines(a, b, 1), b, "morph at 1");
check(F.blendOutlines(a, b, 0.5).every(([x, y], i) => Math.abs(x - (a[i][0] + b[i][0]) / 2) < 1e-12), "morph halfway");
for (const name of Object.keys(face.expressions)) {
  const pose = F.poseOf(face.expressions[name]);
  const lap = F.eyeOutline(pose.slice(0, 4), 1, b).lap;
  check(lap.length >= 2, `star eye cut by ${name} lids leaves a stroke`);
}
const parts = F.partOutlines({ eye: { type: "path", points: [[0, 1], [1, -1], [-0.2, -1]] } });
close(parts.right, F.mirrored(parts.left), "right eye mirrors the left");
const custom = F.partOutlines({ eye: { type: "star" }, right_eye: { type: "circle" } });
close(custom.right, F.outline({ type: "circle" }), "an explicit right_eye is not mirrored");

console.log(`face maths: ${checks - failures}/${checks} checks pass (xy-bench golden + shapes)`);
process.exit(failures ? 1 : 0);
