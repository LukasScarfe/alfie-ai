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
  draw({ w, h, data, options: o, states, S }) {
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
    const out = [];

    // One bar: S.bars draws vertical bars; horizontal ones are the same
    // points turned on their side, the first bar at the top.
    const bar = (it, i, slot, x0, y0, len, fillFrac, mapPt) => {
      const [s] = S.bars([it.v], 0, 0, slot, len, { lo, hi, fill: fillFrac });
      const low = below !== null && it.v !== null && it.v < below;
      // Without the helper's baseline legs: one shared ground line is drawn instead.
      const pts = s.pts.slice(1, -1);
      if (pts.length > 1) out.push({ ...s, pts: pts.map(([px, py]) => mapPt(px + slot * i, py)), fill: !!o.fill, role: low ? "accent" : "line" });
      return low;
    };

    if (vert) {
      const padX = 0.04 * w, x0 = -w + padX, W = 2 * w - 2 * padX, slot = W / n;
      const lblH = Math.min(0.14, slot * 0.5, h * 0.12), valH = Math.min(0.16, slot * 0.4, h * 0.14);
      const rows = (o.values ? valH * 1.6 : 0), labRow = lblH * 2;
      const top = h * 0.92 - rows, base = -h * 0.92 + labRow + lblH * 0.3, len = top - base;
      items.forEach((it, i) => {
        const low = bar(it, i, slot, x0, base, len, 0.6, (px, py) => [x0 + px, base + py]);
        const cx = x0 + slot * (i + 0.5);
        const l = fit(S, it.name, slot * 0.96, lblH, lblH * 0.7);
        out.push(...S.text(l.s, l.ht, cx, -h * 0.92 + lblH * 0.6, { role: "dim" }));
        if (o.values) {
          const frac = it.v === null ? 0 : (Math.min(Math.max(it.v, lo), hi) - lo) / (hi - lo);
          const t = S.fmt(it.v, dec) + (it.v !== null ? unit : "");
          const f = fit(S, t, slot * 0.98, valH, valH * 0.7);
          out.push(...S.text(f.s, f.ht, cx, base + frac * len + f.ht * 0.9, { role: low ? "accent" : "text" }));
        }
      });
      out.push(...S.baseline(x0, base, W, { weight: 0.5 }));   // ground line under the bars
    } else {
      const padY = 0.06 * h, Y = 2 * h - 2 * padY, slot = Y / n;
      const lblH = Math.min(0.14, slot * 0.4), valH = Math.min(0.16, slot * 0.4);
      const labW = Math.min(w * 0.6, Math.max(...items.map((it) => S.width(S.title(it.name), lblH))) + 0.06);
      const valW = o.values ? Math.min(w * 0.4, Math.max(...items.map((it) => S.width(S.fmt(it.v, dec) + unit, valH))) + 0.06) : 0;
      const bx = -w + 0.04 * w + labW, len = 2 * w * 0.96 - labW - valW - 0.04 * w;
      const topY = h - padY;
      items.forEach((it, i) => {
        // Bar i: vertical points (x along the stack, y up the bar) become (y along, -x down).
        const low = bar(it, i, slot, bx, topY, len, 0.6, (px, py) => [bx + py, topY - px]);
        const cy = topY - slot * (i + 0.5);
        const l = fit(S, it.name, labW - 0.04, lblH, lblH * 0.7);
        out.push(...S.text(l.s, l.ht, -w + 0.04 * w + labW - 0.04 - S.width(l.s, l.ht) / 2, cy, { role: "dim" }));
        if (o.values) {
          const t = S.fmt(it.v, dec) + (it.v !== null ? unit : "");
          const f = fit(S, t, valW, valH, valH * 0.7);
          out.push(...S.text(f.s, f.ht, w * 0.96 - S.width(f.s, f.ht) / 2, cy, { role: low ? "accent" : "text" }));
        }
      });
      out.push(S.stroke([[bx, topY], [bx, topY - Y]], { w: 0.5 }));   // ground line left of the bars
    }
    return out;
  },
};
