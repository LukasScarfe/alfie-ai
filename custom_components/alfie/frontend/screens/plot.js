// Plot: 1 to 6 history series on one shared value axis, ported from xy's
// `_two_lines` (plants, temp_week) and generalised. Shape, not colour, tells
// the lines apart: a marker ends each one, and a line may be dotted. The
// provider ("history") sends bucketed series; everything here is cheap layout
// that is cached on `memo` until data, options or the box change.
const MARKERS = ["ring", "diamond", "square", "house", "sun"];
const list = (s) => String(s ?? "").split(",").map((x) => x.trim());

// xy `_labels`: nudge label heights apart so none sit closer than `gap`,
// keeping order and staying near their line's end. Generalised to N by
// relaxing until stable (the order never changes, so it terminates quickly).
export function spread(ys, gap) {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
  const out = [...ys];
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (let k = 0; k + 1 < order.length; k++) {
      const a = order[k], b = order[k + 1];
      if (out[b] - out[a] < gap - 1e-9) {
        const mid = (out[a] + out[b]) / 2;
        out[a] = mid - gap / 2; out[b] = mid + gap / 2; moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

function placeholder({ w, h, options, S }) {
  const word = S.title(options.title) || "Plot";
  const ht = Math.min(0.3, h * 0.4, (2 * w * 0.9) / Math.max(1, S.width(word, 1)));
  return S.text(word, ht, 0, 0);
}

// Each series' live value, from the states the card already has: history is
// cached for a while, but the line's end and its readout should say what it is now.
function liveOf(rows, states, S) {
  return rows.map((r) => (r.entity_id && states?.[r.entity_id] ? S.number(states[r.entity_id].state) : null));
}

function build({ w, h, data, options: o, states, S }) {
  const rows = Array.isArray(data?.series) ? data.series.slice(0, 6) : null;
  if (!rows || !rows.length) return placeholder({ w, h, options: o, S });
  const n = rows.length;
  const labels = list(o.labels), marks = list(o.markers), styles = list(o.styles);
  const live = liveOf(rows, states, S);
  const vals = rows.map((r, i) => {
    const v = S.series(r.values, o.buckets);
    if (live[i] !== null && v.length) v[v.length - 1] = live[i];
    return v;
  });
  const names = rows.map((r, i) => S.title(labels[i] || r.name || r.entity_id || ""));
  const kinds = rows.map((_, i) => {
    const m = (marks[i] || MARKERS[i % 3]).toLowerCase();
    return m === "none" ? null : MARKERS.includes(m) ? m : MARKERS[i % 3];
  });
  const dotted = rows.map((_, i) => (styles[i] ?? styles[0] ?? "solid").toLowerCase() === "dotted");
  const unit = S.clean(o.unit || (rows.every((r) => r.unit === rows[0].unit) ? rows[0].unit : "") || "");

  // Scale the type with the box's height, so the corner box stays legible.
  const sc = Math.min(1.25, Math.max(0.25, Math.min(h / 0.85, w / 1.2)));
  const pad = 0.06 * sc, labelH = 0.075 * sc, readH = 0.11 * sc, mSize = 0.055 * sc;
  const titleText = S.title(o.title);
  const titleH = titleText ? Math.min(0.12 * sc, (2 * w * 0.9) / Math.max(1, S.width(titleText, 1))) : 0;

  // Value range.
  let [lo, hi] = S.span(vals, { pad: 0.08, minSpan: o.min_span });
  const yMin = Math.min(o.y_min, o.y_max), yMax = Math.max(o.y_min, o.y_max);
  if (o.range === "fixed") [lo, hi] = [yMin, yMax];
  else if (o.range === "reach") { lo = Math.min(lo, yMin); hi = Math.max(hi, yMax); }
  const fixedTop = o.range !== "auto";

  // Ticks: round values only, and (like xy) a fixed top is always labelled.
  let ticks = [];
  if (o.axis) {
    ticks = S.niceTicks(lo, hi, o.ticks).filter((t) => t >= lo && t <= hi);
    if (fixedTop && !ticks.includes(yMax) && yMax >= lo && yMax <= hi) {
      ticks = ticks.filter((t) => Math.abs(t - yMax) > (hi - lo) * 0.15).concat([yMax]);
    }
  }
  const tickText = ticks.map((t, i) => S.fmt(t) + (i === ticks.length - 1 ? unit : ""));
  const leftM = o.axis ? 0.08 * sc + 0.03 + Math.max(0, ...tickText.map((t) => S.width(t, labelH))) + 0.01 * sc : 0;

  // Right column: the latest values (and optionally the labels).
  const last = vals.map((v) => { for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null) return v[i]; return null; });
  const labH = 0.06 * sc;
  const readW = o.now ? Math.max(...last.map((v) => S.readoutWidth(v, readH, { decimals: o.decimals }))) : 0;
  const legW = o.legend ? Math.max(...names.map((s) => S.width(s, labH))) : 0;
  const rightM = o.now || o.legend ? Math.max(readW, legW) + 0.07 * sc : 0;

  const x0 = -w + pad + leftM;
  const cw = 2 * w - 2 * pad - leftM - rightM;
  const yTop = h - pad - (titleH ? titleH + 0.07 * sc : 0);
  const y0 = -h + pad + 0.03 * sc, ch = Math.max(0.1, yTop - y0);

  const out = [];
  if (titleH) out.push(...S.text(titleText, titleH, 0, h - pad - titleH / 2));
  if (o.axis) out.push(...S.axis(x0 - 0.05 * sc, y0, ch, lo, hi, ticks, { unit, labelH, tick: 0.03 * sc }));
  else if (fixedTop) out.push(...S.baseline(x0, y0, cw, { ticks: 0 }));

  const ends = [];
  vals.forEach((v, i) => {
    out.push(...S.curve(v, x0, y0, cw, ch, { lo, hi, weight: dotted[i] ? S.DOTTED : 1 }));
    const k = v.length - 1 - [...v].reverse().findIndex((x) => x !== null);
    const hasData = v.some((x) => x !== null);
    const f = (x) => y0 + (Math.min(Math.max(x, lo), hi) - lo) * (ch / (hi - lo));
    if (hasData && kinds[i]) {
      out.push(...S.marker(kinds[i], x0 + (v.length > 1 ? (cw * k) / (v.length - 1) : cw / 2), f(v[k]), mSize * (kinds[i] === "house" ? 1.7 : 1)));
    }
    // A series with no data still gets its readout, as `--`, so an empty chart says so.
    ends.push(hasData ? f(v[k]) : y0 + ch * (0.7 - (0.4 * i) / Math.max(1, n - 1)));
  });
  if (o.now || o.legend) {
    const gap = (o.legend ? readH + labH + 0.03 * sc : readH * 1.45);
    const ys = spread(ends, gap);
    const cx = w - pad - Math.max(readW, legW) / 2;
    ys.forEach((y, i) => {
      if (o.now) out.push(...S.readout(last[i], readH, cx, y + (o.legend ? labH * 0.9 : 0), { decimals: o.decimals }));
      if (o.legend) out.push(...S.text(names[i], labH, cx, y - readH * 0.75, { role: "dim" }));
    });
  }
  return out;
}

export default {
  type: "plot",
  draw(ctx) {
    const { w, h, data, options, states, memo, S } = ctx;
    // The card hands over a fresh options object each frame, so compare by value.
    const rows = Array.isArray(data?.series) ? data.series.slice(0, 6) : [];
    const key = JSON.stringify(options) + JSON.stringify(liveOf(rows, states, S));
    if (memo.data !== data || memo.key !== key || memo.w !== w || memo.h !== h || !memo.out) {
      Object.assign(memo, { data, key, w, h, out: build(ctx) });
    }
    return memo.out;
  },
};
