// Alfie's editor: the admin sidebar panel (registered by frontend.py).
//
// It edits one draft of the whole config (config.py) and saves it with
// alfie/config/set, which applies live. While you edit, alfie/config/preview
// says what the draft makes of the house right now (which signals are active,
// the mood), without saving. Vanilla JS, no build step, no HA-internal
// elements beyond the sidebar's menu button, so it keeps working across HA
// frontend releases.
//
// Inputs carry data-path="mood.weights.major" (and data-kind for how to read
// them); one handler writes them into the draft. Structural changes (add,
// remove, move, expand) re-render the tab; typing never does, so focus stays.

const V = new URL(import.meta.url).search;
await import(`./alfie-card.js${V}`).catch(() => null); // usually loaded already; the card defines itself
const Fm = await import(`./alfie-panel-forms.js${V}`);
let TRANSITIONS = ["cut", "fade"];
try { TRANSITIONS = [...(await import(`./alfie-intros.js${V}`)).STYLES]; } catch { /* the card's own intros are the truth */ }

const TABS = [
  ["signals", "Signals"],
  ["mood", "Mood"],
  ["behaviour", "Behaviour"],
  ["triggers", "Triggers"],
  ["stories", "Stories"],
  ["personality", "Personality"],
  ["screens", "Screens"],
  ["look", "Look"],
  ["playground", "Playground"],
];
const CARD_STYLES = ["neon", "flat", "crt", "theme"];
const LOOK_DEFAULT = {
  style: "neon", face_color: "", eye_color: "", background: "", text_color: "", accent_color: "",
  line_width: 0.035, screen_line_width: 0.02, glow: null, eye_fill: false, padding: 0.08,
  shapes: { head: { type: "circle" }, eye: { type: "circle" } },
};
const LOOK_COLORS = [
  ["face_color", "Ring colour"], ["eye_color", "Eye colour"], ["background", "Background"],
  ["text_color", "Screen text colour"], ["accent_color", "Screen accent colour"],
];
const LOOK_EXPRESSIONS = ["happy", "sad", "angry", "surprised"];
const SCREEN_PREVIEW_DELAY = 300;
const PREVIEW_DELAY = 400;   // ms after the last edit
const LEVEL_TEXT = {
  bubbly: "Bubbly", content: "Content", uneasy: "Uneasy", sad: "Sad", miserable: "Miserable",
};
const COMBINE_TEXT = {
  worst: ["Worst one wins", "A priority ladder: the most severe bad signal alone sets the mood. Any good signal with nothing bad makes him bubbly."],
  weighted: ["Weighted severities", "Bad signals subtract their weight, good ones add theirs, and the total falls into a level by thresholds."],
  count: ["Simple count", "Each good signal cancels one bad one; what is left sets the level."],
};
const SLIDER_TEXT = {
  exaggeration: ["Exaggeration", "How far expressions and animations go"],
  speed: ["Speed", "How quickly he moves and changes expression"],
  bounce: ["Bounce", "How much he overshoots and wobbles into place"],
  fidget_rate: ["Fidgeting", "How often he fidgets when idle (0 never). Takes effect on save."],
  energy_bias: ["Energy", "Added to every mood's energy: perkier or flatter"],
  blink_rate: ["Blinking", "How often he blinks"],
};
const PREVIEW_ANIMS = ["glance_left", "nod", "look_around", "laugh", "startle", "sigh"];
const KIND_TEXT = {
  entity: "An entity changes", motion: "Motion", mood: "Mood changes", signal: "A signal goes bad or recovers", wake: "Waking or sleeping",
};
const BUSY_TEXT = [["auto", "by priority: higher interrupts"], ["queue", "wait its turn"],
  ["interrupt", "interrupt whatever is playing"], ["skip", "don't play"]];
const STEP_TEXT = {
  expression: "Expression", animation: "Animation", screen: "Screen", wait: "Wait", move: "Move", resize: "Resize", speak: "Speak",
};
const OUTCOME_TEXT = { played: "played", queued: "queued", skipped: "skipped (busy)", cooldown: "cooling down", outranked: "outranked" };
const PLACE_TEXT = { centre: "centre", top_left: "top left", top_right: "top right", bottom_left: "bottom left", bottom_right: "bottom right", custom: "custom (x, y)" };

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clone = (v) => JSON.parse(JSON.stringify(v));
// Key order must not matter: a section reset from the defaults equals the saved one.
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "signal";

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((o, k) => o[k], obj);
  parent[last] = value;
}

class AlfiePanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "signals";
    this._open = new Set();     // expanded signal ids
    this._preview = null;
    this._errors = [];
    this._saveError = null;
    this._watch = new Map();    // entity id -> state the last preview saw
    this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
    // HA may create <alfie-panel> and set hass before this class is defined
    // (the module awaits the card first); those land as own properties that
    // shadow our setters, so re-apply them through the setters.
    for (const k of ["hass", "narrow"]) {
      if (Object.prototype.hasOwnProperty.call(this, k)) {
        const v = this[k];
        delete this[k];
        queueMicrotask(() => { this[k] = v; });
      }
    }
    this._onUnload = (e) => {
      if (this._dirty) { e.preventDefault(); e.returnValue = ""; }
    };
  }

  // ------------------------------------------------------------ HA hooks

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this._menu) this._menu.hass = hass;
    if (first) this._load();
    else this._statesChanged();
  }

  set narrow(v) {
    this._narrow = v;
    if (this._menu) this._menu.narrow = v;
  }

  connectedCallback() {
    window.addEventListener("beforeunload", this._onUnload);
  }

  disconnectedCallback() {
    window.removeEventListener("beforeunload", this._onUnload);
    clearTimeout(this._previewTimer);
    this._endPreviews();
    this._unsubScene?.then((u) => u()).catch(() => {});
    this._unsubScene = null;
  }

  async _load() {
    try {
      const r = await this._hass.callWS({ type: "alfie/config/get" });
      this._name = r.name;
      this._defaults = r.defaults;
      this._choices = r.choices;
      this._saved = clone(r.config);
      this._draft = clone(r.config);
      if (r.defaults.look) { // older servers have no look section
        this._saved.look ??= clone(r.defaults.look);
        this._draft.look ??= clone(r.defaults.look);
      }
      this._sdata = new Map();    // screen id -> {data, error} from alfie/screen_data
      this._loadError = null;
    } catch (e) {
      this._loadError = e?.message || String(e);
    }
    this._unsubScene ??= this._hass.connection.subscribeMessage(
      (s) => {
        const was = this._scene?.story?.seq;
        this._scene = s;
        this._showStatus();
        if (this._tab === "triggers" && s.story?.seq !== was) this._loadTriggerStatus();
      }, { type: "alfie/subscribe" });
    this._render();
    this._schedulePreview(0);
  }

  get _dirty() {
    return this._draft && !same(this._draft, this._saved);
  }

  // A preview is only worth redoing when an entity it showed has changed.
  _statesChanged() {
    if (!this._watch.size) return;
    for (const [e, st] of this._watch) {
      if ((this._hass.states[e]?.state ?? null) !== st) {
        this._schedulePreview(1000);
        return;
      }
    }
  }

  // ------------------------------------------------------------ talking

  _schedulePreview(delay = PREVIEW_DELAY) {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this._runPreview(), delay);
  }

  async _runPreview() {
    if (!this._draft) return;
    const draft = clone(this._draft);
    try {
      const r = await this._hass.callWS({ type: "alfie/config/preview", config: draft });
      if (!same(draft, this._draft)) return; // edited meanwhile; a newer one is coming
      this._errors = r.errors || [];
      if (!this._errors.length) {
        this._preview = r;
        this._watch = new Map();
        for (const s of r.signals) for (const e of s.entities) this._watch.set(e.entity_id, e.state);
      }
    } catch (e) {
      this._errors = [e?.message || String(e)];
    }
    this._showPreview();
  }

  async _save() {
    this._saveError = null;
    try {
      const r = await this._hass.callWS({ type: "alfie/config/set", config: this._draft });
      this._saved = clone(r.config);
      this._draft = clone(r.config);
      this._sdata = new Map();
      this._flash("Saved. Alfie is using it now.");
    } catch (e) {
      this._saveError = e?.message || String(e);
    }
    this._render();
    this._schedulePreview(0);
  }

  _revert() {
    this._draft = clone(this._saved);
    this._saveError = null;
    this._render();
    this._schedulePreview(0);
  }

  _resetSection(section) {
    if (!confirm(`Put ${section} back to the house defaults? You can still revert before saving.`)) return;
    this._draft[section] = clone(this._defaults[section]);
    this._edited(true);
  }

  _edited(rerender = false) {
    this._saveError = null;
    if (rerender) this._render();
    else this._showStatus();
    this._schedulePreview();
  }

  _flash(text) {
    this._flashText = text;
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { this._flashText = null; this._showStatus(); }, 4000);
  }

  // ------------------------------------------------------------ editing

  _onInput(ev) {
    if (!this._draft) return;
    const tool = ev.target.closest("[data-shape], [data-pg]");
    if (tool) return this._onTool(tool, ev);
    const el = ev.target.closest("[data-path]");
    if (!el) return;
    const path = el.dataset.path, kind = el.dataset.kind || "text";
    let v;
    if (kind === "bool") v = el.checked;
    else if (kind === "optnum" || kind === "optent") {
      // An option left empty is not written, so the type's default applies.
      v = el.value.trim() === "" ? undefined : kind === "optnum" ? Number(el.value) : el.value.trim();
    } else if (kind === "opttext") v = el.value;
    else if (kind === "number") {
      if (el.value === "") v = el.dataset.empty === "null" ? null : 0;
      else v = Number(el.value);
    } else if (kind === "value") {
      // A signal's test value: a number when it reads as one.
      v = el.value.trim() !== "" && Number.isFinite(Number(el.value)) ? Number(el.value) : el.value;
    } else v = el.value;
    if (/^signals\.\d+\.id$/.test(path) && this._open.delete(getPath(this._draft, path))) this._open.add(v);
    const tk = /^triggers\.(\d+)\.kind$/.exec(path);
    if (tk) {
      const i = Number(tk[1]);
      this._draft.triggers[i] = Fm.changeTriggerKind(this._draft.triggers[i], clone(this._choices.triggers[v]));
      this._edited(true);
      return;
    }
    if (/^triggers\.\d+\.id$/.test(path) && this._open.delete(`t:${getPath(this._draft, path)}`)) this._open.add(`t:${v}`);
    if (/^stories\.\d+\.id$/.test(path)) {
      const old = getPath(this._draft, path);
      Fm.renameStoryRefs(this._draft, old, v);
      if (this._open.delete(`st:${old}`)) this._open.add(`st:${v}`);
    }
    if (/^screens\.\d+\.id$/.test(path)) {
      const old = getPath(this._draft, path);
      Fm.renameScreenRefs(this._draft, old, v);
      if (this._open.delete(`s:${old}`)) this._open.add(`s:${v}`);
      el.closest(".screen")?.querySelector(".spv")?.setAttribute("data-id", v);
    }
    if (v === undefined) {
      const keys = path.split("."), last = keys.pop();
      delete keys.reduce((o, k) => o[k], this._draft)[last];
    } else setPath(this._draft, path, v);
    if (el.type === "range") {
      const out = el.parentElement.querySelector("output");
      if (out) out.textContent = this._fmt(v);
    }
    if (kind === "opttext" && el.closest(".opt")) {
      // swatch and text field edit the same colour
      el.closest(".opt").querySelectorAll(`[data-path="${path}"]`).forEach((o) => {
        if (o === el) return;
        o.value = o.type === "color" ? Fm.swatchValue(v) : v;
      });
    }
    if (path.startsWith("screens.")) this._schedScreenPreview(Number(path.split(".")[1]));
    if (path.startsWith("look.")) this._applyLook();
    if (path.startsWith("personality.") && path !== "personality.preset") {
      this._draft.personality.preset = "custom";
      this.shadowRoot.querySelectorAll(".preset").forEach((b) => b.classList.toggle("on", b.dataset.preset === "custom"));
      const out = el.parentElement.querySelector("output");
      if (out) out.textContent = this._fmt(v);
      this._livePersonality();
    }
    if (path.startsWith("mood.") && el.closest(".level")) this._drawLevel(el.closest(".level"));
    if (/^screens\.\d+\.(title|id)$/.test(path)) {
      const sc = this._draft.screens[Number(path.split(".")[1])];
      const head = el.closest(".screen")?.querySelector(".label");
      if (head) head.textContent = sc.title || sc.id;
    }
    if (path.endsWith(".label")) {
      const head = el.closest(".signal")?.querySelector(".label");
      if (head) head.textContent = v || "(no label)";
    }
    if (/^(triggers|stories)\.\d+\.name$/.test(path)) {
      const head = el.closest(".card")?.querySelector(".label");
      if (head) head.textContent = v || "(no name)";
    }
    const rerender = ev.type === "change" && el.dataset.rerender !== undefined;
    this._edited(rerender);
  }

  _onClick(ev) {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action, d = this._draft;
    const i = Number(el.dataset.i), sigs = d?.signals;
    switch (a) {
      case "tab":
        this._endPreviews();
        this._tab = el.dataset.tab;
        this._render();
        if (this._tab === "triggers") this._loadTriggerStatus();
        return;
      case "save": this._save(); return;
      case "revert": this._revert(); return;
      case "reset": this._resetSection(el.dataset.section); return;
      case "toggle": {
        const id = sigs[i].id;
        this._open.has(id) ? this._open.delete(id) : this._open.add(id);
        this._render();
        return;
      }
      case "add-signal": {
        let id = "new_signal", n = 2;
        while (sigs.some((s) => s.id === id)) id = `new_signal_${n++}`;
        sigs.push({ id, label: "", entities: [], op: "below", value: 15, kind: "bad", severity: "major",
                    weight: null, match: "any", screen: null, enabled: true, repeat: clone(this._defaults.signals[0]?.repeat
                      ?? { on_motion: false, every_hours: 0, in_rotation: false, story: "bad_news" }) });
        this._open.add(id);
        this._edited(true);
        return;
      }
      case "dup": {
        const s = clone(sigs[i]);
        let id = `${s.id}_copy`, n = 2;
        while (sigs.some((x) => x.id === id)) id = `${s.id}_copy_${n++}`;
        s.id = id;
        s.label = `${s.label} (copy)`;
        sigs.splice(i + 1, 0, s);
        this._open.add(id);
        this._edited(true);
        return;
      }
      case "del":
        if (!confirm(`Delete "${sigs[i].label || sigs[i].id}"?`)) return;
        sigs.splice(i, 1);
        this._edited(true);
        return;
      case "up": case "down": {
        const j = a === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= sigs.length) return;
        [sigs[i], sigs[j]] = [sigs[j], sigs[i]];
        this._edited(true);
        return;
      }
      case "kind":
        sigs[i].kind = sigs[i].kind === "bad" ? "good" : "bad";
        this._edited(true);
        return;
      case "add-entity": {
        const inp = el.parentElement.querySelector("input");
        const v = inp.value.trim();
        if (!v) return;
        if (!sigs[i].entities.includes(v)) sigs[i].entities.push(v);
        if (!sigs[i].label) {
          sigs[i].label = this._hass.states[v]?.attributes?.friendly_name || v;
          if (sigs[i].id.startsWith("new_signal")) this._renameSignal(i, slug(sigs[i].label));
        }
        this._edited(true);
        return;
      }
      case "rm-entity":
        sigs[i].entities.splice(Number(el.dataset.j), 1);
        this._edited(true);
        return;
      case "add-gaze":
        d.behaviour.gaze_map.push({ entity: "", action: "notice" });
        this._edited(true);
        return;
      case "rm-gaze":
        d.behaviour.gaze_map.splice(i, 1);
        this._edited(true);
        return;
      case "anim-set": {
        const list = d.behaviour[el.dataset.list], name = el.dataset.name;
        const k = list.indexOf(name);
        k >= 0 ? list.splice(k, 1) : list.push(name);
        el.classList.toggle("on", k < 0);
        this._edited();
        return;
      }
      case "preset": {
        const name = el.dataset.preset;
        const vals = this._choices.personalities[name];
        d.personality = { ...d.personality, preset: name, ...(vals || {}) };
        this._edited(true);
        return;
      }
      case "play":
        this.shadowRoot.querySelector("#live")?.playLocal(el.dataset.name);
        return;
      default: this._onClickMore(a, el, i);
    }
  }

  _onClickMore(a, el, i) {
    const d = this._draft, F = Fm;
    const screens = d.screens, rots = d.rotations;
    const key = el.dataset.key, j = Number(el.dataset.j);
    switch (a) {
      case "toggle-screen": {
        const id = screens[i].id;
        this._open.has(`s:${id}`) ? this._open.delete(`s:${id}`) : this._open.add(`s:${id}`);
        this._render();
        return;
      }
      case "add-screen": {
        const type = this.shadowRoot.querySelector("#newtype")?.value;
        const info = this._choices.screen_types?.[type];
        if (!info) return;
        const sc = F.newScreen(info, screens);
        screens.push(sc);
        this._open.add(`s:${sc.id}`);
        this._edited(true);
        return;
      }
      case "dup-screen": {
        const sc = clone(screens[i]);
        sc.id = F.uniqueId(screens, `${sc.id}_copy`);
        sc.title = sc.title ? `${sc.title} (copy)` : sc.title;
        screens.splice(i + 1, 0, sc);
        this._open.add(`s:${sc.id}`);
        this._edited(true);
        return;
      }
      case "del-screen": {
        const sc = screens[i];
        const used = rots.reduce((n, r) => n + r.steps.filter((s) => s.screen === sc.id).length, 0);
        if (!confirm(`Delete screen "${sc.title || sc.id}"?${used ? ` It is also removed from ${used} rotation step${used > 1 ? "s" : ""}.` : ""}`)) return;
        F.dropScreenRefs(d, sc.id);
        screens.splice(i, 1);
        this._edited(true);
        return;
      }
      case "up-screen": case "down-screen":
        if (F.moveItem(screens, i, a === "up-screen" ? i - 1 : i + 1)) this._edited(true);
        return;
      case "add-opt-entity": {
        const inp = el.parentElement.querySelector("input");
        const v = inp.value.trim();
        if (!v) return;
        const o = (screens[i].options ??= {});
        if (!Array.isArray(o[key])) o[key] = [];
        if (!o[key].includes(v)) o[key].push(v);
        this._edited(true);
        return;
      }
      case "rm-opt-entity":
        screens[i].options[key].splice(j, 1);
        this._edited(true);
        return;
      case "add-rotation": {
        const id = F.uniqueId(rots, "rotation");
        rots.push({ id, name: "", transition: "random", face_seconds: 0, steps: screens.length ? [F.newStep(screens)] : [] });
        this._edited(true);
        return;
      }
      case "del-rotation":
        if (!confirm(`Delete rotation "${rots[i].name || rots[i].id}"?`)) return;
        rots.splice(i, 1);
        this._edited(true);
        return;
      case "add-step":
        if (!screens.length) return;
        rots[i].steps.push(F.newStep(screens));
        this._edited(true);
        return;
      case "add-alfie-step":
        rots[i].steps.push({ alfie: true, seconds: 15 });
        this._edited(true);
        return;
      case "rm-step":
        rots[i].steps.splice(j, 1);
        this._edited(true);
        return;
      case "up-step": case "down-step":
        if (F.moveItem(rots[i].steps, j, a === "up-step" ? j - 1 : j + 1)) this._edited(true);
        return;
      case "glow-auto":
        d.look.glow = el.checked ? null : 0.6;
        this._edited(true);
        this._applyLook();
        return;
      case "pg": this._pgClick(el); return;
      default: this._onClickStory(a, el, i);
    }
  }

  // Triggers and Stories tab actions.
  _onClickStory(a, el, i) {
    const d = this._draft, trs = d.triggers, sts = d.stories, j = Number(el.dataset.j);
    const flip = (key) => { this._open.has(key) ? this._open.delete(key) : this._open.add(key); this._render(); };
    switch (a) {
      case "toggle-trigger": flip(`t:${trs[i].id}`); return;
      case "add-trigger": {
        const kind = this.shadowRoot.querySelector("#newkind")?.value || "entity";
        const t = { ...clone(this._choices.triggers[kind]), id: Fm.uniqueId(trs, `${kind}_trigger`), story: sts[0]?.id || "" };
        trs.push(t);
        this._open.add(`t:${t.id}`);
        this._edited(true);
        return;
      }
      case "dup-trigger": {
        const t = clone(trs[i]);
        t.id = Fm.uniqueId(trs, `${t.id}_copy`);
        t.name = t.name ? `${t.name} (copy)` : "";
        trs.splice(i + 1, 0, t);
        this._open.add(`t:${t.id}`);
        this._edited(true);
        return;
      }
      case "del-trigger":
        if (!confirm(`Delete trigger "${trs[i].name || trs[i].id}"?`)) return;
        trs.splice(i, 1);
        this._edited(true);
        return;
      case "up-trigger": case "down-trigger":
        if (Fm.moveItem(trs, i, a === "up-trigger" ? i - 1 : i + 1)) this._edited(true);
        return;
      case "trig-pick": {
        const list = trs[i][el.dataset.key], name = el.dataset.name;
        const k = list.indexOf(name);
        k >= 0 ? list.splice(k, 1) : list.push(name);
        this._edited(true);
        return;
      }
      case "add-trig-entity": {
        const v = el.parentElement.querySelector("input").value.trim();
        if (!v) return;
        if (!trs[i].entities.includes(v)) trs[i].entities.push(v);
        if (!trs[i].name) trs[i].name = this._hass.states[v]?.attributes?.friendly_name || v;
        this._edited(true);
        return;
      }
      case "rm-trig-entity":
        trs[i].entities.splice(j, 1);
        this._edited(true);
        return;
      case "toggle-story": flip(`st:${sts[i].id}`); return;
      case "add-story": {
        const st = { id: Fm.uniqueId(sts, "story"), name: "", mode: "template", template: clone(this._choices.template), steps: [] };
        sts.push(st);
        this._open.add(`st:${st.id}`);
        this._edited(true);
        return;
      }
      case "dup-story": {
        const st = clone(sts[i]);
        st.id = Fm.uniqueId(sts, `${st.id}_copy`);
        st.name = st.name ? `${st.name} (copy)` : "";
        sts.splice(i + 1, 0, st);
        this._open.add(`st:${st.id}`);
        this._edited(true);
        return;
      }
      case "del-story": {
        const n = Fm.storyUses(d, sts[i].id);
        if (!confirm(`Delete story "${sts[i].name || sts[i].id}"?${n ? ` ${n} trigger${n > 1 ? "s" : ""} play it: point them at another story before saving.` : ""}`)) return;
        sts.splice(i, 1);
        this._edited(true);
        return;
      }
      case "up-story": case "down-story":
        if (Fm.moveItem(sts, i, a === "up-story" ? i - 1 : i + 1)) this._edited(true);
        return;
      case "story-mode":
        sts[i].mode = el.dataset.mode;
        this._edited(true);
        return;
      case "to-steps":
        sts[i].steps = Fm.compileTemplate(sts[i].template, this._choices.steps);
        sts[i].mode = "steps";
        this._edited(true);
        return;
      case "add-story-step": {
        const kind = el.parentElement.querySelector("select")?.value || "wait";
        sts[i].steps.push(clone(this._choices.steps[kind]));
        this._edited(true);
        return;
      }
      case "rm-story-step":
        sts[i].steps.splice(j, 1);
        this._edited(true);
        return;
      case "up-story-step": case "down-story-step":
        if (Fm.moveItem(sts[i].steps, j, a === "up-story-step" ? j - 1 : j + 1)) this._edited(true);
        return;
      case "play-story": this._playStory(i, el); return;
    }
  }

  async _playStory(i, el) {
    try {
      await this._hass.callWS({ type: "alfie/story/play", draft: clone(this._draft.stories[i]) });
      el.textContent = "Playing…";
      setTimeout(() => { el.textContent = "Play on every display"; }, 2000);
    } catch (e) {
      alert(`Can't play it yet: ${e?.message || e}`);
    }
  }

  async _loadTriggerStatus() {
    try {
      this._tstatus = await this._hass.callWS({ type: "alfie/triggers/status" });
    } catch (e) {
      this._tstatus = null;
    }
    this._showTriggerStatus();
  }

  _showTriggerStatus() {
    const st = this._tstatus;
    const root = this.shadowRoot;
    root.querySelectorAll("[data-fired]").forEach((el) => {
      const r = st?.triggers?.[el.dataset.fired];
      el.className = `badge ${r?.outcome === "played" ? "good" : ""}`;
      el.textContent = r ? `${OUTCOME_TEXT[r.outcome] || r.outcome} ${this._ago(r.at)}` : "not fired yet";
    });
    const now = root.querySelector(".playing");
    if (now) {
      const p = st?.playing;
      now.innerHTML = p ? `Playing <b>${esc(p.id)}</b> (step ${p.step} of ${p.total}, from ${esc(p.trigger)})${st.queue.length
        ? `, then ${st.queue.map((q) => esc(q.story)).join(", ")}` : ""}` : "Nothing playing.";
    }
  }

  _ago(at) {
    const s = Math.max(0, Date.now() / 1000 - at);
    return s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
  }

  _renameSignal(i, base) {
    const sigs = this._draft.signals, old = sigs[i].id;
    let id = base, n = 2;
    while (sigs.some((s, k) => k !== i && s.id === id)) id = `${base}_${n++}`;
    sigs[i].id = id;
    if (this._open.delete(old)) this._open.add(id);
  }

  // ------------------------------------------------------------ rendering

  _render() {
    const root = this.shadowRoot;
    root.innerHTML = `<style>${CSS}</style>
      <div class="top">
        <span class="menu"></span>
        <div class="title">${esc(this._name || "Alfie")}</div>
        <div class="status"></div>
        <button class="flat" data-action="revert">Revert</button>
        <button class="primary" data-action="save">Save</button>
      </div>
      <div class="tabs">${TABS.map(([k, t]) =>
        `<button class="tab ${k === this._tab ? "on" : ""}" data-action="tab" data-tab="${k}">${t}</button>`).join("")}</div>
      <div class="body">${this._loadError
        ? `<div class="error">Can't load Alfie's settings: ${esc(this._loadError)}</div>`
        : this._draft ? `<div class="errors"></div>${this[`_${this._tab}`]()}` : `<p class="muted">Loading…</p>`}</div>
      <datalist id="entities">${this._entityOptions()}</datalist>`;
    if (customElements.get("ha-menu-button")) {
      this._menu = document.createElement("ha-menu-button");
      this._menu.hass = this._hass;
      this._menu.narrow = this._narrow;
      root.querySelector(".menu").appendChild(this._menu);
    }
    root.querySelector(".body").addEventListener("input", (e) => this._onInput(e));
    root.querySelector(".body").addEventListener("change", (e) => this._onInput(e));
    // Enter in the entity box adds it, like pressing Add.
    root.querySelector(".body").addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.target.closest(".row")?.querySelector('[data-action="add-entity"], [data-action="add-opt-entity"], [data-action="add-trig-entity"]')?.click();
    });
    this._mountFaces();
    this._showStatus();
    this._showPreview();
    if (this._tab === "triggers") this._showTriggerStatus();
  }

  _entityOptions() {
    this._entityList ??= Object.keys(this._hass?.states || {}).sort()
      .map((e) => `<option value="${esc(e)}">${esc(this._hass.states[e].attributes?.friendly_name || "")}</option>`).join("");
    return this._entityList;
  }

  _showStatus() {
    const el = this.shadowRoot.querySelector(".status");
    if (!el) return;
    const s = this._scene, p = this._preview?.mood;
    const now = s ? `Now <b>${esc(LEVEL_TEXT[s.mood?.level] || s.mood?.level)}</b>${s.asleep ? " (asleep)" : ""}: ${esc(s.reason)}` : "";
    const draft = this._dirty && p ? ` · with your changes <b>${esc(LEVEL_TEXT[p.level])}</b>: ${esc(p.reason)}` : "";
    const msg = this._saveError ? `<span class="bad">Not saved: ${esc(this._saveError)}</span>`
      : this._flashText ? `<span class="good">${esc(this._flashText)}</span>`
      : this._dirty ? `<span class="warn">Unsaved changes</span>` : "";
    el.innerHTML = `${msg}<span class="muted">${now}${draft}</span>`;
    const save = this.shadowRoot.querySelector('[data-action="save"]');
    if (save) save.disabled = !this._dirty;
    const rev = this.shadowRoot.querySelector('[data-action="revert"]');
    if (rev) rev.disabled = !this._dirty;
  }

  _showPreview() {
    const root = this.shadowRoot;
    const box = root.querySelector(".errors");
    // The server's save refusal is shown here too: the status bar truncates it.
    const errs = this._saveError && !this._errors.includes(this._saveError) ? [...this._errors, this._saveError] : this._errors;
    if (box) box.innerHTML = errs.length
      ? `<div class="error"><b>${this._saveError ? "Not saved. Fix these first:" : "Fix these before saving:"}</b><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : "";
    const p = this._preview;
    if (!p) return;
    const byId = Object.fromEntries(p.signals.map((s) => [s.id, s]));
    root.querySelectorAll("[data-badge]").forEach((el) => {
      const r = byId[el.dataset.badge];
      const sig = this._draft.signals.find((s) => s.id === el.dataset.badge);
      if (!r || !sig) { el.className = "badge"; el.textContent = "…"; return; }
      if (!sig.enabled) { el.className = "badge off"; el.textContent = "off"; return; }
      const reading = r.entities.length === 1 ? this._reading(r.entities[0]) : `${r.count} entities`;
      el.className = `badge ${r.active ? (sig.kind === "bad" ? "bad" : "good") : ""}`;
      el.textContent = `${r.active ? "active" : "ok"} · ${reading}`;
    });
    root.querySelectorAll("[data-matches]").forEach((el) => {
      const r = byId[el.dataset.matches];
      el.innerHTML = r ? this._matchTable(r) : "";
    });
    const pm = root.querySelector(".draft-mood");
    if (pm) pm.innerHTML = `With this draft: <b>${esc(LEVEL_TEXT[p.mood.level])}</b> (score ${p.mood.score}, energy ${p.mood.energy}) · ${esc(p.mood.reason)}`;
    this._showStatus();
  }

  _reading(e) {
    if (e.state == null) return "missing";
    return `${e.state}${e.unit ? ` ${e.unit}` : ""}`;
  }

  _matchTable(r) {
    if (!r.count) return `<p class="muted">Nothing matches yet.</p>`;
    const rows = r.entities.map((e) => `<tr class="${e.passing ? "pass" : ""}">
      <td>${e.passing ? "●" : "○"}</td><td><code>${esc(e.entity_id)}</code></td>
      <td>${esc(e.name || "")}</td><td>${esc(this._reading(e))}</td></tr>`).join("");
    const more = r.count > r.entities.length ? `<p class="muted">…and ${r.count - r.entities.length} more.</p>` : "";
    return `<table class="matches">${rows}</table>${more}`;
  }

  _select(path, value, options, attrs = "") {
    return `<select data-path="${path}" ${attrs}>${options.map((o) => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`;
    }).join("")}</select>`;
  }

  _num(path, value, { min, max, step = "any", empty } = {}) {
    return `<input type="number" data-path="${path}" data-kind="number" value="${value ?? ""}"
      ${min !== undefined ? `min="${min}"` : ""} ${max !== undefined ? `max="${max}"` : ""} step="${step}"
      ${empty ? `data-empty="${empty}" placeholder="auto"` : ""}>`;
  }

  _fmt(v) {
    return Number(v).toFixed(2).replace(/\.?0+$/, "") || "0";
  }

  _footer(section) {
    return `<div class="footer"><button class="flat" data-action="reset" data-section="${section}">
      Reset ${section} to the house defaults</button></div>`;
  }

  // ------------------------------------------------------------ tabs

  _signals() {
    const sigs = this._draft.signals;
    return `<p class="intro">Each signal is something about the house that is good or bad. Alfie's mood comes from
      the ones that are active (see Mood). An entity can be a wildcard pattern such as
      <code>binary_sensor.*_battery_low</code>.</p>
      <div class="draft-mood muted"></div>
      ${sigs.map((s, i) => this._signal(s, i)).join("")}
      <button class="add" data-action="add-signal">+ Add a signal</button>
      ${this._footer("signals")}`;
  }

  _signal(s, i) {
    const open = this._open.has(s.id), n = this._draft.signals.length;
    const P = `signals.${i}`;
    const ops = [["above", "is above"], ["below", "is below"], ["is", "is"], ["is_not", "is not"]];
    const numeric = s.op === "above" || s.op === "below";
    const first = this._hass.states[s.entities.find((e) => !/[*?[]/.test(e))];
    const opts = new Set(["on", "off", ...(first?.attributes?.options || []), ...(first ? [first.state] : [])]);
    const head = `<div class="row head">
        <input type="checkbox" title="Enabled" data-path="${P}.enabled" data-kind="bool" ${s.enabled ? "checked" : ""}>
        <button class="chip ${s.kind}" data-action="kind" data-i="${i}" title="Good or bad">${s.kind}</button>
        ${s.kind === "bad" ? `<span class="chip sev ${s.severity}">${s.severity}</span>` : ""}
        <span class="label" data-action="toggle" data-i="${i}">${esc(s.label || "(no label)")}</span>
        <span class="badge" data-badge="${esc(s.id)}">…</span>
        <span class="tools">
          <button class="icon" data-action="up" data-i="${i}" ${i ? "" : "disabled"} title="Move up">▲</button>
          <button class="icon" data-action="down" data-i="${i}" ${i < n - 1 ? "" : "disabled"} title="Move down">▼</button>
          <button class="icon" data-action="toggle" data-i="${i}" title="Edit">${open ? "▾" : "▸"}</button>
        </span>
      </div>`;
    if (!open) return `<div class="signal card">${head}</div>`;
    return `<div class="signal card open">${head}
      <div class="grid">
        <label>Label<input data-path="${P}.label" value="${esc(s.label)}" placeholder="The Monstera is dry"></label>
        <label>ID<input data-path="${P}.id" value="${esc(s.id)}" pattern="[a-z0-9_]+" data-rerender></label>
        <div class="wide"><span class="lbl">Entities</span>
          <div class="chips">${s.entities.map((e, j) => `<span class="ent"><code>${esc(e)}</code>
            <button class="icon" data-action="rm-entity" data-i="${i}" data-j="${j}" title="Remove">✕</button></span>`).join("")
            || `<span class="muted">none yet</span>`}</div>
          <div class="row"><input list="entities" placeholder="Pick an entity or type a pattern" class="grow">
            <button class="flat" data-action="add-entity" data-i="${i}">Add</button></div>
        </div>
        <label>When the state${this._select(`${P}.op`, s.op, ops, "data-rerender")}</label>
        <label>Value${numeric
          ? `<input type="number" step="any" data-path="${P}.value" data-kind="value" value="${esc(s.value)}">`
          : `<input list="vals-${i}" data-path="${P}.value" data-kind="value" value="${esc(s.value)}">
             <datalist id="vals-${i}">${[...opts].map((o) => `<option value="${esc(o)}">`).join("")}</datalist>`}</label>
        <label>With several entities${this._select(`${P}.match`, s.match, [["any", "any one passing is enough"], ["all", "all must pass"]])}</label>
        <label>Kind${this._select(`${P}.kind`, s.kind, [["bad", "bad: something is wrong"], ["good", "good: something is right"]], "data-rerender")}</label>
        ${s.kind === "bad" ? `<label>Severity${this._select(`${P}.severity`, s.severity, this._choices.severities, "data-rerender")}</label>` : ""}
        <label>Weight${this._num(`${P}.weight`, s.weight, { min: 0, max: 100, empty: "null" })}
          <small>Empty uses the ${s.kind === "bad" ? "severity's" : "good"} weight (weighted mode).</small></label>
        <label>Screen that explains it${this._screenSelect(`${P}.screen`, s.screen || "", [["", "none"]])}
          <small>Stories show it for "why" and "what's wrong".</small></label>
      </div>
      ${s.kind === "bad" ? this._repeat(s, P) : ""}
      <div data-matches="${esc(s.id)}"></div>
      <div class="row end">
        <button class="flat" data-action="dup" data-i="${i}">Duplicate</button>
        <button class="flat danger" data-action="del" data-i="${i}">Delete</button>
      </div>
    </div>`;
  }

  // A select of the draft's screens, with `extra` options first; a missing id stays visible.
  _screenSelect(path, value, extra = [], attrs = "") {
    const screens = this._draft.screens;
    const opts = [...extra, ...screens.map((sc) => [sc.id, sc.title || sc.id])];
    if (value && !opts.some(([v]) => v === value)) opts.push([value, `${value} (missing)`]);
    return this._select(path, value, opts, attrs);
  }

  _repeat(s, P) {
    const r = s.repeat || {};
    const stories = this._draft.stories.map((st) => [st.id, st.name || st.id]);
    return `<details class="repeat"><summary>Repeat while it's bad${r.on_motion || r.every_hours || r.in_rotation ? " (on)" : ""}</summary><div class="grid">
        <label class="check"><input type="checkbox" data-path="${P}.repeat.on_motion" data-kind="bool" ${r.on_motion ? "checked" : ""}>
          Tell it again when someone walks in <small>A motion sensor from Behaviour, at most every 15 minutes.</small></label>
        <label>Tell it again every (hours)${this._num(`${P}.repeat.every_hours`, r.every_hours, { min: 0, max: 168, step: 0.5 })}
          <small>0 never.</small></label>
        <label>Story to tell it with${this._select(`${P}.repeat.story`, r.story, stories)}</label>
        <label class="check"><input type="checkbox" data-path="${P}.repeat.in_rotation" data-kind="bool" ${r.in_rotation ? "checked" : ""}>
          Add its screen to the rotation <small>On rotation cards, while it's bad.</small></label>
      </div></details>`;
  }

  // ------------------------------------------------------------ triggers

  _triggers() {
    const trs = this._draft.triggers;
    const kinds = this._choices.trigger_kinds.map((k) => `<option value="${k}">${esc(KIND_TEXT[k] || k)}</option>`).join("");
    return `<p class="intro">A trigger makes Alfie play a story. When one change fires several, only the highest priority
      plays. A story that fires while another plays waits its turn or interrupts it, as its "when busy" says.
      Automations can play any story too, with <code>alfie.play_story</code>.</p>
      <div class="playing muted"></div>
      ${trs.map((t, i) => this._trigger(t, i)).join("") || `<p class="muted">No triggers: Alfie only reacts to motion and fidgets.</p>`}
      <div class="row"><select id="newkind">${kinds}</select>
        <button class="add grow" data-action="add-trigger">+ Add a trigger</button></div>
      ${this._footer("triggers")}`;
  }

  _trigger(t, i) {
    const open = this._open.has(`t:${t.id}`), n = this._draft.triggers.length, c = this._choices;
    const P = `triggers.${i}`;
    const story = this._draft.stories.find((s) => s.id === t.story);
    const head = `<div class="row head">
        <input type="checkbox" title="Enabled" data-path="${P}.enabled" data-kind="bool" ${t.enabled ? "checked" : ""}>
        <span class="chip">${esc(t.kind)}</span>
        <span class="label" data-action="toggle-trigger" data-i="${i}">${esc(t.name || "(no name)")}</span>
        <span class="muted small">${esc(Fm.triggerSummary(t))} → ${esc(story?.name || t.story || "no story")} · ${t.priority}</span>
        <span class="badge" data-fired="${esc(t.id)}">…</span>
        <span class="tools">
          <button class="icon" data-action="up-trigger" data-i="${i}" ${i ? "" : "disabled"} title="Move up">▲</button>
          <button class="icon" data-action="down-trigger" data-i="${i}" ${i < n - 1 ? "" : "disabled"} title="Move down">▼</button>
          <button class="icon" data-action="toggle-trigger" data-i="${i}" title="Edit">${open ? "▾" : "▸"}</button>
        </span></div>`;
    if (!open) return `<div class="card trigger">${head}</div>`;
    const levels = c.levels;
    const picks = (key, all, text = (x) => x) => `<div class="anims">${all.map((x) =>
      `<button class="chip pick ${t[key].includes(x) ? "on" : ""}" data-action="trig-pick" data-i="${i}" data-key="${key}" data-name="${esc(x)}">${esc(text(x))}</button>`).join("")}</div>`;
    let own = "";
    if (t.kind === "entity" || t.kind === "motion") {
      own += `<div class="wide"><span class="lbl">${t.kind === "motion" ? "Motion sensors" : "Entities"}</span>
          <div class="chips">${t.entities.map((e, j) => `<span class="ent"><code>${esc(e)}</code>
            <button class="icon" data-action="rm-trig-entity" data-i="${i}" data-j="${j}" title="Remove">✕</button></span>`).join("")
            || `<span class="muted">none yet</span>`}</div>
          <div class="row"><input list="entities" placeholder="Pick an entity or type a pattern" class="grow">
            <button class="flat" data-action="add-trig-entity" data-i="${i}">Add</button></div></div>`;
    }
    if (t.kind === "entity") {
      const ops = [["changes", "changes at all"], ["above", "goes above"], ["below", "goes below"], ["is", "becomes"], ["is_not", "stops being"]];
      own += `<label>When it${this._select(`${P}.op`, t.op, ops, "data-rerender")}</label>
        ${t.op === "changes" ? "" : `<label>Value<input data-path="${P}.value" data-kind="value" value="${esc(t.value)}"></label>`}`;
    } else if (t.kind === "motion") {
      own += `<label class="check"><input type="checkbox" data-path="${P}.only_if_bad" data-kind="bool" ${t.only_if_bad ? "checked" : ""}>
        Only while something is wrong <small>A walk-in reminder.</small></label>`;
    } else if (t.kind === "mood") {
      own += `<label>When the mood${this._select(`${P}.direction`, t.direction, [["any", "changes"], ["worse", "gets worse"], ["better", "gets better"]])}</label>
        <div class="wide"><span class="lbl">From (none: any)</span>${picks("from", levels, (l) => LEVEL_TEXT[l])}</div>
        <div class="wide"><span class="lbl">To (none: any)</span>${picks("to", levels, (l) => LEVEL_TEXT[l])}</div>`;
    } else if (t.kind === "signal") {
      own += `<label>When${this._select(`${P}.edge`, t.edge, [["goes_bad", "it goes bad"], ["recovers", "it recovers"], ["either", "either"]])}</label>
        <div class="wide"><span class="lbl">Signals (none: any)</span>${picks("signals", this._draft.signals.map((s) => s.id),
          (id) => this._draft.signals.find((s) => s.id === id)?.label || id)}</div>`;
    } else if (t.kind === "wake") {
      own += `<label>When Alfie${this._select(`${P}.edge`, t.edge, [["wakes", "wakes up"], ["sleeps", "falls asleep"]])}</label>`;
    }
    const stories = this._draft.stories.map((s) => [s.id, s.name || s.id]);
    if (t.story && !stories.some(([v]) => v === t.story)) stories.push([t.story, `${t.story} (missing)`]);
    return `<div class="card trigger open">${head}
      <div class="grid">
        <label>Name<input data-path="${P}.name" value="${esc(t.name)}" placeholder="Mood gets worse"></label>
        <label>ID<input data-path="${P}.id" value="${esc(t.id)}" pattern="[a-z0-9_]+" data-rerender></label>
        <label>Kind${this._select(`${P}.kind`, t.kind, c.trigger_kinds.map((k) => [k, KIND_TEXT[k] || k]), "data-rerender")}</label>
        ${own}
        <label>Plays${this._select(`${P}.story`, t.story, stories, "data-rerender")}</label>
        <label>Priority${this._num(`${P}.priority`, t.priority, { min: 0, max: 100, step: 1 })}<small>0 to 100. Higher wins.</small></label>
        <label>When busy${this._select(`${P}.busy`, t.busy, BUSY_TEXT)}</label>
        <label>Cooldown (seconds)${this._num(`${P}.cooldown`, t.cooldown, { min: 0, max: 86400, step: 1 })}<small>Fires at most this often. 0 any time.</small></label>
        <label class="check"><input type="checkbox" data-path="${P}.while_asleep" data-kind="bool" ${t.while_asleep ? "checked" : ""}>
          Even while he sleeps</label>
        <div class="wide"><span class="lbl">Only while the mood is (none: any)</span>${picks("moods", levels, (l) => LEVEL_TEXT[l])}</div>
      </div>
      <div class="row end">
        <button class="flat" data-action="dup-trigger" data-i="${i}">Duplicate</button>
        <button class="flat danger" data-action="del-trigger" data-i="${i}">Delete</button>
      </div></div>`;
  }

  // ------------------------------------------------------------ stories

  _stories() {
    const sts = this._draft.stories;
    return `<p class="intro">A story is what Alfie does when a trigger fires: every display plays it together. Fill in the
      simple template, or switch to steps for a free sequence. <b>@mood</b> is his mood's face now and <b>@old_mood</b> the
      one before the change; <b>@why</b> shows the screens of the signals that changed, <b>@wrong</b> those of everything
      that is wrong, one after another.</p>
      ${sts.map((st, i) => this._story(st, i)).join("") || `<p class="muted">No stories yet.</p>`}
      <button class="add" data-action="add-story">+ Add a story</button>
      ${this._footer("stories")}`;
  }

  _story(st, i) {
    const open = this._open.has(`st:${st.id}`), n = this._draft.stories.length;
    const P = `stories.${i}`, uses = Fm.storyUses(this._draft, st.id);
    const count = st.mode === "template" ? Fm.compileTemplate(st.template, this._choices.steps).length : st.steps.length;
    const head = `<div class="row head">
        <span class="chip">${st.mode === "template" ? "template" : "steps"}</span>
        <span class="label" data-action="toggle-story" data-i="${i}">${esc(st.name || "(no name)")}</span>
        <span class="muted small">${count} step${count === 1 ? "" : "s"} · ${uses ? `played by ${uses} trigger${uses > 1 ? "s" : ""}` : "no trigger"}</span>
        <span class="tools">
          <button class="icon" data-action="up-story" data-i="${i}" ${i ? "" : "disabled"} title="Move up">▲</button>
          <button class="icon" data-action="down-story" data-i="${i}" ${i < n - 1 ? "" : "disabled"} title="Move down">▼</button>
          <button class="icon" data-action="toggle-story" data-i="${i}" title="Edit">${open ? "▾" : "▸"}</button>
        </span></div>`;
    if (!open) return `<div class="card story">${head}</div>`;
    const body = st.mode === "template" ? this._template(st, i) : this._steps(st, i);
    return `<div class="card story open">${head}
      <div class="grid">
        <label>Name<input data-path="${P}.name" value="${esc(st.name)}" placeholder="Bad news"></label>
        <label>ID<input data-path="${P}.id" value="${esc(st.id)}" pattern="[a-z0-9_]+" data-rerender></label>
      </div>
      <div class="row modes2">
        <button class="chip pick ${st.mode === "template" ? "on" : ""}" data-action="story-mode" data-i="${i}" data-mode="template">Template</button>
        <button class="chip pick ${st.mode === "steps" ? "on" : ""}" data-action="story-mode" data-i="${i}" data-mode="steps">Steps</button>
        ${st.mode === "template" ? `<button class="flat" data-action="to-steps" data-i="${i}">Convert to steps</button>` : ""}
      </div>
      ${body}
      <div class="row end">
        <button class="primary" data-action="play-story" data-i="${i}">Play on every display</button>
        <span class="grow"></span>
        <button class="flat" data-action="dup-story" data-i="${i}">Duplicate</button>
        <button class="flat danger" data-action="del-story" data-i="${i}">Delete</button>
      </div></div>`;
  }

  _exprOptions(none) {
    return [...(none ? [["", none]] : []), ["@mood", "@mood (his mood's face)"], ["@old_mood", "@old_mood (before the change)"],
      ...this._choices.expressions.map((e) => [e, e])];
  }

  _screenOptions(none) {
    return [...(none ? [["", none]] : []), ["@why", "@why (what changed)"], ["@wrong", "@wrong (everything wrong)"]];
  }

  _presentOptions() {
    return [["card", "as the card is set"], ["handover", "hand over: Alfie leaves"], ["corner", "corner: Alfie stays aside"]];
  }

  _template(st, i) {
    const t = st.template, P = `stories.${i}.template`, anims = this._choices.animations;
    return `<p class="muted">React, then show a screen, then close. Leave a part empty to skip it.</p><div class="grid">
        <label>React with an expression${this._select(`${P}.expression`, t.expression, this._exprOptions("none"))}</label>
        <label>…and an animation${this._select(`${P}.animation`, t.animation, [["", "none"], ...anims.map((a) => [a, a])])}</label>
        <label>Then show${this._screenSelect(`${P}.screen`, t.screen, this._screenOptions("no screen"))}</label>
        <label>For (seconds)${this._num(`${P}.seconds`, t.seconds, { min: 3, max: 3600, step: 1 })}</label>
        <label>Presented${this._select(`${P}.present`, t.present, this._presentOptions())}</label>
        <label>Transition${this._select(`${P}.transition`, t.transition, [["", "as the card is set"], ...TRANSITIONS.map((x) => [x, x]), ["random", "random"]])}</label>
        <label>Close with${this._select(`${P}.closing`, t.closing, [["", "nothing"], ...anims.map((a) => [a, a])])}</label>
      </div>`;
  }

  _steps(st, i) {
    const rows = st.steps.map((s, j) => `<div class="row step">
        <span class="muted">${j + 1}.</span><span class="chip">${esc(STEP_TEXT[s.kind] || s.kind)}</span>
        ${this._stepFields(s, `stories.${i}.steps.${j}`)}
        <span class="tools">
          <button class="icon" data-action="up-story-step" data-i="${i}" data-j="${j}" ${j ? "" : "disabled"} title="Move up">▲</button>
          <button class="icon" data-action="down-story-step" data-i="${i}" data-j="${j}" ${j < st.steps.length - 1 ? "" : "disabled"} title="Move down">▼</button>
          <button class="icon" data-action="rm-story-step" data-i="${i}" data-j="${j}" title="Remove">✕</button></span></div>`).join("");
    const kinds = this._choices.step_kinds.map((k) => `<option value="${k}">${esc(STEP_TEXT[k] || k)}</option>`).join("");
    return `${rows || `<p class="muted">No steps yet.</p>`}
      <div class="row"><select>${kinds}</select><button class="flat" data-action="add-story-step" data-i="${i}">+ Add a step</button></div>`;
  }

  _stepFields(s, P) {
    const anims = this._choices.animations;
    const secs = (key, lo, hi, label = "s") => `<input type="number" class="secs" data-path="${P}.${key}" data-kind="number"
      min="${lo}" max="${hi}" step="any" value="${esc(s[key])}"> ${label}`;
    switch (s.kind) {
      case "expression":
        return `${this._select(`${P}.name`, s.name, this._exprOptions())} hold ${secs("hold", 0, 3600)}
          blend ${secs("blend", 0, 10, "s <small class=\"muted\">(0 usual)</small>")}`;
      case "animation":
        return `${this._select(`${P}.name`, s.name, anims)}
          <label class="check inline"><input type="checkbox" data-path="${P}.wait" data-kind="bool" ${s.wait ? "checked" : ""}> wait for it</label>`;
      case "screen":
        return `${this._screenSelect(`${P}.screen`, s.screen, this._screenOptions())} for ${secs("seconds", 3, 3600)}
          ${this._select(`${P}.present`, s.present, this._presentOptions())}
          ${this._select(`${P}.transition`, s.transition, [["", "card's transition"], ...TRANSITIONS.map((x) => [x, x]), ["random", "random"]])}`;
      case "wait": return secs("seconds", 0, 3600);
      case "move":
        return `to ${this._select(`${P}.to`, s.to, this._choices.places.map((p) => [p, PLACE_TEXT[p] || p]), "data-rerender")}
          ${s.to === "custom" ? `x ${secs("x", -1, 1, "")} y ${secs("y", -1, 1, "")}` : ""} over ${secs("seconds", 0, 10)}`;
      case "resize": return `to ${secs("scale", 0.3, 1.5, "× size")} over ${secs("seconds", 0, 10)}`;
      case "speak":
        return `<input class="grow" data-path="${P}.text" value="${esc(s.text)}" placeholder="Something to say">
          <small class="muted">Speaking arrives with Voice; until then this step is skipped.</small>`;
      default: return "";
    }
  }

  _mood() {
    const m = this._draft.mood, c = this._choices;
    const modes = c.combine.map((k) => `<label class="radio card ${m.combine === k ? "on" : ""}">
        <input type="radio" name="combine" value="${k}" data-path="mood.combine" data-rerender ${m.combine === k ? "checked" : ""}>
        <b>${COMBINE_TEXT[k][0]}</b><small>${COMBINE_TEXT[k][1]}</small></label>`).join("");
    const levels = c.levels;
    let knobs = "";
    if (m.combine === "worst") {
      knobs = `<h3>The ladder</h3><div class="grid">${c.severities.map((sev) =>
        `<label>Worst is ${sev}${this._select(`mood.ladder.${sev}`, m.ladder[sev], levels.map((l) => [l, LEVEL_TEXT[l]]))}</label>`).join("")}</div>`;
    } else if (m.combine === "weighted") {
      knobs = `<h3>Weights</h3><div class="grid">${["minor", "major", "critical", "good"].map((k) =>
        `<label>${k === "good" ? "A good signal" : `A ${k} bad signal`}${this._num(`mood.weights.${k}`, m.weights[k], { min: 0, max: 100, step: 0.5 })}</label>`).join("")}</div>
        <h3>A score at or above reaches</h3><div class="grid">${["bubbly", "content", "uneasy", "sad"].map((l) =>
        `<label>${LEVEL_TEXT[l]}${this._num(`mood.thresholds.${l}`, m.thresholds[l], { min: -100, max: 100, step: 0.5 })}</label>`).join("")}
        <label class="muted">Below sad is miserable.</label></div>`;
    } else {
      knobs = `<h3>Good minus bad at or above reaches</h3><div class="grid">${["bubbly", "content", "uneasy", "sad"].map((l) =>
        `<label>${LEVEL_TEXT[l]}${this._num(`mood.count_thresholds.${l}`, m.count_thresholds[l], { min: -100, max: 100, step: 1 })}</label>`).join("")}
        <label class="muted">Below sad is miserable.</label></div>`;
    }
    const rows = levels.map((l) => `<div class="level card" data-level="${l}">
        <alfie-card class="mini"></alfie-card>
        <div class="grow"><b>${LEVEL_TEXT[l]}</b>
          <label>Expression${this._select(`mood.expressions.${l}`, m.expressions[l], c.expressions)}</label>
          <label class="slider">Energy <input type="range" min="0.05" max="1.5" step="0.05" data-path="mood.energy.${l}" data-kind="number" value="${m.energy[l]}">
            <output>${this._fmt(m.energy[l])}</output></label>
        </div></div>`).join("");
    return `<h3>How signals combine</h3><div class="modes">${modes}</div>${knobs}
      <div class="draft-mood muted"></div>
      <h3>Each mood's look</h3>
      <p class="intro">Energy sets how quick, big and bouncy he is in that mood: 1 is lively, low is slow and small.</p>
      <div class="levels">${rows}</div>${this._footer("mood")}`;
  }

  _behaviour() {
    const b = this._draft.behaviour, c = this._choices;
    const anims = c.animations;
    const appear = [["", "nothing, he just shows"], ...this._draft.stories.map((st) => [st.id, st.name || st.id])];
    for (const v of [b.appear_story_bad, b.appear_story_ok]) if (v && !appear.some(([x]) => x === v)) appear.push([v, `${v} (missing)`]);
    const set = (list) => `<div class="anims">${anims.map((a) =>
      `<button class="chip pick ${b[list].includes(a) ? "on" : ""}" data-action="anim-set" data-list="${list}" data-name="${a}">${a}</button>`).join("")}</div>`;
    const gaze = b.gaze_map.map((g, i) => `<div class="row">
        <input list="entities" class="grow" data-path="behaviour.gaze_map.${i}.entity" value="${esc(g.entity)}" placeholder="binary_sensor.…_motion">
        ${this._select(`behaviour.gaze_map.${i}.action`, g.action, [["notice", "notice you (a random pick below)"], ...anims.map((a) => [a, a])])}
        <button class="icon" data-action="rm-gaze" data-i="${i}" title="Remove">✕</button></div>`).join("");
    return `<h3>Sleep</h3><div class="grid">
        <label>Sleeps while this is on<input list="entities" data-path="behaviour.sleep_entity" value="${esc(b.sleep_entity)}" placeholder="none">
          <small>Only something critical wakes him. The Mode entity's "night" also sends him to sleep.</small></label>
        <label>Sleeping expression${this._select("behaviour.sleep_expression", b.sleep_expression, c.expressions)}</label>
      </div>
      <h3>Motion</h3>
      <p class="intro">When a sensor turns on, Alfie reacts. A run of motion within the debounce is one reaction.</p>
      ${gaze}<button class="add" data-action="add-gaze">+ Add a motion sensor</button>
      <div class="grid"><label>Debounce (seconds)${this._num("behaviour.motion_debounce", b.motion_debounce, { min: 0, max: 600, step: 1 })}</label></div>
      <h4>"Notice you" picks one of</h4>${set("notice")}
      <h3>Idle</h3>
      <div class="grid"><label>Seconds between fidgets (when content)${this._num("behaviour.idle_interval", b.idle_interval, { min: 10, max: 3600, step: 5 })}
        <small>Lively moods fidget more often, sad ones less; Personality scales it too.</small></label></div>
      <h4>Fidgets</h4>${set("idle_fidgets")}
      <h3>Reactions</h3>
      <p class="intro">What Alfie does when something turns critical, gets fixed or wakes him is set on the
        <button class="link" data-action="tab" data-tab="triggers">Triggers</button> tab, and the
        <button class="link" data-action="tab" data-tab="stories">Stories</button> they play.</p>
      <h3>When he appears in a rotation</h3>
      <p class="intro">In a rotation, screens follow screens and Alfie stays away (or in his corner). He comes on for an
        Alfie step, or between screens when the rotation asks, and plays the most relevant story on that card.</p>
      <div class="grid">
        <label>While something is wrong${this._select("behaviour.appear_story_bad", b.appear_story_bad, appear)}</label>
        <label>While all's well${this._select("behaviour.appear_story_ok", b.appear_story_ok, appear)}</label>
      </div>
      ${this._footer("behaviour")}`;
  }

  _personality() {
    const p = this._draft.personality, c = this._choices;
    const presets = Object.keys(c.personalities).map((k) =>
      `<button class="preset card ${p.preset === k ? "on" : ""}" data-action="preset" data-preset="${k}">${k}</button>`).join("");
    const sliders = Object.entries(c.sliders).map(([k, s]) => `<label class="slider">
        <span><b>${SLIDER_TEXT[k][0]}</b><small>${SLIDER_TEXT[k][1]}</small></span>
        <input type="range" min="${s.min}" max="${s.max}" step="0.05" data-path="personality.${k}" data-kind="number" value="${p[k]}">
        <output>${this._fmt(p[k])}</output></label>`).join("");
    return `<p class="intro">A personality shapes how all his motion feels, in every mood. Pick a preset or move the sliders.</p>
      <div class="presets">${presets}</div>
      <div class="split"><div class="sliders">${sliders}</div>
        <div class="live card"><alfie-card id="live"></alfie-card>
          <div class="anims">${PREVIEW_ANIMS.map((a) => `<button class="chip pick" data-action="play" data-name="${a}">${a}</button>`).join("")}</div>
          <small class="muted">Live Alfie with this personality. These buttons play on this preview only.</small>
        </div></div>${this._footer("personality")}`;
  }

  _screens() {
    const d = this._draft, types = this._choices.screen_types || {};
    this._lists = new Map();
    const list = (domain) => {
      const k = (domain || []).join(",");
      if (!this._lists.has(k)) this._lists.set(k, `ent-${this._lists.size}`);
      return this._lists.get(k);
    };
    const n = d.screens.length;
    const cards = d.screens.map((sc, i) => this._screenCard(sc, i, n, types, list)).join("");
    const lists = [...this._lists].map(([k, id]) => `<datalist id="${id}">${Object.keys(this._hass.states).sort()
      .filter((e) => Fm.inDomains(e, k ? k.split(",") : null)).map((e) => `<option value="${esc(e)}">`).join("")}</datalist>`).join("");
    const tsel = Object.entries(types).map(([k, t]) => `<option value="${esc(k)}">${esc(t.title || k)}</option>`).join("");
    return `<p class="intro">Screens are data pages Alfie shows: a plot, the weather, the sky. A card shows them when a
      signal points at one, from the <code>alfie.show_screen</code> service, or in a rotation (below). Each screen has its own
      options; defaults are shown greyed.</p>
      ${cards || `<p class="muted">No screens yet.</p>`}
      <div class="row"><select id="newtype">${tsel}</select>
        <button class="add grow" data-action="add-screen">+ Add a screen</button></div>
      <h3>Rotations</h3>
      <p class="intro">A rotation cycles through screens on a card: each step shows its screen, then Alfie himself for the
        face time, then the next step. Point a card at one with <code>mode: rotation</code>.</p>
      ${d.rotations.map((r, i) => this._rotation(r, i)).join("") || `<p class="muted">No rotations yet.</p>`}
      <button class="add" data-action="add-rotation">+ Add a rotation</button>
      <div class="footer row">
        <button class="flat" data-action="reset" data-section="screens">Reset screens to the house defaults</button>
        <button class="flat" data-action="reset" data-section="rotations">Reset rotations to the house defaults</button></div>
      ${lists}`;
  }

  _screenCard(sc, i, n, types, list) {
    const open = this._open.has(`s:${sc.id}`), info = types[sc.type];
    const head = `<div class="row head">
        <span class="chip">${esc(info?.title || sc.type)}</span>
        <span class="label" data-action="toggle-screen" data-i="${i}">${esc(sc.title || sc.id)}</span>
        <span class="muted"><code>${esc(sc.id)}</code></span>
        <span class="tools">
          <button class="icon" data-action="up-screen" data-i="${i}" ${i ? "" : "disabled"} title="Move up">▲</button>
          <button class="icon" data-action="down-screen" data-i="${i}" ${i < n - 1 ? "" : "disabled"} title="Move down">▼</button>
          <button class="icon" data-action="toggle-screen" data-i="${i}" title="Edit">${open ? "▾" : "▸"}</button>
        </span></div>`;
    if (!open) return `<div class="screen card">${head}</div>`;
    const P = `screens.${i}`;
    const form = info ? info.options.map((o) => Fm.optionField(o, sc.options?.[o.key], `${P}.options`,
      { i, type: sc.type, list })).join("") : `<p class="error">Unknown screen type "${esc(sc.type)}".</p>`;
    const needs = info?.needs;
    const saved = this._saved.screens.some((x) => x.id === sc.id && x.type === sc.type);
    const dataNote = !needs ? "" : saved
      ? `Data comes from the saved options${same(this._saved.screens.find((x) => x.id === sc.id).options, sc.options) ? "" : "; your edits show after saving"}.`
      : "Save to load data: until then this shows the placeholder.";
    return `<div class="screen card open">${head}
      <div class="split2">
        <div>
          <div class="grid">
            <label>Screen name<input data-path="${P}.title" value="${esc(sc.title)}" placeholder="${esc(info?.title || "")}"></label>
            <label>ID<input data-path="${P}.id" value="${esc(sc.id)}" pattern="[a-z0-9_]+"></label>
          </div>
          <div class="grid">${form}</div>
        </div>
        <div class="pvbox"><alfie-card class="spv" data-id="${esc(sc.id)}"></alfie-card>
          <small class="pvnote">${esc(dataNote)}</small></div>
      </div>
      <div class="row end">
        <button class="flat" data-action="dup-screen" data-i="${i}">Duplicate</button>
        <button class="flat danger" data-action="del-screen" data-i="${i}">Delete</button>
      </div></div>`;
  }

  _rotation(r, i) {
    const P = `rotations.${i}`, screens = this._draft.screens;
    const sel = (j, v) => `<select data-path="${P}.steps.${j}.screen">${screens.map((s) =>
      `<option value="${esc(s.id)}" ${s.id === v ? "selected" : ""}>${esc(s.title || s.id)}</option>`).join("")}
      ${screens.some((s) => s.id === v) ? "" : `<option value="${esc(v)}" selected>${esc(v || "(none)")} (missing)</option>`}</select>`;
    const steps = r.steps.map((st, j) => `<div class="row">
        <span class="muted">${j + 1}.</span> ${st.alfie ? `<span class="alfie-step"><b>Alfie</b> <span class="muted">plays the most relevant story</span></span>` : sel(j, st.screen)}
        <input type="number" class="secs" data-path="${P}.steps.${j}.seconds" data-kind="number" min="3" max="3600" step="1" value="${esc(st.seconds)}"> s
        <span class="tools">
          <button class="icon" data-action="up-step" data-i="${i}" data-j="${j}" ${j ? "" : "disabled"} title="Move up">▲</button>
          <button class="icon" data-action="down-step" data-i="${i}" data-j="${j}" ${j < r.steps.length - 1 ? "" : "disabled"} title="Move down">▼</button>
          <button class="icon" data-action="rm-step" data-i="${i}" data-j="${j}" title="Remove">✕</button></span></div>`).join("");
    return `<div class="card rotation">
      <div class="grid">
        <label>Name<input data-path="${P}.name" value="${esc(r.name)}" placeholder="Living room"></label>
        <label>ID<input data-path="${P}.id" value="${esc(r.id)}" pattern="[a-z0-9_]+"></label>
        <label>Transition${this._select(`${P}.transition`, r.transition, [...TRANSITIONS, "random"])}
          <small>How Alfie and a screen swap places. Random picks a different one each time.</small></label>
        <label>Alfie between screens (seconds)${this._num(`${P}.face_seconds`, r.face_seconds, { min: 0, max: 3600, step: 1 })}
          <small>0 (usual): screens follow screens and Alfie stays away. Add an Alfie step to have him come on.</small></label>
      </div>
      <span class="lbl">Steps</span>
      ${steps || `<p class="muted">No steps yet.</p>`}
      ${r.steps.length && r.steps.every((st) => st.alfie) ? `<p class="muted">Only Alfie steps: add a screen for the rotation to show.</p>` : ""}
      <div class="row"><button class="flat" data-action="add-step" data-i="${i}" ${screens.length ? "" : "disabled"}>+ Add a screen</button>
        <button class="flat" data-action="add-alfie-step" data-i="${i}">+ Add Alfie</button>
        <span class="grow"></span><button class="flat danger" data-action="del-rotation" data-i="${i}">Delete rotation</button></div>
    </div>`;
  }

  _look() {
    const L = this._draft.look;
    if (!L) return `<p class="error">This version of Alfie has no look settings.</p>`;
    const colors = LOOK_COLORS.map(([k, t]) => `<label class="opt">${t}<span class="row">
        <input type="color" class="swatch" data-path="look.${k}" data-kind="opttext" value="${Fm.swatchValue(L[k])}">
        <input class="grow" data-path="look.${k}" data-kind="opttext" value="${esc(L[k])}" placeholder="from the style"></span></label>`).join("");
    const range = (path, v, min, max, step, text) => `<label class="slider"><span>${text}</span>
        <input type="range" min="${min}" max="${max}" step="${step}" data-path="${path}" data-kind="number" value="${v}">
        <output>${this._fmt(v)}</output></label>`;
    const shapes = [["head", "Head"], ["eye", "Eyes"]].map(([part, title]) => this._shapeEditor(part, title, L.shapes?.[part])).join("");
    const extra = L.shapes && (L.shapes.left_eye || L.shapes.right_eye)
      ? `<p class="muted">A separate left or right eye shape is kept as it is; edit it in YAML.</p>` : "";
    return `<p class="intro">How Alfie is drawn, everywhere. A card's own options (set in its editor or YAML) still win over
      this, key by key, so a card can look different from the rest.</p>
      <div class="split"><div>
        <h3>Style and colour</h3>
        <div class="grid"><label>Style${this._select("look.style", L.style, this._choices.styles || CARD_STYLES)}
          <small>Sets the default colours and glow.</small></label></div>
        <div class="grid">${colors}</div>
        <p class="muted">Empty means the style's own. A colour is <code>#hex</code>, a CSS colour or <code>var(--primary-color)</code>.</p>
        <h3>Lines</h3>
        <div class="sliders">${range("look.line_width", L.line_width, 0.005, 0.1, 0.005, "Face line width")}
          ${range("look.screen_line_width", L.screen_line_width, 0.005, 0.06, 0.005, "Screen line width")}
          ${range("look.padding", L.padding, 0, 0.3, 0.01, "Padding around the ring")}</div>
        <div class="glow"><label class="check"><input type="checkbox" data-action="glow-auto" ${L.glow == null ? "checked" : ""}> Glow from the style</label>
          ${L.glow == null ? "" : range("look.glow", L.glow, 0, 2, 0.05, "Glow")}</div>
        <label class="check"><input type="checkbox" data-path="look.eye_fill" data-kind="bool" ${L.eye_fill ? "checked" : ""}> Fill the eyes</label>
        <h3>Shapes</h3>${shapes}${extra}
      </div>
      <div class="live card"><alfie-card id="look"></alfie-card>
        <div class="minis">${LOOK_EXPRESSIONS.map((e) => `<figure><alfie-card class="lookmini" data-expr="${e}"></alfie-card><figcaption>${e}</figcaption></figure>`).join("")}</div>
        <div class="anims">${LOOK_EXPRESSIONS.map((e) => `<button class="chip pick" data-action="pg" data-pg-kind="look-expr" data-name="${e}">${e}</button>`).join("")}
          <button class="chip pick on" data-action="pg" data-pg-kind="look-expr" data-name="">follow mood</button></div>
        <small class="muted">Live Alfie with the look as edited here, before you save.</small>
      </div></div>${this._footer("look")}`;
  }

  _shapeEditor(part, title, spec) {
    spec ||= { type: "circle" };
    const type = spec.type || "circle";
    const types = [...Object.keys(Fm.SHAPE_PARAMS), ...(type === "path" ? ["path"] : [])];
    const params = type === "path" ? [] : [...Fm.SHAPE_PARAMS[type], ...Fm.SHAPE_COMMON];
    return `<div class="card shape"><label>${title}
        <select data-shape="${part}" data-param="type">${types.map((t) =>
          `<option value="${t}" ${t === type ? "selected" : ""}>${t === "path" ? "path (edit in YAML)" : t}</option>`).join("")}</select></label>
      ${type === "path" ? `<p class="muted">A custom path. Edit its points in YAML (or the later shape editor); it is kept untouched here.</p>` : ""}
      ${params.map(([k, min, max, step]) => `<label class="slider"><span>${k.replace("_", " ")}</span>
        <input type="range" min="${min}" max="${max}" step="${step}" data-shape="${part}" data-param="${k}" value="${Fm.shapeParam(spec, k)}">
        <output>${this._fmt(Fm.shapeParam(spec, k))}</output></label>`).join("")}</div>`;
  }

  _playground() {
    const c = this._choices, pg = this._pg ??= { everywhere: false, level: null, expr: "", energy: 0.8 };
    const chip = (kind, name, text, on) => `<button class="chip pick ${on ? "on" : ""}" data-action="pg" data-pg-kind="${kind}" data-name="${esc(name)}">${esc(text ?? name)}</button>`;
    return `<p class="intro">Try Alfie out: everything here is a preview on this page only, unless you turn on
      "play on every display". Nothing here is saved.</p>
      <div class="split"><div>
        <h3>Expressions</h3>
        <div class="anims">${chip("expr", "", "follow mood", pg.expr === "")}${c.expressions.map((e) => chip("expr", e, e, pg.expr === e)).join("")}</div>
        <h3>Animations</h3>
        <div class="anims">${c.animations.map((a) => chip("anim", a)).join("")}</div>
        <h3>A mood level's look</h3>
        <p class="muted">Holds that level's expression and energy from the Mood tab (your draft), so you can judge them in motion.</p>
        <div class="anims">${c.levels.map((l) => chip("level", l, LEVEL_TEXT[l], pg.level === l)).join("")}</div>
        <label class="slider"><span><b>Energy</b><small>How quick, big and bouncy the motion is. Sliding it holds that energy.</small></span>
          <input type="range" id="pg-energy" min="0.05" max="1.5" step="0.05" data-pg="energy" value="${pg.energy}">
          <output>${this._fmt(pg.energy)}</output></label>
        <h3>Personality</h3>
        <div class="anims">${Object.keys(c.personalities).filter((k) => c.personalities[k]).map((k) => chip("pers", k, k)).join("")}</div>
        <h3>Where</h3>
        <label class="check"><input type="checkbox" data-pg="everywhere" ${pg.everywhere ? "checked" : ""}>
          Play on every display (uses the services: expressions hold for 10 seconds)</label>
        <div class="row"><button class="flat" data-action="pg" data-pg-kind="reset">Reset everything</button></div>
      </div>
      <div class="live card"><alfie-card id="pg"></alfie-card>
        <small class="muted">Live Alfie, following the house until you pick something.</small></div></div>`;
  }

  // Playground and Look clicks and sliders. Local previews go to the card on this page;
  // "everywhere" calls the services instead.
  _pgClick(el) {
    const kind = el.dataset.pgKind, name = el.dataset.name, pg = this._pg ??= { everywhere: false, level: null, expr: "", energy: 0.8 };
    const card = this.shadowRoot.querySelector("#pg") || this.shadowRoot.querySelector("#look");
    const on = (btns, pick) => btns.forEach((b) => b.classList.toggle("on", pick(b)));
    const sibs = () => [...el.parentElement.querySelectorAll(`[data-pg-kind="${kind}"]`)];
    const call = (svc, data) => this._hass.callService("alfie", svc, data).catch((e) => this._flash(e?.message || String(e)));
    switch (kind) {
      case "expr": case "look-expr":
        if (kind === "expr") { pg.expr = name; pg.level = null; this.shadowRoot.querySelectorAll('[data-pg-kind="level"]').forEach((b) => b.classList.remove("on")); }
        on(sibs(), (b) => b === el);
        if (pg.everywhere && kind === "expr") call("set_expression", { expression: name || "auto", duration: 10 });
        else card?.previewExpression?.(name || null);
        return;
      case "anim":
        if (pg.everywhere) call("play_animation", { animation: name });
        else card?.playLocal?.(name);
        return;
      case "level": {
        const m = this._draft.mood;
        pg.level = name; pg.expr = m.expressions[name]; pg.energy = Number(m.energy[name]);
        on(sibs(), (b) => b === el);
        this.shadowRoot.querySelectorAll('[data-pg-kind="expr"]').forEach((b) => b.classList.toggle("on", b.dataset.name === pg.expr));
        const sl = this.shadowRoot.querySelector("#pg-energy");
        if (sl) { sl.value = pg.energy; sl.parentElement.querySelector("output").textContent = this._fmt(pg.energy); }
        if (pg.everywhere) call("set_expression", { expression: pg.expr, duration: 10 });
        else { card?.previewExpression?.(pg.expr); card?.previewEnergy?.(pg.energy); }
        return;
      }
      case "pers": {
        const vals = this._choices.personalities[name];
        on(sibs(), (b) => b === el);
        card?.setPersonality?.(vals);
        return;
      }
      case "reset": {
        this._pg = null;
        card?.previewExpression?.(null);
        card?.previewEnergy?.(null);
        card?.setPersonality?.(null);
        this._render();
        return;
      }
    }
  }

  _onTool(el, ev) {
    const card = this.shadowRoot.querySelector("#pg");
    if (el.dataset.pg === "energy") {
      const pg = this._pg ??= { everywhere: false, level: null, expr: "", energy: 0.8 };
      pg.energy = Number(el.value);
      el.parentElement.querySelector("output").textContent = this._fmt(pg.energy);
      card?.previewEnergy?.(pg.energy);
      return;
    }
    if (el.dataset.pg === "everywhere") {
      (this._pg ??= { everywhere: false, level: null, expr: "", energy: 0.8 }).everywhere = el.checked;
      if (el.checked) { card?.previewExpression?.(null); card?.previewEnergy?.(null); }
      return;
    }
    if (el.dataset.shape) {
      const part = el.dataset.shape, L = this._draft.look;
      L.shapes ??= {};
      let spec = L.shapes[part] || { type: "circle" };
      if (el.dataset.param === "type") {
        if (ev.type !== "change") return;
        spec = Fm.changeShapeType(spec, el.value);
        L.shapes[part] = spec;
        this._edited(true);
      } else {
        spec = Fm.setShapeParam(spec, el.dataset.param, Number(el.value));
        L.shapes[part] = spec;
        el.parentElement.querySelector("output").textContent = this._fmt(el.value);
        this._edited();
      }
      this._applyLook();
    }
  }

  // ------------------------------------------------------------ previews

  _endPreviews() {
    const root = this.shadowRoot;
    for (const id of ["#pg", "#look"]) {
      const c = root?.querySelector(id);
      c?.previewExpression?.(null);
      c?.previewEnergy?.(null);
      c?.previewLook?.(null);
    }
    clearTimeout(this._spTimer);
  }

  _applyLook() {
    const c = this.shadowRoot.querySelector("#look");
    if (c?.previewLook) c.previewLook(clone(this._draft.look));
    this.shadowRoot.querySelectorAll(".lookmini").forEach((m) => this._drawLookMini(m));
  }

  _drawLookMini(m) {
    m.previewLook?.(clone(this._draft.look));
    m.renderStill?.({ expression: m.dataset.expr, energy: 0.9 });
  }

  _schedScreenPreview() {
    clearTimeout(this._spTimer);
    this._spTimer = setTimeout(() => this.shadowRoot.querySelectorAll(".spv").forEach((c) => this._drawScreenPreview(c)), SCREEN_PREVIEW_DELAY);
  }

  async _drawScreenPreview(card) {
    const sc = this._draft?.screens.find((x) => x.id === card.dataset.id);
    const note = card.parentElement.querySelector(".pvnote");
    if (!sc || !card.setConfig) return;
    if (!card._configured) { card.setConfig({ card: false, aspect: 1.6, padding: 0.06 }); card._configured = true; }
    const typeInfo = this._choices.screen_types?.[sc.type];
    const seq = card._seq = (card._seq || 0) + 1;
    try {
      await card.renderScreenStill({
        type: sc.type, options: sc.options || {}, typeInfo, data: this._sdata.get(sc.id)?.data ?? null,
        t: Date.now() / 1000, states: this._hass.states, config: this._hass.config, present: "handover", u: 1,
        title: sc.title,
      });
    } catch (e) {
      if (seq === card._seq && note) note.textContent = `Preview failed: ${e?.message || e}`;
    }
    // A saved screen that needs data gets it once; the preview shows the saved data.
    const saved = this._saved.screens.some((x) => x.id === sc.id && x.type === sc.type);
    if (typeInfo?.needs && saved && !this._sdata.has(sc.id)) {
      this._sdata.set(sc.id, {});
      try {
        const r = await this._hass.callWS({ type: "alfie/screen_data", screen: sc.id });
        this._sdata.set(sc.id, r);
        if (r.error && note) note.textContent = `Data: ${r.error}`;
      } catch (e) {
        this._sdata.delete(sc.id);
        if (note) note.textContent = `Data failed: ${e?.message || e}`;
        return;
      }
      if (card.isConnected && card.dataset.id === sc.id) this._drawScreenPreview(card);
    }
  }

  // ------------------------------------------------------------ faces

  _mountFaces() {
    const root = this.shadowRoot;
    root.querySelectorAll(".level").forEach((el) => this._drawLevel(el));
    root.querySelectorAll(".spv").forEach((c) => this._drawScreenPreview(c));
    for (const id of ["#look", "#pg"]) {
      const c = root.querySelector(id);
      if (!c?.setConfig) continue;
      c.setConfig({ card: false });
      c.hass = this._hass;
    }
    if (this._tab === "look") this._applyLook();
    root.querySelectorAll(".lookmini").forEach((m) => {
      m.setConfig?.({ card: false, padding: 0.06 });
      this._drawLookMini(m);
    });
    const live = root.querySelector("#live");
    if (live?.setConfig) {
      live.setConfig({ card: false, personality: this._personalityValues() });
      live.hass = this._hass;
    }
  }

  _personalityValues() {
    const p = this._draft.personality;
    return Object.fromEntries(Object.keys(this._choices.sliders).map((k) => [k, p[k]]));
  }

  _livePersonality() {
    this.shadowRoot.querySelector("#live")?.setPersonality?.(this._personalityValues());
  }

  _drawLevel(el) {
    const card = el.querySelector("alfie-card");
    if (!card?.renderStill) return;
    const l = el.dataset.level, m = this._draft.mood;
    if (!card._configured) { card.setConfig({ card: false, padding: 0.06 }); card._configured = true; }
    card.renderStill({ expression: m.expressions[l], energy: Number(m.energy[l]) });
    const out = el.querySelector("output");
    if (out) out.textContent = this._fmt(m.energy[l]);
  }
}

const CSS = `
  :host { display: block; min-height: 100vh; background: var(--primary-background-color); color: var(--primary-text-color);
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); font-size: 14px; }
  .top { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 56px;
         background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff); }
  .title { font-size: 20px; }
  .status { flex: 1; display: flex; gap: 12px; align-items: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; }
  .status .muted { color: inherit; opacity: .8; overflow: hidden; text-overflow: ellipsis; }
  .tabs { display: flex; gap: 4px; padding: 0 16px; border-bottom: 1px solid var(--divider-color); background: var(--card-background-color); }
  .tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 12px 16px; color: var(--secondary-text-color); cursor: pointer; font: inherit; }
  .tab.on { color: var(--primary-color); border-bottom-color: var(--primary-color); }
  .body { max-width: 980px; margin: 0 auto; padding: 16px; }
  h3 { margin: 24px 0 8px; font-weight: 500; } h4 { margin: 16px 0 6px; font-weight: 500; }
  .intro, small { color: var(--secondary-text-color); }
  small { display: block; font-size: 12px; margin-top: 2px; }
  .muted { color: var(--secondary-text-color); }
  .card { background: var(--card-background-color); border-radius: var(--ha-card-border-radius, 12px);
          border: 1px solid var(--divider-color); padding: 10px 12px; margin: 8px 0; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 4px 0; }
  .row.end { justify-content: flex-end; }
  .grow { flex: 1; min-width: 160px; }
  .head .label { flex: 1; cursor: pointer; font-weight: 500; min-width: 120px; }
  .tools { display: flex; gap: 2px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 16px; margin: 10px 0; }
  .grid .wide { grid-column: 1 / -1; }
  label { display: flex; flex-direction: column; gap: 4px; color: var(--secondary-text-color); font-size: 13px; }
  label.check, label.radio { flex-direction: row; align-items: center; color: var(--primary-text-color); }
  .lbl { color: var(--secondary-text-color); font-size: 13px; }
  input, select { font: inherit; color: var(--primary-text-color); background: var(--input-fill-color, var(--secondary-background-color));
         border: 1px solid var(--divider-color); border-radius: 6px; padding: 7px 8px; }
  input[type=checkbox], input[type=radio] { width: 18px; height: 18px; accent-color: var(--primary-color); }
  input[type=range] { padding: 0; min-width: 0; accent-color: var(--primary-color); }
  button { font: inherit; cursor: pointer; border-radius: 6px; }
  button:disabled { opacity: .4; cursor: default; }
  .primary { background: var(--primary-color); color: var(--text-primary-color, #fff); border: 1px solid rgba(255,255,255,.4); padding: 6px 16px; }
  .top .flat { color: inherit; border-color: rgba(255,255,255,.4); }
  .flat { background: none; border: 1px solid var(--divider-color); color: var(--primary-text-color); padding: 6px 12px; }
  .flat.danger { color: var(--error-color, #db4437); }
  .icon { background: none; border: 0; color: var(--secondary-text-color); padding: 4px 6px; }
  .add { background: none; border: 1px dashed var(--divider-color); color: var(--primary-color); padding: 10px; width: 100%; margin: 8px 0; }
  .chip { border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); padding: 2px 10px;
          border-radius: 12px; font-size: 12px; text-transform: lowercase; }
  .chip.bad { border-color: var(--error-color, #db4437); color: var(--error-color, #db4437); }
  .chip.good { border-color: var(--success-color, #43a047); color: var(--success-color, #43a047); }
  .chip.sev.critical { background: var(--error-color, #db4437); color: #fff; border-color: transparent; }
  .chip.sev.major { color: var(--warning-color, #ffa600); border-color: var(--warning-color, #ffa600); }
  .chip.pick.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: transparent; }
  .small { font-size: 12px; }
  button.link { background: none; border: 0; padding: 0; color: var(--primary-color); cursor: pointer; font: inherit; text-decoration: underline; }
  .row.step { flex-wrap: wrap; gap: 6px; }
  .row.step .secs { width: 70px; }
  label.check.inline { display: inline-flex; align-items: center; gap: 4px; }
  details.repeat { margin: 8px 0; }
  details.repeat summary { cursor: pointer; color: var(--secondary-text-color); }
  .playing { margin: 0 0 8px; }
  .row.modes2 { gap: 8px; margin: 8px 0; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--secondary-background-color); color: var(--secondary-text-color); }
  .badge.bad { background: var(--error-color, #db4437); color: #fff; }
  .badge.good { background: var(--success-color, #43a047); color: #fff; }
  .badge.off { opacity: .6; }
  .signal.open { border-color: var(--primary-color); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
  .ent { display: inline-flex; align-items: center; gap: 2px; background: var(--secondary-background-color); border-radius: 6px; padding: 2px 2px 2px 8px; }
  code { font-family: var(--code-font-family, monospace); font-size: 12px; }
  table.matches { width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0 4px; }
  .matches td { padding: 3px 6px; border-top: 1px solid var(--divider-color); }
  .matches tr.pass td:first-child { color: var(--primary-color); }
  .modes { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
  .radio { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; cursor: pointer; margin: 0; }
  .radio small { grid-column: 2; }
  .radio.on, .preset.on { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
  .levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
  .level { display: flex; gap: 12px; align-items: center; margin: 0; }
  .level .grow { min-width: 0; }
  .level label { margin-top: 6px; }
  alfie-card.mini { width: 96px; flex: none; }
  .slider { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 10px; }
  .slider > span { grid-column: 1 / -1; }
  .slider output { min-width: 36px; text-align: right; color: var(--primary-text-color); }
  .level .slider { grid-template-columns: auto 1fr auto; }
  .presets { display: flex; flex-wrap: wrap; gap: 8px; }
  .preset { margin: 0; padding: 10px 18px; color: var(--primary-text-color); text-transform: capitalize; font-weight: 500; }
  .split { display: grid; grid-template-columns: 1fr 300px; gap: 20px; margin-top: 16px; align-items: start; }
  .sliders { display: flex; flex-direction: column; gap: 14px; }
  .live { position: sticky; top: 72px; }
  .live alfie-card { display: block; background: #000; border-radius: 8px; overflow: hidden; }
  .anims { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  .error { background: rgba(219,68,55,.12); border: 1px solid var(--error-color, #db4437); border-radius: 8px; padding: 8px 12px; margin: 8px 0; }
  .error ul { margin: 4px 0 0; padding-left: 20px; }
  .bad { color: #ffd0cc; } .good { color: #d6ffd8; } .warn { font-weight: 500; }
  .footer { margin: 32px 0 16px; padding-top: 12px; border-top: 1px solid var(--divider-color); }
  .req { color: var(--error-color, #db4437); }
  .note { margin: 4px 0; padding: 6px 10px; border-left: 3px solid var(--warning-color, #ffa600); background: var(--secondary-background-color);
          color: var(--primary-text-color); font-size: 12px; border-radius: 4px; }
  .opt .row { margin: 0; }
  .screen.open { border-color: var(--primary-color); }
  .split2 { display: grid; grid-template-columns: 1fr 300px; gap: 20px; align-items: start; }
  .pvbox { position: sticky; top: 72px; }
  .pvbox alfie-card, .minis alfie-card, #pg { display: block; background: #000; border-radius: 8px; overflow: hidden; }
  .pvnote { min-height: 1em; }
  .secs { width: 80px; }
  input.swatch { width: 40px; padding: 2px; height: 34px; flex: none; }
  .minis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0; }
  .minis figure { margin: 0; text-align: center; font-size: 12px; color: var(--secondary-text-color); }
  .shape { margin: 8px 0; }
  .glow { margin: 8px 0; display: flex; flex-direction: column; gap: 8px; }
  @media (max-width: 700px) { .split2 { grid-template-columns: 1fr; } .pvbox { position: static; }
    .split { grid-template-columns: 1fr; } .live { position: static; } .status .muted { display: none; } }
`;

if (!customElements.get("alfie-panel")) customElements.define("alfie-panel", AlfiePanel);
