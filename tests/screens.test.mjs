// The screens foundation's pure parts: the vector font, text layout and the
// view helpers ported from xy-bench. Run by ./dev test under node.
import fs from "node:fs";
import * as S from "../custom_components/alfie/frontend/alfie-screens.js";
import * as I from "../custom_components/alfie/frontend/alfie-intros.js";

let failures = 0, checks = 0;
function check(ok, what) {
  checks++;
  if (!ok) { failures++; console.error(`FAIL ${what}`); }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

S.setFont(JSON.parse(fs.readFileSync(new URL("../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));

// ---------------------------------------------------------------- font
for (const ch of "0123456789:.-°%'! AZaz") check(S.hasGlyph(ch), `glyph for ${JSON.stringify(ch)}`);
check(S.glyphChars().length === 70, "70 glyphs");
check(S.clean("Café ñ 😀") === "Cafe n ", "NFKD drops accents and unsupported characters");
check(S.unitOf("none", "watching") === "" && S.unitOf("", " W ") === "W" && S.unitOf("kWh", "W") === "kWh", "unitOf: none hides the unit, empty falls back");

// Icon names in text: a slot ICON_W wide, the icon once it is in, the name as text if it never is.
{
  const box = [{ pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]], closed: true, role: "line", w: 1 }];
  const have = { "mdi:plex": box, "mdi:slow": null, "mdi:nope": false };
  check(S.isIcon("mdi:plex") && S.isIcon("hass:home") && !S.isIcon("12:30") && !S.isIcon("Mdi:plex") && !S.isIcon("Time:"), "isIcon");
  const nope = S.width("mdi:nope", 1), wide = S.wrap("mdi:plex Hi", 4).length;
  S.setIconSource((n) => (n in have ? have[n] : false));
  const tr = S.metrics().tracking;
  check(near(S.width("mdi:plex Viewers", 1), S.ICON_W + tr + S.width(" Viewers", 1)), "an icon sets ICON_W wide");
  check(near(S.width("mdi:slow", 2), S.ICON_W * 2), "a loading icon keeps its slot");
  check(near(S.width("mdi:nope", 1), nope), "a failed icon is set as its name");
  const st = S.text("mdi:plex", 0.2, 1, 1, { role: "accent" });
  check(st.length === 1 && st[0].role === "accent" && near(st[0].pts[0][0], 1 - 0.13) && near(st[0].pts[2][1], 1.13), "an icon in text: centred, ICON_W tall, the text's role");
  check(S.text("mdi:slow", 0.2).length === 0, "nothing drawn while loading");
  check(S.title("  mdi:plex   Plex_viewers ") === "mdi:plex Plexviewers", "title keeps icon names whole");
  check(wide === 2 && S.wrap("mdi:plex Hi", 4).length === 1, "wrap measures icons");
  const m = S.marker("mdi:plex", 0, 0, 0.1);
  check(m.length === 1 && near(m[0].pts[1][0], (S.MARKER_ICON * 0.1) / 2), "an icon marker");
  check(S.marker("mdi:slow", 0, 0, 0.1)[0].pts.length === 24, "a ring while the marker icon loads");
  const before = S.iconStamp(); S.iconLoaded();
  check(S.iconStamp() === before + 1, "iconLoaded bumps the stamp");
  S.setIconSource(null);
}
{
  const pts = S.curve([0, 1, 1, 0], 0, 0, 3, 1, { lo: 0, hi: 1, steps: true })[0].pts;
  check(JSON.stringify(pts.map(([x, y]) => [Math.round(x), Math.round(y)])) === "[[0,0],[1,0],[1,1],[2,1],[2,1],[3,1],[3,0]]", "curve steps run flat, then jump");
}
check(S.title("  a   b ’c ") === "a b 'c", "title collapses space and straightens apostrophes");
check(S.width("") === 0, "empty string has no width");
const m = S.metrics();
check(near(S.width("00", 1), 2 * m.digit_w + m.tracking), "two digits: advances plus one tracking");
check(near(S.width("00", 0.5), S.width("00", 1) / 2), "width scales with height");
check(S.width("a€b") === S.width("ab"), "unsupported characters have no width");

const t = S.text("12:30", 0.4, 0.3, -0.2);
const pts = t.flatMap((s) => s.pts);
const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
const w = S.width("12:30", 0.4);
check(Math.min(...xs) > 0.3 - w / 2 - 0.02 && Math.max(...xs) < 0.3 + w / 2 + 0.02, "text stays within its measured width");
check(near((Math.min(...xs) + Math.max(...xs)) / 2, 0.3, 0.05), "text is centred on cx");
check(near((Math.min(...ys) + Math.max(...ys)) / 2, -0.2, 0.03), "digits are centred on cy");
check(near(Math.max(...ys) - Math.min(...ys), 0.4, 0.03), "digits are cap-height tall");
check(S.text("é!", 1).length === S.text("e!", 1).length, "accent dropped, same strokes");
check(t.filter((s) => s.pts.length === 1).length === 2, "the colon is two dots");
check(S.text("0", 1)[0].closed, "zero is a closed stroke");
check(S.wrap("aa bb cc", S.width("aa bb", 1) + 0.01).join("|") === "aa bb|cc", "wrap breaks greedily");

// ---------------------------------------------------------- stroke shape
function validStroke(s) {
  return Array.isArray(s.pts) && s.pts.length >= 1 && s.pts.every((p) => p.length === 2 && p.every(Number.isFinite))
    && typeof s.closed === "boolean" && Number.isFinite(s.w) && ["line", "text", "accent", "dim"].includes(s.role)
    && typeof s.fill === "boolean";
}
const all = {
  text: S.text("Hi 5", 0.3), readout: S.readout(21.46, 0.4, 0, 0, { unit: "°", decimals: 1 }),
  curve: S.curve([1, 3, null, 2], 0, 0, 1, 1, { marks: [1] }), baseline: S.baseline(0, 0, 1, { ticks: 4 }),
  axis: S.axis(0, 0, 1, 0, 40, [0, 20, 40], { unit: "°" }), marker: S.MARKER_SHAPES.flatMap((k) => S.marker(k, 0, 0, 0.1)),
  bars: S.bars([10, null, 80], 0, 0, 1, 1),
  icons: [...S.house(0, 0, 1, 0.3), ...S.leaf(0, 0, 1), ...S.drop(0, 0, 1), ...S.car(0, 0, 1), ...S.sun(0, 0, 1), ...S.cloud(0, 0, 1)],
  weather: ["sunny", "clear-night", "partlycloudy", "cloudy", "rainy", "pouring", "snowy", "fog", "lightning", "windy"]
    .flatMap((c) => [...S.weatherIcon(c, 0, 0, 1), ...S.weatherIcon(c, 0, 0, 1, true)]),
};
for (const [k, v] of Object.entries(all)) check(v.length > 0 && v.every(validStroke), `${k}: valid non-empty strokes`);
check(S.weatherIcon("nonsense", 0, 0, 1).length === 0, "unknown condition draws nothing");
check(S.curve([], 0, 0, 1, 1).length === 0, "empty series draws no curve");
check(near(S.curve([0, 10], 0, 0, 2, 1, { lo: 0, hi: 10 })[0].pts[1][1], 1), "curve maps hi to the box top");

// --------------------------------------------------------------- helpers
check(S.niceTicks(0, 40).join() === "0,20,40", "nice_ticks 0..40");
check(S.niceTicks(0, 1, 4, { fine: true }).join() === "0,0.5,1" && S.niceTicks(0, 12000, 5, { fine: true }).join() === "0,2500,5000,7500,10000", "fine ticks go below 1 and above 100");
check(S.niceTicks(17.3, 22.8, 6, { fine: true }).join() === "18,19,20,21,22" && S.tickDecimals([0, 0.5, 1]) === 1 && S.tickDecimals([5, 10]) === 0, "fine ticks on whole data; tick decimals");
{
  // Layout: % boxes from the top left to draw units and back; hidden and boxed leave the flow.
  const L = S.layout(1.6, 1, { a: { box: [0, 0, 50, 25] }, b: { show: false }, c: { size: 2, align: "left" } });
  const r = L.box("a", null);
  check(near(r.x0, -1.6) && near(r.x1, 0) && near(r.y1, 1) && near(r.y0, 0.5), "a box in % lands in draw units");
  check(!L.flow("a") && !L.flow("b") && L.flow("c") && !L.show("b") && L.size("c") === 2 && L.align("c") === "left" && L.align("a") === "centre", "flow, show, size, align");
  L.box("c", S.rect(-1.6, -1, 1.6, 0));
  check(JSON.stringify(L.boxes) === JSON.stringify({ a: [0, 0, 50, 25], c: [0, 50, 100, 50] }), "boxes kept in % for the panel");
  check(L.box("b", S.rect(0, 0, 1, 1)) && !("b" in L.boxes), "a hidden element has no box to show");
  const st = S.stack(S.rect(0, 0, 1, 1), [{ key: "t", h: 0.2 }, false, { key: "m", grow: 1 }, { key: "f", h: 0.1 }], 0.05);
  check(near(st.t.y1, 1) && near(st.t.h, 0.2) && near(st.m.h, 0.6) && near(st.f.y0, 0), "stack: fixed bands, the rest grows");
  const tight = S.stack(S.rect(0, 0, 1, 0.3), [{ key: "a", h: 0.4 }, { key: "b", h: 0.2 }]);
  check(near(tight.a.h, 0.2) && near(tight.b.h, 0.1), "stack: fixed bands shrink together");
  const ft = S.fitText("Hello", S.rect(0, 0, 0.2, 1), 0.5, { align: "left" }).flatMap((k) => k.pts);
  check(Math.min(...ft.map((q) => q[0])) >= -0.01 && Math.max(...ft.map((q) => q[0])) <= 0.21, "fitText shrinks to its box, aligned left");
}
check(S.niceTicks(3, 17).join() === "5,10,15", "nice_ticks 3..17");
check(S.niceTicks(0, 1).join() === "0,1", "nice_ticks 0..1");
check(S.niceTicks(-10, 10).join() === "-10,0,10", "nice_ticks -10..10");
check(S.fmt(-0.04) === "0" && S.fmt(null) === "--" && S.fmt("x") === "--" && S.fmt(21.456, 1) === "21.5", "fmt");
check(S.number(true) === null && S.number("3.5") === 3.5 && S.number(NaN) === null && S.number("") === null, "number");
check(S.series("nope").length === 0, "series: not a list");
check(S.series([1, "x", 3]).join() === "1,,3", "series: bad values become gaps");
const sr = S.series(Array.from({ length: 100 }, (_, i) => i), 10);
check(sr.length === 10 && near(sr[0], 4.5) && near(sr[9], 94.5), "series buckets by average");
check(S.series([null, null, 4, 6], 2).join() === ",5", "series: all-null bucket stays a gap");
check(S.span([[1, 1.5, null]]).join() === "0.75,1.75", "span widens a flat or narrow range to minSpan");
check(S.span([[0, 10]], { pad: 0.1 }).join() === "-1,11", "span pads");
check(S.span([[]]).join() === "0,1", "span of nothing");

// ---------------------------------------------------------------- intros
check(I.STYLES.includes("cut") && I.STYLES.includes("fade"), "intros: cut and fade");
check(I.presence("fade", 0) === 0 && I.presence("fade", 1) === 1 && I.presence("fade", 0, true) === 1, "fade presence ends");
check(I.apply("cut", I.presence("cut", 0.5), false, [], null).alpha === 0, "cut stays gone until it arrives");
check(I.presence("zoom", 0.5, false, 1) === I.presence("zoom", 0.5) && I.presence("zoom", 0.7, false, 3) > I.presence("zoom", 0.7),
  "overshoot 1 is the usual spring, more springs further");
check(I.presence("zoom", 0.7, false, 0) <= 1 && I.presence("fade", 0.3, false, 3) === I.presence("fade", 0.3), "no overshoot: no spring past");
check(I.secondsOf("zoom") === I.SECONDS.zoom && I.secondsOf("zoom", { transition_speed: 2, transition_seconds: {} }) === I.SECONDS.zoom / 2
  && I.secondsOf("zoom", { transition_speed: 1, transition_seconds: { zoom: 3 } }) === 3 && I.secondsOf("nonsense") === undefined,
  "secondsOf: own length over speed");

console.log(`screens: ${checks - failures}/${checks} checks pass`);
process.exit(failures ? 1 : 0);
