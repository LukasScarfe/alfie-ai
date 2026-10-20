// Alfie's editor: the admin sidebar panel (registered by frontend.py).
//
// It edits one draft of the whole config (config.py) and saves it with
// alfie/config/set, which applies live. While you edit, alfie/config/preview
// says what the draft makes of the house right now (which signals are active,
// the mood), without saving. Vanilla JS, no build step, no HA-internal
// elements beyond the sidebar's menu button, so it keeps working across HA
// frontend releases.
//
// This file is the shell: the header, the left menu of the six sections and
// their sub-pages (kept in the URL hash), the save bar, the generic input
// handling and the preview, and the dock: one live Alfie beside every page
// (or floating over it), drawn with the draft's look, personality and mood.
// List pages are list + detail: the shell moves the open item's editor beside
// its list. The styles are panel/style.js (design.md "Panel style"). Each section is a module in panel/ (docs/settings-contract.md)
// that renders its body and handles its own clicks; panel/ui.js has the HTML
// builders they share. Inputs carry data-path="mood.weights.major" (and
// data-kind for how to read them); one handler writes them into the draft.
// Structural changes (add, remove, move, expand) re-render; typing never does,
// so focus stays.

const V = new URL(import.meta.url).search;
await import(`./alfie-card.js${V}`).catch(() => null); // usually loaded already; the card defines itself
const U = await import(`./panel/ui.js${V}`);
const IconPick = await import(`./panel/icon-picker.js${V}`);
const { swatchValue, perSet } = await import(`./alfie-panel-forms.js${V}`);
const EntPick = await import(`./panel/entity-picker.js${V}`);
const { CSS } = await import(`./panel/style.js${V}`);
const SECTIONS = await Promise.all(["overview", "mood", "reactions", "modes", "screens", "appearance"]
  .map((n) => import(`./panel/${n}.js${V}`)));
const BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));

const PREVIEW_DELAY = 400;   // ms after the last edit
const STACK = 760;   // px of page body below which a list and its editor take turns (list, then editor)
const FLOAT = "(max-width: 1800px)";   // no room for Alfie's column: he floats, closed until asked for   // the menu becomes a dropdown, an editor its own view
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
    this._onResize ??= () => this._placeBar();
    window.addEventListener("resize", this._onResize);
    window.addEventListener("beforeunload", this._onUnload);
    window.addEventListener("hashchange", this._onHash);
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this._onResize);
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
    else if (kind === "optper") {
      // One entity's item of a per-entity option (comma separated); all empty is unset.
      v = perSet(path.split(".").reduce((o, k) => o?.[k], this.draft), Number(el.dataset.j), el.value) || undefined;
    }
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
      case "copy": navigator.clipboard?.writeText(el.dataset.text).then(() => {
        const old = el.lastChild.textContent;
        el.lastChild.textContent = "Copied";
        setTimeout(() => { el.lastChild.textContent = old; }, 1200);
      }, () => {}); return;
      case "revert": this._revert(); return;
      case "reset": this._reset(); return;
      case "dock-hide": this._setDock(true); return;
      case "dock-show": this._setDock(false); return;
      case "dock-toggle": this._setDock(matchMedia(FLOAT).matches ? this.floatOpen : !this.dockHidden); return;
      default: if (this.draft) this._section().click?.(this, a, el);
    }
  }

  // ------------------------------------------------------------ rendering

  render() {
    const root = this.root, sec = this._section();
    const resets = sec.resets?.[this.sub || ""]?.length;
    const subTitle = sec.subs.find(([k]) => k === this.sub)?.[1];
    const title = `<div class="ptitle"><h1>${U.esc(subTitle && sec.subs.length > 1 ? subTitle : sec.title)}</h1>
      ${resets && this.draft ? `<button class="flat" data-action="reset">Reset to defaults</button>` : ""}</div>`;
    let body;
    if (this._loadError) body = `<div class="error">Can't load Alfie's settings: ${U.esc(this._loadError)}</div>`;
    else if (!this.draft) body = `<p class="muted">Loading…</p>`;
    else {
      try {
        body = `${title}${sec.render(this, this.sub)}`;
      } catch (e) {
        console.error(e);
        body = `<div class="error">This section failed to draw: ${U.esc(e?.message || e)}</div>`;
      }
    }
    if (!root.querySelector(".page")) this._frame();
    root.querySelector(".title").textContent = this.name || "Alfie";
    root.querySelector(".nav").innerHTML = this._nav();
    root.querySelector(".page > .body").innerHTML = body;
    if (this.draft && this._placeDetails()) return this.render();
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

  // The left menu: every section with its sub-pages under it. Narrow, one dropdown.
  _nav() {
    const links = SECTIONS.map((s) => {
      const subs = s.subs.length > 1 ? s.subs.map(([k, t]) => `<button class="sub ${s.id === this.sec && k === this.sub ? "on" : ""}"
        data-action="section" data-section="${s.id}" data-sub="${k}">${U.esc(t)}</button>`).join("") : "";
      const on = s.id === this.sec && !subs;
      return `<button class="sec ${on ? "on" : ""} ${s.id === this.sec ? "here" : ""}" data-action="section" data-section="${s.id}"
        data-sub="${s.subs[0]?.[0] || ""}">${U.icon(SECTION_ICONS[s.id] || "mdi:circle-small")}<span>${U.esc(s.title)}</span></button>${subs}`;
    }).join("");
    const opts = SECTIONS.flatMap((s) => s.subs.length > 1 ? s.subs.map(([k, t]) => [`${s.id}/${k}`, `${s.title} · ${t}`]) : [[`${s.id}/`, s.title]]);
    const pick = U.select("", `${this.sec}/${this.sub}`, opts, { attrs: 'class="navpick" aria-label="Page"' });
    return `<div class="links">${links}</div>${pick}`;
  }

  // List + detail: move each list's open editor into its detail column. Only one
  // item of a list is open (the last one opened); on a wide page with none open
  // the first opens. Returns true when it changed what is open (draw again).
  _placeDetails() {
    let again = false;
    const narrow = this._stacked();
    for (const ld of this.root.querySelectorAll(".page .ld")) {
      const items = [...ld.querySelectorAll(":scope > .ld-list > .ld-items > .item")];
      const keys = items.map((el) => el.dataset.key);
      const open = [...this.open].filter((k) => keys.includes(k));
      if (open.length > 1) {
        for (const k of open.slice(0, -1)) this.open.delete(k);
        again = true;
      } else if (!open.length && keys.length && !narrow) {
        this.open.add(keys[0]);
        again = true;
      }
      if (again) continue;
      const detail = items.find((el) => el.classList.contains("open"))?.querySelector(":scope > .detail");
      ld.classList.toggle("has-open", !!detail);
      if (detail) ld.querySelector(".ld-detail").replaceChildren(detail);
    }
    return again;
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
        <button class="flat alfie-toggle" data-action="dock-toggle" title="Show or hide Alfie's live preview">${U.icon("mdi:face-man-shimmer-outline")}<span>Alfie</span></button>
      </div>
      <div class="page">
        <nav class="nav"></nav>
        <main class="body"></main>
        <aside class="dock"><div class="dcard">
          <div class="dock-head"><b>Live preview</b><span class="grow"></span>
            <button class="icon" data-action="dock-hide" title="Hide Alfie" aria-label="Hide Alfie">${U.icon("mdi:close")}</button></div>
          <alfie-card id="face"></alfie-card>
          <small class="dock-note"></small>
          <div class="dock-extra"></div>
        </div></aside>
      </div>
      <div class="savebar" hidden>
        <span class="msg"></span><span class="grow"></span>
        <button class="flat" data-action="revert">Discard</button>
        <button class="primary" data-action="save">Save</button>
      </div>
      <datalist id="entities"></datalist>`;
    if (customElements.get("ha-menu-button")) {
      this._menu = document.createElement("ha-menu-button");
      this._menu.hass = this.hass;
      this._menu.narrow = this._narrow;
      root.querySelector(".menu").appendChild(this._menu);
    }
    const b = root.querySelector(".page > .body");
    root.querySelector(".nav").addEventListener("change", (e) => {
      if (e.target.matches(".navpick")) { const [sec, sub] = e.target.value.split("/"); this.go(sec, sub); }
    });
    b.addEventListener("input", (e) => this._onInput(e));
    b.addEventListener("change", (e) => this._onInput(e));
    IconPick.attach(root, b);   // icon names suggested as they are typed
    EntPick.attach(root, b, () => this.hass);   // entities searched by name or id
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
    const float = matchMedia(FLOAT).matches;
    root.querySelector(".page").classList.toggle("nodock", float ? !this.floatOpen : this.dockHidden);
    root.querySelector(".alfie-toggle").classList.toggle("on", float ? !!this.floatOpen : !this.dockHidden);
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

  // Floating, Alfie opens for this visit only; as a column, the choice is remembered.
  _setDock(hidden) {
    if (matchMedia(FLOAT).matches) this.floatOpen = !hidden;
    else {
      this.dockHidden = hidden;
      try { localStorage.setItem("alfie-panel-dock", hidden ? "hidden" : "shown"); } catch (e) { /* private mode */ }
    }
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
    el.innerHTML = `${this._flashText ? `<span class="flash">${U.esc(this._flashText)}</span>` : ""}<span class="now">${now}${draft}</span>`;
    // The save bar: only while the draft differs from what is saved (or a save failed).
    const bar = this.root.querySelector(".savebar");
    const n = this.errors.length + (this.saveError && !this.errors.includes(this.saveError) ? 1 : 0);
    bar.hidden = !this.dirty && !this.saveError;
    bar.querySelector(".msg").innerHTML = this.saveError ? `<b class="bad">Not saved.</b> Fix the problems shown at the top.`
      : n ? `<b>Unsaved changes</b> · <span class="bad">${n} problem${n > 1 ? "s" : ""} to fix first</span>` : "<b>Unsaved changes</b>";
    bar.querySelector('[data-action="save"]').disabled = !this.dirty || n > 0;
    this.root.querySelector(".page").classList.toggle("saving", !bar.hidden);
    this._placeBar();
  }

  // The save bar floats centred under the page body (HA's sidebar is beside us, not in our box).
  _placeBar() {
    const bar = this.root.querySelector(".savebar"), main = this.root.querySelector(".page > .body");
    if (!bar || bar.hidden || !main) return;
    const r = main.getBoundingClientRect();
    bar.style.left = `${r.left + r.width / 2}px`;
  }

  _showPreview() {
    const root = this.root;
    let box = root.querySelector(".errors");
    if (!box && root.querySelector(".ptitle")) {
      root.querySelector(".ptitle").insertAdjacentHTML("afterend", `<div class="errors"></div>`);
      box = root.querySelector(".errors");
    }
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

  _stacked() { return (this.root.querySelector(".page > .body")?.clientWidth || innerWidth) < STACK; }

  // Open or close an item. In a list + detail page one item is open at a time,
  // and a click on the open one only closes it when narrow (its Back arrow).
  flip(key) {
    const ld = [...this.root.querySelectorAll(".page .ld")].find((l) => l.querySelector(`.ld-items > [data-key="${CSS_ESCAPE(key)}"]`));
    if (!ld) {
      this.open.has(key) ? this.open.delete(key) : this.open.add(key);
    } else if (this.open.has(key)) {
      if (this._stacked()) this.open.delete(key);
    } else {
      for (const el of ld.querySelectorAll(".ld-items > .item")) this.open.delete(el.dataset.key);
      this.open.add(key);
    }
    this.render();
    if (ld && this._stacked()) this.root.querySelector(".page")?.scrollIntoView?.({ block: "start" });
  }
}

const CSS_ESCAPE = (v) => (globalThis.CSS?.escape ? globalThis.CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&"));
const SECTION_ICONS = { overview: "mdi:view-dashboard-outline", mood: "mdi:emoticon-outline", reactions: "mdi:lightning-bolt-outline",
  modes: "mdi:home-switch-outline", screens: "mdi:monitor-dashboard", appearance: "mdi:palette-outline" };



if (!customElements.get("alfie-panel")) customElements.define("alfie-panel", AlfiePanel);
