// The panel's Mood section: Signals (what Alfie watches) and Levels (how the
// signals combine into a mood, and each mood level's look).

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);
const Fm = await import(`../alfie-panel-forms.js${V}`);

export const id = "mood";
export const title = "Mood";
export const subs = [["signals", "Signals"], ["levels", "Levels"]];
export const resets = { signals: ["signals"], levels: ["mood"] };

const L = U.LEVEL_TEXT;
const OPS = [["above", "Above"], ["below", "Below"], ["is", "Is"], ["is_not", "Is not"]];
const COMBINE_TEXT = {
  worst: ["Worst one wins", "The most severe bad signal alone sets the mood, by the ladder below. A good signal with nothing bad makes him bubbly."],
  weighted: ["Weighted", "Bad signals take away their weight, good ones add theirs, and the total falls into a level by the thresholds below."],
  count: ["Simple count", "Each good signal cancels one bad one, and what is left sets the level."],
};

export function render(p, sub) {
  return sub === "levels" ? levels(p) : signals(p);
}

// ------------------------------------------------------------ signals

function signals(p) {
  const sigs = p.draft.signals;
  return `${U.intro(`A signal is something about the house that is good or bad. Alfie's mood comes from the ones
      that are active right now (see Levels).`,
      `A signal watches one or more entities. Each can be a pattern such as <code>binary_sensor.*_battery_low</code>,
      so one signal covers every battery in the house. It is active when any of them (or all, under More options)
      passes its test.`)}
    <div class="draft-mood"></div>
    ${U.list({ items: sigs.map((s, i) => signal(p, s, i, sigs.length)).join(""), empty: "No signals yet.",
      add: U.addButton("sig-add", "+ Add signal"), what: "a signal" })}`;
}

function signalSummary(s) {
  const op = OPS.find(([o]) => o === s.op)?.[1].toLowerCase();
  if (s.entities.length < 2) return `${s.entities[0] || "No entity"} ${op} ${s.value}`;
  return s.match === "all" ? `All ${s.entities.length} entities are ${op.replace(/^is ?/, "")} ${s.value}`.replace("are  ", "are ")
    : `Any of ${s.entities.length} entities ${op} ${s.value}`;
}

function signal(p, s, i, n) {
  const open = p.open.has(`sig:${s.id}`), P = `signals.${i}`;
  const numeric = s.op === "above" || s.op === "below";
  const first = p.hass.states[s.entities.find((e) => !/[*?[]/.test(e))];
  const opts = new Set(["on", "off", ...(first?.attributes?.options || []), ...(first ? [first.state] : [])]);
  // Bad shows how bad (its severity); good is just good.
  const chips = s.kind === "bad" ? U.chip(U.human(s.severity), `bad ${s.severity}`) : U.chip("Good", "good");
  const body = !open ? "" : `
    ${U.group("Watches", `
      ${U.field("Name", U.text(`${P}.name`, s.name, { placeholder: "The Monstera is dry" }))}
      ${U.idField(`${P}.id`, s.id, "triggers and the <code>alfie_signal</code> event", U.automation.signal(s.id))}
      ${U.wide("Entities", U.entities({ items: s.entities, i, add: "sig-add-ent", rm: "sig-rm-ent" }))}
      ${U.field("Is", U.select(`${P}.op`, s.op, OPS, { rerender: true }))}
      ${U.field("Value", numeric
        ? `<input type="number" step="any" data-path="${P}.value" data-kind="value" value="${U.esc(s.value)}">`
        : `<input list="vals-${i}" data-path="${P}.value" data-kind="value" value="${U.esc(s.value)}">
           <datalist id="vals-${i}">${[...opts].map((o) => `<option value="${U.esc(o)}">`).join("")}</datalist>`)}`)}
    ${U.group("Counts as", `
      ${U.field("Good or bad", U.select(`${P}.kind`, s.kind, [["bad", "Bad: something is wrong"], ["good", "Good: something is right"]], { rerender: true }))}
      ${s.kind === "bad" ? U.field("How bad", U.select(`${P}.severity`, s.severity, p.choices.severities.map((v) => [v, U.human(v)]), { rerender: true })) : ""}`)}
    ${U.more(p, `sig:${s.id}`, `
      ${U.field("With several entities", U.select(`${P}.match`, s.match, [["any", "Any one passing is enough"], ["all", "All must pass"]]))}
      ${U.field("Weight", U.num(`${P}.weight`, s.weight, { min: 0, max: 100, empty: "null" }),
        `For the Weighted mood. Empty: the ${s.kind === "bad" ? "severity's" : "good"} weight.`)}
      ${U.field("Screen that explains it", p.screenSelect(`${P}.screen`, s.screen || "", [["", "None"]]),
        "Stories show it for @why and @wrong.")}
      ${s.kind === "bad" ? repeat(p, s, P) : ""}`)}
    <h4>Matching entities</h4><div data-matches="${U.esc(s.id)}"></div>`;
  return U.item({ key: `sig:${s.id}`, i, n, open, cls: "signal", enabledPath: `${P}.enabled`, enabled: s.enabled,
    chips, name: s.name, summary: U.esc(signalSummary(s)), badge: `<span class="badge" data-badge="${U.esc(s.id)}">…</span>`,
    actions: { toggle: "sig-toggle", up: "sig-up", down: "sig-down", dup: "sig-dup", del: "sig-del" }, body });
}

function repeat(p, s, P) {
  const r = s.repeat || {};
  return `<div class="wide"><h4>Repeat while it's bad</h4></div>
    ${U.check(`${P}.repeat.on_motion`, r.on_motion, "Tell it again when someone walks in",
      "On any motion sensor (Reactions → Motion &amp; idle), at most every 15 minutes.")}
    ${U.field("Tell it again every", U.num(`${P}.repeat.every_hours`, r.every_hours, { min: 0, max: 168, step: 0.5, unit: "h" }), "0: never.")}
    ${U.field("Story to tell it with", U.select(`${P}.repeat.story`, r.story, p.storyOptions([], [r.story])))}
    ${U.check(`${P}.repeat.in_rotation`, r.in_rotation, "Add its screen to the rotation", "On rotation cards, while it's bad.")}`;
}

// ------------------------------------------------------------ levels

function levels(p) {
  const m = p.draft.mood, c = p.choices;
  const modes = c.combine.map((k) => `<label class="card radio ${m.combine === k ? "on" : ""}">
      <input type="radio" name="combine" value="${k}" data-path="mood.combine" data-rerender ${m.combine === k ? "checked" : ""}>
      <span><b>${COMBINE_TEXT[k][0]}</b><small>${COMBINE_TEXT[k][1]}</small></span></label>`).join("");
  const lv = (l) => [l, L[l]];
  let knobs;
  if (m.combine === "worst") {
    knobs = U.group("The ladder: the worst bad signal sets", c.severities.map((sev) =>
      U.field(`${U.human(sev)}`, U.select(`mood.ladder.${sev}`, m.ladder[sev], c.levels.map(lv)))).join(""));
  } else if (m.combine === "weighted") {
    knobs = `${U.group("Weights", ["minor", "major", "critical", "good"].map((k) =>
      U.field(k === "good" ? "A good signal" : `A ${k} bad signal`, U.num(`mood.weights.${k}`, m.weights[k], { min: 0, max: 100, step: 0.5 }))).join(""))}
      ${U.group("A score at or above this reaches", ["bubbly", "content", "uneasy", "sad"].map((l) =>
        U.field(L[l], U.num(`mood.thresholds.${l}`, m.thresholds[l], { min: -100, max: 100, step: 0.5 }))).join("")
        + `<p class="muted wide">Below Sad is Miserable.</p>`)}`;
  } else {
    knobs = U.group("Good minus bad, at or above this, reaches", ["bubbly", "content", "uneasy", "sad"].map((l) =>
      U.field(L[l], U.num(`mood.count_thresholds.${l}`, m.count_thresholds[l], { min: -100, max: 100, step: 1 }))).join("")
      + `<p class="muted wide">Below Sad is Miserable.</p>`);
  }
  const rows = c.levels.map((l) => `<div class="card level" data-level="${l}">
      <alfie-card class="mini"></alfie-card>
      <div class="grow"><b>${L[l]}</b>
        ${U.field("Expression", U.select(`mood.expressions.${l}`, m.expressions[l], c.expressions.map((e) => [e, U.human(e)])))}
        <label class="slider"><span>Energy</span>
          <input type="range" min="0.05" max="1.5" step="0.05" data-path="mood.energy.${l}" data-kind="number" value="${m.energy[l]}">
          <output>${p.fmt(m.energy[l])}</output></label>
      </div></div>`).join("");
  return `${U.intro("Alfie has five mood levels, from Bubbly to Miserable. Choose how the active signals combine into one, then how each level looks.")}
    <div class="draft-mood"></div>
    <h3>How signals combine</h3><div class="combine">${modes}</div>${knobs}
    <h3>Each level's look</h3>
    ${U.intro("Energy sets how quick, big and bouncy he is in that mood: 1 is lively, low is slow and small.")}
    <div class="levels">${rows}</div>
    <style>
      .combine { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
      .radio { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; margin: 0; }
      .radio.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
      .levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; }
      .level { display: flex; gap: 14px; align-items: center; margin: 0; }
      .level .grow { min-width: 0; display: grid; gap: 6px; }
      .level .slider { grid-template-columns: auto 1fr auto; }
      .level .slider > span { grid-column: auto; color: var(--muted); font-size: 12px; }
      alfie-card.mini { width: 96px; flex: none; display: block; background: #000; border-radius: 10px; overflow: hidden; }
    </style>`;
}

function drawLevel(p, el) {
  const card = el.querySelector("alfie-card");
  if (!card?.renderStill) return;
  const l = el.dataset.level, m = p.draft.mood;
  if (!card._configured) { card.setConfig({ card: false, padding: 0.06 }); card._configured = true; }
  card.renderStill({ expression: m.expressions[l], energy: Number(m.energy[l]) });
}

export function mount(p, sub) {
  if (sub === "levels") p.root.querySelectorAll(".level").forEach((el) => drawLevel(p, el));
}

// ------------------------------------------------------------ editing

export function beforeInput(p, path, v) {
  const m = /^signals\.(\d+)\.(id|name)$/.exec(path);
  if (!m) return;
  const sigs = p.draft.signals, i = Number(m[1]), old = sigs[i].id;
  const follow = (from, to) => {
    for (const t of p.draft.triggers || []) if (t.kind === "signal") t.signals = t.signals.map((x) => (x === from ? to : x));
  };
  if (m[2] === "id") {
    p.manualId("sig", old);
    follow(old, v);
    p.renameOpen("sig", old, v);
  } else {
    p.nameToId("sig", sigs, i, v, "signal", `signals.${i}.id`, follow);
  }
}

export function afterInput(p, path, v, el) {
  if (/^signals\.\d+\.name$/.test(path)) {
    const head = el.closest(".item")?.querySelector(".name");
    if (head) head.textContent = v || "(no name)";
  }
  if (path.startsWith("mood.") && el.closest(".level")) drawLevel(p, el.closest(".level"));
}

export function click(p, a, el) {
  const sigs = p.draft.signals, i = Number(el.dataset.i);
  switch (a) {
    case "sig-toggle": p.flip(`sig:${sigs[i].id}`); return true;
    case "sig-add": {
      const sid = U.slugId(sigs, "new signal", "signal");
      sigs.push({ id: sid, name: "", entities: [], op: "below", value: 15, kind: "bad", severity: "major",
        weight: null, match: "any", screen: null, enabled: true, repeat: U.clone(p.defaults.signals[0]?.repeat
          ?? { on_motion: false, every_hours: 0, in_rotation: false, story: "bad_news" }) });
      p.autoId("sig", sid);
      p.open.add(`sig:${sid}`);
      p.edited(true);
      return true;
    }
    case "sig-dup": {
      const s = U.clone(sigs[i]);
      s.id = U.slugId(sigs, `${s.id}_copy`, "signal");
      p.autoId("sig", s.id);
      s.name = `${s.name} (copy)`;
      sigs.splice(i + 1, 0, s);
      p.open.add(`sig:${s.id}`);
      p.edited(true);
      return true;
    }
    case "sig-del":
      if (!confirm(`Delete the signal "${sigs[i].name || sigs[i].id}"?`)) return true;
      for (const t of p.draft.triggers || []) if (t.kind === "signal") t.signals = t.signals.filter((x) => x !== sigs[i].id);
      sigs.splice(i, 1);
      p.edited(true);
      return true;
    case "sig-up": case "sig-down":
      if (Fm.moveItem(sigs, i, a === "sig-up" ? i - 1 : i + 1)) p.edited(true);
      return true;
    case "sig-add-ent": {
      const v = el.parentElement.querySelector("input").value.trim();
      if (!v) return true;
      if (!sigs[i].entities.includes(v)) sigs[i].entities.push(v);
      if (!sigs[i].name) {
        sigs[i].name = p.hass.states[v]?.attributes?.friendly_name || v;
        p.nameToId("sig", sigs, i, sigs[i].name, "signal", `signals.${i}.id`);
      }
      p.edited(true);
      return true;
    }
    case "sig-rm-ent":
      sigs[i].entities.splice(Number(el.dataset.j), 1);
      p.edited(true);
      return true;
  }
  return false;
}
