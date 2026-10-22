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
const IC = await import(`./alfie-icons.js${V}`);
const FACE_URL = new URL(`./alfie-face.json${V}`, import.meta.url);

// Icon names in screen text and plot markers (design.md "Icons"): the strokes
// once the path is in; meanwhile null, and its arrival redraws cached screens.
const iconWaits = new Set();
S.setIconSource((name, { fill = "soft" } = {}) => {
  if (IC.failed(name)) return false;
  const got = IC.strokesFor(name, { fill });
  if (!got && !iconWaits.has(name)) {
    iconWaits.add(name);
    IC.iconPath(name).then(() => { iconWaits.delete(name); S.iconLoaded(); });
  }
  return got;
});

let faceData = null;

// An icon on show as a screen (transform and beside; design.md "Icons"): the
// icon's outlines fitted to the box. Its options are the icon's look.
const ICON_MODULE = {
  draw({ w, h, options: o }) {
    const st = IC.strokesFor(o.name, { role: o.color || "line", fill: o.fill });
    return st ? IC.placed(st, Math.min(w, h) * ICON_FIT * clamp(Number(o.size) || 1, 0.3, 2)) : [];
  },
};
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

// His own expressions and animations (the config's, from alfie/face) laid
// over the shipped ones. The face data is shared by every card on the page,
// as there is one Alfie; `face.rev` changes with it, so expressions re-pose.
function layFace(face, extra) {
  face.builtin ??= { expressions: face.expressions, animations: face.animations, compiled: face.compiled };
  const b = face.builtin, anims = extra?.animations || {};
  face.expressions = { ...b.expressions, ...(extra?.expressions || {}) };
  face.animations = { ...b.animations, ...anims };
  face.compiled = { ...b.compiled };
  for (const [k, a] of Object.entries(anims)) {
    try { face.compiled[k] = F.compileAnimation(a); } catch (e) { console.warn(`Alfie: animation ${k}:`, e); }
  }
  face.rev = (face.rev || 0) + 1;
}
const extrasFetch = new Map();   // face_rev -> Promise of alfie/face, shared by the cards

// Render styles set colour defaults; every colour can still be set alone.
const STYLES = {
  neon: { color: "#4dffa0", glow: 0.6 },
  flat: { color: "var(--primary-text-color, #e1e1e1)", glow: 0 },
  crt: { color: "#7dff8a", glow: 1.0 },
  theme: { color: "var(--primary-color, #03a9f4)", glow: 0 },
  // Their own paper too (`bg`, unless a background is set), and effects:
  // `grid` lines behind, a `rough` hand-drawn line, `soft` fill, `lw` thicker or finer.
  blueprint: { color: "#eaf4ff", glow: 0.15, bg: "#0e3a63", grid: true, lw: 0.75, accent: "#ffd166" },
  chalk: { color: "#f4f1e8", glow: 0, bg: "#26342b", rough: true, accent: "#ffc2d4" },
  ink: { color: "#1c1c1c", glow: 0, bg: "#f4efe2", lw: 1.45, accent: "#b03a2e" },
  pastel: { color: "#f49ac2", eye: "#7fb7e6", text: "#6b5b73", accent: "#69c9a0", glow: 0.25, bg: "#fff4f8", soft: 0.18 },
};
const backgroundOf = (c) => (c.background && c.background !== "none" ? c.background : (STYLES[c.style] || STYLES.neon).bg || null);

// A hand-drawn line (the chalk style): points every few pixels, each nudged by
// a slow wobble of the distance along the line, so straight edges wobble too,
// and a point keeps its nudge from frame to frame (no shimmer). `seed` makes a
// second, different pass.
function roughen(pts, amp, seed = 0, closed = true) {
  const out = [], step = Math.max(2, amp * 4);
  let s = 0;
  const nudge = ([x, y], d) => [x + amp * Math.sin(d * 0.23 / amp + seed * 4.1) * Math.cos(d * 0.071 / amp + seed),
    y + amp * Math.sin(d * 0.19 / amp + seed * 2.7 + 1) * Math.cos(d * 0.053 / amp + seed * 1.3)];
  const n = pts.length, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const f = j / k;
      out.push(nudge([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], s + len * f));
    }
    s += len;
  }
  if (!closed && n) out.push(nudge(pts[n - 1], s));
  return out;
}

const DEFAULTS = {
  style: "neon",
  ring_color: null,       // the ring; null takes the style's colour
  eye_color: null,        // null takes ring_color
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
  display: "companion",   // companion: just Alfie (screens only on a show_screen); rotation: run `rotation`
  rotation: null,         // a rotation id, or an inline [{screen, seconds}]
  present: "handover",    // handover: Alfie leaves while a screen shows; corner: he shrinks aside and stays alive
  corner: "bottom_right", // bottom_right | bottom_left | top_right | top_left
  corner_size: 0.3,       // Alfie's size in the corner, share of his full size (0.15 to 0.5)
  transition: null,       // an intro style; null takes the rotation's, then fade
  follow_mode: true,      // false: this card ignores house modes (hiding Alfie, swapping the rotation)
  appear_story: "auto",   // rotation: the story Alfie plays here when he appears in it; auto: the most relevant (mood-led), none, or a story id
  text_color: null,       // screen text; null takes the face colour
  accent_color: null,     // screen accents; null takes the face colour
  line_color: null,       // screen lines (plots, bars, pictures); null takes the style's, then the face colour
  tap_action: { action: "why" },          // why: his why panel over the card; or any HA action (navigate, more-info, …)
  hold_action: { action: "more-info" },
  double_tap_action: { action: "none" },
  entity: null,           // for more-info and toggle; null finds his mood sensor
  screen_line_width: 0.02, // ring radii: screens draw finer than the face
  icons: true,            // false: this card ignores icons (alfie.show_icon, a story's icon steps)
  voice: "all",           // which voice satellites bring Alfie on here: all, chosen (voice_satellites) or none
  voice_satellites: null, // for voice: chosen, a list of assist_satellite entity ids
  speak_style: null,      // pulse | eyes | both | wave while a satellite answers; null takes Alfie's Voice setting
  speak_strength: null,   // how much speaking shows, 0.2..3; null takes Alfie's
  vector_out: false,      // true: each frame's strokes go out as an "alfie-vector" event (the oscilloscope feed)
  paint: true,            // false: draw nothing on the canvas (a headless vector feed skips the cost)
  vector_order: "tour",   // tour: the feed's strokes in the order with the shortest beam jumps; drawn: as painted
  vector_condense: "lines", // the feed's condense: lines between random points (as xy-bench's own), or dots
};

// A 2D context that does nothing, for `paint: false`: the drawing code runs as
// ever, so the vector feed sees exactly what a painted card would show.
const NO_PAINT = new Proxy({}, { get: () => () => {}, set: () => true });

const INTRO_LINES = { lines: true };
const TOUR_MAX = 200;   // a frame with more strokes than this goes out as drawn (solving it costs)

const DISPLAYS = ["companion", "rotation"];
const PRESENTS = ["handover", "corner"];
const CORNERS = ["bottom_right", "bottom_left", "top_right", "top_left"];
const CORNER_SECONDS = 0.8;   // how long the face takes to move to or from its corner
const ICON_FIT = 0.8;         // an icon at size 1 fills this share of its box (or of his ring)
const BADGE_STYLE = "zoom";   // how a badge comes and goes when its icon names no transition
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

  // The animation channels at `t`, scaled by energy, or {}. A scrub (the
  // panel's animation editor) holds one moment of an animation instead.
  channels(t) {
    if (this.scrub) {
      const c = this.scrub.anim.script(this.scrub.u);
      for (const k of MOTION) if (c[k]) c[k] *= this.amp;
      return c;
    }
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
  if (ctx === NO_PAINT) return;   // the vector feed taps the points; there is no path to build
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
    this._heldAnim = null;     // a trigger story animation waiting for Alfie to be back
    this._voiceTry = null;     // the panel's Try it: a pretend satellite phase
    this._voicePhase = null;   // the followed satellite's phase here: listening, processing, responding
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
    config = L.renameOld(config);
    for (const k of ["line_width", "padding", "aspect", "fps", "liveliness"]) {
      if (config[k] !== undefined && !(Number(config[k]) >= 0)) throw new Error(`${k} must be a number`);
    }
    for (const [k, list] of [["display", DISPLAYS], ["present", PRESENTS], ["corner", CORNERS]]) {
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
    if (scene.face_rev && scene.face_rev !== this._faceRev) this._fetchFace(face, scene.face_rev);
    if (this._whyEl && !this._whyEl.hidden) this._whyEl.innerHTML = this._whyHtml();
    if (scene.screen?.icon && this._config.icons !== false) this._iconScreen(scene.screen.id, scene.screen.icon);
    this._syncBadges(scene.icons);
    // What is wrong (and which of it asks to join the rotation) reshapes the rotation.
    const badKey = (scene.signals || []).filter((s) => s.kind === "bad")
      .map((s) => `${s.id}:${s.screen}:${s.in_rotation ? 1 : 0}`).join(",");
    if (badKey !== this._badKey) {
      this._badKey = badKey;
      if (this._rot) this._rot.stale = true;
    }
    // A house mode may swap this card's rotation; the card's own comes back where it was.
    // "pause" just holds the clock (see _wanted).
    const modeRot = this._modeRotation(), was = this._modeRot ?? "";
    if (modeRot !== was) {
      const isId = (x) => x !== "" && x !== "pause";
      this._modeRot = modeRot;
      if (isId(was) && this._ownRot) {
        this._rot = this._ownRot;
        this._rot.t0 += this._rotClock - this._ownAt;   // resume where it was
        this._rot.stale = true;
      } else if (isId(was)) this._rot = null;
      this._ownRot = null;
      if (isId(modeRot)) {
        this._ownRot = this._rot?.steps ? this._rot : null;
        this._ownAt = this._rotClock;
        this._rot = null;
      }
    }
    this._wake();
    const t = this._now();
    const global = this._global = F.personalityOf(scene.personality, face.personalities);
    const p = this._personality(face, global);
    // The engine's energy already has Alfie's own bias in it; a card with its
    // own personality swaps that bias for its own.
    const energy = (scene.mood?.energy ?? 0.8) - global.energy_bias + p.energy_bias;
    this._face.setEnergy(Math.max(0.05, this._energyPreview ?? energy) * this._config.liveliness, t);
    if (scene.story) this._endLocal(false);   // a trigger's story beats this card's own
    this._faceDoc = face;
    // A satellite he follows here: he takes the face role (design.md "Voice").
    const voice = this._voice(), phase = voice?.state ?? null;
    if (phase && !this._voicePhase) this._endLocal(false);
    const vlook = voice?.look || {};
    const attentive = (phase === "listening" || phase === "processing") && !scene.story
      ? vlook.listening_expression || null : null;
    this._applyExpression(face, this._exprPreview ?? attentive ?? this._local?.expression ?? scene.expression, t,
      scene.story?.blend || this._local?.blend || 0);
    if (phase !== this._voicePhase) {
      this._voicePhase = phase;
      if (phase === "listening" && face.compiled[vlook.listening_animation]) this._face.play(face.compiled[vlook.listening_animation]);
    }
    const a = scene.animation;
    if (a && a.id !== this._lastAnimId) {
      const first = this._lastAnimId === null;
      this._lastAnimId = a.id;
      const age = (scene.now ?? Date.now() / 1000) - a.at;
      if (age < ANIMATION_FRESH && face.compiled[a.name] && !(first && age > 1)) {
        // A trigger story's next beat waits until Alfie is back from its screen.
        if (this._returning(true)) this._heldAnim = a.name;
        else this._face.play(face.compiled[a.name]);
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
    // The background and the aspect live in the built CSS.
    const css = (c) => `${backgroundOf(c) || ""}|${Number(c.aspect) || 1}`;
    const before = css(this._config);
    this._config = L.effectiveConfig(DEFAULTS, look, this._user);
    this._colors = null;
    this._partsCache = null;
    if (css(this._config) !== before) this._build();
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
    this._face.setExpression(name, pose, t, this._parts(face, e), `${name}|${k}|${face.rev || 0}`, blend);
  }

  // The config's expressions and animations, once per face_rev for the page.
  async _fetchFace(face, rev) {
    this._faceRev = rev;
    if (!extrasFetch.has(rev)) {
      extrasFetch.set(rev, this._hass.connection.sendMessagePromise({ type: "alfie/face" }).catch((e) => {
        extrasFetch.delete(rev);
        throw e;
      }));
    }
    try {
      const r = await extrasFetch.get(rev);
      if (face.savedExtras !== r) {
        face.savedExtras = r;
        if (!face.previewing) layFace(face, r);
      }
      this._replay();
    } catch (e) {
      this._faceRev = undefined;     // try again with the next scene
      console.warn("Alfie: can't load his expressions", e);
    }
  }

  // The panel's draft expressions and animations on every card of the page,
  // before saving; null goes back to the saved ones.
  async previewFace(extra) {
    const face = await loadFace();
    face.previewing = !!extra;
    layFace(face, extra || face.savedExtras || null);
    this._replay();
  }

  // The unit outlines for an expression: the face's shapes, this card's
  // `shapes` over them, the expression's own eye shapes over those. Memoised,
  // so the same outlines are the same objects (and a re-sent scene is free).
  _parts(face, expr) {
    const spec = { ...face.shapes, ...(this._config.shapes || {}) };
    // An expression's own `eye` beats the look's separate eyes (heart eyes on both).
    if (expr.shapes?.eye) { delete spec.left_eye; delete spec.right_eye; }
    Object.assign(spec, expr.shapes || {});
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
    const bg = backgroundOf(c);
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card, .bare { overflow: hidden; height: 100%; ${bg ? `background: ${bg};` : ""} }
        .wrap { position: relative; width: 100%; aspect-ratio: ${Number(c.aspect) || 1}; }
        canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
        .msg { position: absolute; inset: auto 0 8px 0; text-align: center; font: 13px sans-serif;
               color: var(--secondary-text-color, #aaa); }
        .wrap.tappable { cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .why { position: absolute; inset: 0; overflow: auto; padding: 14px 16px; box-sizing: border-box;
               background: color-mix(in srgb, var(--card-background-color, #1c1c1c) 93%, transparent);
               color: var(--primary-text-color, #e1e1e1); font: 13px/1.45 var(--paper-font-body1_-_font-family, sans-serif); }
        .why[hidden] { display: none; }
        .why h3 { margin: 0 0 2px; font-size: 16px; font-weight: 500; }
        .why h4 { margin: 10px 0 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
                  color: var(--secondary-text-color, #aaa); font-weight: 500; }
        .why p { margin: 0; } .why ul { margin: 0; padding-left: 18px; }
        .why .bad { color: var(--error-color, #db4437); } .why .good { color: var(--success-color, #43a047); }
        .why .v { color: var(--secondary-text-color, #aaa); }
      </style>
      ${c.card ? "<ha-card>" : '<div class="bare">'}
        <div class="wrap"><canvas></canvas><div class="msg"></div><div class="why" hidden></div></div>
      ${c.card ? "</ha-card>" : "</div>"}`;
    this._canvas = this.shadowRoot.querySelector("canvas");
    this._msg = this.shadowRoot.querySelector(".msg");
    this._whyEl = this.shadowRoot.querySelector(".why");
    this._gestures(this.shadowRoot.querySelector(".wrap"));
    this._ro?.disconnect();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this._canvas);
    this._colors = null;
    this._showError();
  }

  // ------------------------------------------------------------ tap, hold, double tap

  // Tap, hold (half a second) and double tap, each to its action. A tap waits
  // for a second one only when there is a double-tap action.
  _gestures(wrap) {
    if (!wrap) return;
    const act = (k) => this._config[`${k}_action`]?.action || "none";
    wrap.classList.toggle("tappable", ["tap", "hold", "double_tap"].some((k) => act(k) !== "none"));
    let holdTimer = null, held = false, lastTap = 0, tapTimer = null, from = null;
    wrap.addEventListener("pointerdown", (e) => {
      if (this._still || e.button > 0) return;
      held = false;
      from = [e.clientX, e.clientY];
      holdTimer = setTimeout(() => { held = true; this._act("hold"); }, 500);
    });
    const cancel = () => { clearTimeout(holdTimer); holdTimer = null; };
    // A drag (scrolling the why panel, say) is no tap.
    wrap.addEventListener("pointermove", (e) => { if (holdTimer && from && Math.hypot(e.clientX - from[0], e.clientY - from[1]) > 10) cancel(); });
    wrap.addEventListener("pointerleave", cancel);
    wrap.addEventListener("pointercancel", cancel);
    wrap.addEventListener("pointerup", (e) => {
      if (this._still || !holdTimer) return;
      cancel();
      if (held) return;
      e.preventDefault();
      if (act("double_tap") === "none") { this._act("tap"); return; }
      const now = Date.now();
      if (now - lastTap < 250) { clearTimeout(tapTimer); lastTap = 0; this._act("double_tap"); return; }
      lastTap = now;
      tapTimer = setTimeout(() => this._act("tap"), 250);
    });
  }

  // One gesture's action: "why" is his own panel; anything else goes to HA
  // as a hass-action event, the way HA's own cards do it.
  _act(kind) {
    const cfg = this._config[`${kind}_action`];
    if (!cfg || cfg.action === "none") return;
    if (this._whyEl && !this._whyEl.hidden) { this._showWhy(false); if (kind === "tap") return; }
    if (cfg.action === "why") { this._showWhy(true); return; }
    const entity = this._config.entity || Object.keys(this._hass?.states || {})
      .find((e) => e.startsWith("sensor.") && e.endsWith("_mood") && "reason" in (this._hass.states[e].attributes || {})) || "sensor.alfie_mood";
    this.dispatchEvent(new CustomEvent("hass-action", { bubbles: true, composed: true,
      detail: { config: { entity, [`${kind}_action`]: cfg }, action: kind } }));
  }

  // The why panel: what he feels and why, what is on show and why, the house mode.
  // It stays until tapped (or 20 s), and refreshes with the scene while open.
  _showWhy(on) {
    const el = this._whyEl;
    if (!el) return;
    clearTimeout(this._whyTimer);
    el.hidden = !on;
    if (!on) return;
    el.innerHTML = this._whyHtml();
    this._whyTimer = setTimeout(() => this._showWhy(false), 20000);
  }

  _whyHtml() {
    const s = this._scene, st = this._hass?.states || {};
    const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
    const human = (v) => String(v || "").replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());
    if (!s) return `<h3>Alfie</h3><p>Not connected to Alfie yet.</p>`;
    const level = human(s.mood?.level);
    const value = (e) => {
      const x = st[e];
      if (!x) return `<span class="v">${esc(e)}: unknown</span>`;
      const unit = x.attributes?.unit_of_measurement ? ` ${x.attributes.unit_of_measurement}` : "";
      return `${esc(x.attributes?.friendly_name || e)} <span class="v">${esc(x.state)}${esc(unit)}</span>`;
    };
    const sig = (x) => `<li><span class="${x.kind === "bad" ? "bad" : "good"}">${esc(x.name)}</span>
      ${x.entities?.length ? `<br>${x.entities.slice(0, 4).map(value).join("<br>")}${x.entities.length > 4 ? ` <span class="v">and ${x.entities.length - 4} more</span>` : ""}` : ""}</li>`;
    const bad = (s.signals || []).filter((x) => x.kind === "bad"), good = (s.signals || []).filter((x) => x.kind !== "bad");
    const title = (id) => this._screenIndex?.get(id)?.title || human(id);
    let showing = "Just him.";
    if (s.screen && this._override === s.screen.id) {
      showing = s.story ? `${esc(title(s.screen.id))}, in the story ${esc(human(s.story.id))}${s.story.reason ? `: ${esc(s.story.reason)}` : ""}.`
        : `${esc(title(s.screen.id))}, as an automation asked.`;
    }
    else if (s.story) showing = `The story ${esc(human(s.story.id))}${s.story.reason ? `: ${esc(s.story.reason)}` : ""}.`;
    else if (this._override === "voice") showing = "Listening to a voice assistant.";
    else if (this._cur?.id && this._rot?.steps) showing = `${esc(title(this._cur.id))}, in turn in the rotation.`;
    else if (this._rot?.steps) showing = "His turn in the rotation.";
    const mode = s.mode_info || {};
    return `<h3>${esc(s.name || "Alfie")} is ${esc(level.toLowerCase())}${s.asleep ? ", and asleep" : ""}</h3>
      <p>${esc(s.reason || "Nothing is wrong or right.")}</p>
      ${bad.length ? `<h4>What's wrong</h4><ul>${bad.map(sig).join("")}</ul>` : ""}
      ${good.length ? `<h4>What's good</h4><ul>${good.map(sig).join("")}</ul>` : ""}
      <h4>On show</h4><p>${showing}</p>
      ${mode.name == null ? "" : `<h4>House mode</h4><p>${esc(mode.name)}${mode.why?.length ? ` <span class="v">(${mode.why.map((e) => esc(st[e]?.attributes?.friendly_name || e)).join(", ")})</span>` : ""}</p>`}
      ${s.holds?.rotation ? `<h4>Rotation</h4><p>${esc(human(s.holds.rotation.value))}, as an automation asked${s.holds.rotation.until ? ` until ${new Date(s.holds.rotation.until * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.</p>` : ""}
      <h4>Face</h4><p>${esc(human(s.expression))}, energy ${Math.round((s.mood?.energy ?? 0.8) * 100)}%${s.personality?.preset ? `, ${esc(s.personality.preset)}` : ""}</p>`;
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
    const face = probe(c.ring_color || st.color);
    const role = (own, styled) => (own ? probe(own) : styled ? probe(styled) : face);
    this._colors = {
      face, eye: role(c.eye_color, st.eye), glow: c.glow ?? st.glow,
      text: role(c.text_color, st.text), accent: role(c.accent_color, st.accent), line: role(c.line_color, st.line),
      grid: !!st.grid, rough: !!st.rough, soft: st.soft || 0, lw: st.lw || 1,
    };
  }

  _now() {
    return (performance.now() - this._t0) / 1000;
  }

  _wake() {
    const blank = this._blank();
    const go = this._visible && !document.hidden && this.isConnected && !this._still && !blank;
    if (go && !this._running) {
      this._running = true;
      requestAnimationFrame((ms) => this._loop(ms));
    } else if (!go) {
      this._running = false;
      // A house mode that hides Alfie: nothing on the card, and no frames drawn at all.
      if (blank && this._canvas) this._canvas.getContext("2d").clearRect(0, 0, this._canvas.width, this._canvas.height);
    }
  }

  // The house mode wants this card blank (a story still brings Alfie on).
  _blank() {
    const s = this._scene;
    return !this._still && this._config?.follow_mode !== false && s?.mode_info?.alfie === "hidden" && !s.story
      && !this._voice();
  }

  // The satellite that has Alfie's face role on this card now ({state, since,
  // name, look}), or null: the latest of those the card follows.
  _voice() {
    if (this._voiceTry) return this._voiceTry;
    const v = this._scene?.voice, mode = this._config?.voice ?? "all";
    if (!v || mode === "none" || this._still) return null;
    const chosen = mode === "chosen" ? [].concat(this._config.voice_satellites || []) : null;
    let best = null;
    for (const [entity, sat] of Object.entries(v.satellites || {})) {
      if (chosen && !chosen.includes(entity)) continue;
      if (!best || sat.since > best.since) best = { ...sat, entity };
    }
    return best && { ...best, look: v.look || {} };
  }

  // How he speaks here: the card's style and strength over Alfie's Voice ones.
  _speaking() {
    const look = this._voiceTry?.look || this._scene?.voice?.look || {}, c = this._config;
    const style = c.speak_style ?? look.speak_style ?? "pulse";
    return { style: F.SPEAK_STYLES.includes(style) ? style : "pulse",
      strength: clamp(Number(c.speak_strength ?? look.speak_strength ?? 1) || 1, 0, 3) };
  }

  // The house mode's rotation for this card: "" (the card's own), "pause", or a rotation id.
  _modeRotation() {
    return this._config.follow_mode !== false ? this._scene?.mode_info?.rotation || "" : "";
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
        // Thinking: the voice look's animation, again each time it ends.
        if (this._voicePhase === "processing" && !this._face.playing && !this._face.queue.length) {
          const a = this._faceDoc?.compiled[this._voice()?.look?.processing_animation];
          if (a) this._face.play(a);
        }
        this._place = G.placeToward(this._place, this._scene?.story?.place ?? this._local?.place ?? null, dt);
        this._draw(this._frame(t), this._presentation(t, dt));
        if (this._heldAnim && !this._returning()) this._playHeld();
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
    // Answering: no mouth, so the ring and / or the eyes keep a talking rhythm.
    const sp = opts.speaking ?? (this._voicePhase === "responding" ? this._speaking() : null);
    if (sp) for (const [k, v] of Object.entries(F.speakingChannels(sp.style, sp.strength, t))) ch[k] = (ch[k] || 0) + v;
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
    const out = F.faceShapes(p, shape.eyes, shape.face, F.GEOMETRY, parts);
    if (sp) out.head = F.speakingHead(out.head, out.ring, sp.style, sp.strength, t);
    return out;
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
    const ctx = c.paint === false ? NO_PAINT : cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    if (col.grid && ctx !== NO_PAINT) this._grid(ctx, w, h);
    this._vec = c.vector_out ? { w, h, strokes: [] } : null;
    const R = (Math.min(w, h) / 2) * (1 - clamp(Number(c.padding), 0, 0.45));
    const L = scr ? this._layout(scr, w, h, R) : null;
    // A story's move/resize places him, except while a corner screen holds him there.
    const P = !(scr && scr.present === "corner") && !G.atHome(this._place)
      ? G.placeAt(this._place, w, h, R) : null;
    const fs = P ? P.s : L ? L.face.s : 1;
    const Rf = R * fs;
    const lw = Math.max(1, Number(c.line_width) * Rf * col.lw);
    const cx = P ? P.cx : L ? L.face.cx : w / 2, cy = P ? P.cy : L ? L.face.cy : h / 2;
    const X = (x) => cx + x * Rf, Y = (y) => cy - y * Rf;
    const faceAlpha = scr ? scr.faceAlpha : 1;
    const screen = () => {
      if (!scr || scr.alpha <= 0.003) return;
      const strokes = scr.strokes(L.box.hw / R, L.box.hh / R, shapes);
      // An icon he turned into is drawn as he is: his line, his colours.
      const own = scr.faceLine ? { lw, palette: { line: col.face, accent: col.eye, text: col.text, dim: col.face } } : null;
      if (strokes?.length) this._drawStrokes(ctx, strokes, L.box.cx, L.box.cy, R, scr.alpha, own);
    };
    // His eyes over an icon his ring became: the icon goes under them.
    if (scr?.noHead) screen();
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
      if (!scr?.noHead) {
        ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = col.face;
        const head = shapes.head.map(([x, y]) => [X(hx + (x - hx) * hs), Y(hy + (y - hy) * hs)]);
        this._line(ctx, head, true, lw, col.soft);
        this._tap(head, true, faceAlpha);
      }

      ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = col.eye;
      for (const eye of [shapes.left, shapes.right]) {
        const pts = eye.map(([x, y]) => [X(x), Y(y)]);
        this._line(ctx, pts, true, lw, c.eye_fill ? 1 : col.soft);
        this._tap(pts, true, faceAlpha);
      }
      ctx.globalAlpha = 1;
    }
    if (!scr?.noHead) screen();
    ctx.shadowBlur = 0;
    this._drawBadges(ctx, w, h, R, { cx, cy, r: Rf });
    if (this._vec) {
      let strokes = this._vec.strokes;
      // Mid-transition the screen is already in its own tour order (_tourScreen),
      // and the frame is not re-solved: that would make the beam's path jump about.
      if (c.vector_order !== "drawn") {
        strokes = !scr?.moving && strokes.length <= TOUR_MAX
          ? G.tourStrokes(strokes, this._tour ??= new Map())
          : G.placeStrokes(strokes, this._loops ??= new Map());
        strokes = G.openLoops(strokes);
      }
      // Between one screen going and the next coming a frame or two can be empty. On
      // the scope that parks the beam in the middle as a bright dot, so none is sent:
      // xy-bench goes on tracing the last frame for that moment.
      if (strokes.length || !scr) this.dispatchEvent(new CustomEvent("alfie-vector", {
        detail: { strokes, aspect: w / h, t: this._now() } }));
    }
  }

  // One closed or open line of the face in the style: rough (chalk) adds a
  // fainter second pass; `fill` is the share of colour inside (soft, or eye fill).
  _line(ctx, pts, closed, lw, fill = 0) {
    if (ctx === NO_PAINT) return;
    const rough = this._colors.rough;
    ctx.beginPath();
    trace(ctx, rough ? roughen(pts, lw * 0.35, 0, closed) : pts, closed);
    if (fill > 0) {
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * fill;
      ctx.fill();
      ctx.globalAlpha = a;
    }
    ctx.stroke();
    if (rough) {
      const a = ctx.globalAlpha, w = ctx.lineWidth;
      ctx.globalAlpha = a * 0.4;
      ctx.lineWidth = w * 0.6;
      ctx.beginPath();
      trace(ctx, roughen(pts, lw * 0.7, 1, closed), closed);
      ctx.stroke();
      ctx.globalAlpha = a;
      ctx.lineWidth = w;
    }
  }

  // Blueprint paper: faint squares, every fourth line a little stronger.
  _grid(ctx, w, h) {
    const step = Math.max(8, Math.min(w, h) / 16);
    ctx.save();
    ctx.strokeStyle = this._colors.face;
    ctx.lineWidth = 1;
    for (const [every, alpha] of [[1, 0.07], [4, 0.14]]) {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let x = (w / 2) % (step * every); x < w; x += step * every) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = (h / 2) % (step * every); y < h; y += step * every) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Record a painted stroke (canvas pixels) for the vector feed.
  _tap(pts, closed, weight) {
    const v = this._vec;
    if (!v) return;
    const st = G.vectorStroke(pts, closed, weight, v.w, v.h);
    if (st) v.strokes.push(st);
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
    const lw = face ? face.lw : Math.max(1.25, Number(c.screen_line_width) * R * col.lw);
    const X = (x) => bx + x * R, Y = (y) => by - y * R;
    const color = face ? face.palette : { line: col.line, text: col.text, accent: col.accent, dim: col.line };
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // A filled icon: each group's closed strokes as one shape, under its outlines.
    let groups = null;
    for (const st of strokes) {
      if (!st.group || !(st.solid > 0) || st.pts?.length < 3) continue;
      groups ??= new Map();
      if (!groups.has(st.group)) groups.set(st.group, []);
      groups.get(st.group).push(st);
    }
    // Each group fills just before its first stroke, so a picture's later
    // shapes cover the earlier ones' lines, as the SVG paints them.
    const fillGroup = (g) => {
      const colr = g[0].color || color[g[0].role] || col.face;
      ctx.globalAlpha = alpha * clamp(g[0].solid, 0, 1);
      ctx.fillStyle = ctx.shadowColor = colr;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      for (const st of g) trace(ctx, st.pts.map(([x, y]) => [X(x), Y(y)]), true);
      ctx.fill(g[0].rule === "evenodd" ? "evenodd" : "nonzero");
    };
    for (const st of strokes) {
      const g = st.group && groups?.get(st.group);
      if (g) { groups.delete(st.group); fillGroup(g); }
      const pts = st.pts;
      if (!pts?.length) continue;
      const w = Number.isFinite(st.w) ? st.w : 1;
      const dashed = w < 0.3, dim = dashed || st.role === "dim";
      const sw = dashed ? lw : lw * clamp(w, 0.45, 2.5);
      const colr = st.color || color[st.role] || col.face;   // st.color: a picture's own
      ctx.globalAlpha = alpha * (dim ? 0.5 : 1);
      ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = colr;
      ctx.lineWidth = sw;
      ctx.shadowBlur = col.glow * sw * 3;
      this._tap(pts.map(([x, y]) => [X(x), Y(y)]), st.closed, alpha * (dim ? 0.5 : 1));
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(X(pts[0][0]), Y(pts[0][1]), sw * 0.9, 0, 2 * Math.PI);
        ctx.fill();
        continue;
      }
      ctx.setLineDash(dashed ? [sw * 1.2, sw * 2.6] : []);
      ctx.beginPath();
      const at = pts.map(([x, y]) => [X(x), Y(y)]);
      trace(ctx, col.rough && !dashed ? roughen(at, sw * 0.35, 0, !!st.closed) : at, !!st.closed);
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
    this._scrTour = new Map(); // screen id -> its kept beam tours (vector feed; G.tourStrokes)
    this._bad = new Set();     // screen ids whose module failed (logged once)
    this._icons ??= new Map(); // icon "screens" (@icon:<seq>), kept across a screens reload
    this._badges ??= new Map(); // seq (or local key) -> {v, at (s, wall clock), style}
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
      for (const v of this._icons.values()) this._screenIndex.set(v.id, v);
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

  // Load a screen's module ahead of showing it, so it never comes in half ready.
  _loadModule(screen) {
    if (screen.__mod || screen.__loading || this._bad.has(screen.id)) return;
    screen.__loading = true;
    if (screen.icon) {
      IC.iconPath(screen.icon.name).then((r) => {
        if (r) screen.__mod = ICON_MODULE;
        else this._fail(screen, new Error(`no icon ${screen.icon.name}`));
      }).finally(() => { screen.__loading = false; });
      return;
    }
    Promise.all([S.fontReady() ? 0 : S.loadFont(), S.loadScreen(screen.type)]).then(([, m]) => { screen.__mod = m; })
      .catch((e) => this._fail(screen, e)).finally(() => { screen.__loading = false; });
  }

  async _ensureData(id) {
    const screen = this._screenIndex.get(id);
    if (screen) this._loadModule(screen);
    if (!screen || !this._typeOf(screen)?.needs || !this._hass) return;
    const d = this._data.get(id) ?? { data: null, error: null, at: 0, inflight: false };
    this._data.set(id, d);
    const age = (Date.now() - d.at) / 1000;
    if (d.inflight || age < (d.error ? DATA_RETRY : DATA_STALE)) return;
    // Data that only changes with the screens (a picture): fetched once; screens_rev resets it.
    if (d.data && d.at && this._typeOf(screen).refresh === false) return;
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
    const mr = this._modeRotation();
    const r = mr && mr !== "pause" ? mr : this._config.rotation;
    if (this._config.display !== "rotation" || !r) return null;
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
      // An icon comes in once its path is here, so it never morphs out of nothing.
      return { id: this._ready(sc.id) ? sc.id : null, next: null };   // the rotation waits (its clock is not advanced)
    }
    if (this._scene?.story) {
      this._override = "story";
      return { id: null, next: null };    // a story has Alfie himself on show; the rotation waits
    }
    if (this._voice()) {
      this._override = "voice";
      return { id: null, next: null };    // a voice assistant has him on: the rotation waits
    }
    this._override = this._local?.screen ? "local" : null;
    if (this._rot === null || this._rot.stale) {
      const spec = this._rotationSteps();
      this._rot = spec ? (this._rot?.steps ? G.carry(this._rot, spec) : G.start(spec, this._rotClock)) : { steps: null };
    }
    const rot = this._rot;
    if (!rot.steps) return { id: this._localScreen(), next: null };
    if (this._modeRotation() !== "pause") this._rotClock += dt;   // a house mode may pause it
    const want = G.advance(rot, this._rotClock, (this._fitFn ??= (id) => this._fit(id)));
    if (want.appear) this._appear(rot);
    // His turn is over: his story stops with it, so the next screen keeps the beat.
    else if (want.id && this._local?.turn) this._endLocal(true);
    // Alfie's own story may show a screen while he has the stage.
    if (!want.id && this._localScreen()) return { id: this._localScreen(), next: want.next };
    return want;
  }

  // A screen's say in its rotation turn (alfie-stage `advance`): its module's
  // `rotation()`, once the module and its data are in. Unknown never skips.
  _fit(id) {
    const screen = this._screenIndex.get(id);
    if (!screen) return null;
    this._ensureData(id);   // a skipped screen keeps its data fresh, so it can come back
    const mod = screen.__mod;
    if (!mod?.rotation || this._bad.has(id)) return null;
    const d = this._data.get(id);
    if (this._typeOf(screen)?.needs && d?.data == null) return null;
    try {
      return mod.rotation({ data: d?.data ?? null, options: this._withDefaults(screen), states: this._hass?.states ?? {}, S });
    } catch (e) {
      return null;
    }
  }

  // The screen this card's own story shows now, once it is ready.
  _localScreen() {
    const id = this._local?.screen?.id;
    return id && this._screenIndex.has(id) && this._ready(id) ? id : null;
  }

  // A screen that can come in: any but an icon whose path is still loading.
  _ready(id) {
    const screen = this._screenIndex.get(id);
    if (!screen?.icon || screen.__mod || this._bad.has(id)) return true;
    this._loadModule(screen);
    return false;
  }

  // ----------------------------------------------------------- icons

  // An icon shown as a screen (transform, beside), under `id` (the scene's
  // @icon:<seq>, or a fresh local one). Old ones are dropped past a few.
  _iconScreen(id, icon) {
    id ??= `${G.ICON_SCREEN}:local:${(this._localIcons = (this._localIcons || 0) + 1)}`;
    let v = this._icons.get(id);
    if (!v) {
      v = { id, type: G.ICON_SCREEN, title: icon.name, icon, options: icon };
      this._icons.set(id, v);
      this._screenIndex.set(id, v);
      for (const old of [...this._icons.keys()].slice(0, Math.max(0, this._icons.size - 6))) {
        if (old !== this._cur?.id) { this._icons.delete(old); this._screenIndex.delete(old); }
      }
      this._loadModule(v);
    }
    return v;
  }

  // The scene's badges (and this card's own) as the ones on show: a new one
  // starts coming in, one the scene dropped goes when its time is up.
  _syncBadges(list, local = false) {
    if (this._config.icons === false) return;
    for (const b of list || []) {
      const key = local ? `local:${(this._localIcons = (this._localIcons || 0) + 1)}` : String(b.seq);
      if (this._badges.has(key)) continue;
      const now = Date.now() / 1000;
      let style = b.transition || BADGE_STYLE;
      if (style === "random") style = I.RANDOM_STYLES[Math.floor(Math.random() * I.RANDOM_STYLES.length)];
      if (!I.STYLES.includes(style) || style === "morph") style = BADGE_STYLE;
      this._badges.set(key, { v: b, at: now, until: local ? now + (Number(b.seconds) || 5) : b.until, style });
      IC.iconPath(b.name);
    }
  }

  // Draw the badges over everything; `face` is where Alfie is ({cx, cy, r} px).
  _drawBadges(ctx, w, h, R, face) {
    if (!this._badges.size) return;
    const now = Date.now() / 1000, m = (Math.min(w, h) / 2) * clamp(Number(this._config.padding), 0, 0.45);
    for (const [key, b] of this._badges) {
      const strokes = IC.strokesFor(b.v.name, { role: b.v.color || "line", fill: b.v.fill });
      if (!strokes) {
        if (IC.failed(b.v.name) || now > b.until) this._badges.delete(key);
        else b.at = now;    // its clock starts once the path is in
        continue;
      }
      const din = I.SECONDS[b.style] || 0.6, dout = din * I.OUTRO_SHARE;
      const left = b.until - now;
      if (left <= 0) { this._badges.delete(key); continue; }
      const leaving = left < dout;
      const p = leaving ? I.presence(b.style, 1 - left / dout, true) : I.presence(b.style, (now - b.at) / din, false);
      const at = G.badgeAt(b.v, w, h, R, face, m);
      const s = at.s / R;
      const out = I.apply(b.style, p, leaving, IC.placed(strokes, s), { w: s, h: s }, null, this._introOpts());
      if (out.alpha > 0.003 && out.strokes.length) this._drawStrokes(ctx, out.strokes, at.cx, at.cy, R, out.alpha);
    }
  }

  // For the panel: show an icon on this card only ({icon, style, transform,
  // seconds, …} as a story's icon step has them). The service shows it everywhere.
  showIconLocal(icon) {
    const a = G.iconAction(icon);
    if (a.kind === "icon") { this._syncBadges([a.value], true); return; }
    this._endLocal(false);
    this._local = { actions: [a], t0: this._now(), tick: null, last: -1, expression: null, blend: 0, place: null, screen: null };
    this._wake();
  }

  // ----------------------------------------------------------- Alfie's own story

  // Alfie comes on in this card's rotation: fetch the most relevant story
  // (or the card's choice) and play it here only, for as long as his turn lasts.
  async _appear(rot) {
    const pick = this._config.appear_story ?? "auto";
    const turn = (this._turn = (this._turn || 0) + 1);
    this._endLocal(true);
    if (pick === "none" || !this._hass) return;
    let r = null;
    try {
      r = await this._hass.connection.sendMessagePromise(
        { type: "alfie/story/expand", ...(pick === "auto" ? {} : { story: pick }) });
    } catch (e) {
      console.warn(`Alfie: can't play the story ${pick}: ${e?.message || e}`);
    }
    // The rotation was rebuilt, or his turn ended, meanwhile.
    if (this._rot !== rot || this._turn !== turn || rot.phase === "screen") return;
    const actions = r?.actions || [];
    if (!actions.length || this._scene?.story) return;
    // Its clock waits while the screen leaves and he comes back (see _stepLocal).
    this._local = { actions, turn, t0: this._now(), tick: null, last: -1, expression: null, blend: 0, place: null, screen: null };
    this._stepLocal(this._local.t0);
  }

  // One frame of this card's own story: new animations fire, and a new
  // expression is worn; when it is over Alfie goes back to the scene's.
  _stepLocal(t) {
    const L = this._local, face = this._faceDoc;
    // As at a screen switch, nothing goes on while a screen leaves and Alfie
    // comes back: the story's clock waits.
    if (this._returning()) {
      if (L.tick != null) L.t0 += t - L.tick;
      L.tick = t;
      return;
    }
    L.tick = t;
    const el = t - L.t0;
    // A story screen that ends now leaves first; the story stands there until he is back.
    const end = L.screen ? G.screenEnd(L.actions, L.last, el) : null;
    if (end !== null) {
      L.t0 = t - end;
      L.last = end - 1e-6;
      L.screen = null;
      return;
    }
    const r = G.runStory(L.actions, L.last, el);
    L.last = el;
    for (const name of r.fire) this.playLocal(name);
    this._syncBadges(r.icons, true);
    // A local icon screen gets its own id the first time it comes up.
    if (r.screen?.icon && r.screen.id === G.ICON_SCREEN) r.screen.id = this._iconScreen(null, r.screen.icon).id;
    L.place = r.place;
    L.screen = r.screen?.icon && this._config.icons === false ? null : r.screen;
    if (r.expression !== L.expression && face && !this._exprPreview) {
      this._applyExpression(face, r.expression in face.expressions ? r.expression : this._scene?.expression, t, r.blend);
    }
    L.expression = r.expression;
    L.blend = r.blend;
    if (r.done) this._endLocal(true);
  }

  // A screen is leaving and Alfie is on his way back (not one screen handing over to the next).
  // `soon`: also when the scene has just dropped the screen on show, before a frame starts it leaving.
  _returning(soon = false) {
    const c = this._cur;
    if (!c) return false;
    if (c.tOut != null) return !c.swap;
    return soon && this._override === c.id && this._scene?.screen?.id !== c.id;
  }

  _playHeld() {
    const name = this._heldAnim, face = this._faceDoc;
    this._heldAnim = null;
    if (face?.compiled[name]) this._face.play(face.compiled[name]);
  }

  _endLocal(restore) {
    if (!this._local) return;
    this._local = null;
    if (restore && this._faceDoc && this._scene && !this._exprPreview) {
      this._applyExpression(this._faceDoc, this._scene.expression, this._now(), 0.6);
    }
  }

  // The style for a screen coming in: [style, random]. On random each change picks
  // afresh, and both sides of it share the pick: `keep` is the leaving screen's.
  _transitionStyle(keep = null) {
    const c = this._config;
    const sc = this._scene?.screen;
    const own = this._override === "local" ? this._local?.screen?.transition : this._override && this._override === sc?.id && sc.transition;
    let style = own || c.transition || this._rot?.transition || "fade";
    const random = style === "random";
    if (random) style = keep || I.RANDOM_STYLES[Math.floor(Math.random() * I.RANDOM_STYLES.length)];
    return [I.STYLES.includes(style) ? style : "fade", random];
  }

  // A new screen on show, and how it comes in.
  _enter(id, t, present, keep = null, extra = {}) {
    this._ensureData(id);
    const [style, random] = this._transitionStyle(keep);
    return (this._cur = { id, tIn: t, tOut: null, style, random, present, ...extra });
  }

  // Decide what is on show at `t` and build the draw description for it, or null
  // when it is Alfie alone (the common, free case).
  _presentation(t, dt) {
    if (this._config.display === "companion" && !this._scene?.screen && !this._cur && !this._local?.screen) return null;
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
      // On random a change picks its own style, which the leaving screen goes by too.
      if (cur.random) cur.style = this._transitionStyle()[0];
      cur.swap = !!want.id && presentOf(want.id) === cur.present;
    }
    if (cur?.swap && cur.tOut != null && !want.id) cur.swap = false;   // Alfie wants the stage after all
    if (!cur && want.id) {
      cur = this._enter(want.id, t, presentOf(want.id));
      // In hand over Alfie leaves first and then the screen comes in, as one screen
      // hands over to the next, so his turn ends on the beat. Morph is both at once.
      cur.pre = cur.present !== "corner" && cur.style !== "morph" && (I.SECONDS[cur.style] ?? 0.6) > 0;
    }
    if (!cur) return null;
    let corner = cur.present === "corner";
    let leaving = cur.tOut != null;
    let durS = I.SECONDS[cur.style] ?? 0.6, durM = corner && !(leaving ? cur.swap : cur.held) ? CORNER_SECONDS : 0;
    if (cur.pre) {
      const u = (t - cur.tIn) / durS;
      if (leaving) {   // wanted away again before it came in: Alfie stays
        this._cur = null;
        return null;
      }
      if (u < 1) return this._describe(cur.id, cur.style, 1 - I.presence(cur.style, u, true), false, 0, t, cur.present, false, true);
      cur.pre = false;
      cur.tIn += durS;
      cur.held = true;
    }
    let age = t - (leaving ? cur.tOut : cur.tIn);
    // Alfie taking the stage back waits for the screen to be gone, as the next screen
    // would, then springs out of his corner, or in hand over comes in by the transition.
    const back = leaving && !cur.swap && cur.style !== "morph" && (corner || durS > 0);
    const durBack = back ? (corner ? CORNER_SECONDS : durS) : 0;
    if (leaving && age >= (back ? durS + durBack : Math.max(durS, durM))) {
      this._cur = null;
      if (!(cur.swap && want.id)) return null;
      cur = this._enter(want.id, t, presentOf(want.id), cur.style, { held: true });
      corner = cur.present === "corner";
      leaving = false;
      durS = I.SECONDS[cur.style] ?? 0.6;
      durM = 0;
      age = 0;
    }
    if (back && age >= durS) {
      // The screen is gone; Alfie comes out of his corner, or in by the transition.
      const u = clamp((age - durS) / durBack, 0, 1);
      if (corner) return this._describe(cur.id, cur.style, 0, true, 1 - F.spring(u), t, cur.present, false, true);
      return this._describe(cur.id, cur.style, 1 - I.presence(cur.style, u, false), true, 0, t, cur.present, false, true);
    }
    // Alfie stays away while one screen hands over to the next, or leaves before he comes back.
    const away = leaving ? (!!cur.swap || back) : !!cur.held;
    const uS = durS ? clamp(age / durS, 0, 1) : 1, uM = durM ? clamp(age / durM, 0, 1) : 1;
    const p = I.presence(cur.style, uS, leaving);
    const k = corner ? (away ? 1 : leaving ? 1 - F.spring(uM) : F.spring(uM)) : 0;
    return this._describe(cur.id, cur.style, p, leaving, k, t, cur.present, away);
  }

  // `gone`: the screen has left and only Alfie is drawn, coming back by presence `p`.
  _describe(id, style, p, leaving, k, t, present = this._config.present, away = false, gone = false) {
    const c = this._config, corner = present === "corner";
    const screen = this._screenIndex.get(id);
    // An icon he turns into by the ring only: his eyes stay, alive, over it.
    const ring = !!screen?.icon?.ring && !corner && style === "morph";
    // In "hand over" the face goes by the same transition the screen comes by
    // (drawn, zoomed, wiped away...); fade and cut just change its alpha, and
    // morph turns the face itself into the screen. Between two screens he stays away.
    const faceAlpha = ring || corner ? 1 : away ? 0 : I.faceAlpha(style, p);
    const shaped = !corner && !away && !["cut", "fade", "morph"].includes(style) && p > 0 && p < 1;
    const iconCorner = screen?.icon?.corner;
    return {
      present, corner: iconCorner && iconCorner !== "card" ? iconCorner : c.corner, size: c.corner_size, k, faceAlpha,
      // Mid-transition, or Alfie on his way to or from the corner.
      moving: (p > 0 && p < 1) || (k > 0 && k < 1) || gone,
      noHead: ring && p > 0,
      faceLine: !!screen?.icon && !corner && style === "morph",
      alpha: gone ? 0 : I.apply(style, p, leaving, [], null).alpha,
      face: shaped ? (shapes, box) => I.apply(style, 1 - clamp(p, 0, 1), !leaving, I.faceStrokes(shapes), box, null, this._introOpts()) : null,
      strokes: (hw, hh, shapes) => this._screenStrokes(screen, hw, hh, t, style, p, leaving,
        style === "morph" && shapes && !corner && !away ? I.faceStrokes(shapes).slice(0, ring ? 1 : 3) : null),
    };
  }

  // The strokes for a screen in a box, never throwing: a module that fails
  // gets its title drawn instead and a single log line.
  _screenStrokes(screen, hw, hh, tCard, style, p, leaving, from = null) {
    const box = { w: hw, h: hh };
    let strokes = null;
    const d = this._data.get(screen.id);
    this._loadModule(screen);
    const mod = screen.__mod;
    // Nothing until the module and the first data are in: never a stand-in title for a moment.
    const pending = !this._bad.has(screen.id) && (!mod || (!screen.icon && !S.fontReady()) || (this._typeOf(screen)?.needs && this._hass && d?.data == null && !d?.error && !d?.at));
    if (pending) return [];
    if (mod && !this._bad.has(screen.id)) {
      try {
        if (!this._memo.has(screen.id)) this._memo.set(screen.id, {});
        strokes = mod.draw({
          w: hw, h: hh, t: Date.now() / 1000, shown: this._cur?.id === screen.id ? tCard - this._cur.tIn : 0, data: d?.data ?? null,
          options: this._withDefaults(screen), states: this._hass?.states ?? {}, config: this._hass?.config ?? {},
          memo: this._memo.get(screen.id), S,
        });
      } catch (e) {
        this._fail(screen, e);
      }
    }
    if (!strokes) strokes = S.fontReady() ? this._titleStrokes(screen, hw, hh) : [];
    const c = this._config;
    if (c.vector_out && c.vector_order !== "drawn" && strokes.length > 1) strokes = this._tourScreen(screen.id, strokes);
    const out = I.apply(style, p, leaving, strokes, box, from, this._introOpts()).strokes;
    // A filled icon's fill comes in with it, not all at once halfway through a morph.
    if (screen.icon && p < 1) for (const st of out) if (st.solid) st.solid *= clamp(p, 0, 1) ** 2;
    return out;
  }

  // A screen's strokes in tour order, before its transition reshapes them: an
  // intro keeps the order it is given, so the beam's path through a transition
  // holds steady instead of re-solving each frame (xy-bench does the same).
  _tourScreen(id, strokes) {
    const wrap = strokes.map((s) => ({ p: s.pts, c: !!s.closed && s.pts.length > 2, s }));
    if (!this._scrTour.has(id)) this._scrTour.set(id, new Map());
    return G.tourStrokes(wrap, this._scrTour.get(id)).map((o) => (o.p === o.s.pts ? o.s : { ...o.s, pts: o.p }));
  }

  _introOpts() {
    return this._config.vector_out && this._config.vector_condense !== "dots" ? INTRO_LINES : null;
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

  // previewAnimationAt(name, seconds): hold that moment of an animation (the
  // editor's scrub); null lets go.
  async previewAnimationAt(name, u = 0) {
    const face = await loadFace();
    const anim = name ? face.compiled[name] : null;
    this._face.scrub = anim ? { anim, u: Math.max(0, Math.min(anim.length, Number(u) || 0)) } : null;
    this._wake?.();
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

  // For the panel's Voice "Try it": this card acts as if a satellite were in
  // `state` (listening, processing, responding), with `look` (the draft's);
  // null goes back to the real satellites.
  previewVoice(state, look = null) {
    this._voiceTry = state ? { state, since: Infinity, name: "Try it", entity: "",
      look: look || this._scene?.voice?.look || {} } : null;
    if (this._scene) this._onScene(this._scene);
  }

  // For tests and the dev harness: draw one still frame, no clock, no HA.
  // {expression, animation, u (seconds in), energy, blink (0..1), speak
  // ({style, strength}: answering, at speech time t)}
  async renderStill({ expression = "neutral", animation = null, u = 0, energy = 0.8, blink = 0, speak = null, t = 0 } = {}) {
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
    this._stillFrame = this._frame(t, { pose, parts, channels, noBreath: true, noBlink: true, speaking: speak });
    this._resize();
    this._draw(this._stillFrame);
  }

  // For tests and the dev harness: one still frame of an icon with Alfie, no
  // clock, no HA (the icon from globalThis.ALFIE_ICONS). {icon, style, transform,
  // u (0..1, how far it has arrived), size, color, corner, place, x, y, expression}.
  async renderIconStill({ icon = "mdi:white-balance-sunny", style = "transform", transform = "whole", u = 1, size = 1,
    color = "line", fill = "soft", corner = "card", place = "top_right", x = 0, y = 0, transition = "", expression = "neutral" } = {}) {
    const face = await loadFace();
    await IC.iconPath(icon);
    this._still = true;
    this._running = false;
    this._face = new FaceState();
    const p0 = this._personality(face);
    this._face.energy = this._face.energyTarget = Math.max(0.05, 0.8 + p0.energy_bias);
    this._applyExpression(face, expression, 0);
    this._stillFrame = this._frame(0, { pose: this._face.target, parts: this._face.targetParts, channels: {}, noBreath: true, noBlink: true });
    const a = G.iconAction({ icon, style, transform, size, color, fill, corner, place, x, y, transition, seconds: 100 });
    this._badges = new Map();
    this._stillScr = null;
    if (a.kind === "icon") {
      const b = a.value, st = transition || BADGE_STYLE, now = Date.now() / 1000;
      this._badges.set("still", { v: b, at: now - u * (I.SECONDS[st] || 0.6), until: now + 100, style: st });
    } else {
      const v = this._iconScreen("@icon:still", a.value.icon);
      v.__mod = ICON_MODULE;
      const st = a.value.transition || "fade", corner_ = a.value.present === "corner";
      this._stillScr = this._describe(v.id, st, I.presence(st, u, false), false, corner_ ? F.spring(u) : 0, 0, a.value.present);
    }
    this._resize();
    this._draw(this._stillFrame, this._stillScr);
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
    // A still draws once: a dry run asks for its icons, and they come in first.
    this._stillScr.strokes(1, 1);
    await Promise.all([...iconWaits].map((n) => IC.iconPath(n)));
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
