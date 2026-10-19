// Pure helpers for the admin panel's Screens, Look and Playground tabs: the
// option form generated from a screen type's schema, plus small list helpers.
// No DOM and no HA here, so node can test them (tests/screens/panel.test.mjs).

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Words that must sit next to an option, because the label alone undersells it.
export const OPTION_NOTES = {
  "map.allow_network": "Privacy: when on, Alfie sends Overpass (a public map service, by default overpass-api.de) "
    + "a position rounded to about 100 m so it can return the streets around it. It is cached, and it stays off unless you turn it on.",
};

// Shapes the Look tab can edit: [param, min, max, step, default] per type.
export const SHAPE_PARAMS = {
  circle: [],
  polygon: [["sides", 3, 12, 1, 4], ["roundness", 0, 1, 0.05, 0]],
  star: [["points", 3, 12, 1, 5], ["inner", 0.1, 0.95, 0.05, 0.5], ["roundness", 0, 1, 0.05, 0]],
  superellipse: [["n", 0.5, 8, 0.1, 4]],
};
export const SHAPE_COMMON = [["rotation", -180, 180, 5, 0], ["stretch_x", 0.3, 2, 0.05, 1], ["stretch_y", 0.3, 2, 0.05, 1]];

// A shape spec with one param set; a param back at its default is dropped.
// stretch_x / stretch_y fold into the spec's `stretch: [sx, sy]`.
export function setShapeParam(spec, param, value) {
  const out = { ...spec };
  if (param === "stretch_x" || param === "stretch_y") {
    const [sx, sy] = spec.stretch || [1, 1];
    const s = param === "stretch_x" ? [value, sy] : [sx, value];
    if (s[0] === 1 && s[1] === 1) delete out.stretch; else out.stretch = s;
    return out;
  }
  const all = [...(SHAPE_PARAMS[spec.type || "circle"] || []), ...SHAPE_COMMON];
  const def = all.find((p) => p[0] === param)?.[4];
  if (value === def) delete out[param]; else out[param] = value;
  return out;
}

export function shapeParam(spec, param) {
  if (param === "stretch_x") return spec.stretch?.[0] ?? 1;
  if (param === "stretch_y") return spec.stretch?.[1] ?? 1;
  const all = [...(SHAPE_PARAMS[spec.type || "circle"] || []), ...SHAPE_COMMON];
  return spec[param] ?? all.find((p) => p[0] === param)?.[4];
}

// A new spec of another type keeps only what still makes sense (rotation, stretch).
export function changeShapeType(spec, type) {
  const out = { type };
  if (spec.rotation) out.rotation = spec.rotation;
  if (spec.stretch) out.stretch = spec.stretch;
  return out;
}

// An id not yet in `list` (items with .id), built from `base`.
export function uniqueId(list, base, except = -1) {
  let id = base, n = 2;
  while (list.some((x, k) => k !== except && x.id === id)) id = `${base}_${n++}`;
  return id;
}

// Rename a screen id everywhere it is referenced (rotation steps, signals, stories).
export function renameScreenRefs(draft, from, to) {
  if (from === to) return;
  for (const r of draft.rotations || []) for (const s of r.steps || []) if (s.screen === from) s.screen = to;
  for (const s of draft.signals || []) if (s.screen === from) s.screen = to;
  for (const st of draft.stories || []) {
    if (st.template?.screen === from) st.template.screen = to;
    for (const s of st.steps || []) if (s.kind === "screen" && s.screen === from) s.screen = to;
  }
}

// Remove a screen's id from rotation steps and signals; returns how many steps went.
export function dropScreenRefs(draft, id) {
  let n = 0;
  for (const r of draft.rotations || []) {
    const before = r.steps.length;
    r.steps = r.steps.filter((s) => s.screen !== id);
    n += before - r.steps.length;
  }
  for (const s of draft.signals || []) if (s.screen === id) s.screen = null;
  for (const st of draft.stories || []) {
    if (st.template?.screen === id) st.template.screen = "";
    st.steps = (st.steps || []).filter((s) => !(s.kind === "screen" && s.screen === id));
  }
  return n;
}

// ---------------------------------------------------------------- stories

// The steps a template stands for (stories.py compile_template, kept equal).
export function compileTemplate(t, defaults) {
  const steps = [];
  if (t.expression) steps.push({ ...defaults.expression, name: t.expression, hold: 1 });
  if (t.animation) steps.push({ ...defaults.animation, name: t.animation });
  if (t.screen) steps.push({ ...defaults.screen, screen: t.screen, seconds: t.seconds, present: t.present, transition: t.transition });
  if (t.closing) steps.push({ ...defaults.animation, name: t.closing });
  return steps;
}

// Rename a story id in the triggers and signal repeats that play it.
export function renameStoryRefs(draft, from, to) {
  if (from === to) return;
  for (const t of draft.triggers || []) if (t.story === from) t.story = to;
  for (const s of draft.signals || []) if (s.repeat?.story === from) s.repeat.story = to;
  const b = draft.behaviour || {};
  for (const k of ["appear_story_bad", "appear_story_ok"]) if (b[k] === from) b[k] = to;
}

// How many triggers play a story (for the delete warning).
export const storyUses = (draft, id) => (draft.triggers || []).filter((t) => t.story === id).length;

// A trigger switched to another kind: the shared fields stay, the kind's own
// fields come fresh from `fresh` (the server's default trigger of that kind).
export function changeTriggerKind(trigger, fresh) {
  const shared = ["id", "name", "enabled", "story", "priority", "busy", "cooldown", "while_asleep", "moods"];
  const out = { ...fresh };
  for (const k of shared) if (k in trigger) out[k] = trigger[k];
  out.kind = fresh.kind;
  return out;
}

// One line on what a trigger listens for, for its collapsed header.
export function triggerSummary(t) {
  const list = (a, none) => (a?.length ? a.join(", ") : none);
  switch (t.kind) {
    case "entity": return `${list(t.entities, "no entity")} ${t.op === "changes" ? "changes" : `${t.op.replace("_", " ")} ${t.value}`}`;
    case "motion": return `motion: ${list(t.entities, "no sensor")}${t.only_if_bad ? " (only while something is wrong)" : ""}`;
    case "mood": return `mood ${t.direction === "any" ? "changes" : `gets ${t.direction}`}${t.from?.length ? ` from ${t.from.join("/")}` : ""}${t.to?.length ? ` to ${t.to.join("/")}` : ""}`;
    case "signal": return `${list(t.signals, "any signal")} ${t.edge === "goes_bad" ? "goes bad" : t.edge === "recovers" ? "recovers" : "goes bad or recovers"}`;
    case "wake": return t.edge === "wakes" ? "Alfie wakes up" : "Alfie falls asleep";
    default: return t.kind;
  }
}

export function moveItem(list, i, j) {
  if (j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
}

// Accept #rgb / #rrggbb as the swatch's value; anything else shows black.
export const swatchValue = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v)
  ? "#" + [...v.slice(1)].map((c) => c + c).join("") : "#000000");

// Entities for a domain-limited datalist: ids starting with one of the domains.
export const inDomains = (id, domain) => !domain?.length || domain.some((d) => id.startsWith(`${d}.`));

// One option's form control, as HTML. `P` is the data-path prefix of the
// screen's options ("screens.3.options"). ctx = {i, type, list(domain) -> datalist id}.
// Value handling lives in the panel's _onInput (kinds optnum, opttext, optent, bool).
export function optionField(opt, value, P, ctx) {
  const path = `${P}.${opt.key}`;
  const req = opt.required ? ` <b class="req" title="Required">*</b>` : "";
  const label = `${esc(opt.label || opt.key)}${req}`;
  const note = OPTION_NOTES[`${ctx.type}.${opt.key}`];
  const noteHtml = note ? `<div class="note">${esc(note)}</div>` : "";
  const dflt = opt.default;
  switch (opt.kind) {
    case "bool":
      return `<div class="wide opt"><label class="check"><input type="checkbox" data-path="${path}" data-kind="bool"
        ${(value ?? dflt) ? "checked" : ""}> <span>${label}</span></label>${noteHtml}</div>`;
    case "number":
      return `<label class="opt">${label}<input type="number" data-path="${path}" data-kind="optnum"
        value="${esc(value ?? "")}" placeholder="${esc(dflt ?? "")}"
        ${opt.min !== undefined ? `min="${opt.min}"` : ""} ${opt.max !== undefined ? `max="${opt.max}"` : ""} step="any">
        ${opt.min !== undefined || opt.max !== undefined ? `<small>${opt.min ?? ""} to ${opt.max ?? ""}${dflt !== undefined ? `, default ${esc(dflt)}` : ""}</small>` : ""}${noteHtml}</label>`;
    case "choice":
      return `<label class="opt">${label}<select data-path="${path}" data-kind="opttext">${(opt.choices || []).map((c) =>
        `<option value="${esc(c)}" ${(value ?? dflt) === c ? "selected" : ""}>${esc(c)}${c === dflt ? " (default)" : ""}</option>`).join("")}</select>${noteHtml}</label>`;
    case "color":
      return `<label class="opt">${label}<span class="row"><input type="color" class="swatch" data-path="${path}" data-kind="opttext"
        value="${swatchValue(value ?? dflt ?? "")}"><input class="grow" data-path="${path}" data-kind="opttext"
        value="${esc(value ?? "")}" placeholder="${esc(dflt || "from the style")}"></span>${noteHtml}</label>`;
    case "entity":
      return `<label class="opt">${label}<input list="${ctx.list(opt.domain)}" data-path="${path}" data-kind="optent"
        value="${esc(value ?? "")}" placeholder="${esc(opt.domain?.length ? `${opt.domain[0]}.…` : "entity id")}">${noteHtml}</label>`;
    case "entities": {
      const vals = Array.isArray(value) ? value : [];
      return `<div class="wide opt"><span class="lbl">${label}</span>
        <div class="chips">${vals.map((e, j) => `<span class="ent"><code>${esc(e)}</code>
          <button class="icon" data-action="rm-opt-entity" data-i="${ctx.i}" data-key="${esc(opt.key)}" data-j="${j}" title="Remove">✕</button></span>`).join("")
          || `<span class="muted">none yet</span>`}</div>
        <div class="row"><input list="${ctx.list(opt.domain)}" class="grow" placeholder="${esc(opt.domain?.length ? `${opt.domain.join(", ")}…` : "Pick an entity")}">
          <button class="flat" data-action="add-opt-entity" data-i="${ctx.i}" data-key="${esc(opt.key)}">Add</button></div>${noteHtml}</div>`;
    }
    default: // text
      return `<label class="opt">${label}<input data-path="${path}" data-kind="opttext" value="${esc(value ?? "")}"
        placeholder="${esc(dflt ?? "")}">${noteHtml}</label>`;
  }
}

// A new screen of a type: the required entity options start empty.
export function newScreen(typeInfo, screens) {
  const base = typeInfo.type;
  return { id: uniqueId(screens, base), type: typeInfo.type, title: typeInfo.title || base, options: {} };
}

// A new rotation step for the first screen.
export const newStep = (screens, seconds = 20) => ({ screen: screens[0]?.id || "", seconds });
