// Icons as strokes (alfie-icons.js): the SVG path parser and flattening.
// Run by ./dev test under node; no packages needed.
import { readFileSync } from "node:fs";
import * as A from "../custom_components/alfie/frontend/alfie-icons.js";

let failures = 0, checks = 0;
function ok(v, what) { checks++; if (!v) { failures++; console.error(`FAIL ${what}`); } }
function near(a, b, what, tol = 1e-6) {
  checks++;
  if (!(Math.abs(a - b) <= tol)) { failures++; console.error(`FAIL ${what}: got ${a}, want ${b}`); }
}
const bounds = (strokes) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s.pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
};

// The parser: implicit linetos after a moveto, packed arc flags, odd numbers.
{
  const p = A.parsePath("M1 2 3 4l.5.5-1e1,2Z");
  ok(JSON.stringify(p) === JSON.stringify([["M", [1, 2]], ["L", [3, 4]], ["l", [0.5, 0.5]], ["l", [-10, 2]], ["Z", []]]), "parsePath basics");
  const a = A.parsePath("M0 0a1 1 0 011 1");
  ok(a[1][0] === "a" && JSON.stringify(a[1][1]) === "[1,1,0,0,1,1,1]", "packed arc flags");
  ok(A.parsePath("M0 0 L garbage").length === 1, "stops at junk");
}

// A square in a 24 box fills [-1, 1] and is closed, y up.
{
  const s = A.pathStrokes("M0 0H24V24H0Z");
  ok(s.length === 1 && s[0].closed, "one closed square");
  const b = bounds(s);
  near(b.x0, -1, "square left"); near(b.x1, 1, "square right");
  near(b.y0, -1, "square bottom"); near(b.y1, 1, "square top");
  ok(s[0].pts[0][1] === 1, "SVG top is up");
}

// An arc: a circle of radius 6 about (12, 12) stays on it.
{
  const s = A.pathStrokes("M6 12A6 6 0 1 0 18 12A6 6 0 1 0 6 12Z");
  let worst = 0;
  for (const [x, y] of s[0].pts) worst = Math.max(worst, Math.abs(Math.hypot(x, y) - 0.5));
  near(worst, 0, "arc points on the circle", 1e-9);
  ok(s[0].pts.length > 16, "arc flattened to many points");
}

// A cubic's end lands exactly; S reflects the last control point.
{
  const c = A.flatten("M0 0C0 10 10 10 10 0S20 -10 20 0");
  const last = c[0].pts.at(-1);
  near(last[0], 20, "cubic end x"); near(last[1], 0, "cubic end y");
  const mid = c[0].pts.reduce((m, p) => (p[1] < m[1] ? p : m));
  ok(mid[1] < -5, "S dips below (reflected control)");
}

// Every fixture icon flattens to sane strokes inside the box.
{
  const icons = JSON.parse(readFileSync(new URL("../devenv/icons.json", import.meta.url)));
  for (const [name, d] of Object.entries(icons)) {
    const s = A.pathStrokes(d);
    const b = bounds(s);
    ok(s.length >= 1, `${name} has strokes`);
    ok(b.x0 >= -1.0001 && b.x1 <= 1.0001 && b.y0 >= -1.0001 && b.y1 <= 1.0001, `${name} inside the box`);
    ok(s.every((st) => st.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))), `${name} finite`);
  }
  const sun = A.pathStrokes(icons["mdi:white-balance-sunny"]);
  ok(sun.length >= 9, "the sun has its rays and its disc");
}

// placed() scales and moves.
{
  const s = A.placed([{ pts: [[1, 1]], closed: false }], 0.5, 2, 3);
  ok(s[0].pts[0][0] === 2.5 && s[0].pts[0][1] === 3.5, "placed");
}

// Loading: fixtures stand in for HA, names are checked.
{
  globalThis.ALFIE_ICONS = { "mdi:test": "M0 0H24V24H0Z" };
  ok(A.strokesFor("mdi:test") === null, "loading at first");
  await A.iconPath("mdi:test");
  ok(A.strokesFor("mdi:test")?.length === 1, "strokes once loaded");
  ok(A.failed("not an icon"), "a bad name fails at once");
  ok((await A.iconPath("mdi:nope")) === null && A.failed("mdi:nope"), "an unknown icon fails");
}

console.log(`icons: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
