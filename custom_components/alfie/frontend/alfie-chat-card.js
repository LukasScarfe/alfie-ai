// custom:alfie-chat-card: typed chat with Alfie on a dashboard (design.md "Chat").
//
// The chat itself is <alfie-chat> (alfie-chat.js), the same one as the panel's
// Chat section; this card frames it with a title, his face if wanted, and a
// height. It works for every user: messages go through conversation/process.
// alfie-card.js imports this file, so the card registers with the integration.
// The visual editor is below the card: plain inputs, like alfie-card-editor.

const V = new URL(import.meta.url).search;
const C = await import(`./alfie-chat.js${V}`);

// Only keys that differ from these are written by the editor.
export const DEFAULTS = {
  title: "Alfie", height: 420, show_face: true, face_size: 96, face_position: "top", face_style: null,
  ...C.OPTIONS,
};
const CHAT_KEYS = Object.keys(C.OPTIONS);

export function applyChange(config, key, value) {
  const out = { ...config };
  const d = DEFAULTS[key];
  const empty = value === undefined || value === null || (value === "" && d === null);
  if (empty || JSON.stringify(value) === JSON.stringify(d)) delete out[key];
  else out[key] = value;
  return out;
}

// The card's settings, defaults filled and numbers kept sane.
export function settled(config) {
  const c = { ...DEFAULTS, ...Object.fromEntries(Object.entries(config || {}).filter(([, v]) => v !== undefined && v !== null)) };
  c.height = Math.max(200, Math.min(2000, Number(c.height) || DEFAULTS.height));
  c.face_size = Math.max(40, Math.min(400, Number(c.face_size) || DEFAULTS.face_size));
  if (!["top", "left", "right"].includes(c.face_position)) c.face_position = "top";
  if (!Array.isArray(c.starters)) c.starters = typeof c.starters === "string" ? c.starters.split("\n") : [];
  c.starters = c.starters.map((s) => String(s).trim()).filter(Boolean);
  return c;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class AlfieChatCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }

    static getStubConfig() { return {}; }

    static getConfigElement() { return document.createElement("alfie-chat-card-editor"); }

    setConfig(config) {
      if (!config || typeof config !== "object") throw new Error("Invalid configuration");
      this._config = settled(config);
      this._build();
    }

    set hass(hass) {
      this._hass = hass;
      if (this._chat) this._chat.hass = hass;
      if (this._face && this._face.hass !== hass) this._face.hass = hass;
    }

    getCardSize() { return Math.ceil(this._config.height / 50); }

    // Its own height in a sections view too (the Height option), not the grid's rows.
    getGridOptions() { return { columns: 12, rows: "auto", min_columns: 4 }; }

    _build() {
      const c = this._config;
      const side = c.show_face && c.face_position !== "top";
      this.shadowRoot.innerHTML = `<style>
          :host { display: block; height: 100%; }
          ha-card { height: ${c.height}px; display: flex; flex-direction: column; overflow: hidden; }
          .head { display: flex; align-items: center; gap: 12px; padding: 12px 16px 0; }
          .head h2 { margin: 0; font-size: var(--ha-card-header-font-size, 20px); font-weight: 400; color: var(--ha-card-header-color, var(--primary-text-color)); }
          .main { flex: 1; min-height: 0; display: flex; flex-direction: ${side ? (c.face_position === "right" ? "row-reverse" : "row") : "column"}; }
          .face { flex: none; width: ${c.face_size}px; align-self: center; margin: ${side ? "0 4px 0 12px" : "8px auto 0"}; }
          alfie-chat { flex: 1; min-height: 0; min-width: 0; }
        </style>
        <ha-card>
          ${c.title ? `<div class="head"><h2>${esc(c.title)}</h2></div>` : ""}
          <div class="main">${c.show_face ? `<alfie-card class="face"></alfie-card>` : ""}<alfie-chat></alfie-chat></div>
        </ha-card>`;
      this._face = this.shadowRoot.querySelector("alfie-card");
      this._chat = this.shadowRoot.querySelector("alfie-chat");
      const opts = Object.fromEntries(CHAT_KEYS.map((k) => [k, c[k]]));
      this._chat.options = opts;
      if (this._face) {
        customElements.whenDefined("alfie-card").then(() => {
          if (!this._face) return;
          this._face.setConfig({ card: false, ...(c.face_style ? { style: c.face_style } : {}), ...(c.face || {}) });
          if (this._hass) this._face.hass = this._hass;
        });
      }
      if (this._hass) this._chat.hass = this._hass;
    }
  }

  class AlfieChatCardEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = {};
    }

    setConfig(config) {
      if (this._emitted && JSON.stringify(config) === JSON.stringify(this._emitted)) { this._config = config; return; }
      this._config = { ...config };
      this._render();
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (first) this._render();
    }

    _get(k) { return this._config[k] ?? DEFAULTS[k]; }

    _set(k, v, rerender = false) {
      this._config = applyChange(this._config, k, v);
      this._emitted = this._config;
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
      if (rerender) this._render();
    }

    async _render() {
      const { STYLE_CSS } = await import(`./alfie-card-editor.js${V}`);
      const { STYLE_TEXT } = await import(`./alfie-look.js${V}`);
      const g = (k) => this._get(k);
      const text = (k, label, hint = "", ph = "") => `<div class="f"><label>${label}</label>
        <input type="text" data-k="${k}" value="${esc(g(k))}" placeholder="${esc(ph)}">${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
      const num = (k, label, min, max, hint = "") => `<div class="f"><label>${label}</label>
        <input type="number" data-k="${k}" data-num min="${min}" max="${max}" value="${esc(g(k))}">${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
      const bool = (k, label, hint = "", re = false) => `<div class="f"><label class="chk">${label}<input type="checkbox" data-k="${k}"${re ? " data-re" : ""}${g(k) ? " checked" : ""}></label>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
      const sel = (k, label, opts, hint = "", re = false) => `<div class="f"><label>${label}</label>
        <select data-k="${k}"${re ? " data-re" : ""}>${opts.map(([v, t]) => `<option value="${esc(v)}"${String(g(k) ?? "") === String(v) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
      const agents = Object.keys(this._hass?.states || {}).filter((e) => e.startsWith("conversation."))
        .map((e) => [e, this._hass.states[e].attributes?.friendly_name || e]);
      if (!agents.some(([e]) => e === g("agent"))) agents.unshift([g("agent"), g("agent")]);
      const group = (id, title, summary, inner, open = false) => `<details${open ? " open" : ""}><summary>${title}<small>${esc(summary)}</small></summary><div class="body">${inner}</div></details>`;
      const starters = (g("starters") || []).join("\n");
      this.shadowRoot.innerHTML = `<style>${STYLE_CSS} textarea { box-sizing: border-box; width: 100%; font: inherit; padding: 8px 12px; color: var(--primary-text-color);
          background: var(--card); border: 1px solid var(--edge); border-radius: 8px; resize: vertical; }</style>
        ${group("card", "Card", g("title") || "No title", `
          ${text("title", "Title", "Empty: no title.")}
          ${num("height", "Height", 200, 2000, "In pixels, 200 to 2000.")}`, true)}
        ${group("face", "Face", g("show_face") ? "Shown" : "Hidden", `
          ${bool("show_face", "Show his face", "His live face beside the chat.", true)}
          ${g("show_face") ? `${num("face_size", "Face size", 40, 400, "In pixels.")}
          ${sel("face_position", "Where", [["top", "Above the chat"], ["left", "Left of it"], ["right", "Right of it"]])}
          ${sel("face_style", "Style", [["", "Alfie's own look"], ...Object.entries(STYLE_TEXT)])}` : ""}`)}
        ${group("starters", "Starter prompts", `${(g("starters") || []).length} prompts`, `
          <div class="f"><label class="l">Prompts</label><textarea data-k="starters" data-lines rows="4">${esc(starters)}</textarea>
            <span class="hint">One per line. A tap sends it.</span></div>
          ${sel("show_starters", "Show them", [["empty", "Only when the chat is empty"], ["always", "Always, above the text box"], ["never", "Never"]])}`)}
        ${group("chat", "Chat", g("conversation") === "device" ? "One chat per device" : "One chat per user", `
          ${sel("agent", "Talk to", agents, "Alfie's brain (conversation.alfie) by default: his own answers, then the agent server.")}
          ${sel("conversation", "Keep the chat", [["user", "Per user, on every device"], ["device", "Per device (this browser)"]], "Per user follows you from phone to tablet.")}
          ${num("history", "Messages kept", 2, 500)}
          ${bool("new_chat", "\"New chat\" button", "Starts over: he forgets what was said before.")}
          ${bool("enter_sends", "Enter sends", "Shift+Enter is a new line. Off: Ctrl+Enter sends.")}
          ${bool("markdown", "Format his replies", "Bold, lists, links and code, as simple markdown.")}
          ${bool("show_times", "Show times")}
          ${text("placeholder", "Text box hint", "", C.OPTIONS.placeholder)}
          <div class="row">${text("you_name", "Your name over your messages")}${text("alfie_name", "His name")}</div>`)}`;
      this.shadowRoot.querySelectorAll("[data-k]").forEach((el) => {
        const k = el.dataset.k, re = el.hasAttribute("data-re");
        if (el.type === "checkbox") el.addEventListener("change", () => this._set(k, el.checked, re));
        else if (el.tagName === "SELECT") el.addEventListener("change", () => this._set(k, el.value || null, re));
        else if (el.hasAttribute("data-num")) el.addEventListener("change", () => {
          const v = Math.min(Number(el.max), Math.max(Number(el.min), Math.round(Number(el.value)) || DEFAULTS[k]));
          el.value = v;
          this._set(k, v);
        });
        else if (el.hasAttribute("data-lines")) el.addEventListener("input", () => this._set(k, el.value.split("\n").map((x) => x.trim()).filter(Boolean)));
        else el.addEventListener("input", () => this._set(k, el.value));
      });
    }
  }

  customElements.whenDefined("home-assistant").then(() => {
    if (!customElements.get("alfie-chat-card")) customElements.define("alfie-chat-card", AlfieChatCard);
    if (!customElements.get("alfie-chat-card-editor")) customElements.define("alfie-chat-card-editor", AlfieChatCardEditor);
  });

  window.customCards = window.customCards || [];
  if (!window.customCards.some((x) => x.type === "alfie-chat-card")) {
    window.customCards.push({ type: "alfie-chat-card", name: "Alfie chat", description: "Type to Alfie: questions about the house, or anything else.", preview: true });
  }
}
