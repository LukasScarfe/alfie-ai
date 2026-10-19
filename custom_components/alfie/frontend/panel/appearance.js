// The panel's Appearance section: Look (how Alfie is drawn on every card),
// Personality (how all his motion feels) and Playground (try him out).

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
  const colors = LOOK_COLORS.map(([k, t]) => U.field(t, `<span class="row">
      <input type="color" class="swatch" data-path="look.${k}" data-kind="opttext" value="${Fm.swatchValue(Lk[k])}" aria-label="${t}">
      <input class="grow" data-path="look.${k}" data-kind="opttext" value="${U.esc(Lk[k])}" placeholder="Default (from the style)"></span>`)).join("");
  const range = (path, v, min, max, step, text) => `<label class="slider"><span>${text}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" data-path="${path}" data-kind="number" value="${v}">
      <output>${p.fmt(v)}</output></label>`;
  const shapes = [["head", "Ring"], ["eye", "Eyes"]].map(([part, t]) => shapeEditor(p, part, t, Lk.shapes?.[part])).join("");
  const extra = Lk.shapes && (Lk.shapes.left_eye || Lk.shapes.right_eye)
    ? `<p class="muted">A separate left or right eye shape is kept as it is; edit it in YAML.</p>` : "";
  return `${U.intro("How Alfie is drawn on every card. A card's own options (in its editor) still win over these, one by one.")}
    <div class="split"><div>
      <h3>Style and colour</h3>
      ${U.group("", `${U.field("Style", U.select("look.style", Lk.style, (p.choices.styles || CARD_STYLES).map((s) => [s, STYLE_TEXT[s] || U.human(s)])),
        "Sets the default colours and glow.")}${colors}`)}
      <p class="muted">Empty: the style's own. A colour is <code>#hex</code>, a CSS colour or <code>var(--primary-color)</code>.</p>
      <h3>Lines</h3>
      <div class="sliders">${range("look.line_width", Lk.line_width, 0.005, 0.1, 0.005, "Ring and eye line width")}
        ${range("look.screen_line_width", Lk.screen_line_width, 0.005, 0.06, 0.005, "Screen line width")}
        ${range("look.padding", Lk.padding, 0, 0.3, 0.01, "Padding around the ring")}
        <label class="check">${U.toggle(null, Lk.glow == null, { action: "look-glow" })}<span><b>Glow from the style</b></span></label>
        ${Lk.glow == null ? "" : range("look.glow", Lk.glow, 0, 2, 0.05, "Glow")}
        ${U.check("look.eye_fill", Lk.eye_fill, "Fill the eyes")}</div>
      <h3>Shapes</h3>${shapes}${extra}
    </div>
    <div class="live card"><alfie-card id="look"></alfie-card>
      <div class="minis">${LOOK_EXPRESSIONS.map((e) => `<figure><alfie-card class="lookmini" data-expr="${e}"></alfie-card><figcaption>${U.human(e)}</figcaption></figure>`).join("")}</div>
      <div class="chips">${LOOK_EXPRESSIONS.map((e) => `<button class="chip pick" data-action="pg" data-pg-kind="look-expr" data-name="${e}">${U.human(e)}</button>`).join("")}
        <button class="chip pick on" data-action="pg" data-pg-kind="look-expr" data-name="">Follow mood</button></div>
      <small>Live Alfie with the look as edited here, before you save.</small>
    </div></div>
    <style>
      .minis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0; }
      .minis figure { margin: 0; text-align: center; font-size: 12px; color: var(--muted); }
      .shape { margin: 8px 0; display: grid; gap: 10px; }
    </style>`;
}

function shapeEditor(p, part, t, spec) {
  spec ||= { type: "circle" };
  const type = spec.type || "circle";
  const types = [...Object.keys(Fm.SHAPE_PARAMS), ...(type === "path" ? ["path"] : [])];
  const params = type === "path" ? [] : [...Fm.SHAPE_PARAMS[type], ...Fm.SHAPE_COMMON];
  return `<div class="card shape">${U.field(t, `<select data-shape="${part}" data-param="type">${types.map((x) =>
      `<option value="${x}" ${x === type ? "selected" : ""}>${SHAPE_TEXT[x]}</option>`).join("")}</select>`)}
    ${type === "path" ? `<p class="muted">A custom path. Edit its points in YAML; it is kept untouched here.</p>` : ""}
    ${params.map(([k, min, max, step]) => `<label class="slider"><span>${PARAM_TEXT[k] || U.human(k)}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" data-shape="${part}" data-param="${k}" value="${Fm.shapeParam(spec, k)}">
      <output>${p.fmt(Fm.shapeParam(spec, k))}</output></label>`).join("")}</div>`;
}

// ------------------------------------------------------------ personality

function personality(p) {
  const pr = p.draft.personality, c = p.choices;
  const presets = Object.keys(c.personalities).map((k) =>
    `<button class="card preset ${pr.preset === k ? "on" : ""}" data-action="preset" data-name="${k}">${U.esc(U.human(k))}</button>`).join("");
  const sliders = Object.entries(c.sliders).map(([k, s]) => `<label class="slider">
      <span><b>${SLIDER_TEXT[k][0]}</b><small>${SLIDER_TEXT[k][1]}</small></span>
      <input type="range" min="${s.min}" max="${s.max}" step="0.05" data-path="personality.${k}" data-kind="number" value="${pr[k]}">
      <output>${p.fmt(pr[k])}</output></label>`).join("");
  return `${U.intro("A personality shapes how all his motion feels, in every mood. Pick a preset, or move the sliders for your own.")}
    <div class="presets">${presets}</div>
    <div class="split"><div class="sliders">${sliders}</div>
      <div class="live card"><alfie-card id="live"></alfie-card>
        <div class="chips">${PREVIEW_ANIMS.map((a) => `<button class="chip pick" data-action="play" data-name="${a}">${U.human(a)}</button>`).join("")}</div>
        <small>Live Alfie with this personality. These buttons play here only.</small>
      </div></div>
    <style>
      .presets { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
      .preset { margin: 0; padding: 10px 18px; color: var(--primary-text-color); font-weight: 500; }
      .preset.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    </style>`;
}

const personalityValues = (p) => Object.fromEntries(Object.keys(p.choices.sliders).map((k) => [k, p.draft.personality[k]]));

// ------------------------------------------------------------ playground

function playground(p) {
  const c = p.choices, pg = pgState(p);
  const chip = (kind, name, t, on) => `<button class="chip pick ${on ? "on" : ""}" data-action="pg" data-pg-kind="${kind}" data-name="${U.esc(name)}">${U.esc(t ?? U.human(name))}</button>`;
  return `${U.intro("Try Alfie out. Everything here plays on this page only, unless you turn on \"Play on every display\". Nothing here is saved.")}
    <div class="split"><div>
      <h3>Expressions</h3>
      <div class="chips">${chip("expr", "", "Follow mood", pg.expr === "")}${c.expressions.map((e) => chip("expr", e, null, pg.expr === e)).join("")}</div>
      <h3>Animations</h3>
      <div class="chips">${c.animations.map((a) => chip("anim", a)).join("")}</div>
      <h3>A mood level's look</h3>
      <p class="muted">Holds that level's expression and energy from Mood → Levels (your draft), so you can judge them in motion.</p>
      <div class="chips">${c.levels.map((l) => chip("level", l, L[l], pg.level === l)).join("")}</div>
      <label class="slider"><span><b>Energy</b><small>How quick, big and bouncy the motion is. Sliding it holds that energy.</small></span>
        <input type="range" id="pg-energy" min="0.05" max="1.5" step="0.05" data-pg="energy" value="${pg.energy}">
        <output>${p.fmt(pg.energy)}</output></label>
      <h3>Personality</h3>
      <div class="chips">${Object.keys(c.personalities).filter((k) => c.personalities[k]).map((k) => chip("pers", k)).join("")}</div>
      <h3>Where</h3>
      <label class="check"><input type="checkbox" class="switch" data-pg="everywhere" ${pg.everywhere ? "checked" : ""}>
        <span><b>Play on every display</b><small>Uses the actions: expressions hold for 10 seconds.</small></span></label>
      <div class="row"><button class="flat" data-action="pg" data-pg-kind="reset">Reset everything</button></div>
    </div>
    <div class="live card"><alfie-card id="pg"></alfie-card>
      <small>Live Alfie, following the house until you pick something.</small></div></div>`;
}

// Playground and Look clicks. Local previews go to the card on this page;
// "everywhere" calls the actions instead.
function pgClick(p, el) {
  const kind = el.dataset.pgKind, name = el.dataset.name, pg = pgState(p);
  const card = p.root.querySelector("#pg") || p.root.querySelector("#look");
  const on = (btns, pick) => btns.forEach((b) => b.classList.toggle("on", pick(b)));
  const sibs = () => [...el.parentElement.querySelectorAll(`[data-pg-kind="${kind}"]`)];
  const call = (svc, data) => p.hass.callService("alfie", svc, data).catch((e) => p.flash(e?.message || String(e)));
  switch (kind) {
    case "expr": case "look-expr":
      if (kind === "expr") { pg.expr = name; pg.level = null; p.root.querySelectorAll('[data-pg-kind="level"]').forEach((b) => b.classList.remove("on")); }
      on(sibs(), (b) => b === el);
      if (pg.everywhere && kind === "expr") call("set_expression", { expression: name || "auto", duration: 10 });
      else card?.previewExpression?.(name || null);
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
      else { card?.previewExpression?.(pg.expr); card?.previewEnergy?.(pg.energy); }
      return;
    }
    case "pers":
      on(sibs(), (b) => b === el);
      card?.setPersonality?.(p.choices.personalities[name]);
      return;
    case "reset":
      p.pg = null;
      card?.previewExpression?.(null);
      card?.previewEnergy?.(null);
      card?.setPersonality?.(null);
      p.render();
  }
}

// ------------------------------------------------------------ live faces

function applyLook(p) {
  p.root.querySelector("#look")?.previewLook?.(U.clone(p.draft.look));
  p.root.querySelectorAll(".lookmini").forEach((m) => drawLookMini(p, m));
}

function drawLookMini(p, m) {
  m.previewLook?.(U.clone(p.draft.look));
  m.renderStill?.({ expression: m.dataset.expr, energy: 0.9 });
}

export function mount(p, sub) {
  for (const sel of ["#look", "#pg"]) {
    const c = p.root.querySelector(sel);
    if (!c?.setConfig) continue;
    c.setConfig({ card: false });
    c.hass = p.hass;
  }
  p.root.querySelectorAll(".lookmini").forEach((m) => { m.setConfig?.({ card: false, padding: 0.06 }); });
  if (sub === "look") applyLook(p);
  const live = p.root.querySelector("#live");
  if (live?.setConfig) {
    live.setConfig({ card: false, personality: personalityValues(p) });
    live.hass = p.hass;
  }
}

export function leave(p) {
  for (const sel of ["#pg", "#look"]) {
    const c = p.root.querySelector(sel);
    c?.previewExpression?.(null);
    c?.previewEnergy?.(null);
    c?.previewLook?.(null);
  }
}

// ------------------------------------------------------------ editing

// Sliders and switches that are not a draft path: the playground's, and the shape editor.
export function tool(p, ev) {
  const el = ev.target.closest("[data-shape], [data-pg]");
  if (!el) return false;
  const card = p.root.querySelector("#pg");
  if (el.dataset.pg === "energy") {
    const pg = pgState(p);
    pg.energy = Number(el.value);
    el.parentElement.querySelector("output").textContent = p.fmt(pg.energy);
    card?.previewEnergy?.(pg.energy);
  } else if (el.dataset.pg === "everywhere") {
    pgState(p).everywhere = el.checked;
    if (el.checked) { card?.previewExpression?.(null); card?.previewEnergy?.(null); }
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
    p.root.querySelector("#live")?.setPersonality?.(personalityValues(p));
  }
}

export function click(p, a, el) {
  switch (a) {
    case "pg": pgClick(p, el); return true;
    case "play": p.root.querySelector("#live")?.playLocal(el.dataset.name); return true;
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
