// N entities as bars (the xy `bars` helper), vertical or horizontal, with
// labels, value labels, a highlight below a threshold and a sort.
const pick = (v, d, key) => (v && Object.keys(v).length ? v : d?.[key] ?? {});

// `s` at the largest height <= hMax that fits maxW; below hMin it is cut short.
function fit(S, s, maxW, hMax, hMin) {
  s = S.title(s);
  let ht = hMax;
  if (S.width(s, ht) > maxW) ht = Math.max(hMin, maxW / S.width(s, 1));
  while (s.length > 1 && S.width(s, ht) > maxW) s = s.slice(0, -1).trimEnd();
  return { s, ht };
}

export default {
  type: "bars",
  draw({ w, h, data, options: o, states, memo, S }) {
    states = pick(states, data, "states");
    const ids = o.entities || [];
    if (!ids.length) return S.text("Bars", Math.min(0.3, h * 0.5), 0, 0, { role: "dim" });
    const given = String(o.labels || "").split(",").map((x) => x.trim());
    let items = ids.map((id, i) => {
      const st = states[id];
      return {
        v: st ? S.number(st.state) : null,
        name: given[i] || st?.attributes?.friendly_name || id.split(".")[1].replace(/_/g, " "),
      };
    });
    if (o.sort !== "none") {
      const key = (it) => (it.v === null ? -Infinity : it.v);
      items.sort((a, b) => (o.sort === "ascending" ? key(a) - key(b) : key(b) - key(a)));
    }
    let lo = Number(o.min), hi = Number(o.max);
    if (o.range === "auto") {
      const vals = items.map((i) => i.v).filter((v) => v !== null);
      lo = Math.min(0, ...vals);
      hi = vals.length ? Math.max(...vals, lo + 1e-6) : 1;
      if (hi <= lo) hi = lo + 1;
    }
    if (!(hi > lo)) hi = lo + 1;
    const unit = S.unitOf(o.unit, states[ids[0]]?.attributes?.unit_of_measurement);
    const dec = Math.max(0, Math.min(3, Number(o.decimals) || 0));
    const below = S.number(o.highlight_below);
    const n = items.length, vert = o.direction !== "horizontal";
    const ts = Number(o.text_size) || 1;   // the Text size option
    const out = [];
    // Elements: title, bars, labels (the names) and values. Auto: the title on
    // top, the names under the bars (or left of them), the values on their
    // tops (or right of them). Names or values in a box of their own spread
    // across it, a slot per bar; the bars in one take the names and values along.
    const L = S.layout(w, h, o.layout);
    if (memo) memo.boxes = L.boxes;
    const title = L.show("title") ? S.title(o.title || "") : "";
    let H = h;   // the top of the room the bars and their text share
    if (title) {
      const th = Math.min(0.14 * ts * L.size("title"), h * 0.2);
      const B = L.box("title", S.rect(-w * 0.96, h * 0.96 - th, w * 0.96, h * 0.96));
      out.push(...S.fitText(title, B, L.own("title") ? B.h * Math.min(1, L.size("title")) : th, { align: L.align("title") }));
      if (L.flow("title")) H = h - th * 1.5;
    }
    const showLab = L.show("labels"), showVal = o.values && L.show("values");
    const labIn = showLab && L.flow("labels"), valIn = showVal && L.flow("values");
    const sl = L.size("labels"), sv = L.size("values");

    // One bar: S.bars draws vertical bars; horizontal ones are the same
    // points turned on their side, the first bar at the top.
    const bar = (it, i, slot, len, fillFrac, mapPt) => {
      const [s] = S.bars([it.v], 0, 0, slot, len, { lo, hi, fill: fillFrac });
      const low = below !== null && it.v !== null && it.v < below;
      // Without the helper's baseline legs: one shared ground line is drawn instead.
      const pts = s.pts.slice(1, -1);
      if (pts.length > 1 && L.show("bars")) out.push({ ...s, pts: pts.map(([px, py]) => mapPt(px + slot * i, py)), fill: !!o.fill, role: low ? "accent" : "line" });
      return low;
    };
    const frac = (it) => (it.v === null ? 0 : (Math.min(Math.max(it.v, lo), hi) - lo) / (hi - lo));
    const valText = (it) => S.fmt(it.v, dec) + (it.v !== null ? unit : "");
    // A row (or column) of text in a box of its own: a slot per bar.
    const slots = (B, k) => (vert ? S.rect(B.x0 + (B.w * k) / n, B.y0, B.x0 + (B.w * (k + 1)) / n, B.y1) : S.rect(B.x0, B.y1 - (B.h * (k + 1)) / n, B.x1, B.y1 - (B.h * k) / n));

    if (vert) {
      const padX = 0.04 * w, slot0 = (2 * w - 2 * padX) / n;
      const lblH = Math.min(0.14, slot0 * 0.5, h * 0.12) * ts * sl, valH = Math.min(0.16, slot0 * 0.4, h * 0.14) * ts * sv;
      const rows = (valIn ? valH * 1.6 : 0), labRow = labIn ? lblH * 2 : 0;
      const autoB = S.rect(-w + padX, -h * 0.92 + labRow + (labIn ? lblH * 0.3 : 0), w - padX, H * 0.92 + (H - h) * 0.08 - rows);
      // Bars in a box of their own keep their names and values inside it.
      const own = L.box("bars", autoB), B = L.own("bars") ? S.rect(own.x0, own.y0 + labRow + (labIn ? lblH * 0.3 : 0), own.x1, own.y1 - rows) : own;
      const x0 = B.x0, W = B.w, slot = W / n, base = B.y0, len = B.h;
      items.forEach((it, i) => {
        const low = bar(it, i, slot, len, 0.6, (px, py) => [x0 + px, base + py]);
        const cx = x0 + slot * (i + 0.5);
        if (labIn) {
          const l = fit(S, it.name, slot * 0.96, lblH, lblH * 0.7);
          out.push(...S.text(l.s, l.ht, cx, base - lblH * 0.3 - lblH * 1.4, { role: "dim" }));
        }
        if (valIn) {
          const f = fit(S, valText(it), slot * 0.98, valH, valH * 0.7);
          out.push(...S.text(f.s, f.ht, cx, base + frac(it) * len + f.ht * 0.9, { role: low ? "accent" : "text" }));
        }
        it.low = low;
      });
      if (labIn) L.box("labels", S.rect(x0, base - lblH * 2.3, x0 + W, base - lblH * 0.3));
      if (valIn) L.box("values", S.rect(x0, base, x0 + W, base + len + valH * 1.6));
      if (L.show("bars")) out.push(...S.baseline(x0, base, W, { weight: 0.5 }));   // ground line under the bars
    } else {
      const padY = 0.06 * h, slot0 = (h + H - 2 * padY) / n;
      const lblH = Math.min(0.14, slot0 * 0.4) * ts * sl, valH = Math.min(0.16, slot0 * 0.4) * ts * sv;
      const labW = labIn ? Math.min(w * 0.6, Math.max(...items.map((it) => S.width(S.title(it.name), lblH))) + 0.06) : 0;
      const valW = valIn ? Math.min(w * 0.4, Math.max(...items.map((it) => S.width(valText(it), valH))) + 0.06) : 0;
      const autoB = S.rect(-w + 0.04 * w + labW, -h + padY, -w + 0.04 * w + labW + 2 * w * 0.96 - labW - valW - 0.04 * w, H - padY);
      const own = L.box("bars", autoB), B = L.own("bars") ? S.rect(own.x0 + labW, own.y0, own.x1 - valW - 0.04 * w, own.y1) : own;
      const bx = B.x0, len = B.w, topY = B.y1, slot = B.h / n;
      items.forEach((it, i) => {
        // Bar i: vertical points (x along the stack, y up the bar) become (y along, -x down).
        const low = bar(it, i, slot, len, 0.6, (px, py) => [bx + py, topY - px]);
        const cy = topY - slot * (i + 0.5);
        if (labIn) {
          const l = fit(S, it.name, labW - 0.04, lblH, lblH * 0.7);
          out.push(...S.text(l.s, l.ht, bx - 0.04 - S.width(l.s, l.ht) / 2, cy, { role: "dim" }));
        }
        if (valIn) {
          const f = fit(S, valText(it), valW, valH, valH * 0.7);
          out.push(...S.text(f.s, f.ht, B.x1 + valW + 0.04 * w - S.width(f.s, f.ht) / 2, cy, { role: low ? "accent" : "text" }));
        }
        it.low = low;
      });
      if (labIn) L.box("labels", S.rect(bx - labW, B.y0, bx, B.y1));
      if (valIn) L.box("values", S.rect(B.x1, B.y0, B.x1 + valW + 0.04 * w, B.y1));
      if (L.show("bars")) out.push(S.stroke([[bx, topY], [bx, topY - B.h]], { w: 0.5 }));   // ground line left of the bars
    }
    if (showLab && !labIn) {
      const B = L.box("labels", null), al = L.align("labels", vert ? "centre" : "right");
      items.forEach((it, i) => out.push(...S.fitText(S.title(it.name), S.inset(slots(B, i), 0.01), (vert ? B.h : B.h / n) * 0.7 * sl, { role: "dim", align: al })));
    }
    if (showVal && !valIn) {
      const B = L.box("values", null), al = L.align("values", vert ? "centre" : "left");
      items.forEach((it, i) => out.push(...S.fitText(valText(it), S.inset(slots(B, i), 0.01), (vert ? B.h : B.h / n) * 0.7 * sv, { role: it.low ? "accent" : "text", align: al })));
    }
    return out;
  },
};
