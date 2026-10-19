// Names and titles (xy `_title`, `_wrap`, `_set_title`, `_birthday`): word-wrapped
// text set as large as fits, one title or cycling through several.
// Sources: calendar events (the provider's data), any entity's state or
// attribute, or fixed text, kept to those `match`ing. In a rotation it can be
// skipped while there is nothing, and lengthened so each title shows once.
const PITCH = 1.6;   // line to line, in cap heights

// The titles to show right now, before the template.
export function titles(options, data, states) {
  const o = options;
  let list = [];
  if (o.source === "calendar") {
    list = (data?.events ?? [])
      .filter((e) => (o.events !== "all_day" || e.a) && e.d < Math.max(1, o.days || 1))
      .map((e) => e.t);
  } else if (o.source === "entity") {
    const st = o.entity ? states?.[o.entity] : null;
    if (st) {
      const v = o.attribute ? st.attributes?.[o.attribute] : st.state;
      list = Array.isArray(v) ? v : v == null ? [] : [v];
      list = list.filter((x) => !["unknown", "unavailable", "none"].includes(String(x).toLowerCase()));
    }
  } else {
    list = String(o.fixed ?? "").split("|");
  }
  const words = String(o.match ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  list = list.map((x) => String(x));
  return words.length ? list.filter((x) => words.some((wd) => x.toLowerCase().includes(wd))) : list;
}

// The titles as shown: through the template, set as the font can.
const shownTitles = (options, data, states, S) =>
  titles(options, data, states).map((n) => S.title(applyTemplate(options.template, n))).filter(Boolean);

// `title` through the template. A template without {name} is a prefix.
export function applyTemplate(template, name) {
  const t = template || "{name}";
  return t.includes("{name}") ? t.split("{name}").join(name) : `${t} ${name}`;
}

// `s` wrapped and set as large as fits 2*bw by 2*bh, at most `max` cap high and
// `maxLines` lines. Returns {lines, h}.
export function fit(S, s, bw, bh, max, maxLines) {
  const words = S.title(s);
  if (!words) return { lines: [], h: max };
  let h = max, best = null;
  for (let i = 0; i < 60; i++) {
    const lines = S.wrap(words, (2 * bw) / h);
    const tall = h * (1 + S.metrics().descender + PITCH * (lines.length - 1));
    const wide = Math.max(...lines.map((l) => S.width(l, h)));
    best = { lines, h };
    if (lines.length <= maxLines && tall <= 2 * bh && wide <= 2 * bw) break;
    h *= 0.93;
    if (h < 0.04) break;
  }
  return best;
}

export default {
  type: "text",
  // Its say in a rotation turn (alfie-stage `advance`).
  rotation({ data, options, states, S }) {
    const n = shownTitles(options, data, states, S).length;
    return { skip: !!options.skip_empty && n === 0, seconds: options.extend ? n * Math.max(1, Number(options.seconds) || 6) : 0 };
  },
  // `shown`: seconds since it came in, so a turn starts on the first title.
  draw({ w, h, t, shown: since = t, data, options, states, memo, S }) {
    const list = shownTitles(options, data, states, S);
    const secs = Math.max(1, Number(options.seconds) || 6);
    const shown = list.length ? list[Math.floor(since / secs) % list.length] : S.title(options.empty) || "--";
    const key = [shown, w.toFixed(3), h.toFixed(3), options.size, options.max_lines, S.iconStamp()].join("|");
    if (memo.key !== key) {
      memo.key = key;
      const f = fit(S, shown, w * 0.92, h * 0.88, Math.max(0.05, Number(options.size) || 0.3), Math.max(1, options.max_lines | 0 || 4));
      const top = ((f.lines.length - 1) * PITCH * f.h) / 2;
      memo.strokes = f.lines.flatMap((line, i) => S.text(line, f.h, 0, top - i * PITCH * f.h));
    }
    return memo.strokes;
  },
};
