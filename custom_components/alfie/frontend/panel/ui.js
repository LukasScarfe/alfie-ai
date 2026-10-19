// The admin panel's HTML builders, shared by every section (docs/settings-contract.md).
//
// Pure: each returns an HTML string and touches no DOM, so node can test them
// (tests/screens/ui.test.mjs). Inputs carry data-path (and data-kind for how
// the shell reads them); buttons carry data-action plus data-i / data-j /
// data-key / data-name for the section's click handler. Every text is escaped.

export const LEVEL_TEXT = {
  bubbly: "Bubbly", content: "Content", uneasy: "Uneasy", sad: "Sad", miserable: "Miserable",
};

export const clone = (v) => JSON.parse(JSON.stringify(v));
// Key order must not matter: a section reset from the defaults equals the saved one.
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
export const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// An id for a new item: the name as a slug, unique in `list` (except index `except`).
export function slugId(list, name, fallback, except = -1) {
  const base = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || fallback;
  let id = base, n = 2;
  while (list.some((x, k) => k !== except && x.id === id)) id = `${base}_${n++}`;
  return id;
}

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// "glance_left" -> "Glance left". Tokens (@mood) and empty stay as they are.
export function human(id) {
  const s = String(id ?? "");
  if (!s || s.startsWith("@")) return s;
  const t = s.replace(/_/g, " ");
  return t[0].toUpperCase() + t.slice(1);
}

const attr = (k, v) => (v === undefined || v === null || v === false ? "" : v === true ? ` ${k}` : ` ${k}="${esc(v)}"`);

export function select(path, value, options, { rerender = false, attrs = "" } = {}) {
  const opts = options.map((o) => {
    const [v, t] = Array.isArray(o) ? o : [o, human(o)];
    return `<option value="${esc(v)}"${String(v) === String(value ?? "") ? " selected" : ""}>${esc(t)}</option>`;
  }).join("");
  return `<select${path ? ` data-path="${esc(path)}"` : ""}${rerender ? " data-rerender" : ""} ${attrs}>${opts}</select>`;
}

// A number with its unit inside the field. `empty: "null"` lets it be left empty (the default).
export function num(path, value, { min, max, step = "any", empty, unit, placeholder } = {}) {
  const input = `<input type="number" data-path="${esc(path)}" data-kind="number" value="${esc(value ?? "")}"${attr("min", min)}${attr("max", max)} step="${step}"${empty ? ` data-empty="${empty}"` : ""}${attr("placeholder", placeholder ?? (empty ? "Default" : undefined))}>`;
  return unit ? `<span class="unit">${input}<span>${esc(unit)}</span></span>` : input;
}

export function text(path, value, { placeholder, kind, attrs = "", list } = {}) {
  return `<input data-path="${esc(path)}"${kind ? ` data-kind="${kind}"` : ""} value="${esc(value ?? "")}"${attr("placeholder", placeholder)}${attr("list", list)} ${attrs}>`;
}

// A switch. With a path it edits a bool in the draft; with an action it is a button-like toggle.
export function toggle(path, on, { title, action, i } = {}) {
  const data = path ? ` data-path="${esc(path)}" data-kind="bool"` : ` data-action="${esc(action)}"${attr("data-i", i)}`;
  return `<input type="checkbox" class="switch"${data}${on ? " checked" : ""}${attr("title", title)}${attr("aria-label", title)}>`;
}

const hintOf = (hint) => (hint ? `<small>${hint}</small>` : "");

// One labelled control. `hint` is HTML (callers escape what they interpolate).
export const field = (label, control, hint = "") => `<label class="field"><span>${esc(label)}</span>${control}${hintOf(hint)}</label>`;
export const wide = (label, control, hint = "") => `<div class="field wide"><span>${esc(label)}</span>${control}${hintOf(hint)}</div>`;

export function check(path, on, label, hint = "") {
  return `<label class="check">${toggle(path, on)}<span><b>${esc(label)}</b>${hintOf(hint)}</span></label>`;
}

export const group = (title, inner) => `<section class="group">${title ? `<h4>${esc(title)}</h4>` : ""}<div class="grid">${inner}</div></section>`;

// A fold whose open state survives re-renders (kept in p.open as more:<key>).
export function more(p, key, inner, summary = "More options") {
  return `<details class="more" data-more="${esc(key)}"${p.open.has(`more:${key}`) ? " open" : ""}><summary>${esc(summary)}</summary><div class="grid">${inner}</div></details>`;
}

// The one list item every section uses: a header, and when open its body and footer.
export function item({ key, i, n, open, cls = "", enabledPath, enabled, chips = "", name, summary = "", badge = "",
  actions = {}, body = "", footer = "" }) {
  const a = actions;
  const head = `<div class="head">
      ${enabledPath ? toggle(enabledPath, enabled, { title: "On" }) : ""}
      ${chips}
      <button class="name" data-action="${esc(a.toggle)}" data-i="${i}">${esc(name || "(no name)")}</button>
      <span class="summary">${summary}</span>
      ${badge}
      <span class="tools">
        ${a.up ? `<button class="icon" data-action="${esc(a.up)}" data-i="${i}" ${i ? "" : "disabled"} title="Move up" aria-label="Move up">▲</button>` : ""}
        ${a.down ? `<button class="icon" data-action="${esc(a.down)}" data-i="${i}" ${i < n - 1 ? "" : "disabled"} title="Move down" aria-label="Move down">▼</button>` : ""}
        <button class="icon chev" data-action="${esc(a.toggle)}" data-i="${i}" title="${open ? "Close" : "Edit"}" aria-label="${open ? "Close" : "Edit"}">${open ? "▾" : "▸"}</button>
      </span></div>`;
  if (!open) return `<div class="item ${cls}" data-key="${esc(key)}">${head}</div>`;
  const foot = `<div class="foot">${footer}<span class="grow"></span>
      ${a.dup ? `<button class="flat" data-action="${esc(a.dup)}" data-i="${i}">Duplicate</button>` : ""}
      ${a.del ? `<button class="flat danger" data-action="${esc(a.del)}" data-i="${i}">Delete</button>` : ""}</div>`;
  return `<div class="item open ${cls}" data-key="${esc(key)}">${head}<div class="body">${body}</div>${foot}</div>`;
}

// Toggle chips over `all`, with `chosen` on.
export function picks(action, i, key, all, chosen, textOf = human) {
  return `<div class="chips">${all.map((x) => `<button class="chip pick${chosen.includes(x) ? " on" : ""}" data-action="${esc(action)}"${attr("data-i", i)}${attr("data-key", key)} data-name="${esc(x)}">${esc(textOf(x))}</button>`).join("")}</div>`;
}

// Entity chips with an input and Add (Enter in the input clicks the [data-add] button).
export function entities({ items, i, add, rm, placeholder = "Pick an entity or type a pattern", list = "entities" }) {
  const chips = items.map((e, j) => `<span class="ent"><code>${esc(e)}</code>
      <button class="icon" data-action="${esc(rm)}" data-i="${i}" data-j="${j}" title="Remove" aria-label="Remove ${esc(e)}">✕</button></span>`).join("");
  return `<div class="chips">${chips || `<span class="muted">None yet</span>`}</div>
    <div class="row"><input list="${esc(list)}" placeholder="${esc(placeholder)}" class="grow">
      <button class="flat" data-add data-action="${esc(add)}" data-i="${i}">Add</button></div>`;
}

export const intro = (textHtml, moreHtml = "") => `<div class="intro"><p>${textHtml}</p>${moreHtml
  ? `<details class="learn"><summary>Learn more</summary><div>${moreHtml}</div></details>` : ""}</div>`;
export const empty = (t) => `<p class="empty">${esc(t)}</p>`;
export const addButton = (action, t, attrs = "") => `<button class="add" data-action="${esc(action)}" ${attrs}>${esc(t)}</button>`;
export const addRow = (control, action, t) => `<div class="row addrow">${control}<button class="add" data-action="${esc(action)}">${esc(t)}</button></div>`;

// A segmented control: options [[value, text]], the current one on.
export function seg(action, current, options, i) {
  return `<div class="seg">${options.map(([v, t]) => `<button class="${v === current ? "on" : ""}" data-action="${esc(action)}"${attr("data-i", i)} data-name="${esc(v)}">${esc(t)}</button>`).join("")}</div>`;
}

export const badge = (t, cls = "", data = "") => `<span class="badge ${cls}" ${data}>${esc(t)}</span>`;
export const chip = (t, cls = "") => `<span class="chip ${cls}">${esc(t)}</span>`;
