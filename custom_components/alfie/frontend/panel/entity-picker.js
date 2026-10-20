// A searchable entity list for every place the panel takes an entity id, like
// HA's own entity picker: each entity with its icon, friendly name and id. Not
// HA's <ha-entity-picker>: HA-internal elements change between frontend
// versions and are not loaded in a custom panel (as in icon-picker.js).
//
// An input opts in with data-entities. The choices are its datalist's options
// (data-list="...", or list="..."), so each place keeps its own filter (a domain, "has a
// position"); the native datalist popup is switched off once the picker owns
// the input. A typed pattern such as sensor.*_moisture still goes, and the list
// then says how many entities it matches. Picking writes the value and fires
// input and change, exactly as if it had been typed.

const SHOWN = 50;
const PATTERN = /[*?[]/;

// Icons by domain when an entity has none of its own (HA's defaults, roughly).
const DOMAIN_ICONS = {
  sensor: "mdi:eye", binary_sensor: "mdi:checkbox-blank-circle-outline", light: "mdi:lightbulb", switch: "mdi:toggle-switch-outline",
  person: "mdi:account", device_tracker: "mdi:map-marker", zone: "mdi:map-marker-radius", weather: "mdi:weather-partly-cloudy",
  input_boolean: "mdi:toggle-switch-outline", input_number: "mdi:ray-vertex", number: "mdi:ray-vertex", counter: "mdi:counter",
  input_select: "mdi:format-list-bulleted", select: "mdi:format-list-bulleted", climate: "mdi:thermostat", fan: "mdi:fan",
  cover: "mdi:window-shutter", lock: "mdi:lock", media_player: "mdi:cast", sun: "mdi:white-balance-sunny", calendar: "mdi:calendar",
  automation: "mdi:robot", script: "mdi:script-text-outline", scene: "mdi:palette", camera: "mdi:video", vacuum: "mdi:robot-vacuum",
  update: "mdi:package-up", button: "mdi:gesture-tap-button", todo: "mdi:clipboard-list", assist_satellite: "mdi:account-voice",
  schedule: "mdi:calendar-clock", alarm_control_panel: "mdi:shield-home", water_heater: "mdi:thermometer", remote: "mdi:remote",
};
export const iconOf = (id, state) => state?.attributes?.icon || DOMAIN_ICONS[String(id).split(".")[0]] || "mdi:shape-outline";

// Entities [{id, name}] for `query`, best first: every word of the query must
// be in the id or the name; ids or names starting with the query come first.
export function matchEntities(list, query, n = SHOWN) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return list.slice(0, n);
  const words = q.split(/\s+/);
  const first = [], rest = [];
  for (const e of list) {
    const id = e.id.toLowerCase(), name = (e.name || "").toLowerCase(), obj = id.slice(id.indexOf(".") + 1);
    if (!words.every((w) => id.includes(w) || name.includes(w))) continue;
    (id.startsWith(q) || obj.startsWith(q) || name.startsWith(q) ? first : rest).push(e);
  }
  return [...first, ...rest].slice(0, n);
}

// How many of `ids` a pattern such as sensor.*_moisture matches (fnmatch-like, as the engine reads it).
export function patternCount(ids, pattern) {
  const rx = new RegExp(`^${String(pattern).trim().replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return ids.filter((id) => rx.test(id)).length;
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Pickers for the data-entities inputs under `body`, drawn in shadow root `root`.
// `hass()` gives the current hass (for names and icons).
export function attach(root, body, hass) {
  const box = document.createElement("div");
  box.className = "entpick";
  box.setAttribute("role", "listbox");
  box.hidden = true;
  const style = document.createElement("style");
  style.textContent = `
    .entpick { position: fixed; z-index: 10; max-height: 320px; overflow-y: auto; min-width: 300px;
      background: var(--card-background-color, #fff); color: var(--primary-text-color);
      border: 1px solid var(--divider-color); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.25); padding: 4px 0; }
    .entpick .opt { display: flex; align-items: center; gap: 16px; padding: 6px 16px; cursor: pointer; min-height: 48px; }
    .entpick .opt ha-icon { --mdc-icon-size: 24px; flex: none; color: var(--state-icon-color, var(--secondary-text-color)); }
    .entpick .opt span { display: flex; flex-direction: column; min-width: 0; }
    .entpick .opt b { font-weight: 400; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .entpick .opt small { margin: 0; font-size: 12px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .entpick .opt.on, .entpick .opt:hover { background: rgba(127,127,127,.12); }
    .entpick .info { padding: 10px 16px; font-size: 13px; color: var(--secondary-text-color); }`;
  root.append(style, box);

  let input = null, shown = [], active = -1, quiet = false;
  const lists = new WeakMap();   // input -> its datalist's id (the attribute comes off)

  const close = () => { box.hidden = true; shown = []; active = -1; };

  const choices = () => {
    const id = lists.get(input) || input.dataset.list;
    const dl = id && root.getElementById(id);
    const states = hass()?.states || {};
    const ids = dl ? [...dl.options].map((o) => o.value) : Object.keys(states).sort();
    return ids.map((e) => ({ id: e, name: states[e]?.attributes?.friendly_name || "" }));
  };

  const place = () => {
    const r = input.getBoundingClientRect();
    const below = innerHeight - r.bottom, up = below < 240 && r.top > below;
    const w = Math.max(300, r.width);
    box.style.left = `${Math.max(4, Math.min(r.left, innerWidth - w - 4))}px`;
    box.style.width = `${w}px`;
    box.style.top = up ? "" : `${r.bottom + 2}px`;
    box.style.bottom = up ? `${innerHeight - r.top + 2}px` : "";
  };

  const update = () => {
    if (!input?.isConnected) return close();
    const q = input.value, all = choices(), states = hass()?.states || {};
    if (PATTERN.test(q)) {
      const n = patternCount(all.map((e) => e.id), q);
      shown = [];
      box.innerHTML = `<div class="info">Pattern: matches ${n} entit${n === 1 ? "y" : "ies"}.</div>`;
    } else {
      shown = matchEntities(all, q);
      if (!shown.length || (shown.length === 1 && shown[0].id === q.trim())) return close();
      box.innerHTML = shown.map((e, i) => `<div class="opt${i === active ? " on" : ""}" role="option" data-i="${i}">
        <ha-icon icon="${esc(iconOf(e.id, states[e.id]))}"></ha-icon><span><b>${esc(e.name || e.id)}</b><small>${esc(e.id)}</small></span></div>`).join("");
    }
    box.hidden = false;
    place();
    box.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  };

  const pick = (e) => {
    input.value = e.id;
    close();
    quiet = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    quiet = false;
  };

  body.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("input[data-entities]");
    if (!el) return;
    if (el.hasAttribute("list")) { lists.set(el, el.getAttribute("list")); el.removeAttribute("list"); }
    el.autocomplete = "off";
    input = el;
    active = -1;
    update();
  });
  body.addEventListener("focusout", (e) => { if (e.target === input) close(); });
  body.addEventListener("input", (e) => { if (e.target === input && !quiet) { active = -1; update(); } });
  // Capture, so Enter picks here before the panel's own Enter (which presses Add).
  body.addEventListener("keydown", (e) => {
    if (e.target !== input || box.hidden) return;
    const n = shown.length;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) {
      active = e.key === "ArrowDown" ? (active + 1) % n : active <= 0 ? n - 1 : active - 1;
      update();
    } else if (e.key === "Enter" && active >= 0) pick(shown[active]);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  box.addEventListener("mousedown", (e) => e.preventDefault());
  box.addEventListener("click", (e) => {
    const opt = e.target.closest(".opt");
    if (opt && input) pick(shown[Number(opt.dataset.i)]);
  });
  root.addEventListener("scroll", () => { if (!box.hidden) (input?.isConnected ? place() : close()); }, true);
  addEventListener("resize", () => { if (!box.hidden) place(); });
}
