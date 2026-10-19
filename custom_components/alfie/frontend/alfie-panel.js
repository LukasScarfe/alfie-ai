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

const TABS = [
  ["signals", "Signals"],
  ["mood", "Mood"],
  ["behaviour", "Behaviour"],
  ["personality", "Personality"],
];
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

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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
      this._loadError = null;
    } catch (e) {
      this._loadError = e?.message || String(e);
    }
    this._unsubScene ??= this._hass.connection.subscribeMessage(
      (s) => { this._scene = s; this._showStatus(); }, { type: "alfie/subscribe" });
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
    const el = ev.target.closest("[data-path]");
    if (!el || !this._draft) return;
    const path = el.dataset.path, kind = el.dataset.kind || "text";
    let v;
    if (kind === "bool") v = el.checked;
    else if (kind === "number") {
      if (el.value === "") v = el.dataset.empty === "null" ? null : 0;
      else v = Number(el.value);
    } else if (kind === "value") {
      // A signal's test value: a number when it reads as one.
      v = el.value.trim() !== "" && Number.isFinite(Number(el.value)) ? Number(el.value) : el.value;
    } else v = el.value;
    if (/^signals\.\d+\.id$/.test(path) && this._open.delete(getPath(this._draft, path))) this._open.add(v);
    setPath(this._draft, path, v);
    if (path.startsWith("personality.") && path !== "personality.preset") {
      this._draft.personality.preset = "custom";
      this.shadowRoot.querySelectorAll(".preset").forEach((b) => b.classList.toggle("on", b.dataset.preset === "custom"));
      const out = el.parentElement.querySelector("output");
      if (out) out.textContent = this._fmt(v);
      this._livePersonality();
    }
    if (path.startsWith("mood.") && el.closest(".level")) this._drawLevel(el.closest(".level"));
    if (path.endsWith(".label")) {
      const head = el.closest(".signal")?.querySelector(".label");
      if (head) head.textContent = v || "(no label)";
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
      case "tab": this._tab = el.dataset.tab; this._render(); return;
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
                    weight: null, match: "any", screen: null, enabled: true });
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
    }
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
    this._mountFaces();
    this._showStatus();
    this._showPreview();
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
    if (box) box.innerHTML = this._errors.length
      ? `<div class="error"><b>Fix these before saving:</b><ul>${this._errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : "";
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
        <label>Screen that explains it<input data-path="${P}.screen" value="${esc(s.screen || "")}" placeholder="none">
          <small>Screens arrive in a later version; this is kept for them.</small></label>
      </div>
      <div data-matches="${esc(s.id)}"></div>
      <div class="row end">
        <button class="flat" data-action="dup" data-i="${i}">Duplicate</button>
        <button class="flat danger" data-action="del" data-i="${i}">Delete</button>
      </div>
    </div>`;
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
    const none = [["", "nothing"], ...anims.map((a) => [a, a])];
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
      <h3>Reactions</h3><div class="grid">
        <label>When something turns critical${this._select("behaviour.on_critical", b.on_critical, none)}</label>
        <label>When he wakes up${this._select("behaviour.on_wake", b.on_wake, none)}</label>
        <label>When something bad is fixed${this._select("behaviour.on_recover", b.on_recover, none)}</label>
        <label class="check"><input type="checkbox" data-path="behaviour.celebrate" data-kind="bool" ${b.celebrate ? "checked" : ""}>
          Celebrate fixes</label>
      </div>${this._footer("behaviour")}`;
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

  // ------------------------------------------------------------ faces

  _mountFaces() {
    const root = this.shadowRoot;
    root.querySelectorAll(".level").forEach((el) => this._drawLevel(el));
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
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 10px; background: var(--secondary-background-color); color: var(--secondary-text-color); }
  .badge.bad { background: var(--error-color, #db4437); color: #fff; }
  .badge.good { background: var(--success-color, #43a047); color: #fff; }
  .badge.off { opacity: .6; }
  .signal.open { border-color: var(--primary-color); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
  .ent { display: inline-flex; align-items: center; gap: 2px; background: var(--secondary-background-color); border-radius: 6px; padding: 2px 2px 2px 8px; }
  code { font-family: var(--code-font-family, monospace); font-size: 12px; }
  table.matches { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
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
  @media (max-width: 700px) { .split { grid-template-columns: 1fr; } .live { position: static; } .status .muted { display: none; } }
`;

customElements.define("alfie-panel", AlfiePanel);
