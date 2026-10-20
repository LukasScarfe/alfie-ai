// Weather: the temperature now beside a condition icon, then the forecast as
// a temperature curve (hourly) or days as columns (daily), with rain as a
// dotted line against its own axis.
// Ported from xy-bench figures._weather. Laid out in a frame `f` units tall
// per 0.72 of half-height, stretched to the box's width.
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

// Shrink a text height so the string fits `room` wide.
const fitH = (S, s, ht, room) => Math.min(ht, room / Math.max(S.width(s, 1), 1e-6));

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
    const out = [];
    const title = S.title(options.title || "");
    if (title) out.push(...S.text(title, 0.06 * f * ts, 0, (0.69 - 0.03 * ts) * f, { role: "dim" }));

    const [raw, srcUnit] = nowTemp(options, states, data, S);
    const forecastUnit = data?.unit || states?.[options.weather]?.attributes?.temperature_unit || config?.unit_system?.temperature;
    const cur = convert(raw, srcUnit || forecastUnit, options.unit);
    const cond = nowCondition(options, states, data);
    const night = isNight(states, data);
    const suffix = options.suffix ?? "°";

    if (!data && cur === null && !cond) {
      return title ? out : S.text("Weather", 0.2 * f, 0, 0);
    }

    // Top: the condition as an icon beside the temperature, centred as a pair.
    const nowH = 0.2 * f * big, isz = 0.22 * f * big, gap = 0.08 * f * big, ny = (0.45 - 0.12 * (big - 1)) * f;
    const iconKey = `${cond}|${night}|${isz.toFixed(3)}`;
    const base = stamp(memo.icon ??= {}, iconKey, () => S.weatherIcon(cond, 0, 0, isz, night));
    const tw = S.readoutWidth(cur, nowH, { unit: suffix, decimals: options.decimals });
    let tx = 0;
    if (base.length) {
      const left = -(isz + gap + tw) / 2;
      const ix = left + isz / 2;
      const moved = options.animate ? animated(base, 0, 0, cond, t) : base;
      out.push(...moved.map((k) => ({ ...k, pts: k.pts.map(([x, y]) => [x + ix, y + ny]) })));
      tx = left + isz + gap + tw / 2;
    }
    out.push(...S.readout(cur, nowH, tx, ny - 0.02 * f, { unit: suffix, decimals: options.decimals }));

    const mode = data?.type === "daily" ? "daily" : (data?.type === "hourly" ? "hourly" : options.forecast);
    if (!data || !Array.isArray(data.temp) || !data.temp.length) return out;
    const conv = (arr) => S.series(arr).map((v) => convert(v, forecastUnit, options.unit));
    const key = `${mode}|${data.times?.[0]}|${data.times?.length}|${config?.time_zone}`;

    if (mode === "daily") return out.concat(daily({ w, f, ts, data, options, config, memo, S, conv, suffix, key }));
    return out.concat(hourly({ w, f, ts, cur, data, options, config, memo, S, conv, suffix, key }));
  },
};

function hourly({ w, f, ts, cur, data, options, config, memo, S, conv, suffix, key }) {
  const out = [];
  const nH = Math.max(2, Math.min(options.hours, 48));
  const lh = 0.06 * f * ts;
  const padL = S.width("-99" + suffix, lh) + 0.04 * f + 0.07;
  const mode = rainMode(options.rain, data);
  const padR = mode ? S.width("100%", lh) + 0.04 * f + 0.07 : 0.04 * f;
  const x0 = -w * 0.97 + padL, x1 = w * 0.97 - padR, pw = x1 - x0;
  const y0 = -0.6 * f, ph = 0.7 * f, y1 = y0 + ph;

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
    out.push(...S.curve(smooth([vals[0], ...vals]), x0, y0, pw, ph, { lo: 0, hi, weight: S.DOTTED }));
    out.push(...S.axis(x1 + 0.04 * f, y0, ph, 0, hi, ticks, { unit, labelH: lh, weight: 0.25, side: "right", unlabelled: [0] }));
    out.push(...S.drop(x1 + 0.04 * f, y1 + 0.12 * f, 0.11 * f));
  }

  // Temperature, against the left axis; the raw values label it, a lightly
  // smoothed copy is drawn (forecasts come in whole degrees: stairs).
  let temps = conv(data.temp).slice(0, nH);
  while (temps.length < nH) temps.push(null);
  const series = [cur, ...temps];
  const [lo, hi] = S.span([series], { pad: 0.05, minSpan: 4 });
  const known = series.filter((v) => v !== null);
  if (known.length) {
    const ticks = [...new Set([Math.round(Math.min(...known)), Math.round(Math.max(...known))])].filter((v) => v >= lo && v <= hi);
    out.push(...S.axis(x0 - 0.04 * f, y0, ph, lo, hi, ticks, { unit: suffix, labelH: lh, weight: 0.25 }));
  }
  out.push(...S.curve(smooth(series), x0, y0, pw, ph, { lo, hi }));

  // Time under the baseline: a tick and an hour every few hours.
  const step = nH <= 12 ? 3 : nH <= 24 ? 6 : 12;
  const div = Math.floor(nH / step);
  if (div >= 1) {
    out.push(...S.baseline(x0, y0, pw * ((div * step) / nH), { ticks: div, weight: 0.4 }));
    if (options.time_labels) {
      const labels = stamp(memo.hours ??= {}, key, () => hourLabels(data.times || [], config?.time_zone));
      const lw = pw / nH;
      for (let j = 1; j <= div; j++) {
        const s = labels[j * step - 1];
        if (s) out.push(...S.text(s, lh * 0.85, x0 + lw * j * step, Math.max(y0 - (0.05 + 0.025 * ts) * f, -0.72 * f + lh * 0.43)));
      }
    }
  } else out.push(...S.baseline(x0, y0, pw));
  return out;
}

function daily({ w, f, ts, data, options, config, memo, S, conv, suffix, key }) {
  const out = [];
  const n = Math.max(1, Math.min(options.days, data.temp.length));
  const hi = conv(data.temp).slice(0, n), lo = conv(data.low || []).slice(0, n);
  const conds = (data.cond || []).slice(0, n);
  const x0 = -w * 0.94, cw = (2 * w * 0.94) / n;
  const names = stamp(memo.days ??= {}, key, () => dayLabels(data.times || [], config?.time_zone));
  const room = cw * 0.92;
  for (let i = 0; i < n; i++) {
    const cx = x0 + cw * (i + 0.5);
    const nm = names[i];
    if (nm) out.push(...S.text(nm, fitH(S, nm, 0.065 * f * ts, room), cx, (0.2 + 0.03 * (ts - 1)) * f, { role: "dim" }));
    // Bigger text (Text size) takes room from the icon and the rain strip.
    const isz = Math.min(cw * 0.75, 0.2 * f * (1 - 0.25 * Math.max(0, ts - 1)));
    const ic = stamp((memo.icons ??= [])[i] ??= {}, `${conds[i]}|${isz.toFixed(3)}`, () => S.weatherIcon(conds[i], 0, 0, isz, false));
    out.push(...ic.map((k) => ({ ...k, pts: k.pts.map(([x, y]) => [x + cx, y + (0.02 * Math.max(0, ts - 1) - 0.01) * f]) })));
    const sh = S.fmt(hi[i]) + suffix;
    out.push(...S.text(sh, fitH(S, sh, 0.09 * f * ts, room), cx, (-0.16 - 0.06 * (ts - 1)) * f));
    if (lo[i] !== null && lo[i] !== undefined) {
      const sl = S.fmt(lo[i]) + suffix;
      out.push(...S.text(sl, fitH(S, sl, 0.07 * f * ts, room), cx, (-0.28 - 0.13 * (ts - 1)) * f, { role: "dim" }));
    }
  }
  // Rain per day: a dotted line through the columns, over a 0..100 (or 0..max)
  // strip on the baseline.
  out.push(...S.baseline(x0, -0.62 * f, cw * n));
  const mode = rainMode(options.rain, data);
  if (mode && n > 1) {
    const vals = S.series(data[mode]).slice(0, n);
    let top = 100;
    if (mode === "precip") top = Math.max(5, Math.ceil(Math.max(0, ...vals.filter((v) => v !== null)) / 5) * 5);
    out.push(...S.curve(vals, x0 + cw / 2, -0.62 * f, cw * (n - 1), (0.22 - 0.1 * Math.max(0, ts - 1)) * f, { lo: 0, hi: top, weight: S.DOTTED }));
  }
  return out;
}
