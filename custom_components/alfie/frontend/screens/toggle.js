// Switches: an entity's icon with a switch that slides to its state, its
// name and its state (design.md "Voice screens"). One entity fills the
// screen; several are a grid of cells. Voice screens make one when Alfie
// switches something ("action": the knob starts at `from` and slides once
// the screen is in) or is asked about something that is on or off.
const pick = (v, d, key) => (v && Object.keys(v).length ? v : d?.[key] ?? {});
const OFF = new Set(["off", "closed", "closing", "locked", "not_home", "standby", "docked", "false", ""]);
const DEAD = new Set(["unavailable", "unknown"]);
const SWITCHY = new Set(["light", "switch", "fan", "input_boolean", "binary_sensor", "lock", "cover",
  "media_player", "climate", "valve", "siren", "humidifier", "vacuum", "automation"]);
const HOLD = 0.45;      // seconds the switch waits at `from` before it slides
const SLIDE = 7;        // how fast it slides (1/s, eased)

export const isOn = (state) => !OFF.has(String(state ?? "").toLowerCase()) && !DEAD.has(String(state));

// Icon by name words first (a coffee maker is an outlet to HA), then kind.
const BY_WORD = [
  [/coffee|espresso/, "mdi:coffee-maker"], [/grow|plant|monstera|ficus|orchid/, "mdi:sprout"], [/\blamp\b/, "mdi:lamp"],
  [/\btv\b|television/, "mdi:television"], [/speaker/, "mdi:speaker"], [/\bpc\b|computer/, "mdi:desktop-tower-monitor"],
  [/tablet/, "mdi:tablet"], [/scope/, "mdi:sine-wave"], [/string|fairy/, "mdi:string-lights"],
  [/fan\b/, "mdi:fan"], [/heater/, "mdi:radiator"], [/kettle/, "mdi:kettle"],
];
const BY_KIND = {
  light: ["mdi:lightbulb", "mdi:lightbulb-outline"], switch: ["mdi:toggle-switch-variant", "mdi:toggle-switch-variant-off"],
  "switch.outlet": ["mdi:power-plug", "mdi:power-plug-off"], fan: ["mdi:fan", "mdi:fan-off"],
  input_boolean: ["mdi:check-circle-outline", "mdi:close-circle-outline"], lock: ["mdi:lock", "mdi:lock-open-variant"],
  cover: ["mdi:window-shutter-open", "mdi:window-shutter"], climate: ["mdi:thermostat", "mdi:thermostat"],
  "binary_sensor.motion": ["mdi:motion-sensor", "mdi:motion-sensor-off"], "binary_sensor.occupancy": ["mdi:home-account", "mdi:home-outline"],
  "binary_sensor.presence": ["mdi:home-account", "mdi:home-outline"], "binary_sensor.door": ["mdi:door-open", "mdi:door-closed"],
  "binary_sensor.window": ["mdi:window-open", "mdi:window-closed"], binary_sensor: ["mdi:checkbox-marked-circle", "mdi:radiobox-blank"],
  "media_player.tv": ["mdi:television", "mdi:television-off"], "media_player.speaker": ["mdi:speaker", "mdi:speaker-off"],
  media_player: ["mdi:cast", "mdi:cast-off"], person: ["mdi:account", "mdi:account-outline"],
  "sensor.temperature": ["mdi:thermometer"], "sensor.humidity": ["mdi:water-percent"], "sensor.moisture": ["mdi:water"],
  "sensor.power": ["mdi:flash"], "sensor.aqi": ["mdi:air-filter"], sensor: ["mdi:eye"], scene: ["mdi:palette"],
  script: ["mdi:script-text"], todo: ["mdi:clipboard-list"], schedule: ["mdi:calendar-clock"], automation: ["mdi:robot"],
  weather: ["mdi:weather-partly-cloudy"], vacuum: ["mdi:robot-vacuum"], valve: ["mdi:valve-open", "mdi:valve-closed"],
};
export function iconFor(id, st, on) {
  const own = st?.attributes?.icon;
  if (own) return own;
  const name = `${st?.attributes?.friendly_name || ""} ${id}`.toLowerCase().replace(/_/g, " ");
  for (const [re, ic] of BY_WORD) if (re.test(name)) return ic;
  const domain = id.split(".")[0], dc = st?.attributes?.device_class;
  const k = BY_KIND[`${domain}.${dc}`] || BY_KIND[domain] || ["mdi:shape-outline"];
  return k[on || k.length === 1 ? 0 : 1];
}

const per = (v, i) => String(v ?? "").split(",").map((x) => x.trim())[i] || "";

// A switch's track `r` (a stadium) and its knob at `p` (0 off .. 1 on).
function drawSwitch(r, p, live, S) {
  const h = Math.min(r.h, r.w * 0.5), w = h * 2, x0 = r.cx - w / 2, y0 = r.cy - h / 2, rad = h / 2;
  const role = live && p > 0.5 ? "accent" : live ? "line" : "dim";
  const arc = (cx, a0, a1) => Array.from({ length: 13 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / 12;
    return [cx + rad * Math.cos(a), y0 + rad + rad * Math.sin(a)];
  });
  const track = [...arc(x0 + rad, Math.PI / 2, (3 * Math.PI) / 2), ...arc(x0 + w - rad, -Math.PI / 2, Math.PI / 2)];
  const kx = x0 + rad + (w - 2 * rad) * p, kr = rad * 0.68;
  const knob = Array.from({ length: 20 }, (_, i) => [kx + kr * Math.cos((2 * Math.PI * i) / 20), y0 + rad + kr * Math.sin((2 * Math.PI * i) / 20)]);
  return [S.stroke(track, { closed: true, role }), S.stroke(knob, { closed: true, role, fill: p > 0.5 })];
}

function stateText(st, action, S) {
  if (!st) return "Not found";
  const s = String(st.state);
  if (DEAD.has(s)) return S.title(s);
  const n = S.number(s);
  if (n !== null) {
    const u = st.attributes?.unit_of_measurement || "";
    return `${S.fmt(n, Number.isInteger(n) ? 0 : 1)}${u ? ` ${u}` : ""}`;
  }
  const t = s.replace(/_/g, " ");
  const txt = action ? `${t} now` : t;
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

// The knob's place for entity `id`, slid toward its state a frame at a time.
function knob(memo, id, target, from, shown, t, action) {
  memo.knob ??= {};
  let k = memo.knob[id];
  if (!k) {
    // Where the slide from `from` has got to by now: exact at any frame rate,
    // and a still (shown long after) shows it home.
    const p0 = from !== "" ? (isOn(from) ? 1 : 0) : target;
    const run = action ? Math.max(0, shown - HOLD) : Infinity;
    k = memo.knob[id] = { p: target + (p0 - target) * Math.exp(-SLIDE * run), t };
  }
  const dt = Math.max(0, Math.min(0.1, t - k.t));
  k.t = t;
  if (!action || shown >= HOLD) k.p += (target - k.p) * Math.min(1, dt * SLIDE);
  if (Math.abs(target - k.p) < 0.002) k.p = target;
  return k.p;
}

function cell(r, e, o, ctx, L, S) {
  const { states, memo, shown, t } = ctx;
  const st = states[e.id], live = !!st && !DEAD.has(String(st.state));
  const on = live && isOn(st.state), switchy = SWITCHY.has(e.id.split(".")[0]) && !(S.number(st?.state) !== null);
  const iconName = e.icon && e.icon !== "auto" ? e.icon : iconFor(e.id, st, on);
  const name = o.show_name === false ? "" : S.title(e.label || st?.attributes?.friendly_name || e.id.split(".")[1]?.replace(/_/g, " ") || "");
  const ts = Number(o.text_size) || 1, single = !!L;
  const has = (k) => !L || L.flow(k);
  const nameH = Math.min(r.h * 0.13, 0.3) * ts * (L ? L.size("name") : 1);
  const stateH = nameH * 0.8 * (L ? L.size("state") : 1);
  const bands = S.stack(r, [
    has("icon") && { key: "icon", grow: 1, min: r.h * 0.2 },
    switchy && has("switch") && { key: "switch", h: r.h * (single ? 0.17 : 0.2) },
    name && has("name") && { key: "name", h: nameH },
    (single || !switchy) && (!switchy || o.show_state !== false) && has("state") && { key: "state", h: stateH },
  ], r.h * 0.05);
  const box = (k) => (L ? L.box(k, bands[k] || null) : bands[k] || null);
  const out = [];
  const role = on || !switchy ? "text" : "dim";
  const bi = box("icon");
  if (bi && (!L || L.show("icon"))) {
    const s = Math.min(bi.w, bi.h) * 0.92;
    out.push(...S.marker(iconName, bi.cx, bi.cy, s / S.MARKER_ICON, { role: on ? "accent" : "line" }));
  }
  const bs = switchy ? box("switch") : null;
  if (bs && (!L || L.show("switch"))) {
    const p = knob(memo, e.id, live ? (on ? 1 : 0) : 0.5, e.from, shown, t, o.action);
    out.push(...drawSwitch(bs, p, live, S));
  }
  const bn = box("name");
  if (bn && name && (!L || L.show("name"))) out.push(...S.fitText(name, bn, bn.h, { role, align: L ? L.align("name") : "centre" }));
  const bt = !switchy || o.show_state !== false ? box("state") : null;
  if (bt && (!L || L.show("state"))) out.push(...S.fitText(stateText(st, o.action && switchy, S), bt, bt.h, { role: "dim", align: L ? L.align("state") : "centre" }));
  return out;
}

export default {
  type: "toggle",
  draw({ w, h, t, shown, data, options: o, states, memo, S }) {
    states = pick(states, data, "states");
    memo ??= {};
    const ids = (o.entities || []).slice(0, 12);
    if (!ids.length) return S.text("Switches", Math.min(0.3, h * 0.5), 0, 0, { role: "dim" });
    const ents = ids.map((id, i) => ({ id, label: per(o.labels, i), icon: per(o.icons, i), from: per(o.from, i) }));
    const L = S.layout(w, h, o.layout);
    const ts = Number(o.text_size) || 1;
    const titleText = o.title ? S.title(o.title) : "";
    const more = Number(o.more) || 0;
    const full = S.inset(S.rect(-w, -h, w, h), w * 0.06, h * 0.06);
    const bands = S.stack(full, [
      titleText && L.flow("title") && { key: "title", h: Math.min(0.32, h * 0.16) * ts * L.size("title") },
      { key: "body", grow: 1 },
      more > 0 && { key: "more", h: Math.min(0.24, h * 0.1) * ts },
    ], h * 0.05);
    const out = [];
    const ctx = { states, memo, shown: shown ?? 0, t: t ?? Date.now() / 1000 };
    if (titleText && L.show("title")) {
      const bt = L.box("title", bands.title || null);
      if (bt) out.push(...S.fitText(titleText, bt, bt.h, { role: "text", align: L.align("title") }));
    }
    const body = bands.body;
    if (ents.length === 1) {
      out.push(...cell(body, ents[0], o, ctx, L, S));
    } else {
      // The grid whose cells come closest to a little taller than wide.
      let best = null;
      for (let cols = 1; cols <= ents.length; cols++) {
        const rows = Math.ceil(ents.length / cols), cw = body.w / cols, ch = body.h / rows;
        const fit = Math.min(cw / 0.85, ch);
        if (!best || fit > best.fit) best = { cols, rows, cw, ch, fit };
      }
      const { cols, cw, ch } = best;
      ents.forEach((e, i) => {
        const row = Math.floor(i / cols), col = i % cols;
        const inRow = Math.min(cols, ents.length - row * cols);
        const x0 = body.cx - (inRow * cw) / 2 + col * cw, y1 = body.y1 - row * ch;
        out.push(...cell(S.inset(S.rect(x0, y1 - ch, x0 + cw, y1), cw * 0.08, ch * 0.06), e, o, ctx, null, S));
      });
    }
    if (more > 0 && bands.more) out.push(...S.fitText(`+${more} more`, bands.more, bands.more.h, { role: "dim" }));
    memo.boxes = L.boxes;
    return out;
  },
};
