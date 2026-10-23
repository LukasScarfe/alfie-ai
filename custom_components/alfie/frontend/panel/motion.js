// Appearance → Motion: the numbers in the motions drawn by code (answering,
// breathing, blinking, tiredness, screen transitions), as look.motion. The
// keyframe animations are Animations'; these have no keys, only knobs. Every
// slider plays on the dock face as it moves (the shell syncs the draft look);
// the dock's chips try each motion there.

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);
const I = await import(`../alfie-intros.js${V}`);

// [key, label, hint, step]
const TALK = [
  ["speak_rate", "Talking speed", "Syllables faster or slower.", 0.05],
  ["speak_pauses", "Pauses", "How deep the gaps between phrases dip. 0: no pauses.", 0.05],
  ["speak_contrast", "Punch", "Above 1 each syllable spikes; below 1 a steady hum.", 0.05],
];
const STYLE_KNOBS = {
  pulse: ["Pulse", [["pulse_depth", "Swell", "How far the ring breathes out, in ring radii.", 0.005]]],
  eyes: ["Eyes", [["eye_grow", "Grow", "How much the eyes grow on a syllable.", 0.01],
    ["eye_lift", "Lift", "How far they lift.", 0.005]]],
  both: ["Both", [["both_share", "Share", "Pulse and eyes each at this share, so together they aren't twice as much.", 0.05]]],
  wave: ["Wave", [["wave_depth", "Ripple", "How far the ripple reaches, in ring radii.", 0.002],
    ["wave_bumps", "Bumps", "Bumps around the ring.", 1],
    ["wave_speed", "Travel", "Turns a second the ripple runs round. Negative: the other way.", 0.1],
    ["wave_detail", "Detail", "A finer ripple running the other way on top, more like a sound trace.", 0.05]]],
};
const BREATH = [
  ["breath_depth", "Depth", "Times the usual. 0: he doesn't breathe (a card can also turn breathing off).", 0.05],
  ["breath_seconds", "Breath length", "Seconds per breath at full energy; slower when he's low.", 0.1],
];
const BLINK = [
  ["blink_seconds", "Blink length", "Seconds per blink; longer when he's low. How often is Personality's Blinking.", 0.01],
  ["blink_min_gap", "Shortest gap", "He never blinks more often than this, in seconds.", 0.1],
];
const SAG = [
  ["sag_below", "Starts under", "The energy where tiredness starts to show. 0: never.", 0.05],
  ["sag_droop", "Heavy lids", "How far his lids drop at no energy.", 0.05],
  ["sag_drop", "Sinking eyes", "How far his eyes sink, in ring radii.", 0.005],
];
const TRANSITION = [
  ["transition_speed", "Speed", "Every screen transition, faster or slower.", 0.05],
  ["overshoot", "Overshoot", "How far zoom, slide and flip spring past. 0: none.", 0.05],
  ["corner_seconds", "Corner move", "Seconds for his move into or out of the corner.", 0.05],
  ["outro_share", "Badge exit", "An icon badge leaves in this share of its entrance.", 0.05],
];
const TRY_STYLES = ["pulse", "eyes", "both", "wave"];
const TRANSITION_STYLES = I.STYLES.filter((s) => s !== "cut");

const ms = (p) => (p.motion ??= { talk: null, tired: false, style: "zoom", present: "handover" });

// The draft's motion, made whole: a config from before Motion has none.
function motionOf(p) {
  const d = p.defaults?.look?.motion || {};
  const m = (p.draft.look.motion ??= U.clone(d));
  for (const [k, v] of Object.entries(d)) if (!(k in m)) m[k] = U.clone(v);
  return m;
}

function slider(p, m, [k, label, hint, step]) {
  const r = p.choices.motion?.[k] || { min: 0, max: 1, default: 0 };
  const changed = Number(m[k]) !== Number(r.default);
  return `<label class="slider">
      <span><b>${U.esc(label)}</b><small>${U.esc(hint)}${changed ? ` Default ${p.fmt(r.default)}.` : ""}</small></span>
      <input type="range" min="${r.min}" max="${r.max}" step="${step}" data-path="look.motion.${k}" data-kind="number" value="${U.esc(m[k])}">
      <output>${p.fmt(m[k])}</output></label>`;
}

const sliders = (p, m, list) => `<div class="sliders">${list.map((s) => slider(p, m, s)).join("")}</div>`;
const back = (group) => `<button class="flat mo-back" data-action="mo-default" data-name="${group}">Back to default</button>`;

export function render(p) {
  const m = motionOf(p), style = p.draft.voice?.speak_style || "pulse";
  const styles = Object.entries(STYLE_KNOBS).map(([s, [t, list]]) =>
    `<h4>${U.esc(t)}${s === style ? ` <span class="muted">(in use)</span>` : ""}</h4>${sliders(p, m, list)}`).join("");
  const secs = TRANSITION_STYLES.map((s) => U.field(U.human(s),
    `<span class="unit"><input type="number" data-path="look.motion.transition_seconds.${s}" data-kind="optnum" min="0" max="5" step="0.1"
      value="${U.esc(m.transition_seconds?.[s] ?? "")}" placeholder="${I.SECONDS[s]}"><span>s</span></span>`)).join("");
  return `${U.intro("The motions drawn by code rather than keyframes: how he talks without a mouth, breathes, blinks, tires, and how screens come and go. Every default is how he has always moved. Try each one with the chips under his face.",
      "The keyframe animations (nod, startle, thinking…) are under Animations. A card can override any of these with its own <code>motion:</code> in YAML.")}
    ${U.cards(`${U.card("Talking", `<p class="muted">How he answers a voice request. The style is chosen on Voice → Assistants (Answering), and how much it shows (×) there too.</p>
        ${sliders(p, m, TALK)}${styles}${back("talk")}`)}
      ${U.card("Breathing", `${sliders(p, m, BREATH)}${back("breath")}`)}
      ${U.card("Blinking", `${sliders(p, m, BLINK)}${back("blink")}`)}
      ${U.card("Tiredness", `<p class="muted">How low energy (a bad mood, or late) weighs on him.</p>${sliders(p, m, SAG)}${back("sag")}`)}
      ${U.card("Screen transitions", `${sliders(p, m, TRANSITION)}
        ${U.more(p, "motion-secs", secs, "Each transition's own length")}${back("transition")}`)}`)}
    <style>.card h4 { margin: 14px 0 2px; font-size: 13px; } .mo-back { margin-top: 10px; }</style>`;
}

// Under the dock face: try each motion there.
export function dock(p) {
  const s = ms(p);
  const chip = (action, name, text, on) => `<button class="chip pick ${on ? "on" : ""}" data-action="${action}" data-name="${name}">${U.esc(text)}</button>`;
  return `<div class="chips"><span class="muted">Talk:</span>${TRY_STYLES.map((st) => chip("mo-talk", st, U.human(st), s.talk === st)).join("")}
      ${chip("mo-talk", "", "Off", !s.talk)}</div>
    <div class="chips">${chip("mo-tired", "", "Tired", s.tired)}</div>
    <div class="chips"><span class="muted">Screen:</span>
      ${U.select(null, s.style, TRANSITION_STYLES.map((st) => [st, U.human(st)]), { attrs: 'data-mo="style"' })}
      ${chip("mo-present", "handover", "Hand over", s.present === "handover")}${chip("mo-present", "corner", "Corner", s.present === "corner")}
      <button class="chip pick" data-action="mo-play">Play</button></div>`;
}

export function mount(p) {
  motionOf(p);
  talk(p);
}

// The dock answers as a satellite would, with the draft's voice look and the chosen style.
function talk(p) {
  const s = ms(p), v = p.draft.voice || {};
  if (!s.talk) { p.face?.previewVoice?.(null); return; }
  p.face?.previewVoice?.("responding", { speak_style: s.talk, speak_strength: v.speak_strength ?? 1 });
}

function tired(p) {
  const s = ms(p);
  p.faceHold = s.tired;
  p.syncFace(true);
  p.face?.previewEnergy?.(s.tired ? 0.1 : null);
}

export function leave(p) {
  const s = ms(p);
  if (s.talk) p.face?.previewVoice?.(null);
  if (s.tired) p.face?.previewEnergy?.(null);
  Object.assign(s, { talk: null, tired: false });
}

// The dock's transition picker is not a draft path.
export function tool(p, ev) {
  const el = ev.target.closest("[data-mo]");
  if (!el) return false;
  if (el.dataset.mo === "style") ms(p).style = el.value;
  return true;
}

const GROUPS = { talk: [...TALK, ...Object.values(STYLE_KNOBS).flatMap(([, l]) => l)], breath: BREATH, blink: BLINK, sag: SAG,
  transition: TRANSITION };

export function click(p, a, el) {
  const s = ms(p);
  switch (a) {
    case "mo-talk": s.talk = el.dataset.name || null; talk(p); p.render(); return true;
    case "mo-tired": s.tired = !s.tired; tired(p); p.render(); return true;
    case "mo-present": s.present = el.dataset.name; p.render(); return true;
    case "mo-play": p.face?.previewTransition?.(s.style, s.present); return true;
    case "mo-default": {
      const m = motionOf(p), d = p.defaults.look.motion, group = el.dataset.name;
      for (const [k] of GROUPS[group] || []) m[k] = d[k];
      if (group === "transition") m.transition_seconds = {};
      p.edited(true);
      return true;
    }
    default: return false;
  }
}
