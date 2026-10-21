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
    const caption = S.title(o.caption ?? "");
    const ch = caption ? CAP * (Number(o.text_size) || 1) : 0;
    const out = [];
    let ph = h, py = 0;
    if (caption) {
      const room = ch * (1 + GAP);
      ph = Math.max(h * 0.3, h - room / 2 - ch / 2);
      py = h - ph;
      let size = ch;
      while (size > 0.03 && S.width(caption, size) > 2 * w * 0.94) size *= 0.9;
      out.push(...S.text(caption, size, 0, -h + ch / 2));
    }
    if (!svg) {
      if (!caption) out.push(...S.text(o.picture ? "Picture" : "No picture", 0.2, 0, 0, { role: "dim" }));
      return out;
    }
    const detail = Number(o.detail) || 1;
    if (memo.svg !== svg || memo.detail !== detail) {
      memo.svg = svg; memo.detail = detail;
      memo.pic = P.pictureContours(svg, detail);
      memo.key = null;
    }
    const key = [w, ph, py, o.fit, o.scale, o.rotation, o.color, o.fill, o.weight, o.max_points].join("|");
    if (memo.key !== key) {
      memo.key = key;
      memo.strokes = P.fitContours(memo.pic, w * 0.96, ph * 0.96, {
        fit: o.fit, scale: o.scale, rotation: o.rotation, fill: o.fill, weight: o.weight,
        budget: o.max_points, own: o.color === "own", role: o.color === "own" ? "line" : o.color,
      });
      if (py) for (const st of memo.strokes) st.pts = st.pts.map(([x, y]) => [x, y + py]);
    }
    return out.length ? out.concat(memo.strokes) : memo.strokes;
  },
};
