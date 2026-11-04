// Typed chat with Alfie: <alfie-chat>, shared by the panel's Chat section and
// the custom:alfie-chat-card (design.md "Chat").
//
// Every message goes through Home Assistant's own conversation/process, to
// conversation.alfie by default: his intents first, then the agent server
// (Hermes), with the delegate standing in when that is down. So it works for
// non-admin users and no key ever reaches the browser. One conversation id per
// HA user (kept in HA's per-user frontend data, so the phone and the tablet
// carry on the same chat) or per browser; "New chat" starts another. The id is
// not a ULID, so HA keeps it past its five-minute chat timeout and the agent
// server sees one session for the whole chat.
//
// The helpers above the element are pure, for node (tests/screens/chat.test.mjs).

export const AGENT = "conversation.alfie";
export const STORE_KEY = "alfie_chat";
export const MAX_TEXT = 4000;   // characters of one message kept in the stored history

export const OPTIONS = {
  agent: AGENT,
  conversation: "user",          // user: one chat per HA user, on every device; device: per browser
  history: 50,                   // messages kept and shown
  starters: ["What's the weather like?", "Is anything left on?", "How are you?"],
  show_starters: "empty",        // empty | always | never
  placeholder: "Message Alfie…",
  enter_sends: true,             // false: Ctrl+Enter sends, Enter is a new line
  new_chat: true,                // the "New chat" button
  show_times: false,
  markdown: true,
  you_name: "",                  // empty: no names over the bubbles
  alfie_name: "",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A conversation id HA won't replace: not a ULID (which it treats as expired
// after five minutes), short, and unique enough.
export function newId(userId = "", rand = Math.random) {
  const r = Array.from({ length: 10 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)]).join("");
  const u = String(userId).replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return `chat-${u || "anon"}-${r}`;
}

// The stored chat, as kept: at most `limit` messages, each text capped.
export function trimmed(chat, limit = OPTIONS.history) {
  const n = Math.max(1, Math.min(500, Number(limit) || OPTIONS.history));
  const messages = (Array.isArray(chat?.messages) ? chat.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "alfie") && typeof m.text === "string")
    .slice(-n)
    .map((m) => ({ role: m.role, text: m.text.slice(0, MAX_TEXT), t: Number(m.t) || 0, ...(m.error ? { error: true } : {}) }));
  return { id: typeof chat?.id === "string" && chat.id ? chat.id : "", messages };
}

// Inline markdown on escaped text: `code`, **bold**, *italic*, _italic_, [links](https://…), bare links.
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/__([^_\n]+)__/g, "<b>$1</b>");
  s = s.replace(/(^|[^*\w])\*(\S(?:[^*\n]*\S)?)\*(?!\w)/g, "$1<i>$2</i>").replace(/(^|[^_\w])_(\S(?:[^_\n]*\S)?)_(?!\w)/g, "$1<i>$2</i>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

// Simple markdown to HTML. Everything is escaped first, so only these tags come
// out: paragraphs, line breaks, headings (as bold lines), lists, code blocks,
// quotes, links (http and https only), bold, italic and code.
export function markdown(text) {
  const lines = esc(text).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [], list = null, quote = [];
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((x) => `<li>${inline(x)}</li>`).join("")}</${list.tag}>`); list = null; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote>${quote.map(inline).join("<br>")}</blockquote>`); quote = []; };
  const flush = () => { flushPara(); flushList(); flushQuote(); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre><code>${code.join("\n")}</code></pre>`);
      continue;
    }
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^\s{0,3}#{1,6}\s+(.*)$/))) { flush(); out.push(`<p class="h">${inline(m[1])}</p>`); continue; }
    if ((m = line.match(/^\s{0,3}&gt;\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/)) || (m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
      const tag = m.length === 3 ? "ol" : "ul", item = m.length === 3 ? m[2] : m[1];
      flushPara(); flushQuote();
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(item);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList(); flushQuote();
    para.push(line);
  }
  flush();
  return out.join("");
}

// A message's text as HTML: markdown, or plain text with line breaks.
export const body = (text, md = true) => (md ? markdown(text) : `<p>${esc(text).replace(/\n/g, "<br>")}</p>`);

// What came back from conversation/process: the words, and whether it failed.
export function replyOf(r) {
  const res = r?.response || {};
  const words = res.speech?.plain?.speech || res.speech?.ssml?.speech || "";
  const error = res.response_type === "error";
  return { text: words || (error ? "Something went wrong." : "(no reply)"), error, id: r?.conversation_id || "" };
}

export const STYLE = `
  :host { display: flex; flex-direction: column; min-height: 0; color: var(--primary-text-color); font-size: 14px; line-height: 1.45;
    --edge: var(--outline-color, rgba(127,127,127,.45)); --soft: var(--secondary-background-color, rgba(127,127,127,.1));
    --accent: var(--primary-color, #03a9f4); --on-accent: var(--text-primary-color, #fff); }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  .log { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; overscroll-behavior: contain; }
  .empty { margin: auto; text-align: center; color: var(--secondary-text-color); padding: 16px; }
  .msg { display: flex; flex-direction: column; max-width: min(85%, 640px); }
  .msg.user { align-self: flex-end; align-items: flex-end; }
  .msg.alfie { align-self: flex-start; align-items: flex-start; }
  .who, .time { font-size: 12px; color: var(--secondary-text-color); margin: 0 6px 2px; }
  .time { margin: 2px 6px 0; }
  .bubble { padding: 8px 12px; border-radius: 16px; overflow-wrap: anywhere; }
  .user .bubble { background: var(--accent); color: var(--on-accent); border-bottom-right-radius: 4px; white-space: pre-wrap; }
  .alfie .bubble { background: var(--soft); border-bottom-left-radius: 4px; }
  .alfie.error .bubble { background: rgba(var(--rgb-error-color, 219,68,55), .14); color: var(--error-color, #db4437); }
  .bubble p { margin: 0; } .bubble p + p, .bubble p + ul, .bubble p + ol, .bubble ul + p, .bubble ol + p, .bubble pre, .bubble blockquote { margin-top: 6px; }
  .bubble p.h { font-weight: 600; }
  .bubble ul, .bubble ol { margin: 0; padding-left: 20px; }
  .bubble code { font-family: var(--code-font-family, ui-monospace, monospace); font-size: 13px; background: rgba(127,127,127,.16); padding: 0 4px; border-radius: 4px; }
  .bubble pre { margin: 6px 0 0; padding: 8px; border-radius: 8px; background: rgba(127,127,127,.16); overflow-x: auto; }
  .bubble pre code { background: none; padding: 0; }
  .bubble blockquote { margin: 6px 0 0; padding-left: 10px; border-left: 3px solid var(--edge); color: var(--secondary-text-color); }
  .bubble a { color: inherit; text-decoration: underline; }
  .dots { display: inline-flex; gap: 4px; padding: 4px 2px; }
  .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--secondary-text-color); opacity: .3; animation: blink 1.2s infinite; }
  .dots i:nth-child(2) { animation-delay: .2s; } .dots i:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .dots i { animation: none; opacity: .7; } }
  .starters { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 8px; }
  .log .starters { justify-content: center; padding: 8px 0 0; }
  .chip { height: 32px; padding: 0 12px; border-radius: 16px; border: 1px solid var(--edge); background: none; color: var(--primary-text-color);
    font: inherit; cursor: pointer; }
  .chip:hover { border-color: var(--accent); color: var(--accent); }
  .bar { display: flex; gap: 8px; align-items: flex-end; padding: 8px 12px 12px; }
  textarea { flex: 1; min-width: 0; resize: none; box-sizing: border-box; min-height: 40px; max-height: 160px; padding: 9px 12px; font: inherit;
    color: var(--primary-text-color); background: var(--card-background-color, transparent); border: 1px solid var(--edge); border-radius: 20px; }
  textarea::placeholder { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  button.icon { width: 40px; height: 40px; flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;
    border: 1px solid transparent; background: none; color: var(--secondary-text-color); cursor: pointer; padding: 0; }
  button.icon:hover { background: rgba(127,127,127,.1); color: var(--primary-text-color); }
  button.send { background: var(--accent); color: var(--on-accent); }
  button.send:hover { background: var(--accent); color: var(--on-accent); filter: brightness(1.1); }
  button:disabled { opacity: .45; cursor: default; }
  svg { width: 22px; height: 22px; fill: currentColor; }
`;

// mdi:send and mdi:chat-plus-outline, inline so the card needs no ha-icon.
const SEND = "M2,21L23,12L2,3V10L17,12L2,14V21Z";
const NEW = "M12 3C17.5 3 22 6.58 22 11C22 11.43 21.96 11.86 21.89 12.28C21.24 12.1 20.56 12 19.86 12C19.9 11.67 20 11.34 20 11C20 7.69 16.42 5 12 5C7.58 5 4 7.69 4 11C4 12.68 4.93 14.27 6.57 15.39L7 15.67V17.82L9.35 16.35L9.76 16.43C10.5 16.6 11.24 16.68 12 16.68L12 16.67C12 17.5 12.13 18.29 12.37 19.04C11.61 19.12 10.84 19.1 10.07 19L4 22V17C2.75 15.6 2 13.4 2 11C2 6.58 6.5 3 12 3M18 14H20V17H23V19H20V22H18V19H15V17H18V14Z";
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

// The chats of this page, per store key: the panel and any cards on one page share them.
const chats = new Map();
const views = new Set();   // live <alfie-chat> elements, redrawn when their chat changes

function timeText(t) {
  if (!t) return "";
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? hm : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${hm}`;
}

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class AlfieChat extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._opts = { ...OPTIONS };
      this._draft = "";
    }

    set options(o) {
      this._opts = { ...OPTIONS, ...Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null)) };
      if (this._hass) this._attach();
      this._render();
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (first || hass?.user?.id !== this._user) this._attach();
    }

    get hass() { return this._hass; }

    connectedCallback() {
      views.add(this);
      if (this._hass) this._attach(true);
      this._render();
    }

    disconnectedCallback() { views.delete(this); }

    // The key this chat is kept under: per HA user, and per browser in device mode.
    _key() {
      this._user = this._hass?.user?.id || "";
      return `${this._opts.conversation === "device" ? "device" : "user"}:${this._user}`;
    }

    // Find (or load) this view's chat. `fresh` re-reads the stored copy when
    // nothing is in flight, so a chat carried on elsewhere shows up.
    _attach(fresh = false) {
      const key = this._key();
      let c = chats.get(key);
      if (!c) {
        c = { key, id: "", messages: [], busy: 0, loaded: null, user: this._user };
        chats.set(key, c);
      }
      this._chat = c;
      if (!c.loaded || (fresh && !c.busy)) c.loaded = this._load(c);
      this._render();
    }

    async _load(c) {
      let stored = null;
      try {
        if (c.key.startsWith("device:")) stored = JSON.parse(localStorage.getItem(`${STORE_KEY}:${c.user}`) || "null");
        else stored = (await this._hass.callWS({ type: "frontend/get_user_data", key: STORE_KEY }))?.value;
      } catch (e) { /* no stored chat: a new one */ }
      if (!c.busy) {
        const t = trimmed(stored, 500);
        if (t.id) { c.id = t.id; c.messages = t.messages; }
      }
      c.id ||= newId(c.user);
      redraw(c);
    }

    async _save(c) {
      const value = trimmed(c, this._opts.history);
      try {
        if (c.key.startsWith("device:")) localStorage.setItem(`${STORE_KEY}:${c.user}`, JSON.stringify(value));
        else await this._hass.callWS({ type: "frontend/set_user_data", key: STORE_KEY, value });
      } catch (e) { /* kept in this page only */ }
    }

    async send(text) {
      text = String(text ?? "").trim();
      const c = this._chat;
      if (!text || !c || !this._hass) return;
      await c.loaded;
      c.id ||= newId(c.user);
      const id = c.id;
      c.messages.push({ role: "user", text, t: Date.now() });
      c.busy++;
      redraw(c);
      let reply;
      try {
        const msg = { type: "conversation/process", text, conversation_id: id };
        if (this._opts.agent) msg.agent_id = this._opts.agent;
        if (this._hass.language) msg.language = this._hass.language;
        reply = replyOf(await this._hass.callWS(msg));
      } catch (e) {
        reply = { text: `Couldn't reach Alfie: ${e?.message || e?.code || e}`, error: true };
      }
      c.busy--;
      if (c.id !== id) { redraw(c); return; }   // "New chat" while he was thinking: drop the old answer
      c.messages.push({ role: "alfie", text: reply.text, t: Date.now(), ...(reply.error ? { error: true } : {}) });
      c.messages = c.messages.slice(-Math.max(1, Number(this._opts.history) || OPTIONS.history));
      redraw(c);
      this._save(c);
    }

    newChat() {
      const c = this._chat;
      if (!c) return;
      c.id = newId(c.user);
      c.messages = [];
      redraw(c);
      this._save(c);
      this.shadowRoot.querySelector("textarea")?.focus();
    }

    _render() {
      const o = this._opts, c = this._chat;
      const root = this.shadowRoot;
      if (!root.querySelector(".log")) {
        root.innerHTML = `<style>${STYLE}</style><div class="log" role="log" aria-live="polite"></div><div class="starters bar-starters"></div>
          <div class="bar"><button class="icon newchat" title="New chat" aria-label="New chat">${svg(NEW)}</button>
          <textarea rows="1" aria-label="Message"></textarea>
          <button class="icon send" title="Send" aria-label="Send">${svg(SEND)}</button></div>`;
        const ta = root.querySelector("textarea");
        ta.value = this._draft;
        ta.addEventListener("input", () => { this._draft = ta.value; this._grow(ta); });
        ta.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" || e.isComposing) return;
          const sends = this._opts.enter_sends ? !e.shiftKey : (e.ctrlKey || e.metaKey);
          if (!sends) return;
          e.preventDefault();
          this._submit();
        });
        root.querySelector(".send").addEventListener("click", () => this._submit());
        root.querySelector(".newchat").addEventListener("click", () => this.newChat());
        root.addEventListener("click", (e) => {
          const chip = e.target.closest(".chip");
          if (chip) this.send(chip.dataset.text);
        });
        // Keys typed here belong to the chat, not to a dashboard or panel around it.
        root.addEventListener("keydown", (e) => e.stopPropagation());
      }
      root.querySelector("textarea").placeholder = o.placeholder || OPTIONS.placeholder;
      root.querySelector(".newchat").hidden = !o.new_chat;
      const msgs = c?.messages || [], busy = c?.busy > 0;
      const starters = (Array.isArray(o.starters) ? o.starters : []).filter((s) => String(s).trim());
      const chips = starters.map((s) => `<button class="chip" data-text="${esc(s)}">${esc(s)}</button>`).join("");
      const log = root.querySelector(".log");
      const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      const showEmptyChips = o.show_starters !== "never" && chips && !msgs.length;
      log.innerHTML = msgs.length || busy
        ? msgs.map((m) => {
          const who = m.role === "user" ? o.you_name : o.alfie_name;
          return `<div class="msg ${m.role}${m.error ? " error" : ""}">${who ? `<span class="who">${esc(who)}</span>` : ""}
            <div class="bubble">${m.role === "alfie" ? body(m.text, o.markdown) : esc(m.text)}</div>
            ${o.show_times && m.t ? `<span class="time">${esc(timeText(m.t))}</span>` : ""}</div>`;
        }).join("") + (busy ? `<div class="msg alfie"><div class="bubble" aria-label="Alfie is thinking"><span class="dots"><i></i><i></i><i></i></span></div></div>` : "")
        : `<div class="empty">${c?.loaded ? "Ask Alfie anything: about the house, or anything else." : "…"}${showEmptyChips ? `<div class="starters">${chips}</div>` : ""}</div>`;
      const bar = root.querySelector(".bar-starters");
      bar.innerHTML = o.show_starters === "always" && msgs.length ? chips : "";
      bar.hidden = !bar.innerHTML;
      root.querySelector(".send").disabled = !this._hass;
      if (near || busy) log.scrollTop = log.scrollHeight;
    }

    _grow(ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight + 2, 160)}px`;
    }

    _submit() {
      const ta = this.shadowRoot.querySelector("textarea");
      const text = ta.value.trim();
      if (!text) return;
      ta.value = this._draft = "";
      this._grow(ta);
      this.send(text);
    }

    focus() { this.shadowRoot.querySelector("textarea")?.focus(); }
  }

  if (!customElements.get("alfie-chat")) customElements.define("alfie-chat", AlfieChat);
}

function redraw(c) {
  for (const v of views) if (v._chat === c) v._render();
}
