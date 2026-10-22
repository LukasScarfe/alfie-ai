// The home clock, ported from xy-bench figures.py (_small_clock, _daylight,
// _home): an analogue clock whose rim is a solar clock (bright where the sun
// will be up when the hour hand gets there, within the next 12 hours), a
// seconds bead, and inside and outside temperature readouts with the house.
// The minute hand may reach the rim (`joined`), and then the rim and both
// hands are one line. All local time comes from HA's time zone, not the browser's, and is derived
// from `t`; nothing here touches the network or HA.
const TAU = 2 * Math.PI;
const RIM_N = 120;           // rim points for a full lap
const RIM_W = 0.7, DAY_W = 1.0, NIGHT_W = 0.35;
const JOINED_W = 0.85;      // the rim and hands as one line: between the rim's weight and a hand's

// States and config come from the draw context; the dev harness cannot feed
// them, so it falls back to data.states / data.config (never set in HA).
const pick = (v, d, key) => (v && Object.keys(v).length ? v : d?.[key] ?? {});

// Seconds to add to epoch seconds to get local wall-clock seconds in `tz`.
// Recomputed once a minute (DST), so per-frame work is plain arithmetic.
function offsetAt(t, tz) {
  const ms = Math.floor(t) * 1000;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || undefined, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    }).formatToParts(ms).map((x) => [x.type, Number(x.value)]));
    return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms) / 1000;
  } catch (_) {
    return -new Date(ms).getTimezoneOffset() * 60;
  }
}

// Today's rise and set as local hours. HA only gives the *next* ones, which
// after sunrise are tomorrow's: a minute or two off today's, so the time of
// day is what we keep. Null when unusable (polar day or night, no sun).
function daylight(sun, off) {
  const a = sun?.attributes;
  if (!a || sun.state === "unavailable" || sun.state === "unknown") return null;
  const hrs = (v) => {
    const ms = typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isFinite(ms) ? ((((ms / 1000 + off) % 86400) + 86400) % 86400) / 3600 : null;
  };
  const rise = hrs(a.next_rising), set = hrs(a.next_setting);
  return rise !== null && set !== null && rise < set ? [rise, set] : null;
}

const at = (cx, cy, r, frac) => [cx + r * Math.sin(TAU * frac), cy + r * Math.cos(TAU * frac)];

// The rim as arcs, cut where day meets night; recomputed once a minute.
function rimStrokes(S, cx, cy, r, hourNow, light) {
  const tick = 0.18 * r, q = RIM_N / 4;
  if (!light) {
    const pts = [];
    for (let i = 0; i < RIM_N; i++) {
      pts.push(at(cx, cy, r, i / RIM_N));
      if (i % q === 0) pts.push(at(cx, cy, r - tick, i / RIM_N), at(cx, cy, r, i / RIM_N));
    }
    return [S.stroke(pts, { closed: true, w: RIM_W })];
  }
  // Each point stands for the next time the hour hand reaches it.
  const isDay = (f) => {
    const h = (hourNow + ((12 * f - hourNow) % 12 + 12) % 12) % 24;
    return light[0] <= h && h < light[1];
  };
  const kinds = Array.from({ length: RIM_N }, (_, i) => isDay(i / RIM_N));
  let start = 0;
  for (let i = 0; i < RIM_N; i++) if (kinds[i] !== kinds[(i + RIM_N - 1) % RIM_N]) { start = i; break; }
  const arcs = [];
  let cur = null;
  for (let j = 0; j <= RIM_N; j++) {
    const i = (start + j) % RIM_N, p = at(cx, cy, r, i / RIM_N);
    if (cur === null || (j < RIM_N && kinds[i] !== cur.day)) {
      if (cur) { cur.pts.push(p); arcs.push(cur); }
      if (j === RIM_N) { cur = null; break; }
      cur = { day: kinds[i], pts: [] };
    }
    cur.pts.push(p);
    if (j < RIM_N && i % q === 0) cur.pts.push(at(cx, cy, r - tick, i / RIM_N), p);
  }
  if (cur) arcs.push(cur);
  if (arcs.length === 1) {
    const { day, pts } = arcs[0];
    return [S.stroke(pts.slice(0, -1), { closed: true, w: day ? DAY_W : NIGHT_W, role: day ? "line" : "dim" })];
  }
  return arcs.map(({ day, pts }) => S.stroke(pts, { w: day ? DAY_W : NIGHT_W, role: day ? "line" : "dim" }));
}

function analogue(S, cx, cy, r, lt, o, memo, sunUp) {
  const hourNow = lt.h + lt.m / 60;
  const key = `${Math.floor(lt.day)}:${lt.h}:${lt.m}:${r.toFixed(3)}:${o.solar_rim}:${sunUp ? sunUp.join() : ""}`;
  if (memo.rimKey !== key) {
    memo.rimKey = key;
    memo.rim = rimStrokes(S, 0, 0, r, hourNow, o.solar_rim ? sunUp : null);
  }
  const mv = (pts) => pts.map(([x, y]) => [x + cx, y + cy]);
  const fm = lt.m / 60 + lt.s / 3600, hour = at(cx, cy, 0.5 * r, ((lt.h % 12) + lt.m / 60) / 12);
  if (o.joined && memo.rim.length === 1) {
    // One line: round the rim from the minute hand's tip and back to it, then
    // down the minute hand and out along the hour hand.
    const rim = memo.rim[0].pts, tip = at(0, 0, r, fm);
    const frac = ([x, y]) => ((Math.atan2(x, y) / TAU) % 1 + 1) % 1;
    let k = rim.findIndex((q) => frac(q) > fm);
    if (k < 0) k = 0;
    const lap = [tip, ...rim.slice(k), ...rim.slice(0, k), tip];
    return [S.stroke([...mv(lap), [cx, cy], hour], { w: JOINED_W }), ...bead(S, cx, cy, r, lt, o)];
  }
  const out = memo.rim.map((s) => ({ ...s, pts: mv(s.pts) }));
  out.push(S.stroke([at(cx, cy, (o.joined ? 1 : 0.78) * r, fm), [cx, cy], hour]));
  out.push(...bead(S, cx, cy, r, lt, o));
  return out;
}

function bead(S, cx, cy, r, lt, o) {
  return o.seconds ? [S.stroke([at(cx, cy, r, lt.s / 60)], { role: "accent", w: 1.6 })] : [];
}

const two = (n) => String(n).padStart(2, "0");

function digital(S, cx, cy, boxW, boxH, lt, o) {
  const h = o.hours === "12" ? (lt.h % 12 || 12) : two(lt.h);
  const hm = `${h}:${two(lt.m)}`, sec = o.seconds ? `:${two(lt.s)}` : "";
  const sh = 0.55;       // seconds are set smaller than the hours and minutes
  const wid = S.width(hm, 1) + (sec ? S.width(sec, sh) + 0.15 : 0);
  // Text size below 1 shrinks it; above, it already fills its room.
  const ht = Math.min(boxH * 0.9, (boxW * 0.96) / wid) * Math.min(1, Number(o.text_size) || 1);
  const total = wid * ht, x0 = cx - total / 2;
  const out = S.text(hm, ht, x0 + (S.width(hm, ht)) / 2, cy);
  if (sec) out.push(...S.text(sec, ht * sh, x0 + S.width(hm, ht) + ht * 0.15 + S.width(sec, ht * sh) / 2, cy - ht * (1 - sh) / 2, { role: "dim" }));
  return out;
}

export default {
  type: "clock",
  draw({ w, h, t, data, options: o, states, config, memo, S }) {
    states = pick(states, data, "states");
    config = pick(config, data, "config");
    const tz = config.time_zone;
    if (memo.offMin !== Math.floor(t / 60) || memo.tz !== tz) {
      memo.offMin = Math.floor(t / 60);
      memo.tz = tz;
      memo.off = offsetAt(t, tz);
      memo.light = daylight(states["sun.sun"], memo.off);
    }
    const local = t + memo.off, secs = ((local % 86400) + 86400) % 86400;
    const lt = { day: local / 86400, h: Math.floor(secs / 3600), m: Math.floor((secs % 3600) / 60), s: secs % 60 };

    const dec = Math.max(0, Math.min(2, Number(o.decimals) || 0));
    const temp = (id) => {
      if (!id) return null;
      const st = states[id];
      const v = st ? S.number(st.state) ?? S.number(st.attributes?.temperature ?? st.attributes?.current_temperature) : null;
      return S.fmt(v, dec) + "°";
    };
    // Elements: the clock and the two readouts. Auto: the readouts beside the
    // clock (wide) or under it; one in a box of its own leaves them, and the
    // clock grows into the room.
    const L = S.layout(w, h, o.layout);
    memo.boxes = L.boxes;
    const all = [];
    if (o.inside) all.push({ key: "inside", txt: temp(o.inside), house: !!o.house });
    if (o.outside) all.push({ key: "outside", txt: temp(o.outside), house: false });
    const readouts = all.filter((r) => L.flow(r.key)), faceIn = L.flow("clock");

    const wide = w >= 1.25 * h;
    const out = [];
    const face = (cx, cy, bw, bh) => (o.style === "digital"
      ? digital(S, cx, cy, bw, bh, lt, o)
      : analogue(S, cx, cy, Math.min(bw, bh) / 2, lt, o, memo, memo.light));

    // A readout: optional house, then the number. Sized by the text height.
    const group = (r, th) => {
      th *= L.size(r.key);
      const hs = r.house ? th * 0.9 : 0, gap = r.house ? th * 0.3 : 0;
      return { hs, gap, width: hs + gap + S.width(r.txt, th), th };
    };
    const place = (r, th, cx, cy, smokePhase) => {
      const g = group(r, th), x0 = cx - g.width / 2;
      L.box(r.key, S.rect(x0, cy - g.th * 0.6, x0 + g.width, cy + g.th * 0.6));
      const s = S.text(r.txt, g.th, x0 + g.hs + g.gap + S.width(r.txt, g.th) / 2, cy);
      if (r.house) s.push(...S.house(x0 + g.hs / 2, cy + g.th * 0.02, g.hs, o.smoke ? smokePhase : null));
      return s;
    };
    const phase = (t * 0.4) % 1;
    const ts = Number(o.text_size) || 1;
    let faceAuto = S.rect(-w * 0.85, -h * 0.9, w * 0.85, h * 0.9);
    if (!readouts.length) {
      // The clock alone.
    } else if (wide) {
      let th = Math.min(0.3, h * 0.28) * ts, R = faceIn ? Math.min(h * 0.9, w * 0.42) : 0;
      const sep = faceIn ? 0.12 * w : 0;
      const room = () => 2 * w * 0.94 - 2 * R - sep;
      while (th > 0.05 && Math.max(...readouts.map((r) => group(r, th).width)) > room()) th *= 0.92;
      const gw = Math.max(...readouts.map((r) => group(r, th).width));
      const total = 2 * R + sep + gw, left = -total / 2;
      faceAuto = S.rect(left, -R, left + 2 * R, R);
      const gx = left + 2 * R + sep + gw / 2, dy = Math.min(h * 0.4, th * 1.4);
      readouts.forEach((r, i) => out.push(...place(r, th, gx, readouts.length === 1 ? 0 : (i ? -dy : dy), phase)));
    } else {
      let th = Math.min(0.26, h * 0.2, w * 0.22) * ts;
      const spread = (k) => readouts.reduce((s, r) => s + group(r, k).width, 0) + (readouts.length - 1) * k * 0.9;
      while (th > 0.05 && spread(th) > 2 * w * 0.94) th *= 0.92;
      const R = faceIn ? Math.min(w * 0.9, (2 * h * 0.94 - 1.7 * th) / 2) : 0;
      const top = (2 * R + 1.7 * th) / 2;
      faceAuto = S.rect(-R, top - 2 * R, R, top);
      let x = -spread(th) / 2;
      for (const r of readouts) {
        const g = group(r, th);
        out.push(...place(r, th, x + g.width / 2, -top + th / 2, phase));
        x += g.width + th * 0.9;
      }
    }
    if (L.show("clock")) {
      const B = L.box("clock", faceAuto);
      out.push(...face(B.cx, B.cy, B.w, B.h));
    }
    // Readouts in boxes of their own: as large as fits.
    for (const r of all) {
      if (!L.show(r.key) || L.flow(r.key)) continue;
      // Width per unit of text height; place() scales by Size, so divide it out.
      const B = L.box(r.key, null), k = L.size(r.key), wu = group(r, 1).width / k;
      const th = Math.min(B.h * 0.8, (B.w * 0.96) / Math.max(wu, 1e-6)) * Math.min(1, k);
      out.push(...place(r, th / k, B.cx, B.cy, phase));
    }
    return out;
  },
};
