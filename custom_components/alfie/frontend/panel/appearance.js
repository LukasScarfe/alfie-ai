// The panel's Appearance section: Look (how Alfie is drawn on every card),
// Personality (how all his motion feels) and Playground (try him out). They
// all play on the shell's dock face (p.face); Look and Personality add their
// extras under it with dock().

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);
const Fm = await import(`../alfie-panel-forms.js${V}`);

export const id = "appearance";
export const title = "Appearance";
export const subs = [["look", "Look"], ["personality", "Personality"], ["playground", "Playground"]];
export const resets = { look: ["look"], personality: ["personality"] };

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
const SHAPE_TEXT = { circle: "Circle", polygon: "Polygon", star: "Star", superellipse: "Superellipse", path: "Path (edit in YAML)" };
const PARAM_TEXT = { sides: "Sides", roundness: "Roundness", points: "Points", inner: "Inner size", n: "Squareness",
  rotation: "Rotation", stretch_x: "Stretch across", stretch_y: "Stretch up" };

const pgState = (p) => (p.pg ??= { everywhere: false, level: null, expr: "", energy: 0.8 });

export function render(p, sub) {
  if (sub === "personality") return personality(p);
  if (sub === "playground") return playground(p);
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
  const shapes = [["head", "Ring"], ["eye", "Eyes"]].map(([part, t]) => shapeEditor(p, part, t, Lk.shapes?.[part])).join("");
  const extra = Lk.shapes && (Lk.shapes.left_eye || Lk.shapes.right_eye)
    ? `<p class="muted">A separate left or right eye shape is kept as it is; edit it in YAML.</p>` : "";
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
    <h3 class="cards-title">Shapes</h3>${U.cards(shapes)}${extra}`;
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

function shapeEditor(p, part, t, spec) {
  spec ||= { type: "circle" };
  const type = spec.type || "circle";
  const types = [...Object.keys(Fm.SHAPE_PARAMS), ...(type === "path" ? ["path"] : [])];
  const params = type === "path" ? [] : [...Fm.SHAPE_PARAMS[type], ...Fm.SHAPE_COMMON];
  return `<section class="card shape"><h3>${U.esc(t)}</h3>${U.field("Shape", `<select data-shape="${part}" data-param="type">${types.map((x) =>
      `<option value="${x}" ${x === type ? "selected" : ""}>${SHAPE_TEXT[x]}</option>`).join("")}</select>`)}
    ${type === "path" ? `<p class="muted">A custom path. Edit its points in YAML; it is kept untouched here.</p>` : ""}
    ${params.map(([k, min, max, step]) => `<label class="slider"><span>${PARAM_TEXT[k] || U.human(k)}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" data-shape="${part}" data-param="${k}" value="${Fm.shapeParam(spec, k)}">
      <output>${p.fmt(Fm.shapeParam(spec, k))}</output></label>`).join("")}</section>`;
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
  if (sub === "look") applyLook(p);
}

// The shell lets go of the dock face after this (faceHold off, syncFace(true)),
// so here only the picks are forgotten, to match.
export function leave(p) {
  if (p.pg) Object.assign(p.pg, { level: null, expr: "", lookExpr: "", energy: 0.8 });
}

// ------------------------------------------------------------ editing

// Sliders and switches that are not a draft path: the playground's, and the shape editor.
export function tool(p, ev) {
  const el = ev.target.closest("[data-shape], [data-pg]");
  if (!el) return false;
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
    let spec = Lk.shapes[part] || { type: "circle" };
    if (el.dataset.param === "type") {
      if (ev.type !== "change") return true;
      Lk.shapes[part] = Fm.changeShapeType(spec, el.value);
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

export function click(p, a, el) {
  switch (a) {
    case "pg": pgClick(p, el); return true;
    case "play": p.face?.playLocal?.(el.dataset.name); return true;
    case "preset": {
      const name = el.dataset.name, vals = p.choices.personalities[name];
      p.draft.personality = { ...p.draft.personality, preset: name, ...(vals || {}) };
      p.edited(true);
      return true;
    }
    case "look-glow":
      p.draft.look.glow = el.checked ? null : 0.6;
      p.edited(true);
      applyLook(p);
      return true;
  }
  return false;
}
