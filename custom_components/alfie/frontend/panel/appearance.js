// The panel's Appearance section: Look (how Alfie is drawn on every card),
// Personality (how all his motion feels) and Playground (try him out). They
// all play on the shell's dock face (p.face); Look and Personality add their
// extras under it with dock().

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);
const Fm = await import(`../alfie-panel-forms.js${V}`);
const Face = await import(`../alfie-face.js${V}`);
const SvgP = await import(`../alfie-svg.js${V}`);
const IC = await import(`../alfie-icons.js${V}`);
const PE = await import(`./shape-editor.js${V}`);
const Scr = await import(`./screens.js${V}`);

export const id = "appearance";
export const title = "Appearance";
export const subs = [["look", "Look"], ["expressions", "Expressions"], ["personality", "Personality"], ["playground", "Playground"]];
export const resets = { look: ["look"], expressions: ["expressions"], personality: ["personality"] };

// The shipped expressions (and animations), which the draft's own replace by id.
const FACE = await fetch(new URL(`../alfie-face.json${V}`, import.meta.url)).then((r) => r.json());

const L = U.LEVEL_TEXT;
const CARD_STYLES = ["neon", "flat", "crt", "theme"];
const STYLE_TEXT = { neon: "Neon", flat: "Flat", crt: "CRT", theme: "Theme colours" };
const LOOK_COLORS = [
  ["ring_color", "Ring colour"], ["eye_color", "Eye colour"], ["background", "Background"],
  ["text_color", "Screen text colour"], ["accent_color", "Screen accent colour"],
];
const LOOK_EXPRESSIONS = ["happy", "sad", "angry", "surprised"];
// Shared with the card editor and house modes (design.md "Words").
export const SLIDER_TEXT = {
  exaggeration: ["Exaggeration", "How far expressions and animations go."],
  speed: ["Speed", "How quickly he moves and changes expression."],
  bounce: ["Bounce", "How much he overshoots and wobbles into place."],
  fidget_rate: ["Fidgeting", "How often he fidgets when idle. 0: never. Takes effect on save."],
  energy_bias: ["Energy", "Added to every mood's energy: perkier or flatter."],
  blink_rate: ["Blinking", "How often he blinks."],
};
const PREVIEW_ANIMS = ["glance_left", "nod", "look_around", "laugh", "startle", "sigh"];
const SHAPE_TEXT = { circle: "Circle", polygon: "Polygon", star: "Star", superellipse: "Superellipse", path: "Drawn (move the corners)" };
const PARAM_TEXT = { sides: "Sides", roundness: "Roundness", points: "Points", inner: "Inner size", n: "Squareness",
  rotation: "Rotation", stretch_x: "Stretch across", stretch_y: "Stretch up" };

const pgState = (p) => (p.pg ??= { everywhere: false, level: null, expr: "", energy: 0.8 });

export function render(p, sub) {
  if (sub === "personality") return personality(p);
  if (sub === "playground") return playground(p);
  if (sub === "expressions") return expressions(p);
  return look(p);
}

// ------------------------------------------------------------ look

function look(p) {
  const Lk = p.draft.look;
  const colors = LOOK_COLORS.map(([k, t]) => U.field(t, `<span class="row colour">
      <input type="color" class="swatch" data-path="look.${k}" data-kind="opttext" value="${Fm.swatchValue(Lk[k])}" aria-label="${t}">
      <input data-path="look.${k}" data-kind="opttext" value="${U.esc(Lk[k])}" placeholder="From the style"></span>`)).join("");
  const range = (path, v, min, max, step, text) => `<label class="slider"><span>${text}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" data-path="${path}" data-kind="number" value="${v}">
      <output>${p.fmt(v)}</output></label>`;
  const apart = eyesApart(Lk);
  const parts = [["head", "Ring"], ...(apart ? [["left_eye", "Left eye"], ["right_eye", "Right eye"]] : [["eye", "Eyes"]])];
  const shapes = parts.map(([part, t]) => shapeEditor(p, part, t, partSpec(Lk, part))).join("");
  const extra = `<label class="check">${U.toggle(null, apart, { action: "eyes-apart" })}<span><b>Shape the left and right eyes apart</b>
      <small>Off: the right eye is the left one in a mirror.</small></span></label>`;
  return `${U.intro("How Alfie is drawn on every card. A card's own options (in its editor) still win over these, one by one.")}
    ${U.card("Style and colour", `<div class="grid">${U.field("Style", U.select("look.style", Lk.style, (p.choices.styles || CARD_STYLES).map((s) => [s, STYLE_TEXT[s] || U.human(s)])),
        "Sets the default colours and glow.")}${colors}</div>
      <small>Empty: the style's own. A colour is <code>#hex</code>, a CSS colour or <code>var(--primary-color)</code>.</small>`)}
    ${U.cards(`${U.card("Lines and size", `<div class="sliders">${range("look.line_width", Lk.line_width, 0.005, 0.1, 0.005, "Ring and eye line width")}
        ${range("look.screen_line_width", Lk.screen_line_width, 0.005, 0.06, 0.005, "Screen line width")}
        ${range("look.padding", Lk.padding, 0, 0.3, 0.01, "Padding around the ring")}
        ${range("look.aspect", Lk.aspect ?? 1, 0.5, 3, 0.05, "Card aspect (width over height)")}</div>`)}
      ${U.card("Glow and fill", `<label class="check">${U.toggle(null, Lk.glow == null, { action: "look-glow" })}<span><b>Glow from the style</b></span></label>
        ${Lk.glow == null ? "" : `<div class="sliders">${range("look.glow", Lk.glow, 0, 2, 0.05, "Glow")}</div>`}
        ${U.check("look.eye_fill", Lk.eye_fill, "Fill the eyes")}`)}`)}
    <h3 class="cards-title">Shapes</h3>${extra}${U.cards(shapes)}
    <style>${PE.STYLE} .pathfrom { gap: 6px; flex-wrap: wrap; } .pathfrom select, .pathfrom input { flex: 1 1 120px; min-width: 0; }</style>`;
}

// Under the dock face: Look's four stills and expression picks, and
// Personality's animations (they play on this page only).
export function dock(p, sub) {
  if (sub === "personality") {
    return `<div class="chips">${PREVIEW_ANIMS.map((a) => `<button class="chip pick" data-action="play" data-name="${a}">${U.human(a)}</button>`).join("")}</div>`;
  }
  if (sub !== "look") return "";
  const pick = pgState(p).lookExpr;
  return `<div class="minis">${LOOK_EXPRESSIONS.map((e) => `<figure><alfie-card class="lookmini" data-expr="${e}"></alfie-card><figcaption>${U.human(e)}</figcaption></figure>`).join("")}</div>
    <div class="chips">${LOOK_EXPRESSIONS.map((e) => `<button class="chip pick ${pick === e ? "on" : ""}" data-action="pg" data-pg-kind="look-expr" data-name="${e}">${U.human(e)}</button>`).join("")}
      <button class="chip pick ${pick ? "" : "on"}" data-action="pg" data-pg-kind="look-expr" data-name="">Follow mood</button></div>
    <style>
      .minis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0; }
      .minis figure { margin: 0; text-align: center; font-size: 12px; color: var(--muted); }
    </style>`;
}

// Separate eyes: a left or right eye spec of its own (the right is then not mirrored).
const eyesApart = (Lk) => !!(Lk.shapes?.left_eye || Lk.shapes?.right_eye);
const partSpec = (Lk, part) => Lk.shapes?.[part] || (part.endsWith("_eye") ? (part === "right_eye" && Lk.shapes?.eye
  ? Fm.mirrorSpec(Lk.shapes.eye) : Lk.shapes?.eye) : null) || { type: "circle" };

function shapeEditor(p, part, t, spec) {
  spec ||= { type: "circle" };
  const type = spec.type || "circle";
  const types = Object.keys(Fm.SHAPE_PARAMS);
  const params = [...Fm.SHAPE_PARAMS[type], ...Fm.SHAPE_COMMON];
  const P = Scr.pics(p);
  const picOpts = (P.list || []).map((m) => `<option value="${U.esc(m.id)}">${U.esc(m.name)}</option>`).join("");
  const from = `<div class="row pathfrom"><select class="path-pic" data-part="${part}" aria-label="Picture">
      <option value="">${P.list ? (P.list.length ? "A picture…" : "No pictures yet") : "Pictures…"}</option>${picOpts}</select>
      <input class="path-icon" data-part="${part}" placeholder="or an icon: mdi:heart" data-icons="one" autocomplete="off">
      <button class="flat" data-action="path-from" data-part="${part}">Use its outline</button></div>`;
  return `<section class="card shape"><h3>${U.esc(t)}</h3>${U.field("Shape", `<select data-shape="${part}" data-param="type">${types.map((x) =>
      `<option value="${x}" ${x === type ? "selected" : ""}>${SHAPE_TEXT[x]}</option>`).join("")}</select>`)}
    ${type === "path" ? PE.html(part) : ""}
    ${U.more(p, `from:${part}`, from, "From a picture or icon")}
    ${params.map(([k, min, max, step]) => `<label class="slider"><span>${PARAM_TEXT[k] || U.human(k)}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" data-shape="${part}" data-param="${k}" value="${Fm.shapeParam(spec, k)}">
      <output>${p.fmt(Fm.shapeParam(spec, k))}</output></label>`).join("")}</section>`;
}

// ------------------------------------------------------------ expressions

// Lids are lines y = height + tilt·u in eye radii, u toward the nose
// (alfie-face.json): [upper height, upper tilt, lower height, lower tilt].
const LIDS = [["Upper lid", -1, 1.2, "1: open; lower closes him from above."], ["Upper lid tilt", -1, 1, "Up toward the nose: worried; down: cross."],
  ["Lower lid", -1.2, 1, "-1: open; higher pushes up (a smile)."], ["Lower lid tilt", -1, 1, ""]];
const EX_SHAPES = ["", "circle", "polygon", "star", "superellipse", "path"];
const EX_SHAPE_TEXT = { "": "His usual eyes", ...SHAPE_TEXT, path: "Drawn (from an icon)" };

// Every expression: the shipped ones (changed or not), then his own.
function exprList(p) {
  const own = p.draft.expressions || [];
  return [
    ...Object.keys(FACE.expressions).map((id) => {
      const o = own.find((e) => e.id === id);
      return { id, name: o?.name || U.human(id), builtin: true, changed: !!o, def: o || FACE.expressions[id] };
    }),
    ...own.filter((e) => !(e.id in FACE.expressions)).map((e) => ({ id: e.id, name: e.name || e.id, builtin: false, def: e })),
  ];
}

// The draft entry for `id`, made from the shipped one on its first change.
function ownExpr(p, id) {
  const own = (p.draft.expressions ??= []);
  let e = own.find((x) => x.id === id);
  if (!e && FACE.expressions[id]) {
    e = { id, name: U.human(id), ...U.clone(FACE.expressions[id]) };
    own.push(e);
  }
  return e;
}

const exOpen = (p) => exprList(p).find((x) => p.open.has(`x:${x.id}`)) || null;

function expressions(p) {
  const all = exprList(p);
  const items = all.map((x, i) => exprItem(p, x, i, all.length)).join("");
  return `${U.intro("His faces: the twelve he ships with, which you can change, and new ones of your own.",
      `Every expression is how his lids sit, how big his eyes are and where they look. Your own can be used anywhere an
      expression is picked: mood levels, stories, house modes, voice. The open one shows on the live preview.`)}
    ${U.list({ items, add: U.addButton("ex-add", "+ New expression"), what: "an expression" })}
    <style>.exmini { display: block; width: 160px; height: 160px; margin: 0 auto 8px; }
      .exsame { margin: 6px 0; }</style>`;
}

function exprItem(p, x, i, n) {
  const key = `x:${x.id}`, open = p.open.has(key);
  const chips = U.chip(x.builtin ? (x.changed ? "Changed" : "Built in") : "Yours");
  const summary = U.esc(x.id);
  if (!open) return U.item({ key, i, n, open, chips, name: x.name, summary, actions: { toggle: "ex-toggle" } });
  const d = x.def, same = !p.exApart?.has(x.id) && JSON.stringify(d.left) === JSON.stringify(d.right || d.left);
  const slider = (k, v, min, max, text, hint = "") => `<label class="slider"><span>${U.esc(text)}</span>
      <input type="range" min="${min}" max="${max}" step="0.01" data-ex="${U.esc(x.id)}" data-k="${k}" value="${v}">
      <output>${p.fmt(v)}</output>${hint ? `<small>${U.esc(hint)}</small>` : ""}</label>`;
  const eye = (side, title) => U.card(title, `<div class="sliders">${LIDS.map(([t, lo, hi, h], j) =>
    slider(`${side}.${j}`, (d[side] || d.left)[j], lo, hi, t, side === "left" ? h : "")).join("")}</div>`);
  const own = (p.draft.expressions || []).findIndex((e) => e.id === x.id);
  const names = x.builtin ? `<p class="muted">Built in. A change here replaces it everywhere he uses it.</p>`
    : `<div class="grid">${U.field("Name", U.text(`expressions.${own}.name`, d.name, { placeholder: "Smug" }))}
        ${U.idField(`expressions.${own}.id`, x.id, "mood levels, stories, house modes and <code>alfie.set_expression</code>")}</div>`;
  const shape = d.shapes?.eye || null, st = shape?.type || "";
  const shapeParams = shape && st !== "path" ? [...Fm.SHAPE_PARAMS[st], ...Fm.SHAPE_COMMON] : [];
  const shapes = `${U.field("Eyes", `<select data-ex="${U.esc(x.id)}" data-k="shape" data-rerender>${EX_SHAPES.map((t) =>
      `<option value="${t}" ${t === st ? "selected" : ""}>${U.esc(EX_SHAPE_TEXT[t])}</option>`).join("")}</select>`, "Heart eyes for a loving face, say. He morphs into them.")}
    ${st === "path" ? `<div class="row pathfrom"><input class="ex-icon" placeholder="An icon: mdi:heart" data-icons="one" autocomplete="off">
      <button class="flat" data-action="ex-shape-icon" data-name="${U.esc(x.id)}">Use its outline</button></div>` : ""}
    <div class="sliders">${shapeParams.map(([k, lo, hi, step]) => `<label class="slider"><span>${PARAM_TEXT[k] || U.human(k)}</span>
      <input type="range" min="${lo}" max="${hi}" step="${step}" data-ex="${U.esc(x.id)}" data-k="shape.${k}" value="${Fm.shapeParam(shape, k)}">
      <output>${p.fmt(Fm.shapeParam(shape, k))}</output></label>`).join("")}</div>`;
  const body = `<alfie-card class="exmini" data-expr="${U.esc(x.id)}"></alfie-card>
    ${names}
    <label class="check exsame">${U.toggle(null, same, { action: "ex-same" })}<span><b>Same for both eyes</b>
      <small>Mirrored, as a face usually is.</small></span></label>
    ${U.cards(same ? eye("left", "Eyes") : eye("left", "Left eye") + eye("right", "Right eye"))}
    ${U.cards(U.card("Size and gaze", `<div class="sliders">${slider("size", d.size ?? 1, 0.3, 2, "Eye size")}
      ${slider("look.0", d.look?.[0] ?? 0, -0.4, 0.4, "Look across")}${slider("look.1", d.look?.[1] ?? 0, -0.4, 0.4, "Look up")}</div>`)
      + U.card("Eye shape", shapes))}`;
  const footer = x.changed ? `<button class="flat" data-action="ex-reset" data-name="${U.esc(x.id)}">Back to built in</button>` : "";
  return U.item({ key, i, n, open, chips, name: x.name, summary, body, footer,
    actions: { toggle: "ex-toggle", dup: "ex-dup", ...(x.builtin ? {} : { del: "ex-del" }) } });
}

// The open expression holds the dock face; its still redraws from the draft.
function showExpr(p) {
  const x = exOpen(p);
  p.faceHold = !!x;
  p.face?.previewExpression?.(x ? x.id : null);
  // After the shell has laid the draft's expressions on the cards (syncFace).
  setTimeout(() => p.root.querySelectorAll(".exmini").forEach((m) => {
    m.setConfig?.({ card: false, padding: 0.06 });
    m.previewLook?.(U.clone(p.draft.look));
    m.renderStill?.({ expression: m.dataset.expr, energy: 0.9 });
  }), 0);
}

function exprInput(p, el, ev) {
  const id = el.dataset.ex, k = el.dataset.k;
  // A built-in's first change makes its entry: redraw (chip, Back to built in) once let go.
  if (!(p.draft.expressions || []).some((x) => x.id === id)) p.exNew = true;
  const e = ownExpr(p, id);
  if (!e) return;
  if (k === "shape") {
    if (ev.type !== "change") return;
    const t = el.value;
    if (!t) delete e.shapes;
    else e.shapes = { eye: t === "path" ? { type: "path", points: [[0, 1], [-1, -1], [1, -1]] } : { type: t } };
    p.edited(true);
    return;
  }
  const v = Number(el.value);
  if (k.startsWith("shape.")) {
    e.shapes = { eye: Fm.setShapeParam(e.shapes?.eye || { type: "circle" }, k.slice(6), v) };
  } else if (k === "size") e.size = v;
  else {
    const [arr, j] = k.split(".");
    if (arr === "look") (e.look ??= [0, 0])[Number(j)] = v;
    else {
      const same = JSON.stringify(e.left) === JSON.stringify(e.right);
      e[arr] = [...(e[arr] || e.left)];
      e[arr][Number(j)] = v;
      if (arr === "left" && same && !el.closest(".detail")?.querySelector('[data-k^="right."]')) e.right = [...e.left];
    }
  }
  const out = el.parentElement.querySelector("output");
  if (out) out.textContent = p.fmt(v);
  const redraw = ev.type === "change" && p.exNew;
  if (redraw) p.exNew = false;
  p.edited(redraw);
  showExpr(p);
}

function exprClick(p, a, el) {
  const own = (p.draft.expressions ??= []);
  const all = exprList(p);
  const x = all[Number(el.dataset.i)];
  switch (a) {
    case "ex-toggle": p.flip(`x:${x.id}`); return true;
    case "ex-add": case "ex-dup": {
      const src = a === "ex-dup" ? x.def : FACE.expressions.neutral;
      const name = a === "ex-dup" ? `${x.name} (copy)` : "New expression";
      const id = U.slugId([...all, ...own], name, "expression");
      const { id: _i, name: _n, ...pose } = U.clone(src);
      own.push({ id, name, ...pose });
      p.autoId("x", id);
      for (const k of [...p.open]) if (k.startsWith("x:")) p.open.delete(k);
      p.open.add(`x:${id}`);
      p.edited(true);
      return true;
    }
    case "ex-del": {
      if (!confirm(`Delete the expression "${x.name}"? Anything that uses it will need another.`)) return true;
      p.draft.expressions = own.filter((e) => e.id !== x.id);
      p.edited(true);
      return true;
    }
    case "ex-reset":
      p.draft.expressions = own.filter((e) => e.id !== el.dataset.name);
      p.edited(true);
      return true;
    case "ex-same": {
      // Apart starts with the right eye as the left; together copies the left over.
      const id = exOpen(p)?.id, e = ownExpr(p, id);
      p.exApart ??= new Set();
      if (el.checked) { p.exApart.delete(id); if (e) e.right = [...e.left]; } else p.exApart.add(id);
      p.edited(true);
      return true;
    }
    case "ex-shape-icon": {
      const id = el.dataset.name, name = el.parentElement.querySelector(".ex-icon")?.value.trim();
      if (!name) return true;
      IC.iconPath(name).then((r) => {
        const pts = r && SvgP.outlinePoints(IC.flatten(r.path), 64);
        if (!pts) { p.flash(`No outline in ${name}`); return; }
        ownExpr(p, id).shapes = { eye: { type: "path", points: pts } };
        p.edited(true);
      });
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------------ personality

function personality(p) {
  const pr = p.draft.personality, c = p.choices;
  const presets = Object.keys(c.personalities).map((k) =>
    `<button class="preset ${pr.preset === k ? "on" : ""}" data-action="preset" data-name="${k}">${U.esc(U.human(k))}</button>`).join("");
  const sliders = Object.entries(c.sliders).map(([k, s]) => `<label class="slider">
      <span><b>${SLIDER_TEXT[k][0]}</b><small>${SLIDER_TEXT[k][1]}</small></span>
      <input type="range" min="${s.min}" max="${s.max}" step="0.05" data-path="personality.${k}" data-kind="number" value="${pr[k]}">
      <output>${p.fmt(pr[k])}</output></label>`).join("");
  return `${U.intro("A personality shapes how all his motion feels, in every mood. Pick a preset, or move the sliders for your own.")}
    ${U.card("Preset", `<div class="seg presets">${presets}</div>`)}
    ${U.card("Fine tuning", `<div class="sliders">${sliders}</div>`)}`;
}

// ------------------------------------------------------------ playground

function playground(p) {
  const c = p.choices, pg = pgState(p);
  const chip = (kind, name, t, on) => `<button class="chip pick ${on ? "on" : ""}" data-action="pg" data-pg-kind="${kind}" data-name="${U.esc(name)}">${U.esc(t ?? U.human(name))}</button>`;
  return `${U.intro("Try Alfie out. Everything here plays on this page only, unless you turn on \"Play on every display\". Nothing here is saved.")}
    ${U.cards(`${U.card("Expressions", `<div class="chips">${chip("expr", "", "Follow mood", pg.expr === "")}${c.expressions.map((e) => chip("expr", e, null, pg.expr === e)).join("")}</div>`)}
      ${U.card("Animations", `<div class="chips">${c.animations.map((a) => chip("anim", a)).join("")}</div>`)}
      ${U.card("A mood level's look", `<small>Holds that level's expression and energy from Mood → Levels (your draft), so you can judge them in motion.</small>
        <div class="chips">${c.levels.map((l) => chip("level", l, L[l], pg.level === l)).join("")}</div>
        <div class="sliders"><label class="slider"><span><b>Energy</b><small>How quick, big and bouncy the motion is. Sliding it holds that energy.</small></span>
          <input type="range" id="pg-energy" min="0.05" max="1.5" step="0.05" data-pg="energy" value="${pg.energy}">
          <output>${p.fmt(pg.energy)}</output></label></div>`)}
      ${U.card("Personality", `<div class="chips">${Object.keys(c.personalities).filter((k) => c.personalities[k]).map((k) => chip("pers", k)).join("")}</div>`)}`)}
    ${U.card("Where", `<label class="check"><input type="checkbox" class="switch" data-pg="everywhere" ${pg.everywhere ? "checked" : ""}>
        <span><b>Play on every display</b><small>Uses the actions: expressions hold for 10 seconds.</small></span></label>
      <div class="row"><button class="flat" data-action="pg" data-pg-kind="reset">Reset everything</button></div>`)}`;
}

// Playground and Look clicks. Local previews go to the dock face, which then
// stops following the draft's mood (p.faceHold) until "Follow mood" or Reset;
// "everywhere" calls the actions instead.
function pgClick(p, el) {
  const kind = el.dataset.pgKind, name = el.dataset.name, pg = pgState(p);
  const card = p.face;
  const hold = (on) => {
    p.faceHold = on;
    p.syncFace(!on);
  };
  const on = (btns, pick) => btns.forEach((b) => b.classList.toggle("on", pick(b)));
  const sibs = () => [...el.parentElement.querySelectorAll(`[data-pg-kind="${kind}"]`)];
  const call = (svc, data) => p.hass.callService("alfie", svc, data).catch((e) => p.flash(e?.message || String(e)));
  switch (kind) {
    case "expr": case "look-expr":
      if (kind === "expr") { pg.expr = name; pg.level = null; p.root.querySelectorAll('[data-pg-kind="level"]').forEach((b) => b.classList.remove("on")); }
      else pg.lookExpr = name;
      on(sibs(), (b) => b === el);
      if (pg.everywhere && kind === "expr") call("set_expression", { expression: name || "auto", duration: 10 });
      else if (name) { hold(true); card?.previewExpression?.(name); }
      else hold(false);
      return;
    case "anim":
      if (pg.everywhere) call("play_animation", { animation: name });
      else card?.playLocal?.(name);
      return;
    case "level": {
      const m = p.draft.mood;
      pg.level = name; pg.expr = m.expressions[name]; pg.energy = Number(m.energy[name]);
      on(sibs(), (b) => b === el);
      p.root.querySelectorAll('[data-pg-kind="expr"]').forEach((b) => b.classList.toggle("on", b.dataset.name === pg.expr));
      const sl = p.root.querySelector("#pg-energy");
      if (sl) { sl.value = pg.energy; sl.parentElement.querySelector("output").textContent = p.fmt(pg.energy); }
      if (pg.everywhere) call("set_expression", { expression: pg.expr, duration: 10 });
      else { hold(true); card?.previewExpression?.(pg.expr); card?.previewEnergy?.(pg.energy); }
      return;
    }
    case "pers":
      on(sibs(), (b) => b === el);
      card?.setPersonality?.(p.choices.personalities[name]);
      return;
    case "reset":
      p.pg = null;
      p.render();
      hold(false);
  }
}

// ------------------------------------------------------------ live faces

// The dock face follows the draft's look by itself (p.syncFace); the stills don't.
function applyLook(p) {
  p.root.querySelectorAll(".lookmini").forEach((m) => drawLookMini(p, m));
}

function drawLookMini(p, m) {
  m.previewLook?.(U.clone(p.draft.look));
  m.renderStill?.({ expression: m.dataset.expr, energy: 0.9 });
}

export function mount(p, sub) {
  p.root.querySelectorAll(".lookmini").forEach((m) => { m.setConfig?.({ card: false, padding: 0.06 }); });
  if (sub === "expressions") showExpr(p);
  if (sub === "look") {
    applyLook(p);
    if (!Scr.pics(p).list && !Scr.pics(p).loading) Scr.loadPictures(p);
    p.root.querySelectorAll(".pathed").forEach((el) => PE.wire(el, pathHooks(p, el.dataset.part)));
  }
}

// The point editor's hooks: live edits go straight into the draft, and the
// dock and the stills follow at most once a frame.
let lookFrame = 0;
function pathHooks(p, part) {
  const Lk = p.draft.look;
  return {
    get: () => partSpec(Lk, part),
    set: (spec) => {
      (Lk.shapes ??= {})[part] = spec;
      p.edited();
      if (!lookFrame) lookFrame = requestAnimationFrame(() => { lookFrame = 0; applyLook(p); });
    },
    done: () => {},
  };
}

// The shell lets go of the dock face after this (faceHold off, syncFace(true)),
// so here only the picks are forgotten, to match.
export function leave(p) {
  p.face?.previewExpression?.(null);
  if (p.pg) Object.assign(p.pg, { level: null, expr: "", lookExpr: "", energy: 0.8 });
}

// ------------------------------------------------------------ editing

// Sliders and switches that are not a draft path: the playground's, and the shape editor.
export function tool(p, ev) {
  const el = ev.target.closest("[data-shape], [data-pg], [data-ex]");
  if (!el) return false;
  if (el.dataset.ex) { exprInput(p, el, ev); return true; }
  const card = p.face;
  if (el.dataset.pg === "energy") {
    const pg = pgState(p);
    pg.energy = Number(el.value);
    el.parentElement.querySelector("output").textContent = p.fmt(pg.energy);
    p.faceHold = true;
    p.syncFace();
    card?.previewEnergy?.(pg.energy);
  } else if (el.dataset.pg === "everywhere") {
    pgState(p).everywhere = el.checked;
    if (el.checked) { p.faceHold = false; p.syncFace(true); }
  } else if (el.dataset.shape) {
    const part = el.dataset.shape, Lk = p.draft.look;
    Lk.shapes ??= {};
    let spec = partSpec(Lk, part);
    if (el.dataset.param === "type") {
      if (ev.type !== "change") return true;
      Lk.shapes[part] = Fm.changeShapeType(partSpec(Lk, part), el.value, (sp) => Face.outline(sp, 48));
      p.edited(true);
    } else {
      spec = Fm.setShapeParam(spec, el.dataset.param, Number(el.value));
      Lk.shapes[part] = spec;
      el.parentElement.querySelector("output").textContent = p.fmt(el.value);
      p.edited();
    }
    applyLook(p);
  }
  return true;
}

export function afterInput(p, path) {
  if (path.startsWith("look.")) applyLook(p);
  if (path.startsWith("personality.") && path !== "personality.preset") {
    p.draft.personality.preset = "custom";
    p.root.querySelectorAll(".preset").forEach((b) => b.classList.toggle("on", b.dataset.name === "custom"));
  }
}

export function beforeInput(p, path, v) {
  const m = /^expressions\.(\d+)\.(id|name)$/.exec(path);
  if (!m) return;
  const list = p.draft.expressions, i = Number(m[1]);
  const follow = (from, to) => {
    Fm.renameFaceRefs(p.draft, "expressions", from, to);
    // The open editor's controls name it by id: keep them pointing at it.
    p.root.querySelectorAll(`[data-ex="${CSS.escape(from)}"]`).forEach((el) => { el.dataset.ex = to; });
    p.root.querySelectorAll(`[data-expr="${CSS.escape(from)}"]`).forEach((el) => { el.dataset.expr = to; });
    if (p.exApart?.delete(from)) p.exApart.add(to);
  };
  if (m[2] === "id") { p.manualId("x", list[i].id); follow(list[i].id, v); p.renameOpen("x", list[i].id, v); }
  // The shipped names are taken too, so a new "Happy" doesn't replace the built-in.
  else p.nameToId("x", [...list, ...Object.keys(FACE.expressions).filter((k) => !list.some((e) => e.id === k)).map((id) => ({ id }))],
    i, v, "expression", `expressions.${i}.id`, follow);
}

export function click(p, a, el) {
  if (a.startsWith("ex-")) return exprClick(p, a, el);
  switch (a) {
    case "pg": pgClick(p, el); return true;
    case "play": p.face?.playLocal?.(el.dataset.name); return true;
    case "preset": {
      const name = el.dataset.name, vals = p.choices.personalities[name];
      p.draft.personality = { ...p.draft.personality, preset: name, ...(vals || {}) };
      p.edited(true);
      return true;
    }
    case "eyes-apart": {
      const sh = (p.draft.look.shapes ??= {});
      if (el.checked) {
        const eye = sh.eye || { type: "circle" };
        sh.left_eye = U.clone(eye);
        sh.right_eye = Fm.mirrorSpec(eye);
      } else {
        if (sh.left_eye) sh.eye = sh.left_eye;
        delete sh.left_eye; delete sh.right_eye;
      }
      p.edited(true);
      applyLook(p);
      return true;
    }
    case "path-rm": {
      const ed = el.closest(".pathed");
      if (ed) PE.removeAt(ed, Number(ed.dataset.sel ?? -1), pathHooks(p, el.dataset.part));
      return true;
    }
    case "path-from": pathFrom(p, el.dataset.part, el.closest(".pathfrom")); return true;
    case "look-glow":
      p.draft.look.glow = el.checked ? null : 0.6;
      p.edited(true);
      applyLook(p);
      return true;
  }
  return false;
}

// A part becomes a drawn shape from a picture's or an icon's biggest outline.
async function pathFrom(p, part, row) {
  const pic = row?.querySelector(".path-pic")?.value, icon = row?.querySelector(".path-icon")?.value.trim();
  let contours = null;
  if (icon) {
    const r = await IC.iconPath(icon);
    if (!r) { p.flash(`No icon called ${icon}`); return; }
    contours = IC.flatten(r.path);
  } else if (pic) {
    const svg = await Scr.pictureSvg(p, pic);
    contours = svg ? SvgP.pictureContours(svg, 1).contours : null;
  } else {
    p.flash("Pick a picture or type an icon first.");
    return;
  }
  const pts = SvgP.outlinePoints(contours, 64);
  if (!pts) { p.flash("That has no closed outline to use."); return; }
  const Lk = p.draft.look;
  (Lk.shapes ??= {})[part] = { type: "path", points: pts };
  p.edited(true);
  applyLook(p);
}
