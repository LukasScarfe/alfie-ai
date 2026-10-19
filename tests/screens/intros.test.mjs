// The intros: endpoints, monotonicity, no NaN, the resampler. Run by ./dev test.
import fs from "node:fs";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";
import * as I from "../../custom_components/alfie/frontend/alfie-intros.js";

let failures = 0, checks = 0;
function check(ok, what) { checks++; if (!ok) { failures++; console.error(`FAIL ${what}`); } }
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));
const box = { w: 1.6, h: 1 };
const label = [...S.text("Hello Alfie", 0.3, 0, 0.3), ...S.text("12:30", 0.3, 0, -0.3, { role: "accent" }),
  S.stroke([[-1, -0.8], [1, -0.8]], { w: 0.5 }), S.stroke([[-0.5, -0.6], [0.5, -0.6], [0.5, -0.5], [-0.5, -0.5]], { closed: true })];
const ring = (r, n = 40) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);
const face = [{ pts: ring(0.9), closed: true, w: 1, role: "line", fill: false },
  { pts: ring(0.1, 12).map(([x, y]) => [x - 0.3, y + 0.1]), closed: true, w: 1, role: "accent", fill: false },
  { pts: ring(0.1, 12).map(([x, y]) => [x + 0.3, y + 0.1]), closed: true, w: 1, role: "accent", fill: false }];
const len = (strokes) => strokes.reduce((a, s) => a + I.polylineLength(s.pts, s.closed), 0);
const finite = (strokes) => strokes.every((s) => s.pts.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])) && Number.isFinite(s.w));
const same = (a, b) => a.length === b.length && a.every((s, i) => s === b[i] || (s.pts.length === b[i].pts.length && s.pts.every((q, j) => near(q[0], b[i].pts[j][0]) && near(q[1], b[i].pts[j][1]))));

// every style has a duration and is known
for (const st of I.STYLES) check(typeof I.SECONDS[st] === "number", `${st} has SECONDS`);
check(I.SECONDS.cut === 0 && !I.RANDOM_STYLES.includes("cut"), "cut is instant and not random");

for (const st of I.STYLES) {
  for (const leaving of [false, true]) {
    // presence runs 0 -> 1 coming in, 1 -> 0 going out
    const a = I.presence(st, 0, leaving), b = I.presence(st, 1, leaving);
    check(near(a, leaving ? 1 : 0) && near(b, leaving ? 0 : 1), `${st} leaving=${leaving} presence endpoints`);
    let prev = null, over = 0, bad = false;
    for (let i = 0; i <= 50; i++) {
      const v = I.presence(st, i / 50, leaving);
      if (!Number.isFinite(v)) bad = true;
      over = Math.max(over, v - 1);
      prev = v;
    }
    check(!bad && over < 0.1, `${st} presence finite, overshoot < 0.1`);
  }
  // presence 1 is the finished drawing; 0 is invisible
  const full = I.apply(st, 1, false, label, box, face);
  check(full.alpha === 1 && same(full.strokes, label), `${st} p=1 is the finished drawing`);
  const none = I.apply(st, 0, false, label, box);
  check(none.alpha === 0 || none.strokes.length === 0, `${st} p=0 is invisible`);
  const goneL = I.apply(st, I.presence(st, 1, true), true, label, box);
  check(goneL.alpha === 0 || goneL.strokes.length === 0, `${st} fully left is invisible`);
  // never NaN anywhere, with and without a box, with empty input, for overshoot
  for (const leaving of [false, true]) {
    for (let i = 0; i <= 20; i++) {
      const p = -0.1 + (1.3 * i) / 20;
      for (const [str, bx] of [[label, box], [label, null], [[], box], [face, box]]) {
        const r = I.apply(st, p, leaving, str, bx, face);
        if (!(r.alpha >= 0 && r.alpha <= 1) || !finite(r.strokes)) { check(false, `${st} p=${p} NaN/alpha ${r.alpha}`); break; }
      }
    }
  }
  check(I.apply(st, NaN, false, label, box).strokes.length >= 0, `${st} survives NaN p`);
}

// monotone where it should be: alpha for fade, drawn length for the writing styles
{
  let prev = -1, ok = true;
  for (let i = 0; i <= 40; i++) { const a = I.apply("fade", I.presence("fade", i / 40), false, label, box).alpha; if (a < prev - 1e-9) ok = false; prev = a; }
  check(ok, "fade alpha is monotone");
  for (const st of ["draw", "stagger", "wipe"]) {
    let last = -1, good = true;
    for (let i = 1; i <= 40; i++) {
      const r = I.apply(st, i / 40, false, label, box);
      const L = len(r.strokes.filter((s) => s.role !== "accent" || st !== "wipe" || s.w !== 1.5));
      if (L < last - 1e-6) good = false;
      last = L;
    }
    check(good, `${st} drawn length is monotone`);
  }
  let k = 0.0, good = true;
  for (let i = 1; i <= 20; i++) {
    const ext = (r) => Math.max(...r.strokes.flatMap((s) => s.pts.map((q) => Math.abs(q[0]))));
    const e = ext(I.apply("zoom", i / 20, false, label, box));
    if (e < k - 1e-9) good = false; k = e;
  }
  check(good, "zoom grows monotonically");
  // draw at half has half of every long stroke
  const half = I.apply("draw", 0.5, false, [S.stroke([[0, 0], [1, 0], [1, 1]])], box).strokes[0];
  check(near(I.polylineLength(half.pts), 1, 1e-6), "draw p=.5 is half the length");
  // stagger: the last stroke has not started at small p
  check(I.apply("stagger", 0.1, false, label, box).strokes.length < label.length, "stagger leaves later strokes out");
}

// directional styles: arriving comes from the left, leaving goes right
{
  const arr = I.apply("slide", 0.5, false, label, box).strokes, lv = I.apply("slide", 0.5, true, label, box).strokes;
  const cx = (st) => st.flatMap((s) => s.pts).reduce((a, q) => a + q[0], 0) / st.flatMap((s) => s.pts).length;
  check(cx(arr) < cx(label) && cx(lv) > cx(label), "slide in from the left, out to the right");
  const w = I.apply("wipe", 0.5, false, label, box).strokes;
  check(w.at(-1).role === "accent" && near(w.at(-1).pts[0][0], 0), "wipe edge is at the middle at .5");
  check(Math.max(...I.apply("slide", 0.6, false, label, box).strokes.flatMap((s) => s.pts.map((q) => Math.abs(q[0])))) <= box.w + 1e-9, "slide stays within the box");
}

// the resampler
{
  const pl = [[0, 0], [1, 0], [1, 1], [3, 1]];
  const L = I.polylineLength(pl);
  for (const n of [2, 3, 7, 50, 200]) {
    const r = I.resample(pl, n);
    check(r.length === n && near(r[0][0], 0) && near(r[0][1], 0) && near(r[n - 1][0], 3) && near(r[n - 1][1], 1), `resample ${n} keeps endpoints`);
    check(near(I.polylineLength(r), L, n < 8 ? L : 0.05) && I.polylineLength(r) <= L + 1e-9, `resample ${n} length`);
  }
  const r = I.resample(pl, 41);
  const d = r.slice(1).map((q, i) => Math.hypot(q[0] - r[i][0], q[1] - r[i][1]));
  check(Math.max(...d) - Math.min(...d) < 0.06, "resample spacing is even");
  check(I.resample([[2, 3]], 4).every((q) => q[0] === 2 && q[1] === 3), "resample of a point repeats it");
  const c = I.resample(ring(1, 64), 30, true);
  check(near(c[0][0], c[29][0]) && near(I.polylineLength(c), I.polylineLength(ring(1, 64), true), 0.1), "closed resample returns to its start");
}

// morph reaches both ends and moves between them
{
  const m0 = I.apply("morph", 0, false, label, box, face);
  check(m0.alpha === 1 && same(m0.strokes, face), "morph p=0 is the from drawing");
  const mid = I.apply("morph", 0.5, false, label, box, face);
  check(mid.strokes.length > 0 && mid.alpha === 1, "morph mid has strokes");
  const alone = I.apply("morph", 0.5, false, label, box);
  check(alone.strokes.length > 0, "morph without from grows from a dot");
  const t = I.align({ x: Float64Array.from([0, 1, 2, 3]), y: new Float64Array(4) }, { x: Float64Array.from([2, 3, 0, 1]), y: new Float64Array(4) });
  check(t.start === 2 && !t.rev, "align finds the cyclic shift");
  check(I.faceStrokes({ head: ring(1), left: ring(0.1), right: ring(0.1) }, 0.5).length === 3, "faceStrokes makes 3 strokes");
  check(I.faceAlpha("morph", 0.3) === 0 && I.faceAlpha("morph", 0) === 1 && I.faceAlpha("fade", 0.5) > 0 && I.faceAlpha("fade", 1) === 0, "faceAlpha");
}

// condense for the scope: one path through random points that closes onto the drawing
{
  const L = (p) => I.apply("condense", p, false, label, box, null, { lines: true });
  const early = L(0.05), mid = L(0.5);
  check(early.strokes.length === label.length && early.strokes.every((s) => !s.closed), "condense lines: an open stroke per stroke");
  check(finite(early.strokes) && finite(mid.strokes), "condense lines: no NaN");
  const pts = early.strokes.reduce((a, s) => a + s.pts.length, 0);
  check(early.strokes.every((s) => s.pts.length % 2 === 0) && pts >= 200, "condense lines: a grain per pair of points");
  // Nearly settled, each stroke ends where the drawing's does: no solid joins between them.
  const late = L(0.97).strokes;
  check(late.every((s, i) => { const e = label[i].closed ? label[i].pts[0] : label[i].pts.at(-1); return Math.hypot(s.pts.at(-1)[0] - e[0], s.pts.at(-1)[1] - e[1]) < 0.05; }),
    "condense lines: strokes end where the drawing's do");
  check(len(early.strokes) > len(mid.strokes) * 1.5, "condense lines: long random lines early, shorter as it gathers");
  check(L(1).strokes === label, "condense lines: done is the drawing itself");
  check(I.apply("condense", 0.5, false, label, box).strokes.length > 10, "condense without lines is still dots");
}

// perf: no style takes real time per frame on a busy screen
{
  const busy = [];
  for (let i = 0; i < 40; i++) busy.push(...S.text("Hello 12:30", 0.1, 0, -1 + i * 0.05));
  const pts = busy.reduce((a, s) => a + s.pts.length, 0);
  for (const st of I.STYLES) {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) I.apply(st, 0.3 + (i % 5) * 0.1, false, busy, box, face, i % 2 ? { lines: true } : null);
    const ms = (performance.now() - t0) / 100;
    check(ms < 6, `${st}: ${ms.toFixed(2)} ms/frame on ${pts} points`);
  }
}

console.log(`intros: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
