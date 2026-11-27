// HA's offsets over the browser's tz data: a browser whose Intl is stale for a
// zone (it says -08:00 where HA's newer tz data says -07:00 all year) must draw
// HA's offset once the scene's table arrives, and its own Intl again without one.
// Run by ./dev test under node.
import fs from "node:fs";

// The stale browser: Intl answers the zone as fixed -08:00 all year.
const Real = Intl.DateTimeFormat;
function Stale(locale, opts = {}) {
  const o = opts.timeZone === "America/Whitehorse" ? { ...opts, timeZone: "Etc/GMT+8" } : opts;
  return new Real(locale, o);
}
Stale.prototype = Real.prototype;
Stale.supportedLocalesOf = Real.supportedLocalesOf;
Intl.DateTimeFormat = Stale;

const TZ = await import("../../custom_components/alfie/frontend/alfie-tz.js");
const S = await import("../../custom_components/alfie/frontend/alfie-screens.js");
const K = await import("../../custom_components/alfie/frontend/alfie-sky.js");
const clock = (await import("../../custom_components/alfie/frontend/screens/clock.js")).default;
const { timeTicks } = await import("../../custom_components/alfie/frontend/screens/plot.js");
const weather = (await import("../../custom_components/alfie/frontend/screens/weather.js")).default;

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };
S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));
const meta = JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/screens/clock.json", import.meta.url)));
const defaults = { ...Object.fromEntries(meta.options.filter((x) => x.default !== undefined).map((x) => [x.key, x.default])), style: "digital", seconds: false };

const zone = "America/Whitehorse";
const t = Date.UTC(2026, 11, 15, 20, 30, 0) / 1000;    // 13:30 at -07:00; the stale browser says 12:30
const table = { zone, from: t - 400 * 86400, to: t + 400 * 86400, spans: [[t - 400 * 86400, -25200]] };
const config = { time_zone: zone };
const dig = (memo = {}) => clock.draw({ w: 1.6, h: 1, t, data: null, options: defaults, states: {}, config, memo, S });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const text = (s) => S.text(s, 1, 0, 0);

check(TZ.tzOffset(t, zone) === -28800, "no table: the browser's (stale) -08:00");
const before = dig();
const memo = {};
dig(memo);

TZ.setTable(table);
check(TZ.tzOffset(t, zone) === -25200, "table: HA's -07:00");
check(TZ.tzOffset(t, "Europe/Berlin") === 3600, "another zone still asks Intl");
check(TZ.tzOffset(t + 401 * 86400, zone) === -28800, "outside the table: Intl again");
check(!same(dig(memo), before), "the clock redraws when the table arrives, even within the same minute");
check(same(dig(), (() => { TZ.setTable(null); const d = dig(); TZ.setTable(table); return d; })()) === false, "with and without the table differ");
// 13:30 vs 12:30: compare against a UTC clock drawn at the matching wall time.
const at = (wall) => clock.draw({ w: 1.6, h: 1, t: wall, data: null, options: defaults, states: {}, config: { time_zone: "UTC" }, memo: {}, S });
check(same(dig(), at(Date.UTC(2026, 11, 15, 13, 30) / 1000)), "clock reads 13:30 with HA's offset");
TZ.setTable(null);
check(same(dig(), at(Date.UTC(2026, 11, 15, 12, 30) / 1000)), "clock reads 12:30 on the browser's own data");
TZ.setTable(table);

// Spans: a transition inside the table is honoured to the second.
const cut = t + 3600;
TZ.setTable({ ...table, spans: [[table.from, -25200], [cut, -21600]] });
check(TZ.tzOffset(cut - 1, zone) === -25200 && TZ.tzOffset(cut, zone) === -21600, "span boundary");
TZ.setTable(table);

// Plot axis labels and the sky's local hours follow the table.
const ticks = timeTicks(t - 6 * 3600, t, 3600, "hour", zone);
check(ticks.some(([x, l]) => x === Date.UTC(2026, 11, 15, 20) / 1000 && l === "13"), "plot hour tick at 13 local");
check(Math.abs(K.localHours(t, zone) - 13.5) < 1e-9, "sky local hours 13.5");
check(K.localMidnight(t, zone) === Date.UTC(2026, 11, 15, 7) / 1000, "sky local midnight at 07:00 UTC");

// Weather hour labels: a fake forecast drawn with and without the table differs.
const fc = { type: "hourly", unit: "°C", times: Array.from({ length: 24 }, (_, i) => t + 3600 * i), temp: Array.from({ length: 24 }, (_, i) => 5 + i % 4),
  low: [], pop: Array(24).fill(0), precip: [], cond: Array(24).fill("sunny"), now: { temperature: 5, condition: "sunny", night: false } };
const wmeta = JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/screens/weather.json", import.meta.url)));
const wopts = Object.fromEntries(wmeta.options.filter((x) => x.default !== undefined).map((x) => [x.key, x.default]));
const wdraw = () => weather.draw({ w: 1.6, h: 1, t, data: fc, options: wopts, states: {}, config, memo: {}, S });
let wa, wb;
try { wa = wdraw(); TZ.setTable(null); wb = wdraw(); TZ.setTable(table); check(!same(wa, wb), "weather hour labels follow the table"); }
catch (e) { check(false, `weather draws: ${e}`); }

// A junk table is ignored.
TZ.setTable({ zone, spans: [] });
check(TZ.tzOffset(t, zone) === -28800, "an empty table falls back to Intl");

Intl.DateTimeFormat = Real;
if (failures) { console.error(`${failures} tz check(s) failed`); process.exit(1); }
console.log("tz: ok");
