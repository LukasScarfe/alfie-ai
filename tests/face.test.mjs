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
const DEGREE = Math.PI / 180;
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

// True fillets: a rounded square's corners lie on an arc tangent to both edges.
{
  const k = 0.3, r = k;                           // side 2, so tangent length k and radius k
  const rs = F.outline({ type: "polygon", sides: 4, roundness: k }, 120);
  check(rs.length === 120, "filleted square: 120 points");
  const near = rs.filter(([x, y]) => Math.abs(x) > 1 - r + 1e-6 && Math.abs(y) > 1 - r + 1e-6);
  check(near.length >= 40, `filleted square: corners are well sampled (${near.length} points)`);
  check(near.every(([x, y]) => Math.abs(Math.hypot(Math.abs(x) - (1 - r), Math.abs(y) - (1 - r)) - r) < 2e-3),
    "filleted square: corner points lie on the fillet arc");
  check(rs.every(([x, y]) => Math.abs(x) <= 1 + 1e-9 && Math.abs(y) <= 1 + 1e-9), "filleted square: inside the box");
  check(Math.abs(rs[0][0] - 1) < 1e-9 && Math.abs(rs[0][1]) < 1e-9, "filleted square: point 0 at angle 0");
  for (const spec of [{ type: "polygon", sides: 4, roundness: 0.12 }, { type: "star", points: 5, inner: 0.5, roundness: 0.2 },
    { type: "polygon", sides: 3, roundness: 0.5 }, { type: "path", points: [[0, 1], [1, -1], [-1, -1]], roundness: 0.3 }]) {
    const pts = F.outline(spec, 120);
    const worst = Math.max(...pts.map((v, i) => {
      const p = pts[(i + 119) % 120], q = pts[(i + 1) % 120];
      return Math.abs(Math.atan2((v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]),
        (v[0] - p[0]) * (q[0] - v[0]) + (v[1] - p[1]) * (q[1] - v[1]))) / DEGREE;
    }));
    check(worst < 20, `${JSON.stringify(spec)}: no kink (worst turn ${worst.toFixed(1)} deg)`);
    check(!F.cornerFlags(pts).some(Boolean), `${JSON.stringify(spec)}: nothing flagged as a sharp corner`);
  }
  const full = F.outline({ type: "polygon", sides: 6, roundness: 1 }, 120);
  const rr = full.map(([x, y]) => Math.hypot(x, y));
  check(Math.max(...rr) - Math.min(...rr) < 5e-3, "roundness 1 on a hexagon is a circle");
  const circ = F.outline({ type: "circle" }, 120);
  check(circ.every(([x, y], i) => Math.abs(x - Math.cos((2 * Math.PI * i) / 120)) < 1e-12 &&
    Math.abs(y - Math.sin((2 * Math.PI * i) / 120)) < 1e-12), "circle outline is unchanged");
  const sharp = F.outline({ type: "polygon", sides: 4 }, 120);
  check(F.cornerFlags(sharp).filter(Boolean).length === 4, "sharp square: 4 corners kept sharp");
  check(!F.cornerFlags(circ).some(Boolean), "circle: no sharp corners");
  for (const name of Object.keys(face.expressions)) {
    const pose = F.poseOf(face.expressions[name]);
    for (const base of [F.outline({ type: "star", points: 5, inner: 0.5, roundness: 0.3 }, 120), rs]) {
      const lap = F.eyeOutline(pose.slice(0, 4), 1, base).lap;
      check(lap.length >= 2 && lap.every(([x, y]) => Math.abs(x) <= 1 + 1e-9 && Math.abs(y) <= 1 + 1e-9), `rounded eye cut by ${name} lids`);
    }
  }
  const lidEye = F.eyeOutline(F.poseOf(face.expressions.happy).slice(0, 4), 1).lap;
  check(F.cornerFlags(lidEye).filter(Boolean).length >= 2, "happy eye: lid corners stay sharp");
  const ra = F.outline({ type: "polygon", sides: 4, roundness: 0.3 }, 120), rb = F.outline({ type: "star", roundness: 0.2 }, 120);
  close(F.blendOutlines(ra, rb, 0), ra, "rounded morph at 0");
  close(F.blendOutlines(ra, rb, 1), rb, "rounded morph at 1");
}
const parts = F.partOutlines({ eye: { type: "path", points: [[0, 1], [1, -1], [-0.2, -1]] } });
close(parts.right, F.mirrored(parts.left), "right eye mirrors the left");
const custom = F.partOutlines({ eye: { type: "star" }, right_eye: { type: "circle" } });
close(custom.right, F.outline({ type: "circle" }), "an explicit right_eye is not mirrored");

// ------------------------------------------------------------- personality
const bubbly = F.personalityOf("bubbly", face.personalities);
close(Object.values(bubbly), Object.values(F.PERSONALITY), "bubbly is the identity", 0);
check(F.bounced(0.45, 1) === 0.45, "bounce 1 leaves damping alone");
check(F.bounced(0.45, 2) < 0.45 && F.bounced(0.45, 0.3) > 0.45, "bounce moves damping the right way");
const neutral = F.poseOf(face.expressions.neutral), angry = F.poseOf(face.expressions.angry);
check(F.exaggerated(angry, neutral, 1) === angry, "exaggeration 1 is the pose itself");
close(F.exaggerated(angry, neutral, 0), F.uncrossed(neutral), "exaggeration 0 is neutral");
check(Math.abs(F.exaggerated(angry, neutral, 0.5)[1] - angry[1] / 2) < 1e-9, "exaggeration halves the slant");
check(F.personalityOf({ speed: 2 }, {}, bubbly).speed === 2 && F.personalityOf(null).bounce === 1,
  "sliders override, nothing is the base");
check(F.personalityOf("nonsense", face.personalities).speed === 1, "an unknown preset is the default");
for (const [name, p] of Object.entries(face.personalities)) {
  check(Object.keys(p).sort().join() === Object.keys(F.PERSONALITY).sort().join(), `${name} has every slider`);
}

// Speaking (no mouth): a 0..1 rhythm that rests and peaks, the eye styles
// move the eyes only, and the ring styles keep the ring's centre.
{
  const lv = Array.from({ length: 2000 }, (_, i) => F.speechLevel(i / 100));
  check(lv.every((v) => v >= 0 && v <= 1), "speech level stays in 0..1");
  check(lv.some((v) => v === 0) && Math.max(...lv) > 0.85, "speech rests and peaks");
  check(Object.keys(F.speakingChannels("pulse", 1, 0.3)).length === 0, "pulse leaves the eyes be");
  const peak = lv.indexOf(Math.max(...lv)) / 100;
  check(F.speakingChannels("eyes", 1, peak).size > 0.1 && F.speakingChannels("both", 1, peak).size
    < F.speakingChannels("eyes", 1, peak).size, "eyes grow on a syllable, less when shared");
  const ring = F.faceShapes(F.poseOf(face.expressions.neutral)).head;
  check(F.speakingHead(ring, [0, 0], "eyes", 1, peak) === ring, "eyes leave the ring be");
  for (const style of ["pulse", "both", "wave"]) {
    const out = F.speakingHead(ring, [0, 0], style, 1, peak);
    const r = out.map(([x, y]) => Math.hypot(x, y));
    check(out.length === ring.length && Math.max(...r) <= 1.05 && Math.min(...r) >= 0.95
      && Math.max(...r) > 1.005, `${style} moves the ring a little`);
  }
  check(F.speakingHead(ring, [0, 0], "pulse", 0, peak).every(([x, y], i) => x === ring[i][0] && y === ring[i][1]),
    "strength 0 is still");
}

// Motion: the defaults are the motion as it always was, and each knob moves
// what it says.
{
  const oldLevel = (t) => {
    const s = Math.sin(2 * Math.PI * 4.1 * t) * 0.55 + Math.sin(2 * Math.PI * 6.7 * t + 1.3) * 0.3
      + Math.sin(2 * Math.PI * 1.3 * t + 0.4) * 0.35;
    const phrase = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.37 * t + 2.1);
    return Math.max(0, Math.min(1, (s * 0.5 + 0.45) * phrase));
  };
  const ts = Array.from({ length: 500 }, (_, i) => i / 37);
  check(ts.every((t) => Math.abs(F.speechLevel(t) - oldLevel(t)) < 1e-12), "default rhythm is the old one");
  const ring = F.faceShapes(F.poseOf(face.expressions.neutral)).head;
  const peak = ts.reduce((a, t) => (F.speechLevel(t) > F.speechLevel(a) ? t : a), 0);
  const oldWave = ring.map(([x, y]) => {
    const k = 1 + 0.028 * oldLevel(peak) * Math.sin(7 * Math.atan2(y, x) + 2 * Math.PI * 1.6 * peak);
    return [x * k, y * k];
  });
  close(F.speakingHead(ring, [0, 0], "wave", 1, peak, F.motionOf()).flat(), oldWave.flat(), "default wave is the old one");
  check(F.motionOf({ wave_depth: "0.1", nonsense: 3 }, { wave_bumps: 12 }).wave_depth === 0.1
    && F.motionOf({ wave_bumps: 5 }, { wave_bumps: 12 }).wave_bumps === 12 && !("nonsense" in F.motionOf({ nonsense: 3 })),
    "motionOf: later wins, unknown keys dropped");
  const reach = (m) => Math.max(...F.speakingHead(ring, [0, 0], "wave", 1, peak, F.motionOf(m)).map(([x, y]) => Math.hypot(x, y)));
  check(reach({ wave_depth: 0.1 }) > reach({}) + 0.03, "wave_depth widens the ripple");
  check(reach({ wave_detail: 1 }) !== reach({}), "wave_detail adds a ripple");
  const bumps = (n) => {
    const r = F.speakingHead(ring, [0, 0], "wave", 1, peak, F.motionOf({ wave_bumps: n })).map(([x, y]) => Math.hypot(x, y) - 1);
    return r.filter((v, i) => v > 0 && r[(i + r.length - 1) % r.length] <= 0).length;
  };
  check(bumps(12) === 12 && bumps(7) === 7, "wave_bumps is the number of bumps");
  const spiky = ts.map((t) => F.speechLevel(t, F.motionOf({ speak_contrast: 2 })));
  check(spiky.every((v, i) => v <= F.speechLevel(ts[i]) + 1e-12), "punch quietens the quiet");
  check(F.speakingChannels("eyes", 1, peak, F.motionOf({ eye_grow: 0.5 })).size > F.speakingChannels("eyes", 1, peak).size * 2,
    "eye_grow grows the eyes");
}

console.log(`face maths: ${checks - failures}/${checks} checks pass (xy-bench golden + shapes + personality)`);
process.exit(failures ? 1 : 0);
