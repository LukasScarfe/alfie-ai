// Volume: a player's volume as a speaker icon and a slider (design.md
// "Voice screens", Volume). Voice screens make one when Alfie changes a
// volume; nothing else on it unless the percentage or the name is turned on.
// The knob eases to a new level as the player reports it.
const pick = (v, d, key) => (v && Object.keys(v).length ? v : d?.[key] ?? {});
const SLIDE = 7;        // how fast the knob follows the volume (1/s, eased)

// The volume 0..1 (null when the player has none), and whether it is muted.
export function level(st) {
  const v = Number(st?.attributes?.volume_level);
  return { v: st && Number.isFinite(v) && st.attributes.volume_level !== null ? Math.max(0, Math.min(1, v)) : null,
    muted: !!st?.attributes?.is_volume_muted };
}

export function iconFor(v, muted) {
  if (muted || v === 0) return "mdi:volume-off";
  return v === null || v > 0.66 ? "mdi:volume-high" : v > 0.33 ? "mdi:volume-medium" : "mdi:volume-low";
}

function slider(r, f, style, live, S) {
  const y = r.cy, xf = r.x0 + r.w * f, out = [], on = live ? "accent" : "dim";
  if (style === "blocks") {
    const n = Math.max(8, Math.min(20, Math.round(r.w / (r.h * 0.7)))), cw = r.w / n, bh = Math.min(r.h * 0.8, cw * 1.6);
    for (let i = 0; i < n; i++) {
      const x0 = r.x0 + i * cw + cw * 0.15, x1 = r.x0 + (i + 1) * cw - cw * 0.15, lit = (i + 0.5) / n <= f;
      out.push(S.stroke([[x0, y - bh / 2], [x1, y - bh / 2], [x1, y + bh / 2], [x0, y + bh / 2]],
        { closed: true, role: lit ? on : "dim", fill: lit, w: lit ? 1 : 0.6 }));
    }
    return out;
  }
  if (f < 1) out.push(S.stroke([[xf, y], [r.x1, y]], { role: "dim", w: style === "dotted" ? S.DOTTED : 0.6 }));
  if (f > 0) out.push(S.stroke([[r.x0, y], [xf, y]], { role: on, w: 2.6 }));
  const kr = Math.min(r.h * 0.45, r.w * 0.04);
  out.push(S.stroke(Array.from({ length: 16 }, (_, i) => [xf + kr * Math.cos((Math.PI * i) / 8), y + kr * Math.sin((Math.PI * i) / 8)]),
    { closed: true, role: on, fill: true }));
  return out;
}

export default {
  type: "volume",
  draw({ w, h, t, data, options: o, states, memo, S }) {
    states = pick(states, data, "states");
    memo ??= {};
    t = t ?? Date.now() / 1000;
    const st = o.entity ? states[o.entity] : null;
    const { v, muted } = level(st);
    const L = S.layout(w, h, o.layout);
    const ts = Number(o.text_size) || 1;
    const full = S.inset(S.rect(-w, -h, w, h), w * 0.08, h * 0.1);
    // The knob follows the volume a frame at a time; it starts where the volume is.
    const target = v ?? 0;
    const k = memo.knob ??= { p: target, t };
    const dt = Math.max(0, Math.min(0.1, t - k.t));
    k.t = t;
    k.p += (target - k.p) * Math.min(1, dt * SLIDE);
    if (Math.abs(target - k.p) < 0.002) k.p = target;

    const name = o.show_name ? S.title(st?.attributes?.friendly_name || o.entity?.split(".")[1]?.replace(/_/g, " ") || "") : "";
    const pct = o.show_percent ? (v === null ? "--" : `${Math.round(v * 100)}%`) : "";
    // One centred block: the name above a row of the icon, the slider and the number.
    const rowH = Math.min(full.h, full.w * 0.22, 0.5);
    const nameH = Math.min(0.24, h * 0.14) * ts * L.size("name");
    const gap = h * 0.1;
    const list = [name && L.flow("name") && { key: "name", h: nameH }, { key: "row", h: rowH }].filter(Boolean);
    const tall = Math.min(full.h, list.reduce((a, b) => a + b.h, 0) + gap * (list.length - 1));
    const bands = S.stack(S.rect(full.x0, full.cy - tall / 2, full.x1, full.cy + tall / 2), list, gap);
    const row = bands.row;
    const iconIn = L.flow("icon"), pctIn = pct && L.flow("percent");
    const pctH = Math.min(row.h * 0.55, 0.26 * ts * L.size("percent"));
    const pctW = pctIn ? S.width("100%", 1) * pctH : 0;
    const x0 = row.x0 + (iconIn ? row.h * 1.25 : 0), x1 = row.x1 - (pctIn ? pctW + row.h * 0.3 : 0);
    const out = [];
    const bi = L.show("icon") ? L.box("icon", iconIn ? S.rect(row.x0, row.y0, row.x0 + row.h, row.y1) : null) : null;
    if (bi) {
      const icon = o.icon && o.icon !== "auto" ? o.icon : iconFor(v, muted);
      out.push(...S.marker(icon, bi.cx, bi.cy, (Math.min(bi.w, bi.h) * 0.95) / S.MARKER_ICON, { role: muted ? "dim" : "line" }));
    }
    const bs = L.show("slider") ? L.box("slider", S.rect(x0, row.cy - row.h * 0.2, x1, row.cy + row.h * 0.2)) : null;
    if (bs) out.push(...slider(bs, k.p, o.slider, v !== null && !muted, S));
    const bp = pct && L.show("percent") ? L.box("percent", pctIn ? S.rect(row.x1 - pctW, row.cy - pctH / 2, row.x1, row.cy + pctH / 2) : null) : null;
    if (bp) out.push(...S.fitText(pct, bp, bp.h, { role: "text", align: L.align("percent", "right") }));
    const bn = name && L.show("name") ? L.box("name", bands.name || null) : null;
    if (bn) out.push(...S.fitText(name, bn, bn.h, { role: "dim", align: L.align("name") }));
    memo.boxes = L.boxes;
    return out;
  },
};
