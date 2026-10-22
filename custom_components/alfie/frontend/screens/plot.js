// Plot: 1 to 6 history series on one shared value axis, ported from xy's
// `_two_lines` (plants, temp_week) and generalised. Shape, not colour, tells
// the lines apart: a marker ends each one, and a line may be dotted. The
// provider ("history") sends bucketed series; everything here is cheap layout
// that is cached on `memo` until data, options or the box change.
//
// Elements (the Layout option): title, plot (the lines), value_axis,
// time_axis, readouts (the latest values) and legend (the series labels).
// Auto: the title on top, the readouts in a column on the right following the
// lines' ends with the labels under them, the axes against the lines. A
// value or time axis in a box of its own spans that box; readouts or labels
// in one become a list, a marker on each row.
const DEFAULT_MARKS = ["ring", "diamond", "square"];
const WEIGHTS = { thin: 0.5, normal: 1, thick: 1.6, bold: 2.4 };
const MARK_SIZES = { small: 0.7, normal: 1, large: 1.4, huge: 2 };
const STEPS = { "1h": 3600, "2h": 7200, "3h": 10800, "6h": 21600, "12h": 43200, "1d": 86400, "2d": 172800, "7d": 604800, "14d": 1209600, "30d": 2592000 };
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

// The value ticks the options ask for, inside lo..hi.
export function valueTicks(o, lo, hi, room, S) {
  let ticks;
  if (o.value_ticks === "list") {
    ticks = list(o.tick_list).map(S.number).filter((v) => v !== null);
  } else if (o.value_ticks === "step" && Number(o.tick_step) > 0) {
    const step = Number(o.tick_step);
    ticks = [];
    for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9 && ticks.length < 50; k++) ticks.push(Number((k * step).toFixed(10)));
  } else {
    const most = o.value_ticks === "count" ? Math.round(Number(o.tick_count) || 4) : room;
    ticks = S.niceTicks(lo, hi, most, { fine: true });
  }
  return [...new Set(ticks)].filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9).sort((a, b) => a - b);
}

// Seconds east of UTC in `tz` at epoch second `t`.
function tzOffset(t, tz) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    const p = Object.fromEntries(f.formatToParts(new Date(t * 1000)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) / 1000 - Math.floor(t);
  } catch (_) { return 0; }
}

// Round times between start and end (local), `step` seconds apart, and their labels.
export function timeTicks(start, end, step, fmt, tz) {
  const off = tzOffset(start, tz), out = [];
  for (let k = Math.ceil((start + off) / step); k * step - off <= end && out.length < 60; k++) out.push(k * step - off);
  const auto = fmt === "auto";
  if (auto) fmt = step < 86400 ? "hour" : end - start <= 8 * 86400 ? "weekday" : "date";
  const opts = { hour: { hour: "2-digit", hourCycle: "h23" }, time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    weekday: { weekday: "short" }, day: { day: "numeric" }, date: { day: "numeric", month: "short" } }[fmt];
  let f = null;
  let day = null;
  if (opts) try { f = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz || undefined }); } catch (_) { f = null; }
  if (auto && fmt === "hour") try { day = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: tz || undefined }); } catch (_) { day = null; }
  const label = (t) => {
    if (fmt === "none") return "";
    if (fmt === "relative" || !f) {
      const d = end - t;
      if (d < 60) return "now";
      return d < 86400 * 2 && step < 86400 ? `-${Math.round(d / 3600)}h` : `-${Math.round(d / 86400)}d`;
    }
    const s = f.format(new Date(t * 1000));
    // On an hourly axis, midnight names the day it starts.
    return fmt === "hour" && s === "00" && day ? day.format(new Date(t * 1000)) : s;
  };
  return out.map((t) => [t, label(t)]);
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

// A tick mark at (x, y) along a direction (dx, dy) pointing away from the plot.
function mark(kind, x, y, dx, dy, len) {
  if (kind === "none") return [];
  const a = kind === "in" ? 0 : 1, b = kind === "out" ? 0 : 1;
  return [[x - dx * len * b, y - dy * len * b], [x + dx * len * a, y + dy * len * a]];
}

function build(ctx) {
  const { w, h, data, options: o, states, config, S } = ctx;
  const rows = Array.isArray(data?.series) ? data.series.slice(0, 6) : null;
  if (!rows || !rows.length) return { out: placeholder(ctx), boxes: {} };
  const L = S.layout(w, h, o.layout);
  const n = rows.length;
  const labels = list(o.labels), marks = list(o.markers), styles = list(o.styles), weights = list(o.weights), msizes = list(o.marker_sizes);
  const live = liveOf(rows, states, S);
  const vals = rows.map((r, i) => {
    const v = S.series(r.values);
    if (live[i] !== null && v.length) v[v.length - 1] = live[i];
    return v;
  });
  const names = rows.map((r, i) => S.title(labels[i] || r.name || r.entity_id || ""));
  const kinds = rows.map((_, i) => {
    const m = marks[i] || DEFAULT_MARKS[i % 3];
    if (S.isIcon(m)) return m;   // an icon such as mdi:account
    const k = m.toLowerCase();
    return k === "none" ? null : S.MARKER_SHAPES.includes(k) ? k : DEFAULT_MARKS[i % 3];
  });
  const dotted = rows.map((_, i) => (styles[i] || "solid").toLowerCase() === "dotted");
  const weight = rows.map((_, i) => (dotted[i] ? S.DOTTED : WEIGHTS[(weights[i] || "normal").toLowerCase()] ?? 1));
  const unit = S.clean(S.unitOf(o.unit, rows.every((r) => r.unit === rows[0].unit) ? rows[0].unit : ""));

  // Scale the type with the box's height, so the corner box stays legible.
  const sc = Math.min(1.25, Math.max(0.25, Math.min(h / 0.85, w / 1.2)));
  const ts = Number(o.text_size) || 1;   // the Text size option scales every height of text
  const pad = 0.06 * sc, mSize = 0.055 * sc;
  const msize = rows.map((_, i) => mSize * (MARK_SIZES[(msizes[i] || "normal").toLowerCase()] ?? 1) * (kinds[i] === "house" ? 1.7 : 1));
  const labelH = 0.075 * sc * ts * L.size("value_axis"), timeH = 0.068 * sc * ts * L.size("time_axis");
  const readH = 0.11 * sc * ts * L.size("readouts"), labH = 0.06 * sc * ts * L.size("legend");
  const area = S.rect(-w + pad, -h + pad, w - pad, h - pad);
  const out = [];

  // Title: a band on top.
  const titleText = S.title(o.title);
  let top = area.y1;
  if (titleText && L.show("title")) {
    const th = Math.min(0.12 * sc * ts * L.size("title"), (2 * w * 0.9) / Math.max(1, S.width(titleText, 1)));
    const B = L.box("title", S.rect(area.x0, area.y1 - th, area.x1, area.y1));
    if (L.flow("title")) top = area.y1 - th - 0.07 * sc;
    // In a box of its own the title fills it (Size scales it down from there).
    out.push(...S.fitText(titleText, B, L.own("title") ? B.h * Math.min(1, L.size("title")) : th, { align: L.align("title") }));
  }

  // Value range.
  let [lo, hi] = S.span(vals, { pad: 0.08, minSpan: o.min_span });
  const yMin = Math.min(o.y_min, o.y_max), yMax = Math.max(o.y_min, o.y_max);
  if (o.range === "fixed") [lo, hi] = [yMin, yMax];
  else if (o.range === "reach") { lo = Math.min(lo, yMin); hi = Math.max(hi, yMax); }
  const fixedTop = o.range !== "auto";

  // Ticks: round values only, and (like xy) a fixed top is always labelled.
  const axisOn = o.axis && L.show("value_axis");
  let ticks = [];
  if (o.axis) {
    // Auto: 3, or 4 on a tall plot (more as it grows); 2 when there is little room.
    const room = Math.max(2, Math.min(8, Math.floor((top - area.y0) / (labelH * 3.5))));
    ticks = valueTicks(o, lo, hi, room, S);
    if (o.value_ticks === "auto" && fixedTop && !ticks.includes(yMax) && yMax >= lo && yMax <= hi) {
      ticks = ticks.filter((t) => Math.abs(t - yMax) > (hi - lo) * 0.15).concat([yMax]);
    }
  }
  const dec = o.tick_decimals === "auto" || o.tick_decimals === undefined ? S.tickDecimals(ticks) : Number(o.tick_decimals);
  const tickText = ticks.map((t, i) => S.fmt(t, dec) + (o.tick_unit === "every" || (o.tick_unit !== "none" && i === ticks.length - 1) ? unit : ""));
  const tickLen = 0.03 * sc;
  const axisW = Math.max(0, ...tickText.map((t) => S.width(t, labelH))) + tickLen + 0.03 + 0.01 * sc;
  const sides = o.axis_side === "both" ? ["left", "right"] : [o.axis_side === "right" ? "right" : "left"];
  const leftM = axisOn && L.flow("value_axis") && sides.includes("left") ? axisW + 0.05 * sc : 0;
  const rightA = axisOn && sides.includes("right") && (L.flow("value_axis") || sides.length > 1) ? axisW + 0.05 * sc : 0;

  // Time axis: a band under the lines.
  const start = Number(data.start) || null, end = Number(data.end) || null;
  const timeOn = o.time_axis && L.show("time_axis") && start && end && end > start;
  const timeBand = timeOn && L.flow("time_axis") ? tickLen + timeH * (o.time_format === "none" ? 0.5 : 1.7) : 0;

  // Right column: the latest values (and the labels) beside the lines' ends.
  const last = vals.map((v) => { for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null) return v[i]; return null; });
  const showNow = o.now && L.show("readouts"), showLeg = o.legend && L.show("legend");
  const nowCol = showNow && L.flow("readouts"), legCol = showLeg && L.flow("legend");
  const readW = showNow ? Math.max(...last.map((v) => S.readoutWidth(v, readH, { decimals: o.decimals }))) : 0;
  const legW = showLeg ? Math.max(...names.map((s) => S.width(s, labH))) : 0;
  const colW = Math.max(nowCol ? readW : 0, legCol ? legW : 0);
  // An icon marker is wider than the built-in ones: keep it clear of the readouts.
  const iconHalf = Math.max(0, ...kinds.map((k, i) => (k && S.isIcon(k) ? (S.MARKER_ICON * msize[i]) / 2 : msize[i] / 2)));
  const rightM = (nowCol || legCol ? colW + 0.07 * sc : 0) + iconHalf;

  const auto = S.rect(area.x0 + leftM, area.y0 + 0.03 * sc + timeBand, area.x1 - rightM - rightA, top);
  const P = L.box("plot", auto.w > 0.1 && auto.h > 0.1 ? auto : S.rect(auto.x0, auto.y0, Math.max(auto.x1, auto.x0 + 0.1), Math.max(auto.y1, auto.y0 + 0.1)));
  const x0 = P.x0, cw = P.w, y0 = P.y0, ch = P.h;
  const fy = (v, r = P) => r.y0 + (Math.min(Math.max(v, lo), hi) - lo) * (r.h / (hi - lo || 1));
  const gridW = o.grid_style === "solid" ? 0.45 : S.FAINT;

  // Value axis: the line against the plot, ticks, the labels away from it.
  if (o.axis) {
    for (const side of sides) {
      const autoA = side === "left" ? S.rect(P.x0 - axisW - 0.05 * sc, P.y0, P.x0 - 0.05 * sc, P.y1) : S.rect(P.x1 + 0.05 * sc, P.y0, P.x1 + 0.05 * sc + axisW, P.y1);
      const A = side === sides[0] ? L.box("value_axis", autoA) : autoA;
      if (!axisOn) break;
      const ax = side === "left" ? A.x1 : A.x0, away = side === "left" ? -1 : 1;
      const pts = o.axis_line ? [[ax, A.y0]] : [];
      const strokes = [];
      ticks.forEach((t, i) => {
        const y = fy(t, A), m = mark(o.tick_marks, ax, y, away, 0, tickLen);
        if (o.axis_line && m.length) pts.push(m[0], m[1], [ax, y]);
        else if (m.length) strokes.push(S.stroke(m, { w: 0.5 }));
        const lw = S.width(tickText[i], labelH), off = (o.tick_marks === "out" || o.tick_marks === "cross" ? tickLen : 0) + 0.03;
        strokes.push(...S.text(tickText[i], labelH, ax + away * (off + lw / 2), y));
      });
      if (o.axis_line) { pts.push([ax, A.y1]); out.push(S.stroke(pts, { w: 0.5 })); }
      else if (fixedTop && !ticks.length) out.push(...S.baseline(x0, y0, cw, { ticks: 0 }));
      out.push(...strokes);
    }
  } else if (fixedTop) out.push(...S.baseline(x0, y0, cw, { ticks: 0 }));
  if (o.grid === "values" || o.grid === "both") {
    for (const t of ticks) out.push(S.stroke([[P.x0, fy(t)], [P.x1, fy(t)]], { w: gridW, role: "dim" }));
  }

  // Time axis: where each point sits in time (a bucket's middle), round times along it.
  const npts = Math.max(1, ...vals.map((v) => v.length));
  if (start && end && end > start && npts > 1 && (timeOn || o.grid === "times" || o.grid === "both")) {
    const bw = (end - start) / npts, t0 = start + bw / 2, t1 = end - bw / 2;
    const autoT = S.rect(P.x0, P.y0 - timeBand - 0.03 * sc, P.x1, P.y0 - 0.03 * sc);
    const T = timeOn ? L.box("time_axis", autoT) : autoT;
    const xt = (t, r) => r.x0 + (r.w * (t - t0)) / (t1 - t0);
    const lw = S.width(o.time_format === "time" ? "00:00" : o.time_format === "date" ? "22 Oct" : "Wed", timeH) * 1.8;
    let step = STEPS[o.time_step];
    if (!step) {
      const most = Math.max(2, Math.floor(T.w / Math.max(lw, 1e-6)));
      step = Object.values(STEPS).find((s) => (t1 - t0) / s <= most) ?? STEPS["30d"];
    }
    const tt = timeTicks(t0, t1, step, o.time_format || "auto", config?.time_zone).filter(([t]) => t >= t0 - 1 && t <= t1 + 1);
    if (o.grid === "times" || o.grid === "both") {
      for (const [t] of tt) out.push(S.stroke([[xt(t, P), P.y0], [xt(t, P), P.y1]], { w: gridW, role: "dim" }));
    }
    if (timeOn) {
      const by = T.y1, pts = [[T.x0, by]];
      for (const [t] of tt) {
        const m = mark(o.time_marks, xt(t, T), by, 0, -1, tickLen);
        if (m.length) pts.push([xt(t, T), by], m[0], m[1], [xt(t, T), by]);
      }
      pts.push([T.x1, by]);
      out.push(S.stroke(pts, { w: 0.5 }));
      const down = (o.time_marks === "out" || o.time_marks === "cross" ? tickLen : 0) + 0.02 * sc;
      let right = -Infinity;
      for (const [t, s] of tt) {
        if (!s) continue;
        const x = xt(t, T), half = S.width(s, timeH) / 2;
        // Keep the end labels inside the axis' box, and skip one that would touch the last.
        const cx = Math.min(Math.max(x, T.x0 + half - 0.02), T.x1 - half + 0.02);
        if (cx - half < right + timeH * 0.6) continue;
        right = cx + half;
        out.push(...S.text(s, timeH, cx, by - down - timeH / 2, { role: "dim" }));
      }
    }
  }

  // The lines, and a marker on each end.
  const ends = [];
  vals.forEach((v, i) => {
    if (L.show("plot")) out.push(...S.curve(v, x0, y0, cw, ch, { lo, hi, weight: weight[i], steps: o.shape === "steps" }));
    const k = v.length - 1 - [...v].reverse().findIndex((x) => x !== null);
    const hasData = v.some((x) => x !== null);
    if (hasData && kinds[i] && L.show("plot")) {
      out.push(...S.marker(kinds[i], x0 + (v.length > 1 ? (cw * k) / (v.length - 1) : cw / 2), fy(v[k]), msize[i]));
    }
    // A series with no data still gets its readout, as `--`, so an empty chart says so.
    ends.push(hasData ? fy(v[k]) : y0 + ch * (0.7 - (0.4 * i) / Math.max(1, n - 1)));
  });

  // The right column: readouts (and labels) spread apart beside the lines' ends.
  if (nowCol || legCol) {
    const withLab = legCol, gap = withLab ? (nowCol ? readH : 0) + labH + 0.03 * sc : readH * 1.45;
    const ys = spread(ends, gap);
    // Spread apart, they may run past the box (large Text size): slide them back in.
    const hiY = area.y1 + pad - (nowCol ? readH * 0.55 : labH * 0.55) - (withLab && nowCol ? labH * 0.9 : 0);
    const loY = area.y0 - pad + (withLab ? (nowCol ? readH * 0.75 : 0) + labH * 0.55 : readH * 0.55);
    const over = Math.max(0, ...ys) - hiY, under = loY - Math.min(...ys);
    if (over > 0) ys.forEach((_, i) => { ys[i] -= over; });
    else if (under > 0) ys.forEach((_, i) => { ys[i] += under; });
    const cx = area.x1 - colW / 2;
    const colBox = S.rect(area.x1 - colW, area.y0, area.x1, area.y1);
    if (nowCol) L.box("readouts", colBox);
    if (legCol) L.box("legend", colBox);
    ys.forEach((y, i) => {
      if (nowCol) out.push(...S.readout(last[i], readH, cx, y + (withLab ? labH * 0.9 : 0), { decimals: o.decimals }));
      if (legCol) out.push(...S.text(names[i], labH, cx, nowCol ? y - readH * 0.75 : y, { role: "dim" }));
    });
  }

  // Readouts or labels in a box of their own: a list, a marker on each row.
  const listIn = (key, text, ht, role) => {
    const B = L.box(key, null);
    const rh = Math.min(B.h / n, ht * 1.5), mw = Math.min(rh * 0.6, mSize * 1.6);
    const align = L.align(key, "left");
    for (let i = 0; i < n; i++) {
      const cy = B.y1 - rh * (i + 0.5);
      if (kinds[i]) out.push(...S.marker(kinds[i], B.x0 + mw / 2, cy, Math.min(mw, msize[i])));
      out.push(...S.fitText(text(i), S.rect(B.x0 + mw * 1.6, cy - rh / 2, B.x1, cy + rh / 2), ht, { align, role }));
    }
  };
  const legInRow = showLeg && !legCol && !L.own("legend");
  if (showNow && L.own("readouts")) {
    listIn("readouts", (i) => S.fmt(last[i], o.decimals) + (legInRow ? ` ${names[i]}` : ""), readH, "text");
  }
  if (showLeg && L.own("legend")) listIn("legend", (i) => names[i], labH, "dim");

  return { out, boxes: L.boxes };
}

export default {
  type: "plot",
  draw(ctx) {
    const { w, h, data, options, states, memo, S } = ctx;
    // The card hands over a fresh options object each frame, so compare by value.
    const rows = Array.isArray(data?.series) ? data.series.slice(0, 6) : [];
    const key = JSON.stringify(options) + JSON.stringify(liveOf(rows, states, S)) + S.iconStamp() + (ctx.config?.time_zone || "");
    if (memo.data !== data || memo.key !== key || memo.w !== w || memo.h !== h || !memo.out) {
      const b = build(ctx);
      Object.assign(memo, { data, key, w, h, out: b.out, boxes: b.boxes });
    }
    return memo.out;
  },
};
