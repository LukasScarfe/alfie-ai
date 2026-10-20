// Visual editor for custom:alfie-card, so nobody needs YAML.
//
// Plain inputs styled with HA's CSS variables, no HA-internal form elements
// (ha-form, ha-selector...): those change between frontend versions, and an
// editor that breaks is worse than a plain one. The live preview is HA's own,
// it re-renders the card from the config we emit. Only keys that differ from
// the card's defaults are written, so the YAML stays short.

const V = new URL(import.meta.url).search;
const { renameOld } = await import(`./alfie-look.js${V}`);

// Mirrors DEFAULTS in alfie-card.js (the card stays the source of truth: a
// stale entry here only means a redundant key is written, never a wrong card).
export const DEFAULTS = {
  style: "neon", ring_color: null, eye_color: null, background: "none",
  line_width: 0.035, glow: null, eye_fill: false, padding: 0.08, aspect: null,
  fps: 30, liveliness: 1, breathing: true, blinking: true, card: true,
  shapes: null, personality: null, display: "companion", rotation: null,
  present: "handover", corner: "bottom_right", corner_size: 0.3, transition: null,
  text_color: null, accent_color: null, screen_line_width: 0.02,
  appear_story: "auto", follow_mode: true, icons: true,
};

export const PRESETS = ["bubbly", "stoic", "grumpy", "sleepy", "nervous"];
// The card-overridable sliders (config.py PERSONALITY; fidget_rate is the engine's).
// Labels and hints are the panel's (Appearance → Personality), word for word.
export const SLIDERS = {
  exaggeration: { min: 0.3, max: 2, def: 1, label: "Exaggeration", hint: "How far expressions and animations go." },
  speed: { min: 0.3, max: 2.5, def: 1, label: "Speed", hint: "How quickly he moves and changes expression." },
  bounce: { min: 0, max: 2, def: 1, label: "Bounce", hint: "How much he overshoots and wobbles into place." },
  blink_rate: { min: 0.2, max: 3, def: 1, label: "Blinking", hint: "How often he blinks." },
  energy_bias: { min: -0.5, max: 0.5, def: 0, label: "Energy", hint: "Added to every mood's energy: perkier or flatter." },
};
export const SHAPE_PARAMS = {
  circle: [],
  polygon: [["sides", 3, 12, 1, 4], ["roundness", 0, 1, 0.05, 0]],
  star: [["points", 3, 12, 1, 5], ["inner", 0.1, 0.95, 0.05, 0.5], ["roundness", 0, 1, 0.05, 0]],
  superellipse: [["n", 0.5, 8, 0.1, 4]],
};
const SHAPE_COMMON = [["rotation", -180, 180, 5, 0]];
const SHAPE_PARTS = [["head", "Ring"], ["eye", "Eyes"]];
const SHAPE_TEXT = { circle: "Circle", polygon: "Polygon", star: "Star", superellipse: "Superellipse" };
const PARAM_TEXT = { sides: "Sides", roundness: "Roundness", points: "Points", inner: "Inner size", n: "Squareness", rotation: "Rotation" };
const human = (id) => { const t = String(id).replace(/_/g, " "); return t[0].toUpperCase() + t.slice(1); };
const FROM_PANEL = "Default (from Alfie's look)";

// A copy of `config` with `key` set, or removed when it equals the default.
export function applyChange(config, key, value) {
  const out = { ...config };
  const d = DEFAULTS[key];
  const empty = value === undefined || value === null || value === "";
  if (empty || (d !== null && value === d)) delete out[key];
  else out[key] = value;
  return out;
}

// A shape spec with `param` set; back at its default the key is dropped.
export function setShapeParam(spec, param, value) {
  const out = { ...spec };
  const all = [...(SHAPE_PARAMS[spec.type || "circle"] || []), ...SHAPE_COMMON];
  const def = all.find((p) => p[0] === param)?.[4];
  if (value === def) delete out[param];
  else out[param] = value;
  return out;
}

// `shapes` with one part's spec replaced (undefined = inherit); {} becomes absent.
export function setShapePart(shapes, part, spec) {
  const out = { ...(shapes || {}) };
  if (spec === undefined) delete out[part];
  else out[part] = spec;
  return Object.keys(out).length ? out : null;
}

const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v)
  ? "#" + [...v.slice(1)].map((c) => c + c).join("") : null);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let TRANSITIONS = ["cut", "fade"];
try {
  TRANSITIONS = [...(await import(`./alfie-intros.js${V}`)).STYLES];
} catch { /* the card's own intros are the truth; two always exist */ }

// The same look as Alfie's panel (design.md "Panel style"): outlined 40px
// fields with the label in the border, HA switches, 36px outlined buttons.
const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath fill='%23888' d='M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z'/%3E%3C/svg%3E\")";
const STYLE_CSS = `
  :host { display: block; color: var(--primary-text-color); font: inherit; font-size: 14px;
    --edge: var(--outline-color, rgba(127,127,127,.45)); --card: var(--card-background-color, #fff); }
  details { border: 1px solid var(--divider-color); border-radius: var(--ha-card-border-radius, 12px); margin: 0 0 12px; background: var(--card); }
  summary { cursor: pointer; padding: 0 16px; min-height: 48px; font-weight: 500; list-style: none; display: flex; gap: 12px; align-items: center; }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: ""; width: 7px; height: 7px; border: solid var(--secondary-text-color); border-width: 0 2px 2px 0;
    transform: rotate(45deg); margin: -4px 4px 0 auto; transition: transform .15s; flex: none; }
  details[open] > summary::after { transform: rotate(225deg); margin-top: 4px; }
  summary small { font-weight: 400; color: var(--secondary-text-color); flex: 1; }
  .body { padding: 4px 16px 16px; display: grid; gap: 16px; }
  .f { display: grid; gap: 6px; position: relative; }
  .f > label, .f > .l { font-size: 12px; font-weight: 500; color: var(--secondary-text-color); display: flex;
    justify-content: space-between; gap: 8px; }
  .f > label b { font-weight: 400; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  /* the label sits in the border of a single field */
  .f:has(> select, > input[type=text], > input[type=number]) { padding-top: 7px; gap: 0; }
  .f:has(> select, > input[type=text], > input[type=number]) > label { position: absolute; top: 0; left: 9px; z-index: 1;
    padding: 0 4px; line-height: 14px; background: var(--card); pointer-events: none; }
  .f:focus-within > label { color: var(--primary-color); }
  .f:has(> select, > input[type=text], > input[type=number]) > .hint { margin-top: 4px; }
  .hint { font-size: 12px; color: var(--secondary-text-color); line-height: 1.35; }
  input[type=text], input[type=number], select {
    box-sizing: border-box; width: 100%; height: 40px; padding: 0 12px; font: inherit; color: var(--primary-text-color);
    background: var(--card); border: 1px solid var(--edge); border-radius: 8px; min-width: 0; }
  select { appearance: none; -webkit-appearance: none; padding-right: 36px; cursor: pointer;
    background-image: ${CHEVRON}; background-repeat: no-repeat; background-position: right 8px center; background-size: 22px; }
  input:hover, select:hover { border-color: var(--primary-text-color); }
  input:focus, select:focus { outline: none; border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
  input[type=range] { width: 100%; accent-color: var(--primary-color); margin: 4px 0; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row input[type=color] { box-sizing: border-box; width: 44px; height: 40px; padding: 3px; flex: none; cursor: pointer;
    background: var(--card); border: 1px solid var(--edge); border-radius: 8px; }
  .f > label.chk { justify-content: space-between; color: var(--primary-text-color); font-size: 14px; font-weight: 400; }
  .chk { display: flex; align-items: center; gap: 16px; cursor: pointer; min-height: 40px; }
  .chk input { order: 2; appearance: none; -webkit-appearance: none; flex: none; width: 36px; height: 14px; margin: 0 4px; border-radius: 7px;
    background: var(--switch-unchecked-track-color, rgba(127,127,127,.5)); position: relative; cursor: pointer; overflow: visible; }
  .chk input::after { content: ""; position: absolute; top: -3px; left: -4px; width: 20px; height: 20px; border-radius: 50%;
    background: var(--switch-unchecked-button-color, #fafafa); box-shadow: 0 1px 3px rgba(0,0,0,.4); transition: left .15s; }
  .chk input:checked { background: var(--switch-checked-track-color, var(--primary-color)); }
  .chk input:checked::after { left: 20px; background: var(--switch-checked-button-color, var(--primary-color)); }
  .sub { border-left: 2px solid var(--divider-color); padding-left: 16px; display: grid; gap: 16px; }
  .sub > .l { font-weight: 500; color: var(--primary-text-color); font-size: 14px; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 16px; font: inherit;
    font-weight: 500; color: var(--primary-text-color); cursor: pointer; background: var(--card);
    border: 1px solid var(--edge); border-radius: 18px; white-space: nowrap; }
  button:hover { border-color: var(--primary-color); color: var(--primary-color); }
  button.x { width: 36px; padding: 0; flex: none; border-color: transparent; border-radius: 50%; color: var(--secondary-text-color); }
  button.x:hover { background: rgba(127,127,127,.08); border-color: transparent; color: var(--primary-text-color); }
  .steps { display: grid; gap: 8px; }
  .steps .row input[type=number] { width: 88px; flex: none; }
  .steps .alfie { flex: 1; opacity: 0.8; }
  .steps .row select, .steps .row input[type=text] { flex: 1; }
  .unset input[type=range] { opacity: .55; }
  .note { font-size: 12px; color: var(--secondary-text-color); }
  .warn { font-size: 12px; color: var(--warning-color, #ffa600); }
  details details { margin: 0; border-radius: 8px; }
  details details > summary { min-height: 44px; padding: 0 12px; }
`;

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class AlfieCardEditor extends HTMLElement {
    constructor() {
      super();
      this._config = {};
      this._open = new Set(["display"]);
      this._screens = null;     // null = not loaded, [] / [{id,...}] loaded
      this._rotations = [];
      this._stories = [];
      this._failed = false;
      this._fields = [];
      this.attachShadow({ mode: "open" });
    }

    setConfig(config) {
      // Our own emit comes straight back through HA: don't rebuild under the user's cursor.
      if (this._emitted && same(config, this._emitted)) { this._config = config; return; }
      this._config = renameOld(config);   // old YAML keys come out as the new ones on the next edit
      this._render();
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (first) this._load();
    }

    async _load() {
      try {
        const r = await this._hass.connection.sendMessagePromise({ type: "alfie/screens" });
        this._screens = r.screens || [];
        this._rotations = r.rotations || [];
        this._stories = r.stories || [];
        this._failed = false;
      } catch {
        this._failed = true;
      }
      this._render();
    }

    _emit(config) {
      this._config = config;
      this._emitted = config;
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
    }

    _get(key) { return this._config[key] ?? DEFAULTS[key]; }

    // ---- field builders: each returns {html, bind(el)} pieces through this._fields
    _add(f) { this._fields.push(f); return this._fields.length - 1; }

    _top(key) { return { get: () => this._get(key), set: (v, rerender) => { this._emit(applyChange(this._config, key, v)); if (rerender) this._render(); } }; }

    _select(label, io, options, { rerender = false, hint = "" } = {}) {
      const i = this._add({ kind: "select", io, rerender });
      const cur = io.get() ?? "";
      const opts = options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(t)}</option>`).join("");
      return `<div class="f"><label>${esc(label)}</label><select data-i="${i}">${opts}</select>${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`;
    }

    _range(label, io, min, max, step, { unset = false, hint = "", after = "" } = {}) {
      const i = this._add({ kind: "range", io });
      const v = io.get();
      return `<div class="f ${unset ? "unset" : ""}"><label>${esc(label)} <b data-out="${i}">${unset ? "Default" : v}</b></label>
        <div class="row"><input type="range" data-i="${i}" min="${min}" max="${max}" step="${step}" value="${v}">${after}</div>
        ${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`;
    }

    _bool(label, io, hint = "") {
      const i = this._add({ kind: "bool", io });
      return `<div class="f"><label class="chk"><input type="checkbox" data-i="${i}" ${io.get() ? "checked" : ""}> ${esc(label)}</label>${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`;
    }

    _text(label, io, placeholder = "", hint = "") {
      const i = this._add({ kind: "text", io });
      return `<div class="f"><label>${esc(label)}</label><input type="text" data-i="${i}" value="${esc(io.get() ?? "")}" placeholder="${esc(placeholder)}">${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`;
    }

    _color(label, key, placeholder) {
      const i = this._add({ kind: "color", io: this._top(key) });
      const v = this._config[key] ?? "";
      return `<div class="f"><label>${esc(label)}</label><div class="row">
        <input type="color" data-c="${i}" style="opacity:${v ? 1 : 0.4}" value="${hex(v) || hex(placeholder) || "#4dffa0"}" aria-label="${esc(label)} picker">
        <input type="text" data-i="${i}" value="${esc(v)}" placeholder="${esc(placeholder)}"></div></div>`;
    }

    _group(id, title, summary, inner) {
      return `<details data-g="${id}" ${this._open.has(id) ? "open" : ""}><summary>${esc(title)}<small>${esc(summary)}</small></summary><div class="body">${inner}</div></details>`;
    }

    // ---- sections
    _look() {
      const t = (k) => this._top(k);
      return [
        this._select("Style", t("style"), [["neon", "Neon"], ["flat", "Flat"], ["crt", "CRT"], ["theme", "Theme colours"]],
          { hint: "Sets the colour and glow defaults; everything below overrides it." }),
        this._color("Ring colour", "ring_color", FROM_PANEL),
        this._color("Eye colour", "eye_color", FROM_PANEL),
        this._color("Background", "background", FROM_PANEL),
        this._color("Screen text colour", "text_color", FROM_PANEL),
        this._color("Screen accent colour", "accent_color", FROM_PANEL),
        this._range("Ring and eye line width", t("line_width"), 0.005, 0.15, 0.005),
        this._range("Screen line width", t("screen_line_width"), 0.005, 0.1, 0.005, { hint: "Screens draw finer than the face." }),
        this._range("Glow", { get: () => this._config.glow ?? 0.6, set: (v) => this._emit(applyChange(this._config, "glow", v)) }, 0, 2, 0.05,
          { unset: this._config.glow == null, hint: "Left alone, the style decides." }),
        this._bool("Fill the eyes", t("eye_fill")),
        this._group("shapes", "Shapes", this._config.shapes ? "This card's own" : "Default", this._shapes()),
      ].join("");
    }

    _rotationField() {
      const rot = this._config.rotation;
      const custom = Array.isArray(rot);
      const ids = this._rotations.map((r) => [r.id, r.name || r.id]);
      let html;
      if (this._failed || this._screens === null) {
        html = this._text("Rotation id", { get: () => (typeof rot === "string" ? rot : ""), set: (v) => this._emit(applyChange(this._config, "rotation", v.trim())) },
          "living_room", this._failed ? "Could not load Alfie's rotations, so type its ID." : "Loading rotations…");
        return html;
      }
      const val = custom ? "__custom" : rot || "";
      html = this._select("Rotation", {
        get: () => val,
        set: (v) => {
          if (v === "__custom") this._emit(applyChange(this._config, "rotation", [{ screen: this._screens[0]?.id || "", seconds: 20 }]));
          else this._emit(applyChange(this._config, "rotation", v));
        },
      }, [["", "None"], ...ids, ["__custom", "This card's own list"]], { rerender: true,
        hint: ids.length ? "" : "No rotations yet: build one in Alfie's panel (Screens → Rotations), or make this card's own list." });
      if (custom) html += this._steps(rot);
      return html;
    }

    _steps(steps) {
      const ids = (this._screens || []).map((s) => [s.id, s.title || s.id]);
      const set = (next) => { this._emit(applyChange(this._config, "rotation", next.length ? next : null)); };
      const rows = steps.map((s, n) => {
        const sel = this._add({ kind: "select", io: { get: () => s.screen, set: (v) => set(steps.map((x, j) => (j === n ? { ...x, screen: v } : x))) } });
        const sec = this._add({ kind: "num", io: { get: () => s.seconds, set: (v) => set(steps.map((x, j) => (j === n ? { ...x, seconds: v } : x))) }, min: 3, max: 3600 });
        const del = this._add({ kind: "button", run: () => { set(steps.filter((_, j) => j !== n)); this._render(); } });
        const pick = s.alfie ? `<span class="alfie">Alfie: plays the most relevant story</span>` : ids.length
          ? `<select data-i="${sel}" aria-label="Screen">${[...ids, ...(ids.some(([id]) => id === s.screen) ? [] : [[s.screen, `${s.screen} (missing)`]])]
            .map(([id, t]) => `<option value="${esc(id)}" ${id === s.screen ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`
          : `<input type="text" data-i="${sel}" value="${esc(s.screen)}" placeholder="screen id" aria-label="Screen">`;
        return `<div class="row">${pick}<input type="number" data-i="${sec}" min="3" max="3600" value="${s.seconds}" aria-label="Seconds"><button class="x" data-b="${del}" title="Remove" aria-label="Remove"><ha-icon icon="mdi:close"></ha-icon></button></div>`;
      }).join("");
      const add = this._add({ kind: "button", run: () => { set([...steps, { screen: ids[0]?.[0] || "", seconds: 20 }]); this._render(); } });
      const addAlfie = this._add({ kind: "button", run: () => { set([...steps, { alfie: true, seconds: 15 }]); this._render(); } });
      return `<div class="sub"><div class="l">This card's own list: screen and seconds</div><div class="steps">${rows}</div>
        <div><button data-b="${add}">+ Add step</button> <button data-b="${addAlfie}">+ Add Alfie step</button></div></div>`;
    }

    // What Alfie plays on this card when he appears in its rotation.
    _appearField() {
      const cur = this._get("appear_story") ?? "auto";
      const opts = [["auto", "Default (from Alfie's panel: the most relevant)"], ["none", "Nothing: he just shows"],
        ...this._stories.map((s) => [s.id, s.name || s.id])];
      if (!opts.some(([v]) => v === cur)) opts.push([cur, `${cur} (missing)`]);
      return this._select("When Alfie appears", this._top("appear_story"), opts, {
        hint: "Alfie comes on for an Alfie step (or between screens, if the rotation asks) and plays this, on this card only." });
    }

    _display() {
      const t = (k) => this._top(k);
      const out = [
        this._select("Display", t("display"), [["companion", "Companion: just Alfie"], ["rotation", "Rotation: screens in turn"]], { rerender: true,
          hint: "A companion shows a screen only when a story or an action asks for one." }),
      ];
      if (this._get("display") === "rotation") {
        out.push(this._rotationField(),
          this._appearField());
      }
      out.push(this._select("Presenting", t("present"), [["handover", "Hand over: Alfie steps aside"], ["corner", "Corner: Alfie shrinks into a corner"]], { rerender: true }));
      if (this._get("present") === "corner") {
        out.push(
          this._select("Corner", t("corner"), [["bottom_right", "Bottom right"], ["bottom_left", "Bottom left"], ["top_right", "Top right"], ["top_left", "Top left"]]),
          this._range("Corner size", t("corner_size"), 0.15, 0.5, 0.01, { hint: "Alfie's size in the corner, as a share of his full size." }));
      }
      out.push(this._select("Transition", t("transition"), [["", "Default (the rotation's, else fade)"], ...TRANSITIONS.map((s) => [s, human(s)]), ["random", "Random: a different one each time"]]),
        this._bool("Follow house modes", t("follow_mode"), "A house mode may hide Alfie on this card or swap its rotation. Off: the card keeps its own."),
        this._bool("Show icons", t("icons"), "Icons from stories and alfie.show_icon. Off: this card leaves them out."));
      return out.join("");
    }

    _personality() {
      const p = this._config.personality;
      const mode = p == null ? "" : typeof p === "string" ? p : "custom";
      const out = [this._select("Personality", {
        get: () => mode,
        set: (v) => {
          // Custom starts empty: unset sliders keep following Alfie's own.
          this._emit(applyChange(this._config, "personality", v === "custom" ? {} : v));
        },
      }, [["", "Default (Alfie's personality)"], ...PRESETS.map((n) => [n, human(n)]), ["custom", "Custom"]], { rerender: true,
        hint: mode === "" ? "This card moves the way Alfie's panel says (Appearance → Personality)." : "" })];
      if (mode === "custom") {
        const obj = p;
        const setKey = (k, v) => {
          const next = { ...obj };
          if (v === undefined) delete next[k]; else next[k] = v;
          this._emit({ ...this._config, personality: next });
        };
        out.push(`<div class="sub"><div class="l">Sliders (untouched ones follow Alfie's)</div>${Object.entries(SLIDERS).map(([k, s]) => {
          const set = obj[k] !== undefined;
          const reset = this._add({ kind: "button", run: () => { setKey(k, undefined); this._render(); } });
          return this._range(s.label, { get: () => obj[k] ?? s.def, set: (v) => setKey(k, v) }, s.min, s.max, 0.05,
            { unset: !set, hint: s.hint, after: set ? `<button data-b="${reset}" title="Back to the default">Reset</button>` : "" });
        }).join("")}</div>`);
      }
      return out.join("");
    }

    // Unset, the card takes the aspect from Alfie's panel (Appearance → Look).
    _aspect() {
      const set = this._config.aspect != null;
      const reset = this._add({ kind: "button", run: () => { this._emit(applyChange(this._config, "aspect", null)); this._render(); } });
      return this._range("Aspect", { get: () => this._config.aspect ?? 1, set: (v) => this._emit(applyChange(this._config, "aspect", v)) }, 0.5, 3, 0.05,
        { unset: !set, hint: "Width over height. Left alone, Alfie's panel decides (Appearance → Look).",
          after: set ? `<button data-b="${reset}" title="Back to the panel's">Reset</button>` : "" });
    }

    _more() {
      const t = (k) => this._top(k);
      return [
        this._range("Liveliness", t("liveliness"), 0, 2, 0.05, { hint: "How much of his energy shows: 0 calm, 2 very." }),
        this._bool("Alfie breathes", t("breathing")),
        this._bool("Alfie blinks", t("blinking")),
        this._range("Frame rate cap", t("fps"), 5, 60, 5, { hint: "30 is smooth and kind to a tablet." }),
        this._range("Padding", t("padding"), 0, 0.3, 0.01, { hint: "Share of the card kept clear around the ring." }),
        this._aspect(),
        this._bool("Card frame", t("card"), "Off drops the card background and border."),
      ].join("");
    }

    _shapes() {
      const shapes = this._config.shapes;
      const inherit = shapes == null || Object.keys(shapes).length === 0;
      const setShapes = (next) => this._emit(applyChange(this._config, "shapes", next));
      const out = [this._select("Shapes", {
        get: () => (inherit ? "inherit" : "own"),
        set: (v) => setShapes(v === "own" ? { head: { type: "circle" } } : null),
      }, [["inherit", FROM_PANEL], ["own", "This card's own"]], { rerender: true })];
      if (!inherit) {
        for (const [part, title] of SHAPE_PARTS) {
          const spec = shapes[part];
          const type = spec ? spec.type || "circle" : "";
          const types = [["", FROM_PANEL], ...Object.keys(SHAPE_PARAMS).map((n) => [n, SHAPE_TEXT[n] || human(n)]), ...(type === "path" ? [["path", "Path (set in YAML)"]] : [])];
          let inner = this._select(title, {
            get: () => type,
            set: (v) => setShapes(setShapePart(shapes, part, v ? { type: v } : undefined)),
          }, types, { rerender: true });
          if (spec && SHAPE_PARAMS[type]) {
            for (const [k, min, max, step, def] of [...SHAPE_PARAMS[type], ...SHAPE_COMMON]) {
              inner += this._range(PARAM_TEXT[k] || human(k), { get: () => spec[k] ?? def, set: (v) => setShapes(setShapePart(shapes, part, setShapeParam(spec, k, v))) }, min, max, step);
            }
            const sx = spec.stretch?.[0] ?? 1, sy = spec.stretch?.[1] ?? 1;
            const st = (nx, ny) => setShapes(setShapePart(shapes, part, nx === 1 && ny === 1
              ? (({ stretch, ...r }) => r)(spec) : { ...spec, stretch: [nx, ny] }));
            inner += this._range("Stretch across", { get: () => sx, set: (v) => st(v, sy) }, 0.3, 2, 0.05);
            inner += this._range("Stretch up", { get: () => sy, set: (v) => st(sx, v) }, 0.3, 2, 0.05);
          } else if (type === "path") {
            inner += `<div class="note">A custom path: edit its points in the YAML editor.</div>`;
          }
          out.push(`<div class="sub">${inner}</div>`);
        }
        if (shapes.left_eye || shapes.right_eye) out.push(`<div class="note">Separate left or right eye shapes are set in YAML and kept as they are.</div>`);
      }
      return out.join("");
    }

    _render() {
      this._fields = [];
      const c = this._config;
      const personality = c.personality == null ? "Default" : typeof c.personality === "string" ? human(c.personality) : "Custom";
      const rot = this._rotations.find((r) => r.id === c.rotation);
      const groups = [
        this._group("display", "Display", this._get("display") === "rotation" ? `Rotation${rot ? `: ${rot.name || rot.id}` : ""}` : "Companion", this._display()),
        this._group("look", "Look", c.style ? human(c.style) : "Default", this._look()),
        this._group("personality", "Personality", personality, this._personality()),
        this._group("more", "More options", `${this._get("fps")} fps`, this._more()),
      ];
      this.shadowRoot.innerHTML = `<style>${STYLE_CSS}</style>${groups.join("")}`;
      this._wire();
    }

    _wire() {
      const root = this.shadowRoot;
      root.querySelectorAll("details").forEach((d) => d.addEventListener("toggle", () => {
        d.open ? this._open.add(d.dataset.g) : this._open.delete(d.dataset.g);
      }));
      const field = (el) => this._fields[Number(el.dataset.i ?? el.dataset.c ?? el.dataset.b)];
      const apply = (f, v, rerender) => { f.io.set(v); if (rerender || f.rerender) this._render(); };
      root.querySelectorAll("[data-b]").forEach((b) => b.addEventListener("click", () => field(b).run()));
      root.querySelectorAll("[data-i]").forEach((el) => {
        const f = field(el);
        if (f.kind === "range") {
          el.addEventListener("input", () => {
            const v = Number(el.value);
            root.querySelector(`[data-out="${el.dataset.i}"]`).textContent = v;
            el.closest(".f").classList.remove("unset");
            f.io.set(v);
          });
          // A slider that had been unset gains its reset button: refresh once released.
          el.addEventListener("change", () => { if (el.closest(".f").dataset.fresh !== "1" && f.io.get() !== undefined) this._refreshIfNeeded(); });
        } else if (f.kind === "select") {
          el.addEventListener("change", () => apply(f, el.value));
        } else if (f.kind === "bool") {
          el.addEventListener("change", () => apply(f, el.checked));
        } else if (f.kind === "num") {
          el.addEventListener("change", () => {
            const v = Math.min(f.max, Math.max(f.min, Math.round(Number(el.value)) || f.min));
            el.value = v;
            f.io.set(v);
          });
        } else {
          // text and colour text: commit as typed, a CSS variable included.
          el.addEventListener("input", () => {
            f.io.set(el.value.trim());
            const sw = root.querySelector(`[data-c="${el.dataset.i}"]`);
            if (sw) { sw.style.opacity = el.value.trim() ? 1 : 0.4; if (hex(el.value.trim())) sw.value = hex(el.value.trim()); }
          });
        }
      });
      root.querySelectorAll("[data-c]").forEach((sw) => sw.addEventListener("input", () => {
        const f = field(sw);
        f.io.set(sw.value);
        sw.style.opacity = 1;
        root.querySelector(`[data-i="${sw.dataset.c}"]`).value = sw.value;
      }));
    }

    // Personality sliders show a reset button once set; redraw after the drag ends.
    _refreshIfNeeded() {
      if (typeof this._config.personality === "object" && this._config.personality) this._render();
    }
  }

  if (!customElements.get("alfie-card-editor")) customElements.define("alfie-card-editor", AlfieCardEditor);
}
