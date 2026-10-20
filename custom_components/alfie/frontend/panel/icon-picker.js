// Icon suggestions as you type, like HA's own icon picker, for every place the
// panel takes an icon name. Not HA's <ha-icon-picker>: HA-internal elements
// change between frontend versions and are not loaded in a custom panel. The
// list is the one HA's picker reads (/static/mdi/iconList.json, names and
// keywords), fetched once on the first focus; previews are <ha-icon>.
//
// An input opts in with data-icons:
//   "one"   the whole value is an icon name (a story's icon, an icon step)
//   "word"  free text where a word starting mdi: is drawn as an icon (screen
//           text, plot markers): only that word is suggested for and replaced
// and may add data-presets="ring,diamond,…": an icon option's built-in
// choices, listed first (all of them when the field opens), like a dropdown.
// Picking writes the value and fires input and change, so the panel stores it
// exactly as if it had been typed. Anything typed by hand still goes.

const { esc, presetIcon } = await import(`../alfie-panel-forms.js${new URL(import.meta.url).search}`);

const LIST_URL = "/static/mdi/iconList.json";
const SHOWN = 30;
const SEP = /[\s,|]/;

// Icon names for `query` (with or without mdi:), best first: names starting
// with it (shortest first), then names containing it, then keyword matches.
// Another prefix (hass:, a custom set) gets none: the list is mdi only.
export function matchIcons(list, query, n = SHOWN) {
  let q = String(query ?? "").trim().toLowerCase();
  if (q.startsWith("mdi:")) q = q.slice(4);
  else if (q.includes(":")) return [];
  if (!q) return [];
  const name = q.replace(/\s+/g, "-");
  const starts = [], within = [], keyed = [];
  for (const ic of list) {
    const i = ic.name.indexOf(name);
    if (i === 0) starts.push(ic.name);
    else if (i > 0) within.push(ic.name);
    else if (ic.keywords?.some((k) => k.includes(q))) keyed.push(ic.name);
  }
  starts.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  return [...starts, ...within, ...keyed].slice(0, n).map((x) => `mdi:${x}`);
}

// What the picker offers. Without presets: the icon matches. With them: every
// preset while the field just opened empty or holding one (not `typed`), else
// the presets starting with the query, then the icon matches.
export function suggest(list, query, presets = [], typed = true) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!presets.length) return matchIcons(list, q);
  if (!typed && (!q || presets.includes(q))) return [...presets];
  return [...presets.filter((p) => q && p.startsWith(q)), ...matchIcons(list, q)];
}

// The word around `caret` in free text: words end at spaces, commas and |.
export function wordAt(text, caret) {
  let start = caret, end = caret;
  while (start > 0 && !SEP.test(text[start - 1])) start--;
  while (end < text.length && !SEP.test(text[end])) end++;
  return { start, end, word: text.slice(start, end) };
}

// `text` with the word at `caret` replaced by `name`; the caret after it.
export function replaceWord(text, caret, name) {
  const { start, end } = wordAt(text, caret);
  return { text: text.slice(0, start) + name + text.slice(end), caret: start + name.length };
}

let icons = null;   // the list, or the promise of it
const load = () => (icons ??= fetch(LIST_URL).then((r) => (r.ok ? r.json() : []))
  .catch(() => []).then((l) => (icons = Array.isArray(l) ? l : [])));

// Suggestions for the icon inputs under `body`, drawn in shadow root `root`.
export function attach(root, body) {
  const box = document.createElement("div");
  box.className = "iconpick";
  box.setAttribute("role", "listbox");
  box.hidden = true;
  const style = document.createElement("style");
  style.textContent = `
    .iconpick { position: fixed; z-index: 10; max-height: 288px; overflow-y: auto; min-width: 260px;
      background: var(--card-background-color, #fff); color: var(--primary-text-color);
      border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.25); padding: 4px 0; }
    .iconpick .opt { display: flex; align-items: center; gap: 12px; padding: 6px 12px; cursor: pointer; font-size: 14px; }
    .iconpick .opt ha-icon { --mdc-icon-size: 24px; flex: none; }
    .iconpick .opt.on, .iconpick .opt:hover { background: rgba(127,127,127,.15); }`;
  root.append(style, box);

  let input = null, names = [], active = -1, quiet = false;

  const close = () => { box.hidden = true; names = []; active = -1; };

  // What is being typed in the current input, or null when nothing should be suggested.
  const query = () => {
    if (input.dataset.icons !== "word") return input.value;
    const { word } = wordAt(input.value, input.selectionStart ?? input.value.length);
    return /^mdi:/i.test(word) ? word : null;
  };

  const place = () => {
    const r = input.getBoundingClientRect();
    const below = innerHeight - r.bottom, up = below < 200 && r.top > below;
    box.style.left = `${Math.max(4, Math.min(r.left, innerWidth - Math.max(260, r.width) - 4))}px`;
    box.style.width = `${Math.max(260, r.width)}px`;
    box.style.top = up ? "" : `${r.bottom + 2}px`;
    box.style.bottom = up ? `${innerHeight - r.top + 2}px` : "";
  };

  const show = () => {
    box.innerHTML = names.map((n, i) => `<div class="opt${i === active ? " on" : ""}" role="option" data-i="${i}">
      <ha-icon icon="${esc(presetIcon(n))}"></ha-icon><span>${esc(n)}</span></div>`).join("");
    box.hidden = false;
    place();
    box.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  };

  const presets = () => (input.dataset.presets ? input.dataset.presets.split(",") : []);

  // `typed`: the query came from typing, not from opening the field.
  const update = async (typed = false) => {
    if (!input?.isConnected) return close();
    const q = query();
    if (q === null || (!q.trim() && !presets().length)) return close();
    const list = Array.isArray(icons) ? icons : !typed && presets().length ? [] : await load();
    if (!input?.isConnected || query() !== q) return;   // typed on, or gone, while loading
    names = suggest(list, q, presets(), typed);
    active = -1;
    if (!names.length || (names.length === 1 && names[0] === q.trim())) return close();
    show();
  };

  const pick = (name) => {
    if (input.dataset.icons === "word") {
      const r = replaceWord(input.value, input.selectionStart ?? input.value.length, name);
      input.value = r.text;
      input.setSelectionRange(r.caret, r.caret);
    } else input.value = name;
    close();
    quiet = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    quiet = false;
  };

  body.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("input[data-icons]");
    if (!el) return;
    input = el;
    load();
    update();
  });
  body.addEventListener("focusout", (e) => { if (e.target === input) close(); });
  body.addEventListener("input", (e) => { if (e.target === input && !quiet) update(true); });
  body.addEventListener("click", (e) => { if (e.target === input && (input.dataset.icons === "word" || input.dataset.presets) && box.hidden) update(); });
  // Capture, so Enter picks here before the panel's own Enter (which presses Add).
  body.addEventListener("keydown", (e) => {
    if (e.target !== input || box.hidden) return;
    const n = names.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      active = e.key === "ArrowDown" ? (active + 1) % n : active <= 0 ? n - 1 : active - 1;
      show();
    } else if ((e.key === "Enter" || e.key === "Tab") && active >= 0) pick(names[active]);
    else if (e.key === "Escape") close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // Keep the input focused through a click on the list.
  box.addEventListener("mousedown", (e) => e.preventDefault());
  box.addEventListener("click", (e) => {
    const opt = e.target.closest(".opt");
    if (opt && input) pick(names[Number(opt.dataset.i)]);
  });
  // The page scrolls under a fixed list: follow the input, or close if it went.
  root.addEventListener("scroll", () => { if (!box.hidden) (input?.isConnected ? place() : close()); }, true);
  addEventListener("resize", () => { if (!box.hidden) place(); });
}
