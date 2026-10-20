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
  draw({ w, h, data, options: o, states, S }) {
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

    // Block at unit digit height 1: number [unit], icon, label.
    const bigUnit = unit === "°" || unit === "%";
    const uh = bigUnit ? 1 : 0.42;
    const uw = unit ? S.width(unit, uh) + 0.12 : 0;
    const nw = S.width(num, 1), rowW0 = nw + uw;
    const lh = 0.28 * (Number(o.text_size) || 1), lw = name ? S.width(name, lh) : 0;
    const wide = w >= 1.3 * h, ih = icon ? 0.95 : 0;
    const rowW = rowW0 + (icon && wide ? ih + 0.25 : 0);
    const blockW = Math.max(rowW, lw);
    const blockH = 1 + (icon && !wide ? ih + 0.25 : 0) + (name ? lh + 0.3 : 0);
    const k = Math.min((2 * w * 0.9) / blockW, (2 * h * 0.88) / blockH, h * 1.2);

    let y = (blockH * k) / 2;        // walking down from the top of the block
    const out = [];
    if (icon && !wide) {
      out.push(...icon(0, y - (ih * k) / 2, ih * k).map((s) => ({ ...s, role })));
      y -= (ih + 0.25) * k;
    }
    const cy = y - k / 2;
    const x0 = -(rowW * k) / 2;
    let x = x0;
    if (icon && wide) {
      out.push(...icon(x + (ih * k) / 2, cy, ih * k).map((s) => ({ ...s, role })));
      x += (ih + 0.25) * k;
    }
    out.push(...S.text(num, k, x + (nw * k) / 2, cy, { role }));
    if (unit) out.push(...S.text(unit, uh * k, x + (nw + 0.12) * k + (S.width(unit, uh * k)) / 2, bigUnit ? cy : cy - ((1 - uh) * k) / 2, { role }));
    if (name) out.push(...S.text(name, lh * k, 0, y - (1 + 0.3 + lh / 2) * k, { role: "dim" }));
    return out;
  },
};
