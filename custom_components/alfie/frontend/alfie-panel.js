// Alfie's editor: the admin sidebar panel (registered by frontend.py).
//
// It edits one draft of the whole config (config.py) and saves it with
// alfie/config/set, which applies live. While you edit, alfie/config/preview
// says what the draft makes of the house right now (which signals are active,
// the mood), without saving. Vanilla JS, no build step, no HA-internal
// elements beyond the sidebar's menu button, so it keeps working across HA
// frontend releases.
//
// This file is the shell: the header with Save and Revert, the six sections
// and their sub-tabs (kept in the URL hash), the generic input handling and
// the preview, and the dock: one live Alfie beside every page, drawn with the
// draft's look, personality and mood. Each section is a module in panel/ (docs/settings-contract.md)
// that renders its body and handles its own clicks; panel/ui.js has the HTML
// builders they share. Inputs carry data-path="mood.weights.major" (and
// data-kind for how to read them); one handler writes them into the draft.
// Structural changes (add, remove, move, expand) re-render; typing never does,
// so focus stays.

const V = new URL(import.meta.url).search;
await import(`./alfie-card.js${V}`).catch(() => null); // usually loaded already; the card defines itself
const U = await import(`./panel/ui.js${V}`);
// House modes ("modes") are switched off for now: the engine still runs them, the panel hides them.
const SECTIONS = await Promise.all(["overview", "mood", "reactions", /* "modes", */ "screens", "appearance"]
  .map((n) => import(`./panel/${n}.js${V}`)));
const BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));

const PREVIEW_DELAY = 400;   // ms after the last edit
const LEVEL_TEXT = U.LEVEL_TEXT;
const OUTCOME_TEXT = { played: "Played", queued: "Queued", skipped: "Skipped (busy)", cooldown: "Cooling down", outranked: "Outranked" };

const { clone, same } = U;

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
    this.root = this.shadowRoot;
    this.open = new Set();      // open items and folds: sig:<id>, t:<id>, more:<key>...
    this.preview = null;
    this.errors = [];
    this.saveError = null;
    this.tstatus = null;
    this._watch = new Map();    // entity id -> state the last preview saw
    this.faceHold = false;      // a section holds the dock face's expression (Playground)
    try { this.dockHidden = localStorage.getItem("alfie-panel-dock") === "hidden"; } catch (e) { this.dockHidden = false; }
    this._route();
    this.root.addEventListener("click", (e) => this._onClick(e));
    // A "More options" fold remembers it is open across re-renders.
    this.root.addEventListener("toggle", (e) => {
      const d = e.target;
      if (d?.dataset?.more) d.open ? this.open.add(`more:${d.dataset.more}`) : this.open.delete(`more:${d.dataset.more}`);
    }, true);
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
      if (this.dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    this._onHash = () => {
      this._section()?.leave?.(this);
      this._route();
      this.faceHold = false;
      this.render();
      this.syncFace(true);
    };
  }

  // ------------------------------------------------------------ HA hooks

  set hass(hass) {
    const first = !this.hass;
    this._hass = hass;
    if (this._menu) this._menu.hass = hass;
    if (this.face && this.face.hass !== hass) this.face.hass = hass;
    if (first) this._load();
    else this._statesChanged();
  }

  get hass() { return this._hass; }

  set narrow(v) {
    this._narrow = v;
    if (this._menu) this._menu.narrow = v;
  }

  connectedCallback() {
    window.addEventListener("beforeunload", this._onUnload);
    window.addEventListener("hashchange", this._onHash);
  }

  disconnectedCallback() {
    window.removeEventListener("beforeunload", this._onUnload);
    window.removeEventListener("hashchange", this._onHash);
    clearTimeout(this._previewTimer);
    this._section()?.leave?.(this);
    this._unsubScene?.then((u) => u()).catch(() => {});
    this._unsubScene = null;
  }

  async _load() {
    try {
      const r = await this.hass.callWS({ type: "alfie/config/get" });
      this.name = r.name;
      this.defaults = r.defaults;
      this.choices = r.choices;
      this.saved = clone(r.config);
      this.draft = clone(r.config);
      this.sdata = new Map();     // screen id -> {data, error} from alfie/screen_data
      this._loadError = null;
    } catch (e) {
      this._loadError = e?.message || String(e);
    }
    this._unsubScene ??= this.hass.connection.subscribeMessage(
      (s) => {
        const was = this.scene?.story?.seq;
        this.scene = s;
        this._showStatus();
        if (s.story?.seq !== was && this.root.querySelector("[data-fired], .playing")) this.loadTriggerStatus();
        this._section()?.scene?.(this, s);
        this.syncFace();
      }, { type: "alfie/subscribe" });
    this.render();
    this._schedulePreview(0);
  }

  get dirty() {
    return this.draft && !same(this.draft, this.saved);
  }

  // A preview is only worth redoing when an entity it showed has changed.
  _statesChanged() {
    if (!this._watch.size) return;
    for (const [e, st] of this._watch) {
      if ((this.hass.states[e]?.state ?? null) !== st) {
        this._schedulePreview(1000);
        return;
      }
    }
  }

  // ------------------------------------------------------------ routing

  // #<section>/<sub>, e.g. #mood/signals. Anything unknown is the Overview.
  _route() {
    const [s, sub] = (location.hash || "").replace(/^#/, "").split("/");
    const sec = BY_ID[s] || BY_ID.overview;
    this.sec = sec.id;
    this.sub = sec.subs.some(([k]) => k === sub) ? sub : sec.subs[0]?.[0] || "";
  }

  _section() { return BY_ID[this.sec]; }

  // Go to a section (and sub-tab), optionally opening an item key there.
  go(section, sub = "", openKey = null) {
    this._section()?.leave?.(this);
    if (openKey) this.open.add(openKey);
    const sec = BY_ID[section] || BY_ID.overview;
    const s = sec.subs.some(([k]) => k === sub) ? sub : sec.subs[0]?.[0] || "";
    const hash = `#${sec.id}${s ? `/${s}` : ""}`;
    if (location.hash !== hash) history.replaceState(null, "", hash);
    this.sec = sec.id;
    this.sub = s;
    this.faceHold = false;
    this.render();
    this.syncFace(true);
    this.root.querySelector(".page")?.scrollIntoView?.({ block: "start" });
  }

  // ------------------------------------------------------------ talking

  _schedulePreview(delay = PREVIEW_DELAY) {
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this._runPreview(), delay);
  }

  async _runPreview() {
    if (!this.draft) return;
    const draft = clone(this.draft);
    try {
      const r = await this.hass.callWS({ type: "alfie/config/preview", config: draft });
      if (!same(draft, this.draft)) return; // edited meanwhile; a newer one is coming
      this.errors = r.errors || [];
      if (!this.errors.length) {
        this.preview = r;
        this._watch = new Map();
        for (const s of r.signals) for (const e of s.entities) this._watch.set(e.entity_id, e.state);
      }
    } catch (e) {
      this.errors = [e?.message || String(e)];
    }
    this._showPreview();
  }

  async _save() {
    this.saveError = null;
    try {
      const r = await this.hass.callWS({ type: "alfie/config/set", config: this.draft });
      this.saved = clone(r.config);
      this.draft = clone(r.config);
      this.sdata = new Map();
      this.flash("Saved. Alfie is using it now.");
    } catch (e) {
      this.saveError = e?.message || String(e);
    }
    this.render();
    this._schedulePreview(0);
  }

  _revert() {
    this.draft = clone(this.saved);
    this.saveError = null;
    this.render();
    this._schedulePreview(0);
  }

  _reset() {
    const sec = this._section();
    const parts = sec.resets?.[this.sub || ""] || [];
    if (!parts.length) return;
    const title = sec.subs.find(([k]) => k === this.sub)?.[1] || sec.title;
    if (!confirm(`Put ${title} back to Alfie's defaults? You can still revert before saving.`)) return;
    for (const part of parts) {
      const [section, key] = part.split(".");
      if (key) this.draft[section][key] = clone(this.defaults[section][key]);
      else this.draft[section] = clone(this.defaults[section]);
    }
    this.edited(true);
  }

  // Call after changing the draft: the preview and status follow, and with
  // `rerender` the body is drawn again.
  edited(rerender = false) {
    this.saveError = null;
    if (rerender) this.render();
    else this._showStatus();
    this.syncFace();
    this._schedulePreview();
  }

  flash(text) {
    this._flashText = text;
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { this._flashText = null; this._showStatus(); }, 4000);
    this._showStatus();
  }

  async loadTriggerStatus() {
    try {
      this.tstatus = await this.hass.callWS({ type: "alfie/triggers/status" });
    } catch (e) {
      this.tstatus = null;
    }
    this._showTriggerStatus();
  }

  modeEntity() {
    return Object.keys(this.hass.states).find((e) => e.startsWith("select.") && e.endsWith("_mode")
      && this.hass.states[e].attributes?.options?.includes("auto")) || "select.alfie_mode";
  }

  // ------------------------------------------------------------ editing

  _onInput(ev) {
    if (!this.draft) return;
    const sec = this._section();
    if (sec.tool?.(this, ev)) return;              // a section's own non-draft control
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
    if (sec.beforeInput?.(this, path, v, el, ev) === false) return;
    if (v === undefined) {
      const keys = path.split("."), last = keys.pop();
      delete keys.reduce((o, k) => o[k], this.draft)[last];
    } else setPath(this.draft, path, v);
    if (el.type === "range") {
      const out = el.parentElement.querySelector("output");
      if (out) out.textContent = this.fmt(v);
    }
    if (kind === "opttext" && el.closest(".row")) {
      // swatch and text field edit the same colour
      el.closest(".row").querySelectorAll(`[data-path="${path}"]`).forEach((o) => {
        if (o === el) return;
        o.value = o.type === "color" ? swatchValue(v) : v;
      });
    }
    sec.afterInput?.(this, path, v, el, ev);
    const rerender = ev.type === "change" && el.dataset.rerender !== undefined;
    this.edited(rerender);
  }

  _onClick(ev) {
    const el = ev.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const a = el.dataset.action;
    switch (a) {
      case "section": this.go(el.dataset.section, el.dataset.sub || ""); return;
      case "sub": this.go(this.sec, el.dataset.name); return;
      case "go": this.go(el.dataset.section, el.dataset.sub || "", el.dataset.open || null); return;
      case "save": this._save(); return;
      case "revert": this._revert(); return;
      case "reset": this._reset(); return;
      case "dock-hide": this._setDock(true); return;
      case "dock-show": this._setDock(false); return;
      default: if (this.draft) this._section().click?.(this, a, el);
    }
  }

  // ------------------------------------------------------------ rendering

  render() {
    const root = this.root, sec = this._section();
    const subs = sec.subs.length > 1 ? `<div class="subs">${U.seg("sub", this.sub, sec.subs)}</div>` : "";
    const resets = sec.resets?.[this.sub || ""]?.length;
    let body;
    if (this._loadError) body = `<div class="error">Can't load Alfie's settings: ${U.esc(this._loadError)}</div>`;
    else if (!this.draft) body = `<p class="muted">Loading…</p>`;
    else {
      try {
        body = `${subs}<div class="errors"></div>${sec.render(this, this.sub)}
          ${resets ? `<div class="footer"><button class="flat" data-action="reset">Reset this section</button></div>` : ""}`;
      } catch (e) {
        console.error(e);
        body = `<div class="error">This section failed to draw: ${U.esc(e?.message || e)}</div>`;
      }
    }
    if (!root.querySelector(".page")) this._frame();
    root.querySelector(".title").textContent = this.name || "Alfie";
    root.querySelector(".tabs").innerHTML = SECTIONS.map((s) =>
      `<button class="tab ${s.id === this.sec ? "on" : ""}" data-action="section" data-section="${s.id}">${U.esc(s.title)}</button>`).join("");
    root.querySelector(".page > .body").innerHTML = body;
    const dl = root.querySelector("#entities");
    if (!dl.firstChild) dl.innerHTML = this._entityOptions();
    this._showDock();
    this._showStatus();
    if (this.draft) {
      this._showPreview();
      this._showTriggerStatus();
      try { sec.mount?.(this, this.sub); } catch (e) { console.error(e); }
    }
  }

  // The parts that stay put across renders: the header, the tabs and the dock,
  // so the dock's Alfie keeps running while sections redraw beside him.
  _frame() {
    const root = this.root;
    root.innerHTML = `<style>${CSS}</style>
      <div class="top">
        <span class="menu"></span>
        <div class="title"></div>
        <div class="status"></div>
        <button class="flat" data-action="dock-show" hidden>Show Alfie</button>
        <button class="flat" data-action="revert">Revert</button>
        <button class="primary" data-action="save">Save</button>
      </div>
      <nav class="tabs"></nav>
      <div class="page">
        <div class="body"></div>
        <aside class="dock"><div class="card">
          <alfie-card id="face"></alfie-card>
          <div class="dock-extra"></div>
          <div class="dock-foot"><small class="dock-note"></small>
            <button class="link" data-action="dock-hide" title="Hide Alfie on every page">Hide</button></div>
        </div></aside>
      </div>
      <datalist id="entities"></datalist>`;
    if (customElements.get("ha-menu-button")) {
      this._menu = document.createElement("ha-menu-button");
      this._menu.hass = this.hass;
      this._menu.narrow = this._narrow;
      root.querySelector(".menu").appendChild(this._menu);
    }
    const b = root.querySelector(".page > .body");
    b.addEventListener("input", (e) => this._onInput(e));
    b.addEventListener("change", (e) => this._onInput(e));
    // Enter in an entity box adds it, like pressing Add.
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches("input:not([type])")) e.target.closest(".row")?.querySelector("[data-add]")?.click();
    });
    this.face = root.querySelector("#face");
    if (this.face?.setConfig) {
      this.face.setConfig({ card: false });
      this.face.hass = this.hass;
    }
    this._faceKeys = {};
  }

  // The dock: hidden or shown, the section's extras under the face (Look's
  // minis, Personality's animations), and what the face is showing.
  _showDock() {
    const root = this.root, sec = this._section();
    root.querySelector(".page").classList.toggle("nodock", this.dockHidden);
    root.querySelector('[data-action="dock-show"]').hidden = !this.dockHidden;
    let extra = "";
    if (this.draft) {
      try { extra = sec.dock?.(this, this.sub) || ""; } catch (e) { console.error(e); }
    }
    root.querySelector(".dock-extra").innerHTML = extra;
    this._dockNote();
  }

  _dockNote() {
    const el = this.root.querySelector(".dock-note");
    if (el) el.textContent = this.faceHold ? "Alfie on this page only, as you picked."
      : this.dirty ? "Alfie with your unsaved changes, on this page only."
      : "Alfie as every card shows him now.";
  }

  _setDock(hidden) {
    this.dockHidden = hidden;
    try { localStorage.setItem("alfie-panel-dock", hidden ? "hidden" : "shown"); } catch (e) { /* private mode */ }
    this._showDock();
  }

  // Put the draft on the dock face: its look and personality as soon as they
  // change, and its mood once the preview says what the draft makes of the
  // house. The mood is held only when it differs from what Alfie shows now,
  // and not while he sleeps, is quiet or plays a story, so the face otherwise
  // follows the house. `force` re-applies everything (after a section let go).
  syncFace(force = false) {
    const f = this.face, d = this.draft;
    if (!f?.previewLook || !d) return;
    const k = this._faceKeys;
    const put = (name, value, apply) => {
      const key = JSON.stringify(value ?? null);
      if (!force && k[name] === key) return;
      k[name] = key;
      apply(value);
    };
    put("look", d.look, (v) => f.previewLook(clone(v)));
    put("pers", Object.fromEntries(Object.keys(this.choices?.sliders || {}).map((s) => [s, d.personality[s]])),
      (v) => f.setPersonality(v));
    this._dockNote();
    if (this.faceHold) { k.mood = null; return; }
    const pm = this.preview?.mood, sm = this.scene?.mood, s = this.scene;
    const differs = pm && sm && (pm.expression !== sm.expression || Math.abs(pm.energy - sm.energy) > 0.001);
    const free = s && !s.asleep && !s.story && s.expression === sm?.expression && (s.mode_info?.alfie || "awake") === "awake";
    const hold = this.dirty && differs && free ? { expression: pm.expression, energy: pm.energy } : null;
    put("mood", hold, (v) => {
      f.previewExpression(v?.expression ?? null);
      f.previewEnergy(v?.energy ?? null);
    });
  }

  _entityOptions() {
    this._entityList ??= Object.keys(this.hass?.states || {}).sort()
      .map((e) => `<option value="${U.esc(e)}">${U.esc(this.hass.states[e].attributes?.friendly_name || "")}</option>`).join("");
    return this._entityList;
  }

  _showStatus() {
    const el = this.root.querySelector(".status");
    if (!el) return;
    const s = this.scene, p = this.preview?.mood;
    const now = s ? `<b>${U.esc(LEVEL_TEXT[s.mood?.level] || s.mood?.level)}</b>${s.asleep ? " (asleep)" : ""}: ${U.esc(s.reason)}` : "";
    const draft = this.dirty && p ? ` · with your changes <b>${U.esc(LEVEL_TEXT[p.level])}</b>` : "";
    const msg = this.saveError ? `<span class="bad">Not saved</span>`
      : this._flashText ? `<span class="good">${U.esc(this._flashText)}</span>`
      : this.dirty ? `<span class="warn">Unsaved changes</span>` : "";
    el.innerHTML = `${msg}<span class="now">${now}${draft}</span>`;
    const save = this.root.querySelector('[data-action="save"]');
    if (save) save.disabled = !this.dirty;
    const rev = this.root.querySelector('[data-action="revert"]');
    if (rev) rev.disabled = !this.dirty;
  }

  _showPreview() {
    const root = this.root;
    const box = root.querySelector(".errors");
    // The server's save refusal is shown here too: the status bar truncates it.
    const errs = this.saveError && !this.errors.includes(this.saveError) ? [...this.errors, this.saveError] : this.errors;
    if (box) box.innerHTML = errs.length
      ? `<div class="error"><b>${this.saveError ? "Not saved. Fix these first:" : "Fix these before saving:"}</b><ul>${errs.map((e) => `<li>${U.esc(e)}</li>`).join("")}</ul></div>` : "";
    const p = this.preview;
    if (p) {
      const byId = Object.fromEntries(p.signals.map((s) => [s.id, s]));
      root.querySelectorAll("[data-badge]").forEach((el) => {
        const r = byId[el.dataset.badge];
        const sig = this.draft.signals.find((s) => s.id === el.dataset.badge);
        if (!r || !sig) { el.className = "badge"; el.textContent = "…"; return; }
        if (!sig.enabled) { el.className = "badge off"; el.textContent = "Off"; return; }
        const reading = !r.count ? "nothing matches" : r.entities.length === 1 ? this.reading(r.entities[0]) : `${r.count} entities`;
        el.className = `badge ${r.active ? (sig.kind === "bad" ? "bad" : "good") : ""}`;
        el.textContent = `${r.active ? "Active" : "OK"} · ${reading}`;
      });
      root.querySelectorAll("[data-matches]").forEach((el) => {
        const r = byId[el.dataset.matches];
        el.innerHTML = r ? this._matchTable(r) : "";
      });
      root.querySelectorAll(".draft-mood").forEach((pm) => {
        pm.innerHTML = `With this draft Alfie is <b>${U.esc(LEVEL_TEXT[p.mood.level])}</b>: ${U.esc(p.mood.reason)}
          <span class="muted">(score ${p.mood.score}, energy ${p.mood.energy})</span>`;
      });
    }
    this._section()?.previewed?.(this);
    this._showStatus();
    this.syncFace();
  }

  reading(e) {
    if (e.state == null) return "missing";
    return `${e.state}${e.unit ? ` ${e.unit}` : ""}`;
  }

  _matchTable(r) {
    if (!r.count) return `<p class="muted">Nothing matches yet.</p>`;
    const rows = r.entities.map((e) => `<tr class="${e.passing ? "pass" : ""}">
      <td>${e.passing ? "●" : "○"}</td><td><code>${U.esc(e.entity_id)}</code></td>
      <td>${U.esc(e.name || "")}</td><td>${U.esc(this.reading(e))}</td></tr>`).join("");
    const more = r.count > r.entities.length ? `<p class="muted">…and ${r.count - r.entities.length} more.</p>` : "";
    return `<table class="matches">${rows}</table>${more}`;
  }

  _showTriggerStatus() {
    const st = this.tstatus, root = this.root;
    root.querySelectorAll("[data-fired]").forEach((el) => {
      const r = st?.triggers?.[el.dataset.fired];
      el.className = `badge ${r?.outcome === "played" ? "good" : ""}`;
      el.textContent = r ? `${OUTCOME_TEXT[r.outcome] || r.outcome} ${this.ago(r.at)}` : "Not fired yet";
    });
    root.querySelectorAll(".playing").forEach((now) => {
      const p = st?.playing;
      const name = (id) => U.esc(this.draft.stories.find((s) => s.id === id)?.name || id);
      now.innerHTML = p ? `Playing <b>${name(p.id)}</b> (step ${p.step} of ${p.total})${st.queue.length
        ? `, then ${st.queue.map((q) => name(q.story)).join(", ")}` : ""}.` : "No story playing.";
    });
  }

  ago(at) {
    const s = Math.max(0, Date.now() / 1000 - at);
    return s < 60 ? `${Math.round(s)} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
  }

  fmt(v) {
    return Number(v).toFixed(2).replace(/\.?0+$/, "") || "0";
  }

  // ------------------------------------------------------------ shared pickers (they read the draft)

  // A select of the draft's screens, with `extra` options first; a missing id stays visible.
  screenSelect(path, value, extra = [], attrs = "") {
    const opts = [...extra, ...this.draft.screens.map((sc) => [sc.id, sc.title || sc.id])];
    if (value && !opts.some(([v]) => v === value)) opts.push([value, `${value} (missing)`]);
    return U.select(path, value, opts, { attrs });
  }

  // [id, name] for every story, `extra` first; `keep` ids that no longer exist stay visible.
  storyOptions(extra = [], keep = []) {
    const opts = [...extra, ...this.draft.stories.map((st) => [st.id, st.name || st.id])];
    for (const v of keep) if (v && !opts.some(([x]) => x === v)) opts.push([v, `${v} (missing)`]);
    return opts;
  }

  // Move an open-item key with an id that changed.
  renameOpen(prefix, from, to) {
    if (this.open.delete(`${prefix}:${from}`)) this.open.add(`${prefix}:${to}`);
  }

  // A new item's ID follows its name until the ID is edited by hand.
  autoId(prefix, id) { (this._auto ??= new Set()).add(`${prefix}:${id}`); }
  manualId(prefix, id) { this._auto?.delete(`${prefix}:${id}`); }

  // The name at list[i] changed: carry its ID along when it is still automatic.
  // `rename(old, new)` follows the ID into whatever refers to it.
  nameToId(prefix, list, i, name, fallback, idPath, rename) {
    const old = list[i].id;
    if (!this._auto?.has(`${prefix}:${old}`)) return;
    const id = U.slugId(list, name, fallback, i);
    if (id === old) return;
    this._auto.delete(`${prefix}:${old}`);
    this._auto.add(`${prefix}:${id}`);
    rename?.(old, id);
    list[i].id = id;
    this.renameOpen(prefix, old, id);
    const inp = this.root.querySelector(`[data-path="${idPath}"]`);
    if (inp) inp.value = id;
  }

  flip(key) {
    this.open.has(key) ? this.open.delete(key) : this.open.add(key);
    this.render();
  }
}

const swatchValue = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v)
  ? "#" + [...v.slice(1)].map((c) => c + c).join("") : "#000000");

const CSS = `
  :host { display: block; min-height: 100vh; background: var(--primary-background-color); color: var(--primary-text-color);
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif); font-size: 14px; line-height: 1.4;
          --gap: 12px; --radius: var(--ha-card-border-radius, 12px); --line: var(--divider-color, rgba(127,127,127,.25));
          --soft: var(--secondary-background-color, rgba(127,127,127,.08)); --muted: var(--secondary-text-color);
          --accent: var(--primary-color); --bad: var(--error-color, #db4437); --ok: var(--success-color, #43a047);
          --warn-c: var(--warning-color, #ffa600); }
  * { box-sizing: border-box; }
  .top { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 56px;
         background: var(--app-header-background-color, var(--primary-color)); color: var(--app-header-text-color, #fff); }
  .title { font-size: 20px; }
  .status { flex: 1; display: flex; gap: 12px; align-items: center; overflow: hidden; white-space: nowrap; font-size: 13px; min-width: 0; }
  .status .now { opacity: .85; overflow: hidden; text-overflow: ellipsis; }
  .tabs { position: sticky; top: 56px; z-index: 2; display: flex; gap: 2px; padding: 0 16px; overflow-x: auto;
          border-bottom: 1px solid var(--line); background: var(--card-background-color); }
  .tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 14px 16px 12px; color: var(--muted); cursor: pointer;
         font: inherit; font-weight: 500; white-space: nowrap; border-radius: 0; }
  .tab:hover { color: var(--primary-text-color); }
  .tab.on { color: var(--accent); border-bottom-color: var(--accent); }
  .page { max-width: 1320px; margin: 0 auto; padding: 20px 16px 48px; display: grid;
          grid-template-columns: minmax(0, 1fr) 260px; gap: 24px; align-items: start; }
  .page.nodock { grid-template-columns: minmax(0, 1fr); max-width: 1040px; }
  .page.nodock .dock { display: none; }
  .dock { position: sticky; top: 120px; }
  .dock > .card { margin: 0; }
  .dock-foot { display: flex; align-items: baseline; gap: 8px; }
  .dock-foot small { flex: 1; }
  .subs { margin: 0 0 16px; }

  h3 { margin: 28px 0 10px; font-size: 16px; font-weight: 500; }
  h3:first-child { margin-top: 4px; }
  h4 { margin: 0 0 8px; font-size: 12px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  p { margin: 6px 0; }
  .intro { margin: 0 0 16px; color: var(--muted); max-width: 760px; }
  .intro p { margin: 0; }
  details.learn summary { cursor: pointer; color: var(--accent); margin-top: 4px; font-size: 13px; }
  details.learn > div { margin-top: 6px; padding: 8px 12px; border-left: 3px solid var(--line); }
  small { display: block; font-size: 12px; margin-top: 2px; color: var(--muted); }
  .muted { color: var(--muted); }
  .empty { color: var(--muted); padding: 16px; text-align: center; border: 1px dashed var(--line); border-radius: var(--radius); margin: 8px 0; }
  code { font-family: var(--code-font-family, monospace); font-size: 12px; }

  .card, .item { background: var(--card-background-color); border-radius: var(--radius); border: 1px solid var(--line); margin: 8px 0; }
  .card { padding: 14px 16px; }
  .item.open { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
  .item .head { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 14px; min-height: 48px; flex-wrap: wrap; }
  .item .name { background: none; border: 0; padding: 4px 0; font: inherit; font-weight: 500; color: var(--primary-text-color);
                cursor: pointer; text-align: left; }
  .item .summary { flex: 1; min-width: 120px; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .body { padding: 4px 16px 4px 16px; border-top: 1px solid var(--line); }
  .item .foot { display: flex; gap: 8px; align-items: center; padding: 10px 16px 14px; flex-wrap: wrap; }
  .tools { display: flex; gap: 0; margin-left: auto; }
  .group { margin: 16px 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px 18px; }
  .grid > .wide, .grid > .check.wide, .grid > table, .grid > .chips { grid-column: 1 / -1; }
  .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .field > span:first-child { color: var(--muted); font-size: 12px; font-weight: 500; }
  .check { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; padding: 4px 0; }
  .check b { font-weight: 400; }
  details.more { margin: 12px 0 8px; border-top: 1px dashed var(--line); padding-top: 8px; }
  details.more > summary { cursor: pointer; color: var(--accent); font-weight: 500; padding: 4px 0; list-style: none; }
  details.more > summary::before { content: "▸ "; } details.more[open] > summary::before { content: "▾ "; }
  details.more > .grid { margin: 10px 0 4px; }

  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 4px 0; }
  .grow { flex: 1; min-width: 160px; }
  input, select { font: inherit; color: var(--primary-text-color); background: var(--input-fill-color, var(--soft));
         border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; min-width: 0; }
  input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  input[type=range] { padding: 0; accent-color: var(--accent); background: none; border: 0; }
  input[type=radio] { width: 18px; height: 18px; accent-color: var(--accent); }
  .unit { display: flex; align-items: center; gap: 6px; } .unit input { flex: 1; width: 100%; } .unit > span { color: var(--muted); }
  input.switch { appearance: none; -webkit-appearance: none; flex: none; width: 36px; height: 20px; padding: 0; margin: 0; border-radius: 10px;
         background: var(--line); border: 0; position: relative; cursor: pointer; transition: background .15s; }
  input.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
         background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: left .15s; }
  input.switch:checked { background: var(--accent); } input.switch:checked::after { left: 18px; }
  .check input.switch { margin-top: 1px; }

  button { font: inherit; cursor: pointer; border-radius: 8px; }
  button:disabled { opacity: .4; cursor: default; }
  .primary { background: var(--accent); color: var(--text-primary-color, #fff); border: 1px solid rgba(255,255,255,.4); padding: 7px 18px; font-weight: 500; }
  .top .flat { color: inherit; border-color: rgba(255,255,255,.4); }
  .flat { background: none; border: 1px solid var(--line); color: var(--primary-text-color); padding: 7px 14px; }
  .flat:hover:not(:disabled) { border-color: var(--accent); }
  .flat.danger { color: var(--bad); }
  .icon { background: none; border: 0; color: var(--muted); padding: 6px 8px; }
  .icon:hover:not(:disabled) { color: var(--primary-text-color); }
  .add { background: none; border: 1px dashed var(--line); color: var(--accent); padding: 12px; width: 100%; margin: 8px 0; font-weight: 500; }
  .add:hover { border-color: var(--accent); }
  .addrow { flex-wrap: nowrap; } .addrow .add { margin: 0; flex: 1; } .addrow select { flex: none; }
  button.link { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }

  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--card-background-color); flex-wrap: wrap; }
  .seg button { border: 0; border-radius: 0; background: none; padding: 8px 16px; color: var(--muted); font-weight: 500; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button.on { background: var(--accent); color: var(--text-primary-color, #fff); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
  .chip { border: 1px solid var(--line); background: none; color: var(--primary-text-color); padding: 3px 10px; border-radius: 14px; font-size: 12px; white-space: nowrap; }
  .chip.bad { border-color: var(--bad); color: var(--bad); }
  .chip.good { border-color: var(--ok); color: var(--ok); }
  .chip.critical { background: var(--bad); color: #fff; border-color: transparent; }
  .chip.major { color: var(--warn-c); border-color: var(--warn-c); }
  .chip.pick { cursor: pointer; } .chip.pick:hover { border-color: var(--accent); }
  .chip.pick.on { background: var(--accent); color: var(--text-primary-color, #fff); border-color: transparent; }
  .badge { font-size: 12px; padding: 3px 10px; border-radius: 12px; background: var(--soft); color: var(--muted); white-space: nowrap; }
  .badge.bad { background: var(--bad); color: #fff; } .badge.good { background: var(--ok); color: #fff; } .badge.off { opacity: .6; }
  .ent { display: inline-flex; align-items: center; gap: 2px; background: var(--soft); border-radius: 8px; padding: 2px 2px 2px 10px; }
  .ent .icon { padding: 2px 6px; }

  table.matches { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0 4px; }
  .matches td { padding: 4px 6px; border-top: 1px solid var(--line); }
  .matches tr.pass td:first-child { color: var(--accent); }
  .draft-mood { margin: 0 0 12px; padding: 10px 14px; border-radius: var(--radius); background: var(--soft); }
  .error { background: rgba(219,68,55,.12); border: 1px solid var(--bad); border-radius: 8px; padding: 8px 12px; margin: 8px 0; }
  .error ul { margin: 4px 0 0; padding-left: 20px; }
  .bad { color: #ffd0cc; } .good { color: #d6ffd8; } .warn { font-weight: 500; }
  .footer { margin: 36px 0 0; padding-top: 14px; border-top: 1px solid var(--line); }
  .req { color: var(--bad); }
  .note { margin: 4px 0; padding: 6px 10px; border-left: 3px solid var(--warn-c); background: var(--soft);
          color: var(--primary-text-color); font-size: 12px; border-radius: 4px; }
  [hidden] { display: none !important; }

  /* faces and previews */
  .split { display: grid; grid-template-columns: 1fr 300px; gap: 24px; align-items: start; }
  .live { position: sticky; top: 120px; }
  .dock alfie-card, .live alfie-card, .face alfie-card, .pvbox alfie-card, .minis alfie-card { display: block; background: #000; border-radius: 10px; overflow: hidden; }
  .sliders { display: flex; flex-direction: column; gap: 14px; }
  .slider { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 10px; }
  .slider > span { grid-column: 1 / -1; }
  .slider output { min-width: 36px; text-align: right; color: var(--primary-text-color); }
  .slider b { font-weight: 500; }
  input.swatch { width: 42px; padding: 2px; height: 36px; flex: none; }
  .opt .row { margin: 0; }
  @media (max-width: 760px) {
    .split { grid-template-columns: 1fr; } .live { position: static; }
    .page { grid-template-columns: minmax(0, 1fr); }
    .dock { position: static; order: -1; } .dock > .card { max-width: 200px; margin: 0 auto; }
    .status .now { display: none; } .title { font-size: 18px; }
    .item .summary { flex-basis: 100%; order: 9; white-space: normal; }
  }
`;

if (!customElements.get("alfie-panel")) customElements.define("alfie-panel", AlfiePanel);
