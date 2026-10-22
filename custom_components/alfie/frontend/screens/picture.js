// An uploaded SVG (Screens → Pictures), drawn in Alfie's line style: filled
// shapes as their outlines, stroked ones as their lines (alfie-svg.js). The
// SVG comes as data from the picture provider; it is parsed and flattened
// once per file and detail (memo), then fitted to the box when that changes,
// never per frame. A caption, if any, goes underneath.
const V = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const P = await import(`../alfie-svg.js${V}`);

const CAP = 0.16;     // caption cap height, face units, at Text size 1
const GAP = 0.7;      // caption to picture, in cap heights

export default {
  type: "picture",
  draw({ w, h, data, options: o, memo, S }) {
    const svg = data?.svg;
    // Elements: the picture, and the caption in a band under it; either can
    // have a box of its own, and the picture takes the whole screen without
    // the caption in its way.
    const L = S.layout(w, h, o.layout);
    memo.boxes = L.boxes;
    const caption = L.show("caption") ? S.title(o.caption ?? "") : "";
    const ch = caption ? CAP * (Number(o.text_size) || 1) * L.size("caption") : 0;
    const out = [];
    let pbox = S.rect(-w, -h, w, h);
    if (caption) {
      const room = ch * (1 + GAP);
      if (L.flow("caption")) {
        const ph = Math.max(h * 0.3, h - room / 2 - ch / 2);
        pbox = S.rect(-w, h - 2 * ph, w, h);
      }
      const B = L.box("caption", S.rect(-w * 0.97, -h, w * 0.97, -h + ch));
      out.push(...S.fitText(caption, B, L.own("caption") ? B.h * Math.min(1, L.size("caption")) : ch, { align: L.align("caption") }));
    }
    if (!L.show("picture")) return out;
    const P_ = L.box("picture", pbox);
    if (!svg) {
      if (!caption) out.push(...S.text(o.picture ? "Picture" : "No picture", 0.2, P_.cx, P_.cy, { role: "dim" }));
      return out;
    }
    const detail = Number(o.detail) || 1;
    if (memo.svg !== svg || memo.detail !== detail) {
      memo.svg = svg; memo.detail = detail;
      memo.pic = P.pictureContours(svg, detail);
      memo.key = null;
    }
    const key = [P_.x0, P_.y0, P_.x1, P_.y1, o.fit, o.scale, o.rotation, o.color, o.fill, o.weight, o.max_points].join("|");
    if (memo.key !== key) {
      memo.key = key;
      memo.strokes = P.fitContours(memo.pic, (P_.w / 2) * 0.96, (P_.h / 2) * 0.96, {
        fit: o.fit, scale: o.scale, rotation: o.rotation, fill: o.fill, weight: o.weight,
        budget: o.max_points, own: o.color === "own", role: o.color === "own" ? "line" : o.color,
      });
      if (P_.cx || P_.cy) for (const st of memo.strokes) st.pts = st.pts.map(([x, y]) => [x + P_.cx, y + P_.cy]);
    }
    return out.length ? out.concat(memo.strokes) : memo.strokes;
  },
};
