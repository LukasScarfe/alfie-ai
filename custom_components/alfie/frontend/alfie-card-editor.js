// Visual editor for custom:alfie-card, so nobody needs YAML.
//
// Plain inputs styled with HA's CSS variables, no HA-internal form elements
// (ha-form, ha-selector...): those change between frontend versions, and an
// editor that breaks is worse than a plain one. The live preview is HA's own,
// it re-renders the card from the config we emit. Only keys that differ from
// the card's defaults are written, so the YAML stays short.

const V = new URL(import.meta.url).search;

// Mirrors DEFAULTS in alfie-card.js (the card stays the source of truth: a
// stale entry here only means a redundant key is written, never a wrong card).
export const DEFAULTS = {
  style: "neon", face_color: null, eye_color: null, background: "none",
  line_width: 0.035, glow: null, eye_fill: false, padding: 0.08, aspect: 1,
  fps: 30, liveliness: 1, breathing: true, blinking: true, card: true,
  shapes: null, personality: null, mode: "companion", rotation: null,
  present: "handover", corner: "bottom_right", corner_size: 0.3, transition: null,
  text_color: null, accent_color: null, screen_line_width: 0.02,
};

export const PRESETS = ["bubbly", "stoic", "grumpy", "sleepy", "nervous"];
// The card-overridable sliders (config.py PERSONALITY; fidget_rate is the engine's).
export const SLIDERS = {
  exaggeration: { min: 0.3, max: 2, def: 1, hint: "size of expressions" },
  speed: { min: 0.3, max: 2.5, def: 1, hint: "animation and blend rate" },
  bounce: { min: 0, max: 2, def: 1, hint: "spring overshoot" },
  blink_rate: { min: 0.2, max: 3, def: 1, hint: "how often he blinks" },
  energy_bias: { min: -0.5, max: 0.5, def: 0, hint: "added to the mood's energy" },
};
export const SHAPE_PARAMS = {
  circle: [],
  polygon: [["sides", 3, 12, 1, 4], ["roundness", 0, 1, 0.05, 0]],
  star: [["points", 3, 12, 1, 5], ["inner", 0.1, 0.95, 0.05, 0.5], ["roundness", 0, 1, 0.05, 0]],
  superellipse: [["n", 0.5, 8, 0.1, 4]],
};
const SHAPE_COMMON = [["rotation", -180, 180, 5, 0]];
const SHAPE_PARTS = [["head", "Head"], ["eye", "Eyes"]];

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

const STYLE_CSS = `
  :host { display: block; color: var(--primary-text-color); font: inherit; }
  details { border: 1px solid var(--divider-color); border-radius: 10px; margin: 0 0 10px;
    background: var(--card-background-color, transparent); }
  summary { cursor: pointer; padding: 12px 14px; font-weight: 500; list-style: none; display: flex;
    justify-content: space-between; align-items: center; }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: "\\25B8"; color: var(--secondary-text-color); transition: transform .15s; }
  details[open] > summary::after { transform: rotate(90deg); }
  summary small { font-weight: 400; color: var(--secondary-text-color); margin-left: 10px; flex: 1; }
  .body { padding: 2px 14px 12px; display: grid; gap: 12px; }
  .f { display: grid; gap: 4px; }
  .f > label, .f > .l { font-size: 0.85em; color: var(--secondary-text-color); display: flex;
    justify-content: space-between; gap: 8px; }
  .f > label b { font-weight: 400; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
  .hint { font-size: 0.78em; color: var(--secondary-text-color); opacity: .85; margin-top: -2px; }
  input[type=text], input[type=number], select {
    box-sizing: border-box; width: 100%; padding: 8px 10px; font: inherit; color: var(--primary-text-color);
    background: var(--secondary-background-color, var(--card-background-color));
    border: 1px solid var(--divider-color); border-radius: 8px; min-width: 0; }
  input:focus, select:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; }
  input[type=range] { width: 100%; accent-color: var(--primary-color); margin: 4px 0; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row input[type=color] { width: 44px; height: 36px; padding: 2px; flex: none; cursor: pointer;
    background: var(--secondary-background-color); border: 1px solid var(--divider-color); border-radius: 8px; }
  .f > label.chk { justify-content: flex-start; color: var(--primary-text-color); font-size: 1em; }
  .chk { display: flex; align-items: center; gap: 10px; cursor: pointer; }
  .chk input { width: 18px; height: 18px; accent-color: var(--primary-color); }
  .sub { border-left: 3px solid var(--divider-color); padding-left: 12px; display: grid; gap: 12px; }
  .sub > .l { font-weight: 500; color: var(--primary-text-color); }
  button { font: inherit; color: var(--primary-text-color); cursor: pointer; padding: 7px 12px;
    background: var(--secondary-background-color); border: 1px solid var(--divider-color); border-radius: 8px; }
  button:hover { border-color: var(--primary-color); }
  button.x { padding: 6px 10px; flex: none; }
  .steps { display: grid; gap: 8px; }
  .steps .row input[type=number] { width: 80px; flex: none; }
  .steps .row select, .steps .row input[type=text] { flex: 1; }
  .unset input[type=range] { opacity: .55; }
  .note { font-size: 0.85em; color: var(--secondary-text-color); }
  .warn { font-size: 0.85em; color: var(--warning-color, #ffa600); }
`;

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class AlfieCardEditor extends HTMLElement {
    constructor() {
      super();
      this._config = {};
      this._open = new Set(["look"]);
      this._screens = null;     // null = not loaded, [] / [{id,...}] loaded
      this._rotations = [];
      this._failed = false;
      this._fields = [];
      this.attachShadow({ mode: "open" });
    }

    setConfig(config) {
      // Our own emit comes straight back through HA: don't rebuild under the user's cursor.
      if (this._emitted && same(config, this._emitted)) { this._config = config; return; }
      this._config = { ...config };
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
      return `<div class="f ${unset ? "unset" : ""}"><label>${esc(label)} <b data-out="${i}">${unset ? "inherit" : v}</b></label>
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
        this._select("Style", t("style"), [["neon", "Neon"], ["flat", "Flat"], ["crt", "CRT"], ["theme", "Theme colour"]], { hint: "Sets the colour and glow defaults; everything below overrides it." }),
        this._color("Face colour", "face_color", "from the style"),
        this._color("Eye colour", "eye_color", "same as the face"),
        this._color("Background", "background", "none"),
        this._color("Screen text colour", "text_color", "same as the face"),
        this._color("Screen accent colour", "accent_color", "same as the face"),
        this._range("Line width", t("line_width"), 0.005, 0.15, 0.005),
        this._range("Screen line width", t("screen_line_width"), 0.005, 0.1, 0.005, { hint: "Screens draw finer than the face." }),
        this._range("Glow", { get: () => this._config.glow ?? 0.6, set: (v) => this._emit(applyChange(this._config, "glow", v)) }, 0, 2, 0.05,
          { unset: this._config.glow == null, hint: "Left alone, the style decides." }),
        this._bool("Fill the eyes", t("eye_fill")),
        this._range("Padding", t("padding"), 0, 0.3, 0.01, { hint: "Share of the card kept clear around the ring." }),
        this._range("Aspect (width / height)", t("aspect"), 0.5, 3, 0.05),
        this._bool("Card frame", t("card"), "Off drops the card background and border."),
      ].join("");
    }

    _rotationField() {
      const rot = this._config.rotation;
      const custom = Array.isArray(rot);
      const ids = this._rotations.map((r) => [r.id, r.name || r.id]);
      let html;
      if (this._failed || this._screens === null) {
        html = this._text("Rotation id", { get: () => (typeof rot === "string" ? rot : ""), set: (v) => this._emit(applyChange(this._config, "rotation", v.trim())) },
          "e.g. living_room", this._failed ? "Could not load Alfie's rotations, so type the id." : "Loading rotations...");
        return html;
      }
      const val = custom ? "__custom" : rot || "";
      html = this._select("Rotation", {
        get: () => val,
        set: (v) => {
          if (v === "__custom") this._emit(applyChange(this._config, "rotation", [{ screen: this._screens[0]?.id || "", seconds: 20 }]));
          else this._emit(applyChange(this._config, "rotation", v));
        },
      }, [["", "(none)"], ...ids, ["__custom", "Custom list"]], { rerender: true,
        hint: ids.length ? "" : "No rotations yet: build one in Alfie's panel, or use a custom list." });
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
        const pick = ids.length
          ? `<select data-i="${sel}" aria-label="Screen">${[...ids, ...(ids.some(([id]) => id === s.screen) ? [] : [[s.screen, `${s.screen} (missing)`]])]
            .map(([id, t]) => `<option value="${esc(id)}" ${id === s.screen ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>`
          : `<input type="text" data-i="${sel}" value="${esc(s.screen)}" placeholder="screen id" aria-label="Screen">`;
        return `<div class="row">${pick}<input type="number" data-i="${sec}" min="3" max="3600" value="${s.seconds}" aria-label="Seconds"><button class="x" data-b="${del}" title="Remove">x</button></div>`;
      }).join("");
      const add = this._add({ kind: "button", run: () => { set([...steps, { screen: ids[0]?.[0] || "", seconds: 20 }]); this._render(); } });
      return `<div class="sub"><div class="l">Custom list: screen and seconds</div><div class="steps">${rows}</div>
        <div><button data-b="${add}">Add a screen</button></div></div>`;
    }

    _display() {
      const t = (k) => this._top(k);
      const out = [
        this._select("Mode", t("mode"), [["companion", "Companion: just Alfie"], ["rotation", "Rotation: cycle through screens"]], { rerender: true,
          hint: "A companion shows screens only when something asks for one." }),
      ];
      if (this._get("mode") === "rotation") out.push(this._rotationField());
      out.push(this._select("Presenting a screen", t("present"), [["handover", "Handover: Alfie leaves"], ["corner", "Corner: Alfie shrinks aside"]], { rerender: true }));
      if (this._get("present") === "corner") {
        out.push(
          this._select("Corner", t("corner"), [["bottom_right", "Bottom right"], ["bottom_left", "Bottom left"], ["top_right", "Top right"], ["top_left", "Top left"]]),
          this._range("Corner size", t("corner_size"), 0.15, 0.5, 0.01, { hint: "Alfie's size in the corner, as a share of his full size." }));
      }
      out.push(this._select("Transition", t("transition"), [["", "Rotation's own, else fade"], ...TRANSITIONS.map((s) => [s, s]), ["random", "random"]]));
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
      }, [["", "Inherit Alfie's"], ...PRESETS.map((n) => [n, n[0].toUpperCase() + n.slice(1)]), ["custom", "Custom sliders"]], { rerender: true,
        hint: mode === "" ? "This card moves the way the Alfie panel says." : "" })];
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
          return this._range(k.replace("_", " "), { get: () => obj[k] ?? s.def, set: (v) => setKey(k, v) }, s.min, s.max, 0.05,
            { unset: !set, hint: s.hint, after: set ? `<button class="x" data-b="${reset}" title="Back to inherit">reset</button>` : "" });
        }).join("")}</div>`);
      }
      return out.join("");
    }

    _motion() {
      const t = (k) => this._top(k);
      return [
        this._range("Liveliness", t("liveliness"), 0, 2, 0.05, { hint: "How much energy shows: 0 calm, 2 very." }),
        this._bool("Breathing", t("breathing")),
        this._bool("Blinking", t("blinking")),
        this._range("Frame rate cap", t("fps"), 5, 60, 5, { hint: "30 is smooth and kind to a tablet." }),
      ].join("");
    }

    _shapes() {
      const shapes = this._config.shapes;
      const inherit = shapes == null || Object.keys(shapes).length === 0;
      const setShapes = (next) => this._emit(applyChange(this._config, "shapes", next));
      const out = [this._select("Shapes", {
        get: () => (inherit ? "inherit" : "own"),
        set: (v) => setShapes(v === "own" ? { head: { type: "circle" } } : null),
      }, [["inherit", "Inherit Alfie's"], ["own", "Override for this card"]], { rerender: true })];
      if (!inherit) {
        for (const [part, title] of SHAPE_PARTS) {
          const spec = shapes[part];
          const type = spec ? spec.type || "circle" : "";
          const types = [["", "Inherit"], ...Object.keys(SHAPE_PARAMS).map((n) => [n, n]), ...(type === "path" ? [["path", "path (set in YAML)"]] : [])];
          let inner = this._select(title, {
            get: () => type,
            set: (v) => setShapes(setShapePart(shapes, part, v ? { type: v } : undefined)),
          }, types, { rerender: true });
          if (spec && SHAPE_PARAMS[type]) {
            for (const [k, min, max, step, def] of [...SHAPE_PARAMS[type], ...SHAPE_COMMON]) {
              inner += this._range(k, { get: () => spec[k] ?? def, set: (v) => setShapes(setShapePart(shapes, part, setShapeParam(spec, k, v))) }, min, max, step);
            }
            const sx = spec.stretch?.[0] ?? 1, sy = spec.stretch?.[1] ?? 1;
            const st = (nx, ny) => setShapes(setShapePart(shapes, part, nx === 1 && ny === 1
              ? (({ stretch, ...r }) => r)(spec) : { ...spec, stretch: [nx, ny] }));
            inner += this._range("stretch x", { get: () => sx, set: (v) => st(v, sy) }, 0.3, 2, 0.05);
            inner += this._range("stretch y", { get: () => sy, set: (v) => st(sx, v) }, 0.3, 2, 0.05);
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
      const personality = c.personality == null ? "inherit" : typeof c.personality === "string" ? c.personality : "custom";
      const groups = [
        this._group("look", "Look", `${c.style || "neon"}`, this._look()),
        this._group("display", "Display", this._get("mode") === "rotation" ? "rotation" : "companion", this._display()),
        this._group("personality", "Personality", personality, this._personality()),
        this._group("motion", "Motion", `${this._get("fps")} fps`, this._motion()),
        this._group("shapes", "Shapes", c.shapes ? "own" : "inherit", this._shapes()),
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
