// Pictures as strokes (alfie-svg.js): the XML reader, transforms, the basic
// shapes, paint, and fitting to a box. Run by ./dev test under node.
import * as P from "../custom_components/alfie/frontend/alfie-svg.js";

let failures = 0, checks = 0;
function ok(v, what) { checks++; if (!v) { failures++; console.error(`FAIL ${what}`); } }
function near(a, b, what, tol = 1e-6) {
  checks++;
  if (!(Math.abs(a - b) <= tol)) { failures++; console.error(`FAIL ${what}: got ${a}, want ${b}`); }
}

// The reader: nesting, self-closing tags, entities, comments, a prolog.
{
  const t = P.parseXml(`<?xml version="1.0"?><!-- hi --><svg:svg viewBox='0 0 10 10'><g id="a&amp;b"><path d="M0 0"/></g><circle r="1"></circle></svg:svg>`);
  ok(t && t.name === "svg" && t.attrs.viewBox === "0 0 10 10", "root svg");
  ok(t.children.length === 2 && t.children[0].attrs.id === "a&b", "children and entities");
  ok(t.children[0].children[0].name === "path", "self-closing child");
  ok(P.parseXml("<html/>") === null, "no svg");
}

// Transforms compose left to right, as SVG does.
{
  const m = P.parseTransform("translate(10, 20) scale(2) rotate(90)");
  const at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const [x, y] = at(1, 0);
  near(x, 10, "rotate then scale then translate x"); near(y, 22, "… y");
  const r = P.parseTransform("rotate(180 5 5)");
  near(r[4], 10, "rotate about a point"); near(r[5], 10, "rotate about a point y");
}

// Shapes and paint: filled shapes close, stroke-only lines stay open, hidden
// and unpainted ones go, own colours are kept, bounds include transforms.
{
  const svg = `<svg viewBox="0 0 100 100">
    <rect x="10" y="10" width="20" height="10" style="fill:#f00"/>
    <polyline points="0,0 50,50 100,0" style="fill:none;stroke:#0f0"/>
    <circle cx="50" cy="50" r="10" style="fill:none;stroke:none"/>
    <g style="display:none"><rect width="5" height="5"/></g>
    <g transform="translate(100 100)"><ellipse rx="10" ry="5"/></g>
  </svg>`;
  const pic = P.pictureContours(svg);
  ok(pic.contours.length === 3, `three contours (got ${pic.contours.length})`);
  const [rect, line, ell] = pic.contours;
  ok(rect.closed && rect.filled && rect.color === "#f00", "filled rect closed, own colour");
  ok(!line.closed && !line.filled && line.color === "#0f0", "stroked polyline open");
  ok(ell.filled && ell.color === "black", "default fill is black");
  near(pic.bounds[0], 0, "bounds x0"); near(pic.bounds[2], 110, "bounds x1 (ellipse moved)", 1e-3);
  near(pic.bounds[3], 105, "bounds y1", 1e-3);
  // A rounded rect stays inside its box.
  const rr = P.pictureContours(`<svg><rect x="0" y="0" width="10" height="10" rx="3"/></svg>`);
  ok(rr.contours.length === 1 && rr.contours[0].pts.length > 8, "rounded rect has arcs");
  ok(rr.bounds.every((v) => v >= -1e-9 && v <= 10 + 1e-9), "rounded rect inside");
}

// Fitting: contain keeps the aspect and fills the box's short side, y up;
// stretch fills both; colours by role unless own; fill groups per shape.
{
  const pic = P.pictureContours(`<svg viewBox="0 0 200 100"><rect width="200" height="100" style="fill:#123"/><rect x="0" y="0" width="10" height="10"/></svg>`);
  const bb = (ss) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of ss) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, x1, y0, y1 };
  };
  const c = P.fitContours(pic, 1, 1, {});
  const b = bb(c);
  near(b.x1, 1, "contain fills width"); near(b.y1, 0.5, "contain keeps aspect");
  ok(c.every((s) => s.role === "line" && !s.color), "role colour by default");
  // The small square sits top left in the SVG: top left in the box too (y up).
  const sq = bb([c[1]]);
  ok(sq.x0 < -0.9 && sq.y1 > 0.45, "y flips up");
  const s = bb(P.fitContours(pic, 1, 1, { fit: "stretch" }));
  near(s.y1, 1, "stretch fills height");
  const own = P.fitContours(pic, 1, 1, { own: true, fill: "soft" });
  ok(own[0].color === "#123" && own[0].solid === 0.3 && own[0].group !== own[1].group, "own colours, a fill group per shape");
  const r = bb(P.fitContours(pic, 1, 1, { rotation: 90 }));
  near(r.y1, 1, "rotated picture refits");
  const big = P.pictureContours(`<svg viewBox="0 0 100 100">${Array.from({ length: 50 }, (_, i) => `<circle cx="${i * 2}" cy="50" r="${i < 5 ? 0.1 : 20}"/>`).join("")}</svg>`, 2);
  const under = P.fitContours(big, 1, 1, { budget: 1000 });
  ok(under.reduce((n, k) => n + k.pts.length, 0) <= 1100, "point budget kept");
}

console.log(`svg: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
