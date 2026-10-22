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

export const { esc, human } = await import(`../alfie-panel-forms.js${new URL(import.meta.url).search}`);

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

// An item's ID, beside its name: made from the name while the item is new (the
// shell's autoId / nameToId), then kept, since automations and other items use it.
// `auto` ([kind, yaml]) adds the automation that uses it, with a Copy button.
export const idField = (path, id, uses, auto = null) => field("ID", text(path, id, { attrs: 'pattern="[a-z0-9_]+" data-rerender' }),
  `Made from the name until you change it. Used by ${uses}.`) + (auto ? `<div class="wide autosnip">
    <span class="muted">In an automation (${esc(auto[0])}):</span> <code>${esc(auto[1].replace(/\n\s*/g, " "))}</code>
    <button class="flat" data-action="copy" data-text="${esc(auto[1])}" title="Copy the YAML"><ha-icon icon="mdi:content-copy"></ha-icon>Copy</button></div>` : "");

// The YAML an automation uses for an item: [kind, yaml] for idField.
export const automation = {
  screen: (id) => ["action", `action: alfie.show_screen\ndata:\n  screen: ${id}`],
  story: (id) => ["action", `action: alfie.play_story\ndata:\n  story: ${id}`],
  rotation: (id) => ["action", `action: alfie.show_rotation\ndata:\n  rotation: ${id}\n  duration: 10800`],
  mode: (id) => ["action", `action: alfie.set_mode\ndata:\n  mode: ${id}`],
  trigger: (id) => ["action", `action: alfie.set_enabled\ndata:\n  item: trigger.${id}\n  enabled: false`],
  signal: (id) => ["trigger", `trigger: event\nevent_type: alfie_signal\nevent_data:\n  signal: ${id}\n  state: bad`],
};
export const wide = (label, control, hint = "") => `<div class="field wide"><span>${esc(label)}</span>${control}${hintOf(hint)}</div>`;

export function check(path, on, label, hint = "") {
  return `<label class="check">${toggle(path, on)}<span><b>${esc(label)}</b>${hintOf(hint)}</span></label>`;
}

export const group = (title, inner) => `<section class="group">${title ? `<h3>${esc(title)}</h3>` : ""}<div class="grid">${inner}</div></section>`;

// A titled card on a settings page; `cards()` lays several side by side when there is room.
export const card = (title, inner, cls = "") => `<section class="card ${cls}">${title ? `<h3>${esc(title)}</h3>` : ""}${inner}</section>`;
export const cards = (inner) => `<div class="cards">${inner}</div>`;

// A fold whose open state survives re-renders (kept in p.open as more:<key>).
export function more(p, key, inner, summary = "More options") {
  return `<details class="more" data-more="${esc(key)}"${p.open.has(`more:${key}`) ? " open" : ""}><summary>${esc(summary)}</summary><div class="grid">${inner}</div></details>`;
}

// An mdi icon, drawn by HA's own <ha-icon>.
export const icon = (name) => `<ha-icon icon="${esc(name)}"></ha-icon>`;
export const iconButton = (action, mdi, title, { i, disabled, cls = "" } = {}) =>
  `<button class="icon ${cls}" data-action="${esc(action)}"${attr("data-i", i)}${disabled ? " disabled" : ""} title="${esc(title)}" aria-label="${esc(title)}">${icon(mdi)}</button>`;

// The one list item every section uses. Closed, it is a row: switch, name and
// summary. Open, it also has its editor (.detail): a header with the name, the
// badge, move, Duplicate and Delete, then the body and the footer. Inside a
// list() the shell moves the open editor beside the list (list + detail);
// anywhere else it opens in place under its row.
export function item({ key, i, n, open, cls = "", enabledPath, enabled, chips = "", name, summary = "", badge = "",
  actions = {}, body = "", footer = "" }) {
  const a = actions;
  const head = `<div class="head${open ? " on" : ""}">
      ${enabledPath ? toggle(enabledPath, enabled, { title: "On" }) : ""}
      <button class="name" data-action="${esc(a.toggle)}" data-i="${i}"><b>${esc(name || "(no name)")}</b>${summary ? `<span class="summary">${summary}</span>` : ""}</button>
      <span class="tags">${chips}${badge}</span>
      <span class="chev">${icon(open ? "mdi:chevron-down" : "mdi:chevron-right")}</span></div>`;
  if (!open) return `<div class="item ${cls}" data-key="${esc(key)}">${head}</div>`;
  const tools = `${a.up ? iconButton(a.up, "mdi:arrow-up", "Move up", { i, disabled: !i }) : ""}
      ${a.down ? iconButton(a.down, "mdi:arrow-down", "Move down", { i, disabled: i >= n - 1 }) : ""}`;
  const foot = footer || a.dup || a.del ? `<div class="foot">
      ${a.del ? `<button class="flat danger" data-action="${esc(a.del)}" data-i="${i}">Delete</button>` : ""}
      <span class="grow"></span>${footer}
      ${a.dup ? `<button class="flat" data-action="${esc(a.dup)}" data-i="${i}">Duplicate</button>` : ""}</div>` : "";
  const detail = `<div class="detail">
      <div class="dhead">
        <button class="icon back" data-action="${esc(a.toggle)}" data-i="${i}" title="Back to the list" aria-label="Back to the list">${icon("mdi:arrow-left")}</button>
        <h2>${esc(name || "(no name)")}</h2>${badge}${tools}</div>
      <div class="body">${body}</div>${foot}</div>`;
  return `<div class="item open ${cls}" data-key="${esc(key)}">${head}${detail}</div>`;
}

// A list page: the items, the Add control on top, and the editor of the open
// one beside them (the shell moves it there after drawing).
export const list = ({ items, empty: none, add = "", what = "item" }) => `<div class="ld">
    <div class="ld-list">${add ? `<div class="ld-add">${add}</div>` : ""}<div class="ld-items">${items || `<p class="empty">${esc(none)}</p>`}</div></div>
    <div class="ld-detail"><p class="ld-none">Pick ${esc(what)} on the left to edit it.</p></div></div>`;

// Toggle chips over `all`, with `chosen` on.
export function picks(action, i, key, all, chosen, textOf = human) {
  return `<div class="chips">${all.map((x) => `<button class="chip pick${chosen.includes(x) ? " on" : ""}" data-action="${esc(action)}"${attr("data-i", i)}${attr("data-key", key)} data-name="${esc(x)}">${esc(textOf(x))}</button>`).join("")}</div>`;
}

// Entity chips with an input and Add (Enter in the input clicks the [data-add] button).
export function entities({ items, i, add, rm, placeholder = "Pick an entity or type a pattern", list = "entities" }) {
  const chips = items.map((e, j) => `<span class="ent"><code>${esc(e)}</code>
      <button class="icon" data-action="${esc(rm)}" data-i="${i}" data-j="${j}" title="Remove" aria-label="Remove ${esc(e)}">${icon("mdi:close")}</button></span>`).join("");
  return `<div class="chips">${chips || `<span class="muted">None yet</span>`}</div>
    <div class="row"><input data-list="${esc(list)}" data-entities placeholder="${esc(placeholder)}" class="grow">
      <button class="flat" data-add data-action="${esc(add)}" data-i="${i}">Add</button></div>`;
}

export const intro = (textHtml, moreHtml = "") => `<div class="intro"><p>${textHtml}</p>${moreHtml
  ? `<details class="learn"><summary>Learn more</summary><div>${moreHtml}</div></details>` : ""}</div>`;
export const empty = (t) => `<p class="empty">${esc(t)}</p>`;
// "+ Add signal" reads as "Add signal" with a plus icon.
const addText = (t) => esc(String(t).replace(/^\+\s*/, ""));
export const addButton = (action, t, attrs = "") => `<button class="primary add" data-action="${esc(action)}" ${attrs}>${icon("mdi:plus")}${addText(t)}</button>`;
export const addRow = (control, action, t) => `<div class="row addrow">${control}<button class="primary add" data-action="${esc(action)}">${icon("mdi:plus")}${addText(t)}</button></div>`;

// A segmented control: options [[value, text]], the current one on.
export function seg(action, current, options, i) {
  return `<div class="seg">${options.map(([v, t]) => `<button class="${v === current ? "on" : ""}" data-action="${esc(action)}"${attr("data-i", i)} data-name="${esc(v)}">${esc(t)}</button>`).join("")}</div>`;
}

export const badge = (t, cls = "", data = "") => `<span class="badge ${cls}" ${data}>${esc(t)}</span>`;
export const chip = (t, cls = "") => `<span class="chip ${cls}">${esc(t)}</span>`;
