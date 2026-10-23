// Now playing: a player's song title, artist and album, and a play bar that
// fills as the song goes (design.md "Screens"). It reads the media_player
// attributes Music Assistant keeps; no provider. The layout and the text are
// cached on `memo`; only the bar and the times are drawn afresh each frame,
// the position worked out from `media_position` and when it was updated.
const pick = (v, d, key) => (v && Object.keys(v).length ? v : d?.[key] ?? {});
const PITCH = 1.6;     // a wrapped title's line spacing, in cap heights

const isMA = (st) => st?.attributes?.app_id === "music_assistant" && st.attributes.mass_player_type !== "group";
const updated = (st) => Date.parse(st?.attributes?.media_position_updated_at || "") / 1000 || 0;

// The player to show: playing before paused, the one updated last first.
// Named players are all candidates (a group too); with none named, every
// Music Assistant player but its groups, so a group and its member don't both show.
export function choose(states, o) {
  const named = (o.players || []).filter(Boolean);
  const ids = named.length ? named : Object.keys(states).filter((id) => id.startsWith("media_player.") && isMA(states[id]));
  let best = null, bestRank = 0, bestAt = -Infinity;
  for (const id of ids) {
    const st = states[id], a = st?.attributes;
    if (!a?.media_title) continue;
    const rank = st.state === "playing" ? 2 : st.state === "paused" && o.show_paused ? 1 : 0;
    const at = updated(st);
    if (rank && (rank > bestRank || (rank === bestRank && at > bestAt))) [best, bestRank, bestAt] = [id, rank, at];
  }
  return best;
}

// Seconds into the song at `t`, and its length (0 when it has none: a stream).
export function position(st, t) {
  const a = st?.attributes || {};
  const d = Math.max(0, Number(a.media_duration) || 0);
  let p = Number(a.media_position) || 0;
  const u = updated(st);
  if (st?.state === "playing" && u) p += Math.max(0, t - u);
  return { pos: d ? Math.min(d, Math.max(0, p)) : Math.max(0, p), dur: d };
}

export const clock = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

// A play triangle or two pause bars, filled, in `r`.
function mark(r, playing, S) {
  const s = Math.min(r.w, r.h) * 0.8, x0 = r.cx - s / 2, y0 = r.cy - s / 2;
  if (playing) return [S.stroke([[x0 + s * 0.1, y0], [x0 + s, r.cy], [x0 + s * 0.1, y0 + s]], { closed: true, role: "accent", fill: true })];
  const bw = s * 0.24;
  return [x0 + s * 0.06, x0 + s * 0.7].map((x) =>
    S.stroke([[x, y0], [x + bw, y0], [x + bw, y0 + s], [x, y0 + s]], { closed: true, role: "line", fill: true }));
}

function bar(r, f, style, S) {
  const y = r.cy, xf = r.x0 + r.w * f, out = [];
  if (style === "blocks") {
    const n = Math.max(8, Math.min(30, Math.round(r.w / (r.h * 0.9)))), cw = r.w / n, bh = Math.min(r.h * 0.6, cw * 1.4);
    for (let i = 0; i < n; i++) {
      const x0 = r.x0 + i * cw + cw * 0.15, x1 = r.x0 + (i + 1) * cw - cw * 0.15, on = (i + 0.5) / n <= f;
      out.push(S.stroke([[x0, y - bh / 2], [x1, y - bh / 2], [x1, y + bh / 2], [x0, y + bh / 2]],
        { closed: true, role: on ? "accent" : "dim", fill: on, w: on ? 1 : 0.6 }));
    }
    return out;
  }
  if (f < 1) out.push(S.stroke([[xf, y], [r.x1, y]], { role: "dim", w: style === "dotted" ? S.DOTTED : 0.6 }));
  if (f > 0) out.push(S.stroke([[r.x0, y], [xf, y]], { role: "accent", w: 2.2 }));
  const kr = Math.min(r.h * 0.32, r.w * 0.03);
  out.push(S.stroke(Array.from({ length: 16 }, (_, i) => [xf + kr * Math.cos((Math.PI * i) / 8), y + kr * Math.sin((Math.PI * i) / 8)]),
    { closed: true, role: "accent", fill: true }));
  return out;
}

// Lines of `s` at most `max`, as tall as `hh` (smaller to fit `r`), centred.
function titleLines(s, max, hh, r, S) {
  let ls = S.wrap(s, r.w / hh);
  if (ls.length > max) ls = [...ls.slice(0, max - 1), ls.slice(max - 1).join(" ")];
  const ht = Math.min(hh, r.h / (1 + PITCH * (ls.length - 1)), ...ls.map((l) => r.w / Math.max(1e-6, S.width(l, 1))));
  return { ls, ht };
}

// Everything but the bar and the times: the text strokes, and the boxes.
function lay(w, h, o, st, S) {
  const L = S.layout(w, h, o.layout);
  const a = st.attributes, ts = Number(o.text_size) || 1;
  const title = S.title(a.media_title || ""), artist = S.title(a.media_artist || a.media_album_artist || "");
  const album = o.show_album ? S.title(a.media_album_name || "") : "";
  const full = S.inset(S.rect(-w, -h, w, h), w * 0.08, h * 0.1);
  const max = Math.max(1, Math.min(3, Math.round(Number(o.title_lines) || 2)));
  const th = Math.min(0.34, h * 0.2) * ts * L.size("title");
  const nTitle = Math.min(max, S.wrap(title, full.w / th).length || 1);
  const timesOn = o.times !== "none", barOn = o.bar !== "none";
  const rowOn = (barOn && L.flow("bar")) || (o.state_icon && L.flow("state"));
  const bands = S.stack(full, [
    title && L.flow("title") && { key: "title", h: th * (1 + PITCH * (nTitle - 1)) },
    artist && L.flow("artist") && { key: "artist", h: Math.min(0.22, h * 0.13) * ts * L.size("artist") },
    album && L.flow("album") && { key: "album", h: Math.min(0.18, h * 0.11) * ts * L.size("album") },
    rowOn && { key: "gap", h: h * 0.06 },
    rowOn && { key: "row", h: Math.min(0.14, h * 0.09) },
    timesOn && L.flow("times") && { key: "times", h: Math.min(0.13, h * 0.08) * ts * L.size("times") },
  ], h * 0.045, { spread: true });
  const out = [];
  if (title && L.show("title")) {
    const r = L.box("title", bands.title || null);
    if (r) {
      const { ls, ht } = titleLines(title, max, th, r, S);
      out.push(...S.lines(ls, ht, r, { pitch: PITCH, align: L.align("title"), role: "text" }));
    }
  }
  for (const [k, s, role] of [["artist", artist, "line"], ["album", album, "dim"]]) {
    if (!s || !L.show(k)) continue;
    const r = L.box(k, bands[k] || null);
    if (r) out.push(...S.fitText(s, r, r.h, { role, align: L.align(k) }));
  }
  // The row: the mark on the left (when it flows), the bar in the rest.
  const row = bands.row || bands.times || full;
  const markIn = o.state_icon && L.flow("state");
  const autoMark = markIn ? S.rect(row.x0, row.y0, row.x0 + row.h * 1.1, row.y1) : null;
  const autoBar = S.rect(row.x0 + (markIn ? row.h * 1.9 : 0), row.y0, row.x1, row.y1);
  const autoTimes = bands.times ? S.rect(autoBar.x0, bands.times.y0, autoBar.x1, bands.times.y1) : null;
  const boxes = {
    state: o.state_icon && L.show("state") ? L.box("state", autoMark) : null,
    bar: barOn && L.show("bar") ? L.box("bar", autoBar) : null,
    times: timesOn && L.show("times") ? L.box("times", autoTimes) : null,
  };
  return { out, boxes, pct: L.boxes, align: L.align("times", "") };
}

export default {
  type: "nowplaying",
  rotation({ data, options, states }) {
    return { skip: !!options.skip_empty && !choose(pick(states, data, "states"), options) };
  },
  draw({ w, h, t, data, options: o, states, memo, S }) {
    states = pick(states, data, "states");
    memo ??= {};
    t = t ?? Date.now() / 1000;
    // Which player: looked for once a second, not on every state change in the house.
    const sec = Math.floor(t);
    if (memo.sec !== sec || memo.o !== o) {
      memo.sec = sec;
      memo.o = o;
      memo.id = choose(states, o);
    }
    const st = memo.id ? states[memo.id] : null;
    if (!st) {
      memo.boxes = {};
      const msg = S.title(o.empty) || "--";
      return S.fitText(msg, S.inset(S.rect(-w, -h, w, h), w * 0.1, h * 0.1), Math.min(0.3, h * 0.25) * (Number(o.text_size) || 1), { role: "dim" });
    }
    const a = st.attributes;
    const key = [memo.id, a.media_title, a.media_artist, a.media_album_name, w.toFixed(3), h.toFixed(3), o.text_size,
      o.show_album, o.title_lines, o.times, o.bar, o.state_icon, JSON.stringify(o.layout || {}), S.iconStamp()].join("|");
    if (memo.key !== key) {
      memo.key = key;
      memo.lay = lay(w, h, o, st, S);
    }
    const { out: text, boxes, pct, align } = memo.lay;
    memo.boxes = pct;
    const playing = st.state === "playing";
    const { pos, dur } = position(st, t);
    const out = [...text];
    if (boxes.state) out.push(...mark(boxes.state, playing, S));
    if (boxes.bar && dur) out.push(...bar(boxes.bar, pos / dur, o.bar, S));
    if (boxes.times) {
      const r = boxes.times, ht = r.h;
      const left = clock(pos), right = !dur || o.times === "elapsed" ? "" : o.times === "elapsed_remaining" ? `-${clock(dur - pos)}` : clock(dur);
      if (right) {
        out.push(...S.fitText(left, S.rect(r.x0, r.y0, r.cx, r.y1), ht, { role: "dim", align: "left" }));
        out.push(...S.fitText(right, S.rect(r.cx, r.y0, r.x1, r.y1), ht, { role: "dim", align: "right" }));
      } else {
        out.push(...S.fitText(left, r, ht, { role: "dim", align: align || (dur ? "left" : "centre") }));
      }
    }
    return out;
  },
};
