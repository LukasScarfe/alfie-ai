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
const FACE_URL = new URL(`./alfie-face.json${V}`, import.meta.url);

let faceData = null;
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
};

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
  }

  // How the current energy shapes motion: speed, size and settle.
  get rate() { return 0.65 + 0.55 * this.energy; }
  get amp() { return 0.6 + 0.55 * this.energy; }

  setEnergy(e, t) {
    this.energyTarget = clamp(e, 0, 1.5);
    this.energyAt = t;
  }

  setExpression(name, pose, t, parts) {
    if (this.expression === name && this.targetParts === parts) return;
    const first = this.expression === null;
    this.start = first ? pose : this.poseAt(t);
    this.startParts = first ? parts : this.partsAt(t);
    this.target = pose;
    this.targetParts = parts;
    this.expression = name;
    this.since = t;
    // Low energy: a slower blend that settles without bouncing.
    this.blendLength = F.GEOMETRY.blend / this.rate;
    this.damping = clamp(F.GEOMETRY.damping + 0.35 * (1 - this.energy), 0.2, 0.92);
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

class AlfieCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULTS };
    this._face = new FaceState();
    this._scene = null;
    this._lastAnimId = null;
    this._visible = true;
    this._running = false;
    this._still = false;
    this._last = 0;
    this._t0 = performance.now();
    this._error = null;
  }

  static getStubConfig() {
    return { style: "neon" };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    for (const k of ["line_width", "padding", "aspect", "fps", "liveliness"]) {
      if (config[k] !== undefined && !(Number(config[k]) >= 0)) throw new Error(`${k} must be a number`);
    }
    if (config.style && !STYLES[config.style]) {
      throw new Error(`style must be one of ${Object.keys(STYLES).join(", ")}`);
    }
    if (config.shapes !== undefined && (typeof config.shapes !== "object" || config.shapes === null)) {
      throw new Error("shapes must be a mapping of head / eye / left_eye / right_eye to shape specs");
    }
    this._config = { ...DEFAULTS, ...config };
    this._partsCache = null;
    if (this._face.expression !== null && faceData) {
      const name = this._face.expression;
      this._face.expression = null;   // re-apply with the new shapes, no blend
      faceData.then((face) => this._applyExpression(face, name, this._now()));
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
    this._error = null;
    this._showError();
    const t = this._now();
    this._face.setEnergy((scene.mood?.energy ?? 0.8) * this._config.liveliness, t);
    this._applyExpression(face, scene.expression, t);
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

  _applyExpression(face, name, t) {
    if (!(name in face.expressions)) name = "neutral";
    const e = face.expressions[name];
    this._face.setExpression(name, F.poseOf(e), t, this._parts(face, e));
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

  _resize() {
    const cv = this._canvas;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cv.clientWidth * dpr));
    const h = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    if (this._still) this._draw(this._stillFrame);
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
    this._colors = { face, eye: c.eye_color ? probe(c.eye_color) : face, glow: c.glow ?? st.glow };
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
        this._draw(this._frame(t));
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
      p = F.blinked(p, F.blink(t, F.GEOMETRY.blink_slot * slow, F.GEOMETRY.blink * slow));
    }
    return F.faceShapes(p, shape.eyes, shape.face, F.GEOMETRY, parts);
  }

  _draw(shapes) {
    const cv = this._canvas;
    if (!cv || !shapes) return;
    if (!cv.width || cv.width === 1) this._resize();
    if (!this._colors) this._resolveColors();
    const c = this._config, col = this._colors;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const R = (Math.min(w, h) / 2) * (1 - clamp(Number(c.padding), 0, 0.45));
    const lw = Math.max(1, Number(c.line_width) * R);
    const cx = w / 2, cy = h / 2;
    const X = (x) => cx + x * R, Y = (y) => cy - y * R;
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowBlur = col.glow * lw * 3;

    // The head's outline sits just inside the drawing area, so its stroke fits.
    const hs = (R - lw / 2) / R;
    const [hx, hy] = shapes.ring;
    ctx.strokeStyle = ctx.shadowColor = col.face;
    ctx.beginPath();
    shapes.head.forEach(([x, y], i) => {
      const px = X(hx + (x - hx) * hs), py = Y(hy + (y - hy) * hs);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = col.eye;
    for (const eye of [shapes.left, shapes.right]) {
      ctx.beginPath();
      eye.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.closePath();
      if (c.eye_fill) ctx.fill();
      ctx.stroke();
    }
  }

  // For tests and the dev harness: draw one still frame, no clock, no HA.
  // {expression, animation, u (seconds in), energy, blink (0..1)}
  async renderStill({ expression = "neutral", animation = null, u = 0, energy = 0.8, blink = 0 } = {}) {
    const face = await loadFace();
    this._still = true;
    this._running = false;
    this._face = new FaceState();
    this._face.energy = this._face.energyTarget = energy;
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
