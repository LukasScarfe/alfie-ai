// The now playing screen: inside its box at any aspect, the bar following the
// song while it plays and holding while paused, the playing player picked over
// others (groups left out), and the rotation skip while nothing plays.
// Run by ./dev test under node.
import fs from "node:fs";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";
import mod, { choose, position, clock } from "../../custom_components/alfie/frontend/screens/nowplaying.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };
S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));
const meta = JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/screens/nowplaying.json", import.meta.url)));
const defaults = Object.fromEntries(meta.options.filter((x) => x.default !== undefined).map((x) => [x.key, x.default]));
const inBox = (strokes, w, h) => strokes.every((s) => s.pts.every(([x, y]) => Math.abs(x) <= w + 0.03 && Math.abs(y) <= h + 0.03));
const valid = (strokes) => strokes.length > 0 && strokes.every((s) => s.pts.length >= 1 && s.pts.every((p) => p.every(Number.isFinite)));

const AT = "2026-10-23T00:35:21Z", T0 = Date.parse(AT) / 1000;
const player = (state, extra = {}, at = AT) => ({ state, attributes: { app_id: "music_assistant", mass_player_type: "player",
  media_title: "Mr. Blue Sky", media_artist: "Electric Light Orchestra", media_album_name: "Out of the Blue",
  media_duration: 303, media_position: 2, media_position_updated_at: at, ...extra } });
const states = {
  "media_player.kitchen": player("playing"),
  "media_player.bedroom": player("idle", { media_title: "Other" }),
  "media_player.all": { ...player("playing", { media_title: "Group" }, "2026-10-23T00:40:00Z"), attributes: { ...player("playing").attributes, mass_player_type: "group", media_title: "Group", media_position_updated_at: "2026-10-23T00:40:00Z" } },
  "media_player.tv": { state: "playing", attributes: { media_title: "Not music", media_position_updated_at: "2026-10-23T00:50:00Z" } },
};
const draw = (o, { w = 1.6, h = 1, t = T0 + 70, memo = {}, st = states } = {}) =>
  mod.draw({ w, h, t, data: null, options: { ...defaults, ...o }, states: st, memo, S });

// Which player.
check(choose(states, defaults) === "media_player.kitchen", "every MA player but groups: the playing one");
check(choose(states, { ...defaults, players: ["media_player.all", "media_player.kitchen"] }) === "media_player.all", "a named group counts; the later one wins");
check(choose(states, { ...defaults, players: ["media_player.bedroom"] }) === null, "an idle player isn't shown");
const paused = { "media_player.kitchen": player("paused") };
check(choose(paused, defaults) === "media_player.kitchen", "paused shows by default");
check(choose(paused, { ...defaults, show_paused: false }) === null, "paused left out when asked");
check(choose({ a: player("paused"), "media_player.b": player("playing", {}, "2026-01-01T00:00:00Z"), "media_player.a": player("paused") }, defaults) === "media_player.b", "playing beats a later paused");

// Where in the song.
check(position(player("playing"), T0 + 70).pos === 72, "playing: the position moves on with time");
check(position(player("paused"), T0 + 70).pos === 2, "paused: it holds");
check(position(player("playing"), T0 + 9999).pos === 303, "it stops at the end");
check(position(player("playing", { media_duration: undefined }), T0 + 10).dur === 0, "a stream has no length");
check(clock(72) === "1:12" && clock(3725) === "1:02:05" && clock(-3) === "0:00", "times read m:ss or h:mm:ss");

// Drawing, at several aspects and in every bar style and times choice.
for (const [w, h] of [[1.6, 1], [1, 1], [0.7, 1], [1.6, 0.6]]) {
  for (const bar of ["line", "dotted", "blocks", "none"]) {
    for (const times of ["elapsed_total", "elapsed_remaining", "elapsed", "none"]) {
      const out = draw({ bar, times }, { w, h });
      check(valid(out) && inBox(out, w, h), `${w}x${h} bar ${bar} times ${times}: valid and inside`);
    }
  }
  const long = draw({}, { w, h, st: { "media_player.k": player("playing", { media_title: "Not Here to Get a Pedicure or Anything Else Today" }) } });
  check(valid(long) && inBox(long, w, h), `${w}x${h}: a long title wraps and fits`);
}
// The bar's filled part (accent, w > 2) grows with time.
const fill = (t) => { const s = draw({}, { t }).find((x) => x.role === "accent" && x.w > 2); return s ? s.pts[1][0] - s.pts[0][0] : 0; };
check(fill(T0 + 200) > fill(T0 + 50) && fill(T0 + 50) > 0, "the bar fills as the song goes");
const pausedFill = (t) => draw({}, { t, st: paused }).find((x) => x.role === "accent" && x.w > 2).pts[1][0];
check(pausedFill(T0 + 50) === pausedFill(T0 + 200), "a paused bar holds");
// Missing parts close up.
const noAlbum = draw({}, { st: { "media_player.k": player("playing", { media_album_name: "", media_duration: 0 }) } });
check(valid(noAlbum) && inBox(noAlbum, 1.6, 1), "no album and no length still draws");
// Song name, artist and album each turn off; turning one off draws less.
const all = draw({});
for (const k of ["show_title", "show_artist", "show_album"]) {
  const less = draw({ [k]: false });
  check(valid(less) && inBox(less, 1.6, 1) && less.length < all.length, `${k} off draws less`);
}
const bare = draw({ show_title: false, show_artist: false, show_album: false, bar: "none", times: "none", state_icon: false });
check(bare.length === 0, "everything off draws nothing");
// One memo across frames: the text is reused, the times move.
const memo = {};
const a = draw({}, { memo, t: T0 + 10 }), b = draw({}, { memo, t: T0 + 11 });
check(a.length > 0 && b.length > 0 && memo.key, "frames share the cached layout");

// Nothing playing.
const empty = draw({}, { st: {} });
check(valid(empty) && inBox(empty, 1.6, 1), "nothing playing: a message");
check(mod.rotation({ data: null, options: defaults, states: {}, S }).skip === true, "skips in a rotation while idle");
check(mod.rotation({ data: null, options: { ...defaults, skip_empty: false }, states: {}, S }).skip === false, "or not, when asked");
check(mod.rotation({ data: null, options: defaults, states, S }).skip === false, "no skip while playing");

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("nowplaying ok");
