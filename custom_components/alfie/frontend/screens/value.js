// One big readout: an optional icon, the number with its unit, and a label.
// The whole block is laid out at unit height and scaled to fit the box, so it
// fills it at any aspect. A sparkline would need history (a provider): future.
const pick = (v, d, key) => (v && Object.keys(v).length ? v : d?.[key] ?? {});

// Icon from the device class, or the entity name for plant sensors.
function autoIcon(id, st) {
  if (/soil|plant/.test(id)) return "leaf";
  const dc = st?.attributes?.device_class;
  if (["moisture", "humidity", "precipitation", "water"].includes(dc)) return "drop";
  if (["illuminance", "irradiance"].includes(dc)) return "sun";
  if (["pm1", "pm25", "pm10", "aqi", "carbon_dioxide", "volatile_organic_compounds"].includes(dc)) return "cloud";
  return "none";
}

const ICONS = (S) => ({
  leaf: (x, y, s) => S.leaf(x, y, s), drop: (x, y, s) => S.drop(x, y, s), house: (x, y, s) => S.house(x, y, s),
  sun: (x, y, s) => S.sun(x, y, s * 0.28, 8, 0.7), cloud: (x, y, s) => S.cloud(x, y, s), car: (x, y, s) => S.car(x, y, s),
});
// Any icon name (mdi:thermometer) draws that icon `s` across, as a marker does.
const iconOf = (name, S) => (S.isIcon(name) ? (x, y, s) => S.marker(name, x, y, s / S.MARKER_ICON) : ICONS(S)[name]);

export default {
  type: "value",
  draw({ w, h, data, options: o, states, memo, S }) {
    states = pick(states, data, "states");
    const st = states[o.entity];
    const raw = st ? S.number(st.state) : null;
    const name = S.title(o.label || st?.attributes?.friendly_name || (o.entity || "").split(".")[1]?.replace(/_/g, " ") || "");
    if (!o.entity) return S.text("Value", Math.min(0.3, h * 0.5), 0, 0, { role: "dim" });
    const num = S.fmt(raw, Math.max(0, Math.min(3, Number(o.decimals) || 0)));
    const unit = S.unitOf(o.unit, st?.attributes?.unit_of_measurement);
    const below = S.number(o.below), above = S.number(o.above);
    const hot = raw !== null && ((below !== null && raw < below) || (above !== null && raw > above));
    const role = hot ? "accent" : "text";
    const iconName = o.icon === "auto" ? autoIcon(o.entity, st) : o.icon;
    const icon = iconOf(iconName, S);

    // Block at unit digit height 1: number [unit], icon, label. An element in a
    // box of its own leaves the block, and the rest grows to fill the room.
    const L = S.layout(w, h, o.layout);
    if (memo) memo.boxes = L.boxes;
    const iconIn = icon && L.flow("icon"), nameIn = name && L.flow("name"), numIn = L.flow("number");
    const bigUnit = unit === "°" || unit === "%";
    const uh = bigUnit ? 1 : 0.42;
    const uw = unit ? S.width(unit, uh) + 0.12 : 0;
    const nw = S.width(num, 1), rowW0 = nw + uw;
    const lh = 0.28 * (Number(o.text_size) || 1) * L.size("name"), lw = nameIn ? S.width(name, lh) : 0;
    const wide = w >= 1.3 * h, ih = icon ? 0.95 * L.size("icon") : 0;
    const rowW = (numIn ? rowW0 : 0) + (iconIn && wide ? ih + (numIn ? 0.25 : 0) : 0);
    const rowH = numIn || (iconIn && wide) ? Math.max(numIn ? 1 : 0, iconIn && wide ? ih : 0) : 0;
    const blockW = Math.max(rowW, lw, 1e-6);
    const blockH = Math.max(1e-6, rowH + (iconIn && !wide ? ih + (rowH ? 0.25 : 0) : 0) + (nameIn ? lh + (rowH || iconIn ? 0.3 : 0) : 0));
    const k = Math.min((2 * w * 0.9) / blockW, (2 * h * 0.88) / blockH, h * 1.2);

    let y = (blockH * k) / 2;        // walking down from the top of the block
    const out = [];
    const auto = {};
    if (iconIn && !wide) {
      auto.icon = S.rect(-(ih * k) / 2, y - ih * k, (ih * k) / 2, y);
      y -= (ih + 0.25) * k;
    }
    const cy = y - (rowH * k) / 2;
    let x = -(rowW * k) / 2;
    if (iconIn && wide) {
      auto.icon = S.rect(x, cy - (ih * k) / 2, x + ih * k, cy + (ih * k) / 2);
      x += (ih + 0.25) * k;
    }
    if (numIn) auto.number = S.rect(x, cy - k / 2, x + rowW0 * k, cy + k / 2);
    if (nameIn) auto.name = S.rect(-(lw * k) / 2, y - (rowH + 0.3 + lh) * k, (lw * k) / 2, y - (rowH + 0.3) * k);

    if (icon && L.show("icon")) {
      const B = L.box("icon", auto.icon || null), s = Math.min(B.w, B.h);
      out.push(...icon(B.cx, B.cy, s).map((st) => ({ ...st, role })));
    }
    if (L.show("number")) {
      // The number and its unit as one group, `kk` tall, its left edge at x0.
      const B = L.box("number", auto.number || null);
      const kk = L.own("number") ? Math.min(B.h, B.w / rowW0) * Math.min(1, L.size("number")) : k;
      const al = L.align("number");
      const x0 = al === "left" ? B.x0 : al === "right" ? B.x1 - rowW0 * kk : B.cx - (rowW0 * kk) / 2;
      out.push(...S.text(num, kk, x0 + (nw * kk) / 2, B.cy, { role }));
      if (unit) out.push(...S.text(unit, uh * kk, x0 + (nw + 0.12) * kk + (S.width(unit, uh * kk)) / 2, bigUnit ? B.cy : B.cy - ((1 - uh) * kk) / 2, { role }));
    }
    if (name && L.show("name")) {
      const B = L.box("name", auto.name || null);
      out.push(...S.fitText(name, B, L.own("name") ? B.h * Math.min(1, L.size("name")) : lh * k, { role: "dim", align: L.align("name") }));
    }
    return out;
  },
};
