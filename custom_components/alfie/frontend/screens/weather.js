// Weather: the temperature now beside a condition icon, then the forecast as
// a temperature curve (hourly) or days as columns (daily), with rain as a
// dotted line against its own axis.
// Ported from xy-bench figures._weather. Sizes come from a frame `f` units
// tall per 0.72 of half-height; the layout is bands stacked top to bottom
// (S.stack), so a larger Text size squeezes the forecast instead of
// overlapping it. Elements (the Layout option): title, icon, temperature,
// forecast (the area below, holding the rest);
// hourly curve, temp_axis, rain_axis, hours; daily days, day_icons, highs,
// lows, rain. A daily row in a box of its own spreads its columns across it.
const ELEVATION_NIGHT = -0.833;     // sun.sun elevation below which it is night

// A 1-2-1 moving average, ends kept, gaps kept as gaps.
export function smooth(vals, passes = 1) {
  let v = vals;
  for (let p = 0; p < passes; p++) {
    v = v.map((x, i) => {
      if (i === 0 || i === v.length - 1) return x;
      const a = v[i - 1], c = v[i + 1];
      return a === null || x === null || c === null ? x : (a + 2 * x + c) / 4;
    });
  }
  return v;
}

export function convert(v, from, to) {
  if (v === null || to === "auto") return v;
  const f = /f/i.test(from || "") ;
  if (to === "fahrenheit") return f ? v : (v * 9) / 5 + 32;
  return f ? ((v - 32) * 5) / 9 : v;
}

// Which rain series to draw: probability if the forecast has any, else amount.
export function rainMode(choice, data) {
  const has = (k) => Array.isArray(data?.[k]) && data[k].some((v) => v !== null && v !== undefined);
  if (choice === "off") return null;
  if (choice === "probability") return has("pop") ? "pop" : null;
  if (choice === "amount") return has("precip") ? "precip" : null;
  return has("pop") ? "pop" : has("precip") ? "precip" : null;
}

export function isNight(states, data) {
  const sun = states?.["sun.sun"];
  if (sun) {
    const el = Number(sun.attributes?.elevation);
    if (Number.isFinite(el)) return el < ELEVATION_NIGHT;
    return sun.state === "below_horizon";
  }
  return !!data?.now?.night;
}

// Temperature now: the override sensor, else the weather entity, else what
// the provider saw. Returns [value, unit] (unit as the source reports it).
export function nowTemp(options, states, data, S) {
  const sensor = options.sensor && states?.[options.sensor];
  if (sensor) {
    const v = S.number(sensor.state);
    if (v !== null) return [v, sensor.attributes?.unit_of_measurement];
  }
  const w = options.weather && states?.[options.weather];
  const v = S.number(w?.attributes?.temperature);
  if (v !== null) return [v, w.attributes.temperature_unit];
  return [S.number(data?.now?.temperature), data?.now?.unit];
}

export function nowCondition(options, states, data) {
  const w = options.weather && states?.[options.weather];
  const c = w?.state;
  return c && c !== "unavailable" && c !== "unknown" ? c : data?.now?.condition ?? null;
}

function stamp(memo, key, make) {
  if (memo.key !== key) { memo.key = key; memo.val = make(); }
  return memo.val;
}

// The icon, drifting a little (and the sun turning) when animated. Cheap: the
// strokes are cached per condition and only moved per frame.
function animated(icon, cx, cy, condition, t) {
  if (condition === "sunny") {
    const a = t * 0.35, c = Math.cos(a), s = Math.sin(a);
    return icon.map((k) => ({ ...k, pts: k.pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]) }));
  }
  const dx = 0.012 * Math.sin(t * 0.9), dy = 0.008 * Math.sin(t * 0.7 + 1);
  return icon.map((k) => ({ ...k, pts: k.pts.map(([x, y]) => [x + dx, y + dy]) }));
}

function hourLabels(times, tz) {
  let fmt;
  try { fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz || undefined }); } catch (_) { fmt = null; }
  return times.map((s) => (s && fmt ? fmt.format(new Date(s * 1000)).replace(/^24$/, "00") : null));
}

function dayLabels(times, tz) {
  let fmt;
  try { fmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: tz || undefined }); } catch (_) { fmt = null; }
  return times.map((s) => (s && fmt ? fmt.format(new Date(s * 1000)) : ""));
}

export default {
  type: "weather",
  draw({ w, h, t, data, options, states, config, memo, S }) {
    const f = Math.min(h / 0.72, w / 0.8);
    // Text size: the small text in full; the big readout less, as it already fills its band.
    const ts = Number(options.text_size) || 1, big = Math.min(ts, 1.4);
    const L = S.layout(w, h, options.layout);
    memo.boxes = L.boxes;
    const out = [];
    const area = S.rect(-w * 0.97, -h + 0.02 * f, w * 0.97, h - 0.02 * f);
    const title = S.title(options.title || "");
    const titleH = title && L.show("title") ? 0.06 * f * ts * L.size("title") : 0;

    const [raw, srcUnit] = nowTemp(options, states, data, S);
    const forecastUnit = data?.unit || states?.[options.weather]?.attributes?.temperature_unit || config?.unit_system?.temperature;
    const cur = convert(raw, srcUnit || forecastUnit, options.unit);
    const cond = nowCondition(options, states, data);
    const night = isNight(states, data);
    const suffix = options.suffix ?? "°";

    if (!data && cur === null && !cond) {
      if (titleH) out.push(...S.fitText(title, L.box("title", S.rect(area.x0, area.y1 - titleH, area.x1, area.y1)), titleH, { role: "dim", align: L.align("title") }));
      return titleH ? out : S.text("Weather", 0.2 * f, 0, 0);
    }
    const mode = data?.type === "daily" ? "daily" : (data?.type === "hourly" ? "hourly" : options.forecast);
    const hasForecast = !!data && Array.isArray(data.temp) && data.temp.length > 0;

    // Bands: the title, the temperature now, the forecast.
    const nowH = 0.2 * f * big * L.size("temperature"), isz = 0.22 * f * big * L.size("icon"), gap = 0.08 * f * big;
    const nowFlow = L.flow("icon") || L.flow("temperature");
    const nowBand = nowFlow ? Math.max(L.flow("icon") ? isz * 0.8 : 0, L.flow("temperature") ? nowH * 1.25 : 0) : 0;
    const bands = S.stack(area, [
      titleH && L.flow("title") && { key: "title", h: titleH },
      nowBand && { key: "now", h: nowBand },
      hasForecast && L.flow("forecast") && { key: "forecast", grow: 1, min: 0.25 * f },
    ], 0.04 * f);
    if (!hasForecast && bands.now) {
      // No forecast: the temperature takes the room.
      bands.now = S.rect(area.x0, area.y0, area.x1, bands.title ? bands.title.y0 - 0.04 * f : area.y1);
    }
    if (titleH) {
      const B = L.box("title", bands.title || S.rect(area.x0, area.y1 - titleH, area.x1, area.y1));
      out.push(...S.fitText(title, B, L.own("title") ? B.h * Math.min(1, L.size("title")) : titleH, { role: "dim", align: L.align("title") }));
    }

    // The condition icon beside the temperature, centred as a pair in their band.
    const nb = bands.now || S.rect(area.x0, area.y1 - nowBand, area.x1, area.y1);
    const tw = S.readoutWidth(cur, nowH, { unit: suffix, decimals: options.decimals });
    const showIcon = L.show("icon") && !!cond, pair = showIcon && L.flow("icon") && L.flow("temperature");
    const left = nb.cx - ((pair ? isz + gap : 0) + tw) / 2;
    const fitIn = Math.min(1, nb.h / Math.max(isz, nowH * 1.1, 1e-6));   // a squeezed band shrinks both
    if (showIcon) {
      const ib = L.box("icon", S.rect(pair ? left : nb.cx - isz / 2, nb.cy - isz / 2, (pair ? left : nb.cx - isz / 2) + isz, nb.cy + isz / 2));
      const sz = Math.min(ib.w, ib.h, L.own("icon") ? Infinity : isz * fitIn);
      const iconKey = `${cond}|${night}|${sz.toFixed(3)}`;
      const base = stamp(memo.icon ??= {}, iconKey, () => S.weatherIcon(cond, 0, 0, sz, night));
      const moved = options.animate ? animated(base, 0, 0, cond, t) : base;
      out.push(...moved.map((k) => ({ ...k, pts: k.pts.map(([x, y]) => [x + ib.cx, y + ib.cy]) })));
    }
    if (L.show("temperature")) {
      const x0 = pair ? left + isz + gap : nb.cx - tw / 2;
      const tb = L.box("temperature", S.rect(x0, nb.cy - nowH * 0.55, x0 + tw, nb.cy + nowH * 0.55));
      const s = S.fmt(cur, options.decimals) + suffix;
      out.push(...S.fitText(s, tb, L.own("temperature") ? tb.h * 0.9 : nowH * fitIn, { align: L.align("temperature") }));
    }

    if (!hasForecast) return out;
    const conv = (arr) => S.series(arr).map((v) => convert(v, forecastUnit, options.unit));
    const key = `${mode}|${data.times?.[0]}|${data.times?.length}|${config?.time_zone}`;
    const fr = L.box("forecast", bands.forecast || S.rect(area.x0, area.y0, area.x1, area.y0 + 0.4 * f));
    if (!L.show("forecast")) return out;
    if (mode === "daily") return out.concat(daily({ fr, f, ts, data, options, config, memo, S, L, conv, suffix, key }));
    return out.concat(hourly({ fr, f, ts, cur, data, options, config, memo, S, L, conv, suffix, key }));
  },
};

function hourly({ fr, f, ts, cur, data, options, config, memo, S, L, conv, suffix, key }) {
  const out = [];
  const nH = Math.max(2, Math.min(options.hours, 48));
  const lh = 0.06 * f * ts, ah = lh * L.size("temp_axis"), rh = lh * L.size("rain_axis"), hh = lh * 0.85 * L.size("hours");
  const mode = rainMode(options.rain, data);
  const labels = options.time_labels && L.show("hours");
  const leftW = L.flow("temp_axis") ? S.width("-99" + suffix, ah) + 0.04 * f + 0.07 : 0.02 * f;
  const rightW = mode && L.flow("rain_axis") ? S.width("100%", rh) + 0.04 * f + 0.07 : 0.04 * f;
  const dropH = mode && L.flow("rain_axis") ? 0.15 * f : 0;
  const hoursH = labels && L.flow("hours") ? hh * 1.9 : 0.035;   // room for the baseline's ticks
  // The curve in a box of its own keeps its axes and hours inside it.
  const own = L.box("curve", S.rect(fr.x0 + leftW, fr.y0 + hoursH, fr.x1 - rightW, fr.y1 - dropH));
  const C = L.own("curve") ? S.rect(own.x0 + leftW, own.y0 + hoursH, own.x1 - rightW, own.y1 - dropH) : own;
  const x0 = C.x0, pw = C.w, y0 = C.y0, ph = C.h;

  // Rain, a dotted line against the right axis, on the temperature's hours
  // (the first hour's value stands for now).
  if (mode) {
    const vals = S.series(data[mode]).slice(0, nH);
    while (vals.length < nH) vals.push(null);
    let hi = 100, ticks = [0, 50, 100], unit = "%";
    if (mode === "precip") {
      const m = Math.max(0, ...vals.filter((v) => v !== null));
      hi = Math.max(2, Math.ceil(m / 2) * 2);
      ticks = [0, hi / 2, hi]; unit = "";
    }
    if (L.show("curve")) out.push(...S.curve(smooth([vals[0], ...vals]), x0, y0, pw, ph, { lo: 0, hi, weight: S.DOTTED }));
    if (L.show("rain_axis")) {
      const A = L.box("rain_axis", S.rect(C.x1 + 0.04 * f, C.y0, C.x1 + rightW, C.y1 + dropH));
      const top = A.y1 - (L.own("rain_axis") ? Math.min(0.15 * f, A.h * 0.25) : dropH);
      out.push(...S.axis(A.x0, A.y0, top - A.y0, 0, hi, ticks, { unit, labelH: rh, weight: 0.25, side: "right", unlabelled: [0] }));
      out.push(...S.drop(A.x0, top + (A.y1 - top) * 0.55, Math.min(0.11 * f, (A.y1 - top) * 0.8)));
    }
  }

  // Temperature, against the left axis; the raw values label it, a lightly
  // smoothed copy is drawn (forecasts come in whole degrees: stairs).
  let temps = conv(data.temp).slice(0, nH);
  while (temps.length < nH) temps.push(null);
  const series = [cur, ...temps];
  const [lo, hi] = S.span([series], { pad: 0.05, minSpan: 4 });
  const known = series.filter((v) => v !== null);
  if (known.length && L.show("temp_axis")) {
    const A = L.box("temp_axis", S.rect(C.x0 - leftW, C.y0, C.x0 - 0.04 * f, C.y1));
    const ticks = [...new Set([Math.round(Math.min(...known)), Math.round(Math.max(...known))])].filter((v) => v >= lo && v <= hi);
    out.push(...S.axis(A.x1, A.y0, A.h, lo, hi, ticks, { unit: suffix, labelH: ah, weight: 0.25 }));
  }
  if (L.show("curve")) out.push(...S.curve(smooth(series), x0, y0, pw, ph, { lo, hi }));

  // Time under the baseline: a tick and an hour every few hours.
  const step = nH <= 12 ? 3 : nH <= 24 ? 6 : 12;
  const div = Math.floor(nH / step);
  if (div >= 1) {
    out.push(...S.baseline(x0, y0, pw * ((div * step) / nH), { ticks: div, weight: 0.4 }));
    if (labels) {
      const T = L.box("hours", S.rect(C.x0, fr.y0, C.x1, C.y0));
      const names = stamp(memo.hours ??= {}, key, () => hourLabels(data.times || [], config?.time_zone));
      const lw = T.w / nH;
      for (let j = 1; j <= div; j++) {
        const s = names[j * step - 1];
        if (s) out.push(...S.fitText(s, S.rect(T.x0 + lw * j * step - lw * step / 2, T.y0, T.x0 + lw * j * step + lw * step / 2, T.y1 - 0.02 * f), hh));
      }
    }
  } else out.push(...S.baseline(x0, y0, pw));
  return out;
}

// Daily: a column per day; its rows (day name, icon, high, low, rain) are bands
// stacked in the forecast's room, each of which can have a box of its own.
function daily({ fr, f, ts, data, options, config, memo, S, L, conv, suffix, key }) {
  const out = [];
  const n = Math.max(1, Math.min(options.days, data.temp.length));
  const hi = conv(data.temp).slice(0, n), lo = conv(data.low || []).slice(0, n);
  const hasLow = lo.some((v) => v !== null && v !== undefined);
  const conds = (data.cond || []).slice(0, n);
  const names = stamp(memo.days ??= {}, key, () => dayLabels(data.times || [], config?.time_zone));
  const mode = rainMode(options.rain, data);
  const H = { days: 0.065 * f * ts * L.size("days"), day_icons: 0.2 * f * L.size("day_icons"), highs: 0.09 * f * ts * L.size("highs"), lows: 0.07 * f * ts * L.size("lows") };
  const cwAuto = fr.w / n;
  H.day_icons = Math.min(H.day_icons, cwAuto * 0.75);
  const rows = S.stack(fr, [
    L.flow("days") && { key: "days", h: H.days * 1.2 },
    L.flow("day_icons") && { key: "day_icons", h: H.day_icons },
    L.flow("highs") && { key: "highs", h: H.highs * 1.2 },
    hasLow && L.flow("lows") && { key: "lows", h: H.lows * 1.2 },
    L.flow("rain") && { key: "rain", h: 0.22 * f },
  ], 0.03 * f, { spread: true });
  // Each row's box: its band, or its own; its columns spread across it.
  const row = (k) => L.box(k, rows[k] || S.rect(fr.x0, fr.y0, fr.x1, fr.y0 + 0.05 * f));
  const cols = (B) => Array.from({ length: n }, (_, i) => S.rect(B.x0 + (B.w * i) / n, B.y0, B.x0 + (B.w * (i + 1)) / n, B.y1));
  const textRow = (k, text, role) => {
    if (!L.show(k)) return;
    const B = row(k), ht = L.own(k) ? B.h * 0.8 : H[k];
    cols(B).forEach((c, i) => { const s = text(i); if (s) out.push(...S.fitText(s, S.inset(c, c.w * 0.04, 0), ht, { role })); });
  };
  textRow("days", (i) => names[i], "dim");
  if (L.show("day_icons")) {
    const B = row("day_icons");
    cols(B).forEach((c, i) => {
      const isz = Math.min(c.w * 0.75, B.h, L.own("day_icons") ? Infinity : H.day_icons);
      const ic = stamp((memo.icons ??= [])[i] ??= {}, `${conds[i]}|${isz.toFixed(3)}`, () => S.weatherIcon(conds[i], 0, 0, isz, false));
      out.push(...ic.map((k) => ({ ...k, pts: k.pts.map(([x, y]) => [x + c.cx, y + c.cy]) })));
    });
  }
  textRow("highs", (i) => S.fmt(hi[i]) + suffix, "text");
  if (hasLow) textRow("lows", (i) => (lo[i] === null || lo[i] === undefined ? "" : S.fmt(lo[i]) + suffix), "dim");
  // Rain per day: a dotted line through the columns over a 0..100 (or 0..max)
  // strip on the baseline.
  if (L.show("rain")) {
    const B = row("rain");
    out.push(...S.baseline(B.x0, B.y0, B.w));
    if (mode && n > 1) {
      const vals = S.series(data[mode]).slice(0, n);
      let top = 100;
      if (mode === "precip") top = Math.max(5, Math.ceil(Math.max(0, ...vals.filter((v) => v !== null)) / 5) * 5);
      out.push(...S.curve(vals, B.x0 + B.w / n / 2, B.y0, B.w * (1 - 1 / n), Math.min(B.h, 0.22 * f), { lo: 0, hi: top, weight: S.DOTTED }));
    }
  }
  return out;
}
