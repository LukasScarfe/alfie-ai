// The panel's Overview: Alfie now (the dock has his face; here his mood, house mode, what is active),
// the Get started guide for a new install, and export / import of the config.

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);

export const id = "overview";
export const title = "Overview";
export const subs = [];
export const resets = {};

const L = U.LEVEL_TEXT;
const CARD_YAML = "type: custom:alfie-card";
const DONE_TEXT = { signals: "Done", dashboard: "Mark done" };

export function render(p) {
  const o = p.draft.overview;
  return `<div class="ov">
        <div class="card nowcard">
          <h4>Now</h4>
          <div class="nowmood"></div>
          <div class="nowmode muted"></div>
          <p class="playing muted"></p>
          <div class="nowsigs"></div>
        </div>
        ${o.dismissed ? "" : guide(p)}
        ${U.more(p, "overview", `
          <div class="wide row">
            <button class="flat" data-action="ov-export">Export settings</button>
            <label class="flat filebtn">Import settings<input type="file" accept="application/json,.json" data-action="ov-import" hidden></label>
            ${o.dismissed ? `<button class="flat" data-action="ov-show">Show Get started</button>` : ""}
          </div>
          <p class="wide muted">Export saves every setting as one JSON file. Importing one replaces your unsaved
            draft with it; check it over, then Save (or Revert).</p>`)}
    </div>
    <style>
      .nowmood { font-size: 18px; margin: 4px 0; } .nowmood b { font-weight: 500; }
      .nowsigs { display: grid; gap: 4px; margin-top: 10px; }
      .nowsig { display: flex; gap: 8px; align-items: center; }
      .guide { margin: 20px 0; }
      .guide-head { display: flex; align-items: baseline; gap: 12px; }
      .guide-head h3 { margin: 0; flex: 1; }
      .step { display: grid; grid-template-columns: 32px 1fr; gap: 4px 12px; padding: 14px 16px; }
      .step .dot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-weight: 500;
                   border: 2px solid var(--line); color: var(--muted); }
      .step.done .dot { background: var(--ok); border-color: var(--ok); color: #fff; }
      .step.done { grid-template-columns: 32px 1fr auto; align-items: center; padding: 8px 10px 8px 16px; }
      .step.done h4 { margin: 0; font-weight: 400; color: var(--muted); }
      .step h4 { margin: 4px 0 2px; font-size: 15px; text-transform: none; letter-spacing: 0; color: var(--primary-text-color); }
      .step .content { grid-column: 2; }
      .sugg { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); }
      .sugg:first-child { border-top: 0; }
      .sugg .grow { min-width: 0; }
      .sugg code { color: var(--muted); }
      pre.yaml { margin: 6px 0; padding: 10px 12px; background: var(--soft); border-radius: 8px; overflow-x: auto; }
      .filebtn { display: inline-flex; align-items: center; cursor: pointer; }
    </style>`;
}

// ------------------------------------------------------------ Get started

function nightMode(p) {
  return p.draft.modes.find((m) => m.id === "night") || p.draft.modes.find((m) => m.alfie === "asleep");
}

function steps(p) {
  const d = p.draft, done = d.overview.done;
  const night = nightMode(p);
  return [
    // Done by hand: the starter signals often match already, and the suggestions are the point.
    { id: "signals", title: "Choose what Alfie watches", done: done.includes("signals"),
      text: "Signals are the good and bad things about the house that set his mood. Alfie starts with a few that work in most homes; here is what else yours has.",
      go: ["mood", "signals"], content: signalSuggestions },
    { id: "motion", title: "Tell Alfie about motion sensors", done: d.behaviour.motion_sensors.length > 0 || done.includes("motion"),
      text: "When someone moves, he glances that way or notices you.",
      go: ["reactions", "motion"], content: motionSuggestions },
    p.choices?.house_modes !== false && { id: "sleep", title: "When is it night?", done: !!night?.condition || done.includes("sleep"),
      text: "While it is on, Alfie sleeps (only something critical wakes him). Pick what tells him: a sleep mode, a bedtime switch.",
      go: ["modes", ""], content: sleepSuggestions },
    { id: "dashboard", title: "Put Alfie on a dashboard", done: done.includes("dashboard"),
      text: "Add a card to any dashboard (Edit dashboard → Add card → Manual), with this:",
      content: () => `<pre class="yaml"><code>${CARD_YAML}</code></pre>
        <div class="row"><button class="flat" data-action="ov-copy">Copy</button>
          <span class="muted">The card has its own editor: choose Display → Rotation there to show screens.</span></div>` },
    { id: "screens", title: "Optional: build a screen", done: d.screens.length > 0 || done.includes("screens"),
      text: "Screens are data pages Alfie presents: a plot, the weather, the sky, a clock. Stories show them, and a rotation shows them in turn.",
      go: ["screens", "screens"] },
  ].filter(Boolean);
}

function guide(p) {
  const all = steps(p), left = all.filter((s) => !s.done).length;
  return `<section class="guide">
      <div class="guide-head"><h3>Get started</h3>
        <span class="muted">${left ? `${all.length - left} of ${all.length} done` : "All done"}</span>
        <button class="flat" data-action="ov-hide">Hide</button></div>
      ${all.map((s, k) => s.done ? `<div class="card step done">
        <span class="dot">✓</span><h4>${U.esc(s.title)}</h4>
        ${s.go ? `<button class="flat" data-action="go" data-section="${s.go[0]}" data-sub="${s.go[1]}">Open ${U.esc(sectionName(s.go))}</button>` : "<span></span>"}
        </div>` : `<div class="card step">
        <span class="dot">${k + 1}</span>
        <div><h4>${U.esc(s.title)}</h4>${s.done ? "" : `<p class="muted">${U.esc(s.text)}</p>`}</div>
        <div class="content">
          ${!s.done && s.content ? s.content(p) : ""}
          <div class="row">
            ${s.go ? `<button class="flat" data-action="go" data-section="${s.go[0]}" data-sub="${s.go[1]}">Open ${U.esc(sectionName(s.go))}</button>` : ""}
            ${s.done ? "" : `<button class="flat" data-action="ov-done" data-name="${s.id}">${DONE_TEXT[s.id] || "Skip"}</button>`}
          </div>
        </div></div>`).join("")}
    </section>`;
}

const sectionName = ([sec, sub]) => ({ mood: "Signals", reactions: "Motion & idle", modes: "House modes", screens: "Screens" })[sec] || sec;

// The suggestions not yet in the draft (the server skips what the saved config covers).
function fresh(p) {
  const s = p.suggest;
  if (!s) return null;
  const sigEnts = new Set(p.draft.signals.flatMap((x) => x.entities));
  const motion = new Set(p.draft.behaviour.motion_sensors.map((m) => m.entity));
  return {
    signals: s.signals.filter((x) => !x.entities.some((e) => sigEnts.has(e))),
    motion: s.motion.filter((x) => !motion.has(x.entity)),
    sleep: s.sleep,
  };
}

function signalSuggestions(p) {
  const f = fresh(p);
  const have = p.draft.signals.map((s) => {
    const r = p.preview?.signals?.find((x) => x.id === s.id);
    return `<span class="chip ${r?.count ? "good" : ""}">${U.esc(s.name)}${r ? ` · ${r.count}` : ""}</span>`;
  }).join("");
  const rows = !f ? `<p class="muted">Looking around the house…</p>` : f.signals.length
    ? f.signals.map((s, k) => `<div class="sugg"><span class="grow"><b>${U.esc(s.name)}</b> <code>${U.esc(s.entities[0])}</code>
        <small>${U.esc(U.human(s.why))}: ${s.op === "below" ? `below ${s.value}` : "is on"}, ${s.severity}.</small></span>
        <button class="flat" data-action="ov-add-signal" data-i="${k}"><ha-icon icon="mdi:plus"></ha-icon>Add</button></div>`).join("")
    : `<p class="muted">Nothing else to suggest.</p>`;
  return `<p class="muted small">Watching now (with how many entities match):</p><div class="chips">${have || "none"}</div>
    <h4 style="margin-top:12px">Suggestions</h4>${rows}`;
}

function motionSuggestions(p) {
  const f = fresh(p);
  if (!f) return `<p class="muted">Looking around the house…</p>`;
  if (!f.motion.length) return `<p class="muted">No motion, occupancy or presence sensors found. You can add any entity on Motion &amp; idle.</p>`;
  return `${f.motion.map((m, k) => `<div class="sugg"><span class="grow"><b>${U.esc(m.name)}</b> <code>${U.esc(m.entity)}</code></span>
      <button class="flat" data-action="ov-add-motion" data-i="${k}"><ha-icon icon="mdi:plus"></ha-icon>Add</button></div>`).join("")}
    ${f.motion.length > 1 ? `<div class="row"><button class="flat" data-action="ov-add-motion-all"><ha-icon icon="mdi:plus"></ha-icon>Add all ${f.motion.length}</button></div>` : ""}`;
}

function sleepSuggestions(p) {
  const f = fresh(p);
  if (!nightMode(p)) return `<p class="muted">There is no Night mode. Add one on House modes, with Alfie: Asleep.</p>`;
  const rows = !f ? "" : f.sleep.map((s) => `<div class="sugg"><span class="grow"><b>${U.esc(s.name)}</b> <code>${U.esc(s.entity)}</code></span>
      <button class="flat" data-action="ov-sleep" data-name="${U.esc(s.entity)}">Use this</button></div>`).join("");
  return `${rows}<div class="row"><input data-list="entities" data-entities class="grow" placeholder="Or pick any entity that is on at night">
    <button class="flat" data-add data-action="ov-sleep">Use</button></div>`;
}

// ------------------------------------------------------------ now

// What automations hold (alfie.set_mood and the like), and for how long.
const HOLD_TEXT = { mood: "Mood", alfie: "Alfie", rotation: "Rotation", personality: "Personality" };
function holdsText(p, holds) {
  const rots = Object.fromEntries((p.draft.rotations || []).map((r) => [r.id, r.name]));
  return Object.entries(holds || {}).map(([k, h]) => {
    const mins = h.until ? Math.max(1, Math.round((h.until - Date.now() / 1000) / 60)) : null;
    const left = mins == null ? " until changed" : mins >= 90 ? ` for ${Math.floor(mins / 60)} h ${mins % 60} min more` : ` for ${mins} min more`;
    const name = k === "rotation" ? rots[h.value] || U.human(h.value) : U.human(h.value);
    return `${HOLD_TEXT[k] || k}: <b>${U.esc(name)}</b>${left}`;
  }).join(" · ");
}

export function scene(p, s) {
  const root = p.root;
  const mood = root.querySelector(".nowmood");
  if (!mood || !s) return;
  mood.innerHTML = `<b>${U.esc(L[s.mood?.level] || s.mood?.level)}</b>${s.asleep ? " and asleep" : ""} · ${U.esc(s.reason)}`;
  const info = s.mode_info;
  const held = holdsText(p, s.holds);
  root.querySelector(".nowmode").innerHTML = p.choices?.house_modes === false
    ? held || "Rotation: each card's own"
    : info ? `House mode: <b>${U.esc(info.name)}</b>${s.mode_pick && s.mode_pick !== "auto" ? " (picked by hand)" : ""}${held ? ` · ${held}` : ""}` : "";
  root.querySelector(".nowsigs").innerHTML = (s.signals || []).map((x) => `<div class="nowsig">
      ${U.chip(x.kind === "bad" ? U.human(x.severity) : "Good", x.kind === "bad" ? x.severity : "good")}
      <button class="link" data-action="go" data-section="mood" data-sub="signals" data-open="sig:${U.esc(x.id)}">${U.esc(x.name)}</button></div>`).join("")
    || `<span class="muted">No signal is active.</span>`;
}

export function mount(p) {
  scene(p, p.scene);
  p.loadTriggerStatus();
  if (!p.suggest && !p._suggesting && !p.draft.overview.dismissed) {
    p._suggesting = true;     // one request per visit to the guide
    p.hass.callWS({ type: "alfie/suggest" })
      .then((r) => { p.suggest = r; if (p.sec === "overview") p.render(); })
      .catch(() => { p.suggest = { signals: [], motion: [], sleep: [] }; })
      .finally(() => { p._suggesting = false; });
  }
}

// The guide's ticks follow the preview (how many entities each signal matches).
export function previewed(p) {
  if (p.draft.overview.dismissed || p._ovTicks === ticks(p)) return;
  p._ovTicks = ticks(p);
  p.render();
}
const ticks = (p) => steps(p).map((s) => (s.done ? 1 : 0)).join("");

// ------------------------------------------------------------ editing

export function tool(p, ev) {
  const el = ev.target;
  if (el.dataset?.action !== "ov-import" || ev.type !== "change") return el.dataset?.action === "ov-import";
  const file = el.files?.[0];
  if (!file) return true;
  file.text().then(async (txt) => {
    let raw;
    try { raw = JSON.parse(txt); } catch { alert("That file is not JSON."); return; }
    const r = await p.hass.callWS({ type: "alfie/config/preview", config: raw.config ?? raw, with_config: true });
    if (r.errors?.length) { alert(`That file can't be used:\n\n${r.errors.join("\n")}`); return; }
    p.draft = r.config;
    p.flash("Imported. Check it over, then Save.");
    p.edited(true);
  }).catch((e) => alert(`Import failed: ${e?.message || e}`));
  return true;
}

export function click(p, a, el) {
  const d = p.draft, o = d.overview, f = fresh(p), i = Number(el.dataset.i);
  switch (a) {
    case "ov-hide": o.dismissed = true; p.edited(true); return true;
    case "ov-show": o.dismissed = false; p.suggest = null; p.edited(true); return true;
    case "ov-done": if (!o.done.includes(el.dataset.name)) o.done.push(el.dataset.name); p.edited(true); return true;
    case "ov-copy":
      navigator.clipboard?.writeText(CARD_YAML).then(() => p.flash("Copied.")).catch(() => {});
      return true;
    case "ov-add-signal": {
      const s = f?.signals[i];
      if (!s) return true;
      const repeat = U.clone(p.defaults.signals[0]?.repeat ?? { on_motion: false, every_hours: 0, in_rotation: false, story: "bad_news" });
      d.signals.push({ id: U.slugId(d.signals, s.name, "signal"), name: s.name, entities: [...s.entities], op: s.op, value: s.value,
        kind: s.kind, severity: s.severity, weight: null, match: "any", screen: null, enabled: true, repeat });
      p.edited(true);
      return true;
    }
    case "ov-add-motion": case "ov-add-motion-all": {
      const list = a === "ov-add-motion" ? [f?.motion[i]].filter(Boolean) : f?.motion || [];
      for (const m of list) d.behaviour.motion_sensors.push({ entity: m.entity, action: "notice" });
      p.edited(true);
      return true;
    }
    case "ov-sleep": {
      const ent = el.dataset.name || el.parentElement.querySelector("input")?.value.trim();
      const night = nightMode(p);
      if (!ent || !night) return true;
      night.condition = { entities: [ent], match: "any", op: "is", value: "on" };
      p.edited(true);
      return true;
    }
    case "ov-export": {
      const blob = new Blob([JSON.stringify(p.saved, null, 1)], { type: "application/json" });
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(blob);
      a2.download = "alfie-config.json";
      a2.click();
      setTimeout(() => URL.revokeObjectURL(a2.href), 1000);
      return true;
    }
  }
  return false;
}
