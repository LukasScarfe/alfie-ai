// Local time in HA's zone. Browsers carry their own tz data and it lags (when
// a region stops changing its clocks, a browser built on older tz data still
// changes them), so the engine sends HA's own offsets with
// the scene: {zone, from, to, spans: [[start, offset], ...]}, epoch seconds,
// offsets in seconds east of UTC. Within it, for HA's zone, those are the
// truth; anywhere else (another zone, outside the table, the dev harness with
// no scene) the browser's Intl answers.
let Z = null;
let REV = 0;

// The table from the scene; a no-op when it has not changed.
export function setTable(z) {
  const ok = z && typeof z.zone === "string" && Array.isArray(z.spans) && z.spans.length
    && Number.isFinite(z.from) && Number.isFinite(z.to);
  const next = ok ? z : null;
  if (JSON.stringify(next) === JSON.stringify(Z)) return;
  Z = next;
  REV++;
}

// Bumps whenever the table changes: memo keys include it.
export const rev = () => REV;

// HA's offset for `tz` at epoch second t, or null when the table does not cover it.
export function haOffset(t, tz) {
  if (!Z || !tz || tz !== Z.zone || !(t >= Z.from && t < Z.to)) return null;
  const s = Z.spans;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid][0] <= t) lo = mid; else hi = mid - 1;
  }
  return s[lo][1];
}

const PARTS = new Map();

// Seconds the zone `tz` is ahead of UTC at epoch second t (the browser's own
// zone when tz is empty).
export function tzOffset(t, tz) {
  const h = haOffset(t, tz);
  if (h !== null) return h;
  try {
    const key = tz || "";
    let f = PARTS.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
      PARTS.set(key, f);
    }
    const ms = Math.floor(t) * 1000, p = {};
    for (const x of f.formatToParts(new Date(ms))) p[x.type] = Number(x.value);
    return (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - ms) / 1000;
  } catch (_) {
    return -new Date(t * 1000).getTimezoneOffset() * 60;
  }
}

// A formatter of epoch seconds as local time in `tz`, like
// Intl.DateTimeFormat(locale, {...opts, timeZone: tz}).format, but through
// HA's offsets where the table covers the time. Null when Intl refuses.
export function formatter(tz, opts, locale = "en-GB") {
  let utc, zoned;
  try {
    utc = new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" });
    zoned = new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz || undefined });
  } catch (_) { return null; }
  return (t) => {
    const h = haOffset(t, tz);
    return h !== null ? utc.format(new Date((t + h) * 1000)) : zoned.format(new Date(t * 1000));
  };
}
