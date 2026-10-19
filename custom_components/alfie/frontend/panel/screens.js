// The panel's Screens section: Screens (data pages Alfie presents) and
// Rotations (screens in turn on a card, and what Alfie plays between them).

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);
const Fm = await import(`../alfie-panel-forms.js${V}`);
const R = await import(`./reactions.js${V}`);

export const id = "screens";
export const title = "Screens";
export const subs = [["screens", "Screens"], ["rotations", "Rotations"]];
export const resets = { screens: ["screens"], rotations: ["rotations", "behaviour.appear_story_bad", "behaviour.appear_story_ok"] };

const PREVIEW_DELAY = 300;

export function render(p, sub) {
  return sub === "rotations" ? rotations(p) : screens(p);
}

// ------------------------------------------------------------ screens

function screens(p) {
  const d = p.draft, types = p.choices.screen_types || {};
  const lists = new Map();
  const list = (domain) => {
    const k = (domain || []).join(",");
    if (!lists.has(k)) lists.set(k, `ent-${lists.size}`);
    return lists.get(k);
  };
  const cards = d.screens.map((sc, i) => screen(p, sc, i, d.screens.length, types, list)).join("");
  const datalists = [...lists].map(([k, lid]) => `<datalist id="${lid}">${Object.keys(p.hass.states).sort()
    .filter((e) => Fm.inDomains(e, k ? k.split(",") : null)).map((e) => `<option value="${U.esc(e)}">`).join("")}</datalist>`).join("");
  const tsel = U.select("", Object.keys(types)[0], Object.entries(types).map(([k, t]) => [k, t.title || k]), { attrs: 'id="newtype" aria-label="Screen type"' });
  return `${U.intro("Screens are data pages Alfie presents on a card: a plot, the weather, the sky, a clock.",
      `A card shows a screen when a story asks for it (a signal's screen, through @why and @wrong), when the
      <code>alfie.show_screen</code> action asks, or in a rotation. Each screen type has its own options; empty ones show their default greyed.`)}
    ${cards || U.empty("No screens yet.")}
    ${U.addRow(tsel, "sc-add", "+ Add screen")}
    ${datalists}
    <style>
      .split2 { display: grid; grid-template-columns: 1fr 300px; gap: 20px; align-items: start; }
      .pvbox { position: sticky; top: 120px; padding-top: 12px; }
      .pvnote { min-height: 1em; }
      @media (max-width: 760px) { .split2 { grid-template-columns: 1fr; } .pvbox { position: static; } }
    </style>`;
}

function screen(p, sc, i, n, types, list) {
  const open = p.open.has(`s:${sc.id}`), info = types[sc.type], P = `screens.${i}`;
  const chips = U.chip(info?.title || sc.type);
  if (!open) {
    return U.item({ key: `s:${sc.id}`, i, n, open, chips, name: sc.title || sc.id, summary: "",
      actions: { toggle: "sc-toggle", up: "sc-up", down: "sc-down" } });
  }
  const form = info ? info.options.map((o) => Fm.optionField(o, sc.options?.[o.key], `${P}.options`,
    { i, type: sc.type, list })).join("") : `<p class="error">Unknown screen type "${U.esc(sc.type)}".</p>`;
  const saved = p.saved.screens.find((x) => x.id === sc.id && x.type === sc.type);
  const dataNote = !info?.needs ? "" : saved
    ? `Data comes from the saved options${U.same(saved.options, sc.options) ? "" : "; your edits show after saving"}.`
    : "Save to load data: until then this shows a stand-in.";
  const body = `<div class="split2">
      <div>
        <div class="grid">${U.field("Name", U.text(`${P}.title`, sc.title, { placeholder: info?.title || "" }), "How lists show it.")}</div>
        ${U.group("Options", form)}
        ${U.more(p, `s:${sc.id}`, U.field("ID", U.text(`${P}.id`, sc.id, { attrs: 'pattern="[a-z0-9_]+"' }),
          "Used by signals, stories, rotations and <code>alfie.show_screen</code>."))}
      </div>
      <div class="pvbox"><alfie-card class="spv" data-id="${U.esc(sc.id)}"></alfie-card>
        <small class="pvnote">${U.esc(dataNote)}</small></div>
    </div>`;
  return U.item({ key: `s:${sc.id}`, i, n, open, chips, name: sc.title || sc.id, summary: "",
    actions: { toggle: "sc-toggle", up: "sc-up", down: "sc-down", dup: "sc-dup", del: "sc-del" }, body });
}

async function drawPreview(p, card) {
  const sc = p.draft?.screens.find((x) => x.id === card.dataset.id);
  const note = card.parentElement.querySelector(".pvnote");
  if (!sc || !card.setConfig) return;
  if (!card._configured) { card.setConfig({ card: false, aspect: 1.6, padding: 0.06 }); card._configured = true; }
  const typeInfo = p.choices.screen_types?.[sc.type];
  const seq = card._seq = (card._seq || 0) + 1;
  try {
    await card.renderScreenStill({
      type: sc.type, options: sc.options || {}, typeInfo, data: p.sdata.get(sc.id)?.data ?? null,
      t: Date.now() / 1000, states: p.hass.states, config: p.hass.config, present: "handover", u: 1,
      title: sc.title,
    });
  } catch (e) {
    if (seq === card._seq && note) note.textContent = `Preview failed: ${e?.message || e}`;
  }
  // A saved screen that needs data gets it once; the preview shows the saved data.
  const saved = p.saved.screens.some((x) => x.id === sc.id && x.type === sc.type);
  if (typeInfo?.needs && saved && !p.sdata.has(sc.id)) {
    p.sdata.set(sc.id, {});
    try {
      const r = await p.hass.callWS({ type: "alfie/screen_data", screen: sc.id });
      p.sdata.set(sc.id, r);
      if (r.error && note) note.textContent = `Data: ${r.error}`;
    } catch (e) {
      p.sdata.delete(sc.id);
      if (note) note.textContent = `Data failed: ${e?.message || e}`;
      return;
    }
    if (card.isConnected && card.dataset.id === sc.id) drawPreview(p, card);
  }
}

const drawAll = (p) => p.root.querySelectorAll(".spv").forEach((c) => drawPreview(p, c));

export function mount(p, sub) { if (sub === "screens") drawAll(p); }
export function leave() { clearTimeout(timer); }
let timer;

// ------------------------------------------------------------ rotations

function rotations(p) {
  const d = p.draft, b = d.behaviour;
  const appear = p.storyOptions([["", "Nothing: he just shows"]], [b.appear_story_bad, b.appear_story_ok]);
  return `${U.intro("A rotation shows screens in turn on a card. Point a card at one in its editor (Display: Rotation).",
      `Screens follow screens with Alfie kept away, or in his corner. He comes on for an Alfie step, or between screens
      when the rotation asks, and plays the most relevant story on that card: the one below.`)}
    ${d.rotations.map((r, i) => rotation(p, r, i, d.rotations.length)).join("") || U.empty("No rotations yet.")}
    ${U.addButton("rot-add", "+ Add rotation", d.screens.length ? "" : "disabled")}
    ${d.screens.length ? "" : `<p class="muted">Build a screen first (Screens).</p>`}
    <h3>When Alfie appears in a rotation</h3>
    ${U.group("", `
      ${U.field("While something is wrong", U.select("behaviour.appear_story_bad", b.appear_story_bad, appear))}
      ${U.field("While all's well", U.select("behaviour.appear_story_ok", b.appear_story_ok, appear))}`)}
    <style>.rsteps .row { padding: 4px 0; flex-wrap: nowrap; } .rsteps .n { width: 22px; flex: none; } .rsteps .secs { width: 110px; flex: none; }
      .rsteps select, .alfie-step { width: 260px; flex: none; } .rsteps .tools { margin-left: auto; }</style>`;
}

function rotation(p, r, i, n) {
  const open = p.open.has(`r:${r.id}`), P = `rotations.${i}`, screens = p.draft.screens;
  const names = Object.fromEntries(screens.map((s) => [s.id, s.title || s.id]));
  const summary = r.steps.map((st) => (st.alfie ? "Alfie" : names[st.screen] || st.screen)).join(" → ") || "No steps";
  if (!open) return U.item({ key: `r:${r.id}`, i, n, open, name: r.name || r.id, summary: U.esc(summary), actions: { toggle: "rot-toggle" } });
  const sel = (j, v) => U.select(`${P}.steps.${j}.screen`, v, [...screens.map((s) => [s.id, s.title || s.id]),
    ...(screens.some((s) => s.id === v) ? [] : [[v, `${v || "(none)"} (missing)`]])]);
  const steps = r.steps.map((st, j) => `<div class="row">
      <span class="muted n">${j + 1}.</span>${st.alfie ? `<span class="alfie-step"><b>Alfie</b> <span class="muted">plays the most relevant story</span></span>` : sel(j, st.screen)}
      <span class="secs">${U.num(`${P}.steps.${j}.seconds`, st.seconds, { min: 3, max: 3600, step: 1, unit: "s" })}</span>
      <span class="tools">
        <button class="icon" data-action="rot-step-up" data-i="${i}" data-j="${j}" ${j ? "" : "disabled"} title="Move up">▲</button>
        <button class="icon" data-action="rot-step-down" data-i="${i}" data-j="${j}" ${j < r.steps.length - 1 ? "" : "disabled"} title="Move down">▼</button>
        <button class="icon" data-action="rot-step-rm" data-i="${i}" data-j="${j}" title="Remove">✕</button></span></div>`).join("");
  const body = `
    <div class="grid">${U.field("Name", U.text(`${P}.name`, r.name, { placeholder: "Living room" }))}
      ${U.field("Transition", U.select(`${P}.transition`, r.transition, [...U_TRANS()]), "How Alfie and a screen swap places.")}</div>
    <h4>Steps</h4>
    <div class="rsteps">${steps || U.empty("No steps yet.")}</div>
    ${r.steps.length && r.steps.every((st) => st.alfie) ? `<p class="muted">Only Alfie steps: add a screen for the rotation to show.</p>` : ""}
    <div class="row"><button class="flat" data-action="rot-step-add" data-i="${i}" ${screens.length ? "" : "disabled"}>+ Add step</button>
      <button class="flat" data-action="rot-alfie-add" data-i="${i}">+ Add Alfie step</button></div>
    ${U.more(p, `r:${r.id}`, `
      ${U.field("ID", U.text(`${P}.id`, r.id, { attrs: 'pattern="[a-z0-9_]+"' }), "What a card's rotation option names.")}
      ${U.field("Alfie between screens", U.num(`${P}.face_seconds`, r.face_seconds, { min: 0, max: 3600, step: 1, unit: "s" }),
        "0 (usual): screens follow screens. Add an Alfie step to have him come on.")}`)}`;
  return U.item({ key: `r:${r.id}`, i, n, open, name: r.name || r.id, summary: U.esc(summary),
    actions: { toggle: "rot-toggle", del: "rot-del" }, body });
}

// A rotation's transition has no "card's default": it is the card's default.
const U_TRANS = () => R.transitionOptions("").filter(([v]) => v !== "").map(([v, t]) => [v, v === "fade" ? "Fade (usual)" : t]);

// ------------------------------------------------------------ editing

export function beforeInput(p, path, v) {
  let m = /^screens\.(\d+)\.id$/.exec(path);
  if (m) {
    const old = p.draft.screens[Number(m[1])].id;
    Fm.renameScreenRefs(p.draft, old, v);
    p.renameOpen("s", old, v);
    p.root.querySelector(`.spv[data-id="${CSS.escape(old)}"]`)?.setAttribute("data-id", v);
    return;
  }
  m = /^rotations\.(\d+)\.id$/.exec(path);
  if (m) {
    const old = p.draft.rotations[Number(m[1])].id;
    Fm.renameModeRefs(p.draft, "rotation", old, v);
    p.renameOpen("r", old, v);
  }
}

export function afterInput(p, path, v, el) {
  if (path.startsWith("screens.")) {
    clearTimeout(timer);
    timer = setTimeout(() => drawAll(p), PREVIEW_DELAY);
  }
  if (/^screens\.\d+\.title$/.test(path) || /^rotations\.\d+\.name$/.test(path)) {
    const head = el.closest(".item")?.querySelector(".name");
    if (head) head.textContent = v || "(no name)";
  }
}

export function click(p, a, el) {
  const d = p.draft, screens = d.screens, rots = d.rotations;
  const i = Number(el.dataset.i), j = Number(el.dataset.j), key = el.dataset.key;
  switch (a) {
    case "sc-toggle": p.flip(`s:${screens[i].id}`); return true;
    case "sc-add": {
      const info = p.choices.screen_types?.[p.root.querySelector("#newtype")?.value];
      if (!info) return true;
      const sc = Fm.newScreen(info, screens);
      screens.push(sc);
      p.open.add(`s:${sc.id}`);
      p.edited(true);
      return true;
    }
    case "sc-dup": {
      const sc = U.clone(screens[i]);
      sc.id = Fm.uniqueId(screens, `${sc.id}_copy`);
      sc.title = sc.title ? `${sc.title} (copy)` : sc.title;
      screens.splice(i + 1, 0, sc);
      p.open.add(`s:${sc.id}`);
      p.edited(true);
      return true;
    }
    case "sc-del": {
      const sc = screens[i];
      const used = rots.reduce((k, r) => k + r.steps.filter((s) => s.screen === sc.id).length, 0);
      if (!confirm(`Delete the screen "${sc.title || sc.id}"?${used ? ` It is also taken out of ${used} rotation step${used > 1 ? "s" : ""}.` : ""}`)) return true;
      Fm.dropScreenRefs(d, sc.id);
      screens.splice(i, 1);
      p.edited(true);
      return true;
    }
    case "sc-up": case "sc-down":
      if (Fm.moveItem(screens, i, a === "sc-up" ? i - 1 : i + 1)) p.edited(true);
      return true;
    case "add-opt-entity": {
      const v = el.parentElement.querySelector("input").value.trim();
      if (!v) return true;
      const o = (screens[i].options ??= {});
      if (!Array.isArray(o[key])) o[key] = [];
      if (!o[key].includes(v)) o[key].push(v);
      p.edited(true);
      return true;
    }
    case "rm-opt-entity": screens[i].options[key].splice(j, 1); p.edited(true); return true;
    case "rot-toggle": p.flip(`r:${rots[i].id}`); return true;
    case "rot-add": {
      const rid = Fm.uniqueId(rots, "rotation");
      rots.push({ id: rid, name: "", transition: "random", face_seconds: 0, steps: screens.length ? [Fm.newStep(screens)] : [] });
      p.open.add(`r:${rid}`);
      p.edited(true);
      return true;
    }
    case "rot-del":
      if (!confirm(`Delete the rotation "${rots[i].name || rots[i].id}"?`)) return true;
      rots.splice(i, 1);
      p.edited(true);
      return true;
    case "rot-step-add": if (screens.length) { rots[i].steps.push(Fm.newStep(screens)); p.edited(true); } return true;
    case "rot-alfie-add": rots[i].steps.push({ alfie: true, seconds: 15 }); p.edited(true); return true;
    case "rot-step-rm": rots[i].steps.splice(j, 1); p.edited(true); return true;
    case "rot-step-up": case "rot-step-down":
      if (Fm.moveItem(rots[i].steps, j, a === "rot-step-up" ? j - 1 : j + 1)) p.edited(true);
      return true;
  }
  return false;
}
