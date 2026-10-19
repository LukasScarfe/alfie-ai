// Alfie's Lovelace card: the face, drawn in the browser at full frame rate.
//
// The engine pushes low-rate scene state over `alfie/subscribe` (see
// docs/design.md "Scene state"); everything per frame happens here: the
// spring blend between expressions, blinks, breathing, animation keyframes,
// and energy, which makes a happy Alfie quick and bouncy and a miserable one
// slow and small. Vanilla JS, no build step. Auto-registered by the
// integration, so there is no Lovelace resource to add.

const V = new URL(import.meta.url).search; // ?v=<version>: carry it to our own files
const F = await import(`./alfie-face.js${V}`);
const S = await import(`./alfie-screens.js${V}`);
const L = await import(`./alfie-look.js${V}`);
const I = await import(`./alfie-intros.js${V}`);
const G = await import(`./alfie-stage.js${V}`);
const FACE_URL = new URL(`./alfie-face.json${V}`, import.meta.url);

let faceData = null;
// A screen's options with the type's defaults under them.
function withDefaults(type, options) {
  const out = { ...(options || {}) };
  for (const o of type?.options ?? []) if (out[o.key] === undefined && o.default !== undefined) out[o.key] = o.default;
  return out;
}

function loadFace() {
  faceData ??= fetch(FACE_URL).then((r) => {
    if (!r.ok) throw new Error(`alfie-face.json: HTTP ${r.status}`);
    return r.json();
  }).then((d) => ({
    ...d,
    compiled: Object.fromEntries(Object.entries(d.animations).map(([k, a]) => [k, F.compileAnimation(a)])),
  }));
  return faceData;
}

// Render styles set colour defaults; every colour can still be set alone.
const STYLES = {
  neon: { color: "#4dffa0", glow: 0.6 },
  flat: { color: "var(--primary-text-color, #e1e1e1)", glow: 0 },
  crt: { color: "#7dff8a", glow: 1.0 },
  theme: { color: "var(--primary-color, #03a9f4)", glow: 0 },
};

const DEFAULTS = {
  style: "neon",
  face_color: null,       // the ring; null takes the style's colour
  eye_color: null,        // null takes face_color
  background: "none",     // "none" keeps the card's own background, or any CSS colour
  line_width: 0.035,      // ring radii
  glow: null,             // 0..2, null takes the style's
  eye_fill: false,
  padding: 0.08,          // share of the card around the ring
  aspect: 1,              // width / height of the drawing area
  fps: 30,                // frame-rate cap: 30 is smooth and kind to a tablet
  liveliness: 1,          // scales how much energy shows: 0 calm, 2 very
  breathing: true,
  blinking: true,
  card: true,             // false drops the ha-card frame
  shapes: null,           // {head, eye, left_eye, right_eye} over the face's own; see alfie-face.js
  personality: null,      // a preset name or {exaggeration, speed, bounce, blink_rate, energy_bias}; null follows Alfie's
  mode: "companion",      // companion: just Alfie (screens only on a show_screen); rotation: run `rotation`
  rotation: null,         // a rotation id, or an inline [{screen, seconds}]
  present: "handover",    // handover: Alfie leaves while a screen shows; corner: he shrinks aside and stays alive
  corner: "bottom_right", // bottom_right | bottom_left | top_right | top_left
  corner_size: 0.3,       // Alfie's size in the corner, share of his full size (0.15 to 0.5)
  transition: null,       // an intro style; null takes the rotation's, then fade
  appear_story: "auto",   // rotation: the story Alfie plays here when he appears in it; auto: the most relevant (mood-led), none, or a story id
  text_color: null,       // screen text; null takes the face colour
  accent_color: null,     // screen accents; null takes the face colour
  screen_line_width: 0.02, // ring radii: screens draw finer than the face
};

const MODES = ["companion", "rotation"];
const PRESENTS = ["handover", "corner"];
const CORNERS = ["bottom_right", "bottom_left", "top_right", "top_left"];
const CORNER_SECONDS = 0.8;   // how long the face takes to move to or from its corner
const DATA_STALE = 300;       // seconds before a shown screen's data is fetched again
const DATA_RETRY = 30;        // seconds before retrying a failed fetch

const QUEUE = 2;          // animations waiting behind the one playing
const ANIMATION_FRESH = 5; // seconds: an older one is not replayed on (re)connect
const MOTION = ["dx", "dy", "lx", "ly", "rx", "ry", "fx", "fy", "size"];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Where the face is between expressions: the one part with memory. A new
// expression blends from wherever the eyes are when it arrives, possibly
// halfway through the last blend. Times are seconds on the card's own clock.
class FaceState {
  constructor() {
    this.expression = null;
    this.start = null;
    this.since = 0;
    this.blendLength = F.GEOMETRY.blend;
    this.damping = F.GEOMETRY.damping;
    this.energy = 0.8;
    this.energyTarget = 0.8;
    this.energyAt = 0;
    this.queue = [];
    this.playing = null; // {anim, began}
    this.personality = { ...F.PERSONALITY };
  }

  // How the current energy and personality shape motion: speed, size and settle.
  get rate() { return (0.65 + 0.55 * this.energy) * this.personality.speed; }
  get amp() { return (0.6 + 0.55 * this.energy) * this.personality.exaggeration; }

  setEnergy(e, t) {
    this.energyTarget = clamp(e, 0, 1.5);
    this.energyAt = t;
  }

  // `key` names the pose exactly (the expression and how exaggerated), so a
  // personality change re-blends even when the expression stays.
  // `blend` (seconds, 0 for the usual) slows one change down, e.g. a story's mood morph.
  setExpression(name, pose, t, parts, key = name, blend = 0) {
    if (this.expression === name && this.key === key && this.targetParts === parts) return;
    const first = this.expression === null;
    this.start = first ? pose : this.poseAt(t);
    this.startParts = first ? parts : this.partsAt(t);
    this.target = pose;
    this.targetParts = parts;
    this.expression = name;
    this.key = key;
    this.since = t;
    // Low energy: a slower blend that settles without bouncing.
    this.blendLength = blend > 0 ? blend : F.GEOMETRY.blend / this.rate;
    this.damping = F.bounced(clamp(F.GEOMETRY.damping + 0.35 * (1 - this.energy), 0.2, 0.92),
      this.personality.bounce);
  }

  _f(t) {
    return F.spring((t - this.since) / this.blendLength, this.damping);
  }

  poseAt(t) {
    const f = this._f(t);
    if (f <= 0) return this.start;
    if (t - this.since >= this.blendLength) return this.target;
    return F.uncrossed(F.lerp(this.start, this.target, f));
  }

  // Eye shapes morph on the same spring as the lids; the head follows the target.
  partsAt(t) {
    const a = this.startParts, b = this.targetParts;
    if (a === b || t - this.since >= this.blendLength) return b;
    const f = this._f(t);
    return { head: b.head, left: F.blendOutlines(a.left, b.left, f), right: F.blendOutlines(a.right, b.right, f) };
  }

  play(anim) {
    if (this.queue.length >= QUEUE) return false;
    this.queue.push(anim);
    return true;
  }

  // The animation channels at `t`, scaled by energy, or {}.
  channels(t) {
    if (this.playing && (t - this.playing.began) * this.playing.rate >= this.playing.anim.length) {
      this.playing = null;
    }
    if (!this.playing && this.queue.length) {
      this.playing = { anim: this.queue.shift(), began: t, rate: this.rate, amp: this.amp };
    }
    if (!this.playing) return {};
    const p = this.playing;
    const c = p.anim.script((t - p.began) * p.rate);
    for (const k of MOTION) if (c[k]) c[k] *= p.amp;
    return c;
  }

  // Energy drifts to its target over a couple of seconds, not in a jump.
  tick(t, dt) {
    this.energy += (this.energyTarget - this.energy) * (1 - Math.exp(-dt / 2));
  }
}

// A polyline as a smooth path (quadratics through the edge midpoints) except at
// deliberate corners, which stay sharp. Shared by the face (closed outlines) and
// screens (open or closed strokes). Adds to the current path; the caller strokes.
function trace(ctx, pts, closed = true) {
  const m = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (!closed) {
    ctx.moveTo(...pts[0]);
    if (m < 3) { for (let i = 1; i < m; i++) ctx.lineTo(...pts[i]); return; }
    const flags = F.cornerFlags(pts);
    for (let i = 1; i < m - 1; i++) {
      if (flags[i]) { ctx.lineTo(...pts[i]); continue; }
      ctx.lineTo(...mid(pts[i - 1], pts[i]));
      ctx.quadraticCurveTo(...pts[i], ...mid(pts[i], pts[i + 1]));
    }
    ctx.lineTo(...pts[m - 1]);
    return;
  }
  const flags = F.cornerFlags(pts);
  const s = flags.indexOf(true);
  if (s >= 0) ctx.moveTo(...pts[s]);
  else ctx.moveTo(...mid(pts[m - 1], pts[0]));
  for (let j = s >= 0 ? 1 : 0; j < m; j++) {
    const i = s >= 0 ? (s + j) % m : j, v = pts[i];
    if (flags[i]) { ctx.lineTo(...v); continue; }
    ctx.lineTo(...mid(pts[(i + m - 1) % m], v));
    ctx.quadraticCurveTo(...v, ...mid(v, pts[(i + 1) % m]));
  }
  ctx.closePath();
}

class AlfieCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULTS };
    this._face = new FaceState();
    this._scene = null;
    this._user = {};
    this._lookKey = "";       // the applied look, as JSON, to tell a change from a re-sent scene
    this._lookPreview = null;
    this._exprPreview = null;
    this._energyPreview = null;
    this._lastAnimId = null;
    this._visible = true;
    this._running = false;
    this._still = false;
    this._last = 0;
    this._t0 = performance.now();
    this._error = null;
    this._place = { ...G.HOME };   // where a story has put Alfie, sprung toward each frame
    this._local = null;            // a story this card plays by itself (an Alfie step in its rotation)
    this._badKey = "";
    this._resetScreens();
  }

  static getStubConfig() {
    return { style: "neon" };
  }

  static async getConfigElement() {
    await import(`./alfie-card-editor.js${V}`);   // loaded only when the editor opens
    return document.createElement("alfie-card-editor");
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    for (const k of ["line_width", "padding", "aspect", "fps", "liveliness"]) {
      if (config[k] !== undefined && !(Number(config[k]) >= 0)) throw new Error(`${k} must be a number`);
    }
    for (const [k, list] of [["mode", MODES], ["present", PRESENTS], ["corner", CORNERS]]) {
      if (config[k] !== undefined && !list.includes(config[k])) throw new Error(`${k} must be one of ${list.join(", ")}`);
    }
    if (config.corner_size !== undefined && !(Number(config.corner_size) > 0)) throw new Error("corner_size must be a number");
    if (config.rotation != null && typeof config.rotation !== "string" && !Array.isArray(config.rotation)) {
      throw new Error("rotation must be a rotation id or a list of {screen, seconds} / {alfie: true, seconds}");
    }
    if (config.style && !STYLES[config.style]) {
      throw new Error(`style must be one of ${Object.keys(STYLES).join(", ")}`);
    }
    if (config.shapes !== undefined && (typeof config.shapes !== "object" || config.shapes === null)) {
      throw new Error("shapes must be a mapping of head / eye / left_eye / right_eye to shape specs");
    }
    const pc = config.personality;
    if (pc !== undefined && pc !== null && typeof pc !== "string" && typeof pc !== "object") {
      throw new Error("personality must be a preset name or a mapping of sliders");
    }
    this._user = { ...config };   // the card's own keys: they beat Alfie's global look
    // Before appearance stories, bad_news: false kept Alfie's bad news off.
    if (config.appear_story === undefined && config.bad_news === false) this._user.appear_story = "none";
    this._config = L.effectiveConfig(DEFAULTS, this._lookNow(), this._user);
    this._rot = null;   // rebuilt from the new rotation option
    this._partsCache = null;
    if (this._face.expression !== null && faceData) {
      const name = this._face.expression;
      this._face.expression = null;   // re-apply with the new shapes, no blend
      faceData.then((face) => {
        this._personality(face, this._global);
        this._applyExpression(face, name, this._now());
      });
    }
    this._build();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._subscribing && !this._still) this._subscribe();
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 3 };
  }

  connectedCallback() {
    this._build();
    this._io ??= new IntersectionObserver((es) => {
      this._visible = es.some((e) => e.isIntersecting);
      this._wake();
    });
    this._io.observe(this);
    this._onVis ??= () => this._wake();
    document.addEventListener("visibilitychange", this._onVis);
    this._wake();
  }

  disconnectedCallback() {
    this._io?.disconnect();
    document.removeEventListener("visibilitychange", this._onVis);
    this._running = false;
  }

  // ------------------------------------------------------------- engine

  async _subscribe() {
    this._subscribing = true;
    try {
      this._unsub = await this._hass.connection.subscribeMessage(
        (scene) => this._onScene(scene), { type: "alfie/subscribe" });
      this._error = null;
    } catch (e) {
      this._error = e?.code === "not_loaded" ? "Alfie isn't set up yet." : `Can't reach Alfie (${e?.message || e?.code || e}).`;
      this._subscribing = false;
      this._showError();
      setTimeout(() => this._hass && !this._subscribing && this._subscribe(), 15000);
    }
  }

  async _onScene(scene) {
    if (scene.ended) {
      // The engine reloaded: drop this subscription and join the new one.
      try { (await this._unsub)?.(); } catch (_) { /* already gone */ }
      this._unsub = null;
      this._subscribing = false;
      setTimeout(() => this._hass && !this._subscribing && this._subscribe(), 2000);
      return;
    }
    const face = await loadFace();
    this._scene = scene;
    this._applyLook();
    this._error = null;
    this._showError();
    if (scene.screens_rev !== this._screensRev) this._fetchScreens(scene.screens_rev);
    // What is wrong (and which of it asks to join the rotation) reshapes the rotation.
    const badKey = (scene.signals || []).filter((s) => s.kind === "bad")
      .map((s) => `${s.id}:${s.screen}:${s.in_rotation ? 1 : 0}`).join(",");
    if (badKey !== this._badKey) {
      this._badKey = badKey;
      if (this._rot) this._rot.stale = true;
    }
    const t = this._now();
    const global = this._global = F.personalityOf(scene.personality, face.personalities);
    const p = this._personality(face, global);
    // The engine's energy already has Alfie's own bias in it; a card with its
    // own personality swaps that bias for its own.
    const energy = (scene.mood?.energy ?? 0.8) - global.energy_bias + p.energy_bias;
    this._face.setEnergy(Math.max(0.05, this._energyPreview ?? energy) * this._config.liveliness, t);
    if (scene.story) this._endLocal(false);   // a trigger's story beats this card's own
    this._faceDoc = face;
    this._applyExpression(face, this._exprPreview ?? this._local?.expression ?? scene.expression, t,
      scene.story?.blend || this._local?.blend || 0);
    const a = scene.animation;
    if (a && a.id !== this._lastAnimId) {
      const first = this._lastAnimId === null;
      this._lastAnimId = a.id;
      const age = (scene.now ?? Date.now() / 1000) - a.at;
      if (age < ANIMATION_FRESH && face.compiled[a.name] && !(first && age > 1)) {
        this._face.play(face.compiled[a.name]);
      }
    }
  }

  // The look in force: the panel's preview, else Alfie's global one from the scene.
  _lookNow() {
    return this._lookPreview ?? this._scene?.look ?? null;
  }

  // Apply the look when it really changed (a cheap JSON compare: scenes arrive
  // often). Colours re-resolve, the shapes cache drops, and the new shapes
  // blend in because the expression's parts object is a new one.
  _applyLook() {
    const look = this._lookNow(), key = L.lookKey(look);
    if (key === this._lookKey) return false;
    this._lookKey = key;
    const bg = (c) => (c.background && c.background !== "none" ? c.background : "");
    const before = bg(this._config);
    this._config = L.effectiveConfig(DEFAULTS, look, this._user);
    this._colors = null;
    this._partsCache = null;
    if (bg(this._config) !== before) this._build();
    return true;
  }

  // The card's `personality` option over Alfie's own (`base`, from the scene).
  _personality(face, base = this._global || F.PERSONALITY) {
    const p = this._config.personality == null ? base
      : F.personalityOf(this._config.personality, face.personalities, base);
    this._face.personality = p;
    return p;
  }

  _applyExpression(face, name, t, blend = 0) {
    if (!(name in face.expressions)) name = "neutral";
    const e = face.expressions[name];
    const k = this._face.personality.exaggeration;
    const pose = F.exaggerated(F.poseOf(e), F.poseOf(face.expressions.neutral), k);
    this._face.setExpression(name, pose, t, this._parts(face, e), `${name}|${k}`, blend);
  }

  // The unit outlines for an expression: the face's shapes, this card's
  // `shapes` over them, the expression's own eye shapes over those. Memoised,
  // so the same outlines are the same objects (and a re-sent scene is free).
  _parts(face, expr) {
    const spec = { ...face.shapes, ...(this._config.shapes || {}), ...(expr.shapes || {}) };
    const key = JSON.stringify(spec);
    this._partsCache ??= new Map();
    let p = this._partsCache.get(key);
    if (!p) {
      p = F.partOutlines(spec, F.GEOMETRY);
      this._partsCache.set(key, p);
    }
    return p;
  }

  // ------------------------------------------------------------ drawing

  _build() {
    if (!this.shadowRoot) return;
    const c = this._config;
    const bg = c.background && c.background !== "none" ? c.background : null;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card, .bare { overflow: hidden; height: 100%; ${bg ? `background: ${bg};` : ""} }
        .wrap { position: relative; width: 100%; aspect-ratio: ${Number(c.aspect) || 1}; }
        canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
        .msg { position: absolute; inset: auto 0 8px 0; text-align: center; font: 13px sans-serif;
               color: var(--secondary-text-color, #aaa); }
      </style>
      ${c.card ? "<ha-card>" : '<div class="bare">'}
        <div class="wrap"><canvas></canvas><div class="msg"></div></div>
      ${c.card ? "</ha-card>" : "</div>"}`;
    this._canvas = this.shadowRoot.querySelector("canvas");
    this._msg = this.shadowRoot.querySelector(".msg");
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this._canvas);
    this._colors = null;
    this._showError();
  }

  _showError() {
    if (this._msg) this._msg.textContent = this._error || "";
  }

  _resize(redraw = true) {
    const cv = this._canvas;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cv.clientWidth * dpr));
    const h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    if (redraw && this._still) this._draw(this._stillFrame, this._stillScr || null);
  }

  // Colours may be CSS variables; the canvas needs them resolved.
  _resolveColors() {
    const c = this._config;
    const st = STYLES[c.style] || STYLES.neon;
    const probe = (v) => {
      if (!v.includes("var(")) return v;
      this._canvas.style.color = v;
      const out = getComputedStyle(this._canvas).color;
      this._canvas.style.color = "";
      return out;
    };
    const face = probe(c.face_color || st.color);
    this._colors = {
      face, eye: c.eye_color ? probe(c.eye_color) : face, glow: c.glow ?? st.glow,
      text: c.text_color ? probe(c.text_color) : face, accent: c.accent_color ? probe(c.accent_color) : face,
    };
  }

  _now() {
    return (performance.now() - this._t0) / 1000;
  }

  _wake() {
    const go = this._visible && !document.hidden && this.isConnected && !this._still;
    if (go && !this._running) {
      this._running = true;
      requestAnimationFrame((ms) => this._loop(ms));
    } else if (!go) {
      this._running = false;
    }
  }

  _loop(ms) {
    if (!this._running) return;
    const gap = 1000 / clamp(Number(this._config.fps) || 30, 1, 120);
    if (ms - this._last >= gap - 1) {
      const dt = this._last ? Math.min((ms - this._last) / 1000, 0.5) : 0;
      this._last = ms;
      if (this._face.expression !== null) {
        const t = this._now();
        this._face.tick(t, dt);
        if (this._local) this._stepLocal(t);
        this._place = G.placeToward(this._place, this._scene?.story?.place ?? this._local?.place ?? null, dt);
        this._draw(this._frame(t), this._presentation(t, dt));
      }
    }
    requestAnimationFrame((m) => this._loop(m));
  }

  // The face at `t`: expression pose, energy sag, animation, breath, blink.
  _frame(t, opts = {}) {
    const f = this._face, c = this._config;
    const e = f.energy;
    const pose = opts.pose || f.poseAt(t);
    const parts = opts.parts || f.partsAt(t);
    const ch = opts.channels || f.channels(t);
    // Low energy weighs on him: lids heavier, eyes lower.
    const sag = clamp(0.5 - e, 0, 0.5) * 2;
    if (sag > 0) {
      ch.droop = Math.max(ch.droop || 0, 0.35 * sag);
      ch.dy = (ch.dy || 0) - 0.035 * sag;
    }
    if (c.breathing && !opts.noBreath) {
      const period = 3.6 / (0.6 + 0.6 * e);
      ch.fy = (ch.fy || 0) + (0.006 + 0.012 * e) * Math.sin((2 * Math.PI * t) / period);
    }
    const shape = F.animated(pose, ch);
    let p = shape.pose;
    if (c.blinking && !opts.noBlink) {
      const slow = 1.5 - 0.5 * clamp(e, 0, 1);
      const slot = (F.GEOMETRY.blink_slot * slow) / clamp(f.personality.blink_rate, 0.2, 3);
      p = F.blinked(p, F.blink(t, Math.max(slot, 1.6), F.GEOMETRY.blink * slow));
    }
    return F.faceShapes(p, shape.eyes, shape.face, F.GEOMETRY, parts);
  }

  // `scr` is null (Alfie alone, exactly as ever) or what `_presentation` built:
  // how the face is placed and faded, and the screen's strokes.
  _draw(shapes, scr = null) {
    const cv = this._canvas;
    if (!cv || !shapes) return;
    // A canvas with no size yet (hidden, not laid out) draws nothing; the
    // ResizeObserver redraws a still once it has one. Resizing from here
    // must not draw, or a sizeless canvas recurses forever.
    if (!cv.width || cv.width === 1) this._resize(false);
    if (cv.width <= 1 || cv.height <= 1) return;
    if (!this._colors) this._resolveColors();
    const c = this._config, col = this._colors;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const R = (Math.min(w, h) / 2) * (1 - clamp(Number(c.padding), 0, 0.45));
    const L = scr ? this._layout(scr, w, h, R) : null;
    // A story's move/resize places him, except while a corner screen holds him there.
    const P = !(scr && scr.present === "corner") && !G.atHome(this._place)
      ? G.placeAt(this._place, w, h, R) : null;
    const fs = P ? P.s : L ? L.face.s : 1;
    const Rf = R * fs;
    const lw = Math.max(1, Number(c.line_width) * Rf);
    const cx = P ? P.cx : L ? L.face.cx : w / 2, cy = P ? P.cy : L ? L.face.cy : h / 2;
    const X = (x) => cx + x * Rf, Y = (y) => cy - y * Rf;
    const faceAlpha = scr ? scr.faceAlpha : 1;
    if (scr?.face) {
      // The face as strokes, shaped by the transition, in the same units as the screen.
      const out = scr.face(shapes, { w: w / 2 / R, h: h / 2 / R });
      const a = faceAlpha * (out.alpha ?? 1);
      if (a > 0.003 && out.strokes?.length) {
        this._drawStrokes(ctx, out.strokes, cx, cy, R, a,
          { lw, palette: { line: col.face, accent: col.eye, text: col.face, dim: col.face } });
      }
    } else if (faceAlpha > 0.003) {
      if (faceAlpha < 1) ctx.globalAlpha = faceAlpha;
      ctx.lineWidth = lw;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowBlur = col.glow * lw * 3;

      // The head's outline sits just inside the drawing area, so its stroke fits.
      const hs = (Rf - lw / 2) / Rf;
      const [hx, hy] = shapes.ring;
      ctx.strokeStyle = ctx.shadowColor = col.face;
      ctx.beginPath();
      trace(ctx, shapes.head.map(([x, y]) => [X(hx + (x - hx) * hs), Y(hy + (y - hy) * hs)]));
      ctx.stroke();

      ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = col.eye;
      for (const eye of [shapes.left, shapes.right]) {
        ctx.beginPath();
        trace(ctx, eye.map(([x, y]) => [X(x), Y(y)]));
        if (c.eye_fill) ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (scr && scr.alpha > 0.003) {
      const strokes = scr.strokes(L.box.hw / R, L.box.hh / R, shapes);
      if (strokes?.length) this._drawStrokes(ctx, strokes, L.box.cx, L.box.cy, R, scr.alpha);
    }
  }

  // Where Alfie sits and what is left for the screen, in canvas pixels. `k` is
  // 0 with Alfie centred and full size, 1 with him settled in his corner.
  _layout(scr, w, h, R) {
    const c = this._config, side = Math.min(w, h);
    const m = (side / 2) * clamp(Number(c.padding), 0, 0.45);
    const full = { cx: w / 2, cy: h / 2, hw: w / 2 - m, hh: h / 2 - m };
    if (scr.present !== "corner") return { face: { cx: w / 2, cy: h / 2, s: 1 }, box: full };
    const size = clamp(Number(scr.size) || 0.3, 0.15, 0.5), Rf = R * size;
    const right = scr.corner.endsWith("right"), bottom = scr.corner.startsWith("bottom");
    const fx = right ? w - m - Rf : m + Rf, fy = bottom ? h - m - Rf : m + Rf;
    const gap = 2 * Rf + m * 0.5;
    // Cut the corner's strip off whichever side leaves the larger screen.
    const W = 2 * full.hw, H = 2 * full.hh;
    let box;
    if ((W - gap) * H >= W * (H - gap)) {
      box = { hw: (W - gap) / 2, hh: full.hh, cy: full.cy, cx: right ? m + (W - gap) / 2 : w - m - (W - gap) / 2 };
    } else {
      box = { hw: full.hw, hh: (H - gap) / 2, cx: full.cx, cy: bottom ? m + (H - gap) / 2 : h - m - (H - gap) / 2 };
    }
    const k = scr.k;
    return { face: { cx: w / 2 + (fx - w / 2) * k, cy: h / 2 + (fy - h / 2) * k, s: 1 + (size - 1) * k }, box };
  }

  // Screen strokes in the box at pixel centre (bx, by); one canvas unit is R px.
  // `face` (optional) draws the face this way instead: its line width, its colours.
  _drawStrokes(ctx, strokes, bx, by, R, alpha, face = null) {
    const c = this._config, col = this._colors;
    const lw = face ? face.lw : Math.max(1.25, Number(c.screen_line_width) * R);
    const X = (x) => bx + x * R, Y = (y) => by - y * R;
    const color = face ? face.palette : { line: col.face, text: col.text, accent: col.accent, dim: col.face };
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const st of strokes) {
      const pts = st.pts;
      if (!pts?.length) continue;
      const w = Number.isFinite(st.w) ? st.w : 1;
      const dashed = w < 0.3, dim = dashed || st.role === "dim";
      const sw = dashed ? lw : lw * clamp(w, 0.45, 2.5);
      const colr = color[st.role] || col.face;
      ctx.globalAlpha = alpha * (dim ? 0.5 : 1);
      ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = colr;
      ctx.lineWidth = sw;
      ctx.shadowBlur = col.glow * sw * 3;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(X(pts[0][0]), Y(pts[0][1]), sw * 0.9, 0, 2 * Math.PI);
        ctx.fill();
        continue;
      }
      ctx.setLineDash(dashed ? [sw * 1.2, sw * 2.6] : []);
      ctx.beginPath();
      trace(ctx, pts.map(([x, y]) => [X(x), Y(y)]), !!st.closed);
      if (st.fill) { ctx.globalAlpha = alpha * 0.3; ctx.fill(); ctx.globalAlpha = alpha * (dim ? 0.5 : 1); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  // ----------------------------------------------------------- screens

  _resetScreens() {
    this._screensRev = undefined;
    this._screens = null;      // {rev, screens, rotations, types} from alfie/screens
    this._screenIndex = new Map();
    this._data = new Map();    // screen id -> {data, error, at (ms), inflight}
    this._memo = new Map();    // screen id -> memo object for its module
    this._bad = new Set();     // screen ids whose module failed (logged once)
    this._cur = null;          // {id, tIn, tOut}: the screen on show
    this._rot = null;
    this._rotClock = 0;        // seconds of rotation time; stops while hidden
    this._override = null;
    this._lastWant = -1;
  }

  async _fetchScreens(rev) {
    this._screensRev = rev;
    try {
      const r = await this._hass.connection.sendMessagePromise({ type: "alfie/screens" });
      this._screens = r;
      this._screensRev = rev ?? r.rev;
      this._screenIndex = new Map((r.screens || []).map((s) => [s.id, s]));
      this._memo.clear();
      this._bad.clear();
      for (const d of this._data.values()) d.at = 0;   // keep what we have, fetch afresh
      this._rot = null;
      this._lastWant = -1;
    } catch (e) {
      this._screensRev = undefined;   // try again with the next scene
      if (!this._warnedScreens) { this._warnedScreens = true; console.warn("alfie: can't load screens", e); }
    }
  }

  _typeOf(screen) {
    return this._screens?.types?.[screen.type] ?? this._screens?.types?.find?.((t) => t.type === screen.type) ?? null;
  }

  async _ensureData(id) {
    const screen = this._screenIndex.get(id);
    if (!screen || !this._typeOf(screen)?.needs || !this._hass) return;
    const d = this._data.get(id) ?? { data: null, error: null, at: 0, inflight: false };
    this._data.set(id, d);
    const age = (Date.now() - d.at) / 1000;
    if (d.inflight || age < (d.error ? DATA_RETRY : DATA_STALE)) return;
    d.inflight = true;
    try {
      const r = await this._hass.connection.sendMessagePromise({ type: "alfie/screen_data", screen: id });
      d.data = r.data ?? d.data;
      d.error = r.error ?? null;
    } catch (e) {
      d.error = String(e?.message || e?.code || e);
    }
    d.at = Date.now();
    d.inflight = false;
  }

  _rotationSteps() {
    const r = this._config.rotation;
    if (this._config.mode !== "rotation" || !r) return null;
    let steps = r, face = null, transition = null;
    if (typeof r === "string") {
      const rot = this._screens?.rotations?.find((x) => x.id === r);
      if (!rot) return null;
      steps = rot.steps; face = rot.face_seconds ?? null; transition = rot.transition ?? null;
    }
    steps = (steps || []).filter((st) => (st.alfie || this._screenIndex.has(st.screen)) && Number(st.seconds) > 0);
    // A bad signal set to "add to the rotation" joins it while it is bad.
    for (const sig of this._badSignals()) {
      if (sig.in_rotation && !steps.some((st) => st.screen === sig.screen)) steps = [...steps, { screen: sig.screen, seconds: 15 }];
    }
    return steps.length ? { steps, face, transition } : null;
  }

  // Active bad signals whose screen exists, worst first (the engine's order).
  _badSignals() {
    return (this._scene?.signals || []).filter((s) => s.kind === "bad" && s.screen && this._screenIndex.has(s.screen));
  }

  // The screen id wanted at this moment, and the one after it (to prefetch).
  _wanted(dt) {
    const sc = this._scene?.screen;
    if (sc && sc.until * 1000 > Date.now() && this._screenIndex.has(sc.id)) {
      this._override = sc.id;
      return { id: sc.id, next: null };   // the rotation waits (its clock is not advanced)
    }
    if (this._scene?.story) {
      this._override = "story";
      return { id: null, next: null };    // a story has Alfie himself on show; the rotation waits
    }
    this._override = this._local?.screen ? "local" : null;
    if (this._rot === null || this._rot.stale) {
      const spec = this._rotationSteps();
      this._rot = spec ? (this._rot?.steps ? G.carry(this._rot, spec) : G.start(spec, this._rotClock)) : { steps: null };
    }
    const rot = this._rot;
    if (!rot.steps) return { id: null, next: null };
    this._rotClock += dt;
    const want = G.advance(rot, this._rotClock);
    if (want.appear) this._appear(rot);
    // Alfie's own story may show a screen while he has the stage.
    if (!want.id && this._local?.screen && this._screenIndex.has(this._local.screen.id)) {
      return { id: this._local.screen.id, next: want.next };
    }
    return want;
  }

  // ----------------------------------------------------------- Alfie's own story

  // Alfie comes on in this card's rotation: fetch the most relevant story
  // (or the card's choice) and play it here only. The rotation holds his
  // phase until it is known, then for as long as it runs.
  async _appear(rot) {
    const pick = this._config.appear_story ?? "auto";
    this._endLocal(true);
    if (pick === "none" || !this._hass) return;
    rot.hold = 1e9;
    let r = null;
    try {
      r = await this._hass.connection.sendMessagePromise(
        { type: "alfie/story/expand", ...(pick === "auto" ? {} : { story: pick }) });
    } catch (e) {
      console.warn(`Alfie: can't play the story ${pick}: ${e?.message || e}`);
    }
    if (this._rot !== rot) return;           // the rotation was rebuilt meanwhile
    const actions = r?.actions || [];
    rot.hold = G.storyLength(actions);
    if (!actions.length || this._scene?.story) return;
    this._local = { actions, t0: this._now(), last: -1, expression: null, blend: 0, place: null, screen: null };
    this._stepLocal(this._local.t0);
  }

  // One frame of this card's own story: new animations fire, and a new
  // expression is worn; when it is over Alfie goes back to the scene's.
  _stepLocal(t) {
    const L = this._local, face = this._faceDoc;
    const el = t - L.t0;
    const r = G.runStory(L.actions, L.last, el);
    L.last = el;
    for (const name of r.fire) this.playLocal(name);
    L.place = r.place;
    L.screen = r.screen;
    if (r.expression !== L.expression && face && !this._exprPreview) {
      this._applyExpression(face, r.expression in face.expressions ? r.expression : this._scene?.expression, t, r.blend);
    }
    L.expression = r.expression;
    L.blend = r.blend;
    if (r.done) this._endLocal(true);
  }

  _endLocal(restore) {
    if (!this._local) return;
    this._local = null;
    if (restore && this._faceDoc && this._scene && !this._exprPreview) {
      this._applyExpression(this._faceDoc, this._scene.expression, this._now(), 0.6);
    }
  }

  _transitionStyle() {
    const c = this._config;
    const sc = this._scene?.screen;
    let style = (this._override && this._override === sc?.id && sc.transition) || c.transition || this._rot?.transition || "fade";
    if (style === "random") style = I.RANDOM_STYLES[Math.floor(Math.random() * I.RANDOM_STYLES.length)];
    return I.STYLES.includes(style) ? style : "fade";
  }

  // Decide what is on show at `t` and build the draw description for it, or null
  // when it is Alfie alone (the common, free case).
  _presentation(t, dt) {
    if (this._config.mode === "companion" && !this._scene?.screen && !this._cur) return null;
    const want = this._wanted(dt);
    if (t - this._lastWant > 1 && this._hass) {
      this._lastWant = t;
      if (want.id) this._ensureData(want.id);
      if (want.next) this._ensureData(want.next);
    }
    let cur = this._cur;
    const c = this._config, sc = this._scene?.screen;
    // A story step may say how its screen is presented; otherwise the card does.
    const presentOf = (id) => {
      if (this._override === "local" && this._local?.screen?.id === id) {
        const lp = this._local.screen.present;
        return lp && lp !== "card" ? lp : c.present;
      }
      return (this._override === id && sc?.id === id && sc.present) || c.present;
    };
    if (cur && cur.tOut == null && want.id !== cur.id) {
      // Screen to screen: the old one leaves and the next arrives, with Alfie
      // kept as he is (gone, or in his corner) throughout.
      cur.tOut = t;
      cur.swap = !!want.id && presentOf(want.id) === cur.present;
    }
    if (cur?.swap && cur.tOut != null && !want.id) cur.swap = false;   // Alfie wants the stage after all
    if (!cur && want.id) cur = this._cur = { id: want.id, tIn: t, tOut: null, style: this._transitionStyle(), present: presentOf(want.id) };
    if (!cur) return null;
    let corner = cur.present === "corner";
    let leaving = cur.tOut != null;
    let durS = I.SECONDS[cur.style] ?? 0.6, durM = corner && !(leaving ? cur.swap : cur.held) ? CORNER_SECONDS : 0;
    let age = t - (leaving ? cur.tOut : cur.tIn);
    if (leaving && age >= Math.max(durS, durM)) {
      this._cur = null;
      if (!(cur.swap && want.id)) return null;
      cur = this._cur = { id: want.id, tIn: t, tOut: null, style: this._transitionStyle(), present: presentOf(want.id), held: true };
      corner = cur.present === "corner";
      leaving = false;
      durS = I.SECONDS[cur.style] ?? 0.6;
      durM = 0;
      age = 0;
    }
    // Alfie stays away while one screen hands over to the next.
    const away = leaving ? !!cur.swap : !!cur.held;
    const uS = durS ? clamp(age / durS, 0, 1) : 1, uM = durM ? clamp(age / durM, 0, 1) : 1;
    const p = I.presence(cur.style, uS, leaving);
    const k = corner ? (away ? 1 : leaving ? 1 - F.spring(uM) : F.spring(uM)) : 0;
    return this._describe(cur.id, cur.style, p, leaving, k, t, cur.present, away);
  }

  _describe(id, style, p, leaving, k, t, present = this._config.present, away = false) {
    const c = this._config, corner = present === "corner";
    const screen = this._screenIndex.get(id);
    // In "hand over" the face goes by the same transition the screen comes by
    // (drawn, zoomed, wiped away...); fade and cut just change its alpha, and
    // morph turns the face itself into the screen. Between two screens he stays away.
    const faceAlpha = corner ? 1 : away ? 0 : I.faceAlpha(style, p);
    const shaped = !corner && !away && !["cut", "fade", "morph"].includes(style) && p > 0 && p < 1;
    return {
      present, corner: c.corner, size: c.corner_size, k, faceAlpha,
      alpha: I.apply(style, p, leaving, [], null).alpha,
      face: shaped ? (shapes, box) => I.apply(style, 1 - clamp(p, 0, 1), !leaving, I.faceStrokes(shapes), box) : null,
      strokes: (hw, hh, shapes) => this._screenStrokes(screen, hw, hh, t, style, p, leaving,
        style === "morph" && shapes && !corner && !away ? I.faceStrokes(shapes) : null),
    };
  }

  // The strokes for a screen in a box, never throwing: a module that fails
  // gets its title drawn instead and a single log line.
  _screenStrokes(screen, hw, hh, tCard, style, p, leaving, from = null) {
    const box = { w: hw, h: hh };
    let strokes = null;
    const d = this._data.get(screen.id);
    const mod = screen.__mod;
    if (!mod && !this._bad.has(screen.id) && !screen.__loading) {
      screen.__loading = true;
      Promise.all([S.fontReady() ? 0 : S.loadFont(), S.loadScreen(screen.type)]).then(([, m]) => { screen.__mod = m; })
        .catch((e) => this._fail(screen, e)).finally(() => { screen.__loading = false; });
    }
    if (mod && !this._bad.has(screen.id) && S.fontReady()) {
      try {
        if (!this._memo.has(screen.id)) this._memo.set(screen.id, {});
        strokes = mod.draw({
          w: hw, h: hh, t: Date.now() / 1000, data: d?.data ?? null,
          options: this._withDefaults(screen), states: this._hass?.states ?? {}, config: this._hass?.config ?? {},
          memo: this._memo.get(screen.id), S,
        });
      } catch (e) {
        this._fail(screen, e);
      }
    }
    if (!strokes) strokes = S.fontReady() ? this._titleStrokes(screen, hw, hh) : [];
    return I.apply(style, p, leaving, strokes, box, from).strokes;
  }

  _fail(screen, e) {
    if (this._bad.has(screen.id)) return;
    this._bad.add(screen.id);
    console.warn(`alfie: screen "${screen.id}" (${screen.type}) failed`, e);
  }

  _titleStrokes(screen, hw, hh) {
    const words = S.title(screen.title || screen.type || "");
    const ht = Math.min(0.3, hh * 0.5);
    return S.wrap(words, (2 * hw * 0.9) / ht).flatMap((l, i, a) => S.text(l, ht, 0, ((a.length - 1) / 2 - i) * 1.6 * ht, { role: "dim" }));
  }

  _withDefaults(screen) {
    const type = this._typeOf(screen);
    return withDefaults(type, screen.options);
  }

  // For the panel's live preview: play an animation on this card only (the
  // service would play it on every display), and try a personality without
  // rebuilding the card.
  async playLocal(name) {
    const face = await loadFace();
    if (face.compiled[name]) this._face.play(face.compiled[name]);
  }

  // Panel previews, local to this card and never sent anywhere. null ends one.
  // previewLook(look): a look instead of the scene's; previewExpression(name):
  // hold an expression; previewEnergy(value): hold an energy (before liveliness).
  async previewLook(look) {
    this._lookPreview = look && typeof look === "object" ? look : null;
    if (this._applyLook()) await this._replay();
  }

  async previewExpression(name) {
    this._exprPreview = name || null;
    await this._replay();
  }

  async previewEnergy(value) {
    this._energyPreview = value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value);
    await this._replay();
  }

  // Re-run the scene through the current previews (or, with no scene, hold them).
  async _replay() {
    if (this._scene) return this._onScene(this._scene);
    const face = await loadFace();
    this._personality(face);
    if (this._energyPreview !== null) this._face.setEnergy(this._energyPreview * this._config.liveliness, this._now());
    if (this._exprPreview) this._applyExpression(face, this._exprPreview, this._now());
  }

  async setPersonality(personality) {
    this._user = { ...this._user, personality };
    this._config = { ...this._config, personality };
    const face = await loadFace();
    if (this._scene) this._onScene(this._scene);
    else this._personality(face);
  }

  // For tests and the dev harness: draw one still frame, no clock, no HA.
  // {expression, animation, u (seconds in), energy, blink (0..1)}
  async renderStill({ expression = "neutral", animation = null, u = 0, energy = 0.8, blink = 0 } = {}) {
    const face = await loadFace();
    this._still = true;
    this._running = false;
    this._face = new FaceState();
    const p = this._personality(face);
    this._face.energy = this._face.energyTarget = Math.max(0.05, energy + p.energy_bias);
    this._applyExpression(face, expression, 0);
    const anim = animation ? face.compiled[animation] : null;
    const channels = anim ? anim.script(u) : {};
    if (anim) for (const k of MOTION) if (channels[k]) channels[k] *= this._face.amp;
    const pose = F.blinked(this._face.target, blink);
    const parts = this._face.targetParts;
    this._stillFrame = this._frame(0, { pose, parts, channels, noBreath: true, noBlink: true });
    this._resize();
    this._draw(this._stillFrame);
  }

  // For tests and the dev harness: one still frame of a screen with Alfie, no
  // clock, no HA. {type, options, typeInfo (the type's JSON, for defaults), data,
  // t (epoch s), present, corner, u (0..1, how far the screen has arrived),
  // expression, states, config (stand-ins for hass.states and hass.config)}.
  // Uses the fade transition.
  async renderScreenStill({ type, options = {}, typeInfo = null, data = null, t = 0, present = this._config.present,
    corner = this._config.corner, u = 1, expression = "neutral", title = null, states = {}, config = {} } = {}) {
    const face = await loadFace();
    await S.loadFont();
    const mod = await S.loadScreen(type);
    this._still = true;
    this._running = false;
    this._face = new FaceState();
    const p = this._personality(face);
    this._face.energy = this._face.energyTarget = Math.max(0.05, 0.8 + p.energy_bias);
    this._applyExpression(face, expression, 0);
    this._stillFrame = this._frame(0, { pose: this._face.target, parts: this._face.targetParts, channels: {}, noBreath: true, noBlink: true });
    const opts = withDefaults(typeInfo, options);
    const pres = I.presence("fade", u, false);
    const k = present === "corner" ? F.spring(u) : 0;
    this._user = { ...this._user, present, corner };
    this._config = { ...this._config, present, corner };
    this._stillScr = {
      present, corner, size: this._config.corner_size, k,
      faceAlpha: present === "corner" ? 1 : 1 - pres, alpha: pres,
      strokes: (hw, hh) => {
        try {
          return mod.draw({ w: hw, h: hh, t, data, options: opts, states, config, memo: {}, S });
        } catch (e) {
          console.error(e);
          return this._titleStrokes({ title: title || type }, hw, hh);
        }
      },
    };
    this._resize();
    this._draw(this._stillFrame, this._stillScr);
  }
}

// HA installs a scoped custom-element registry polyfill; defining before it
// is ready breaks the card in some clients.
customElements.whenDefined("home-assistant").then(() => {
  if (!customElements.get("alfie-card")) customElements.define("alfie-card", AlfieCard);
});

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "alfie-card")) {
  window.customCards.push({
    type: "alfie-card",
    name: "Alfie",
    description: "Alfie's face: the lively soul of your home.",
    preview: true,
  });
}
