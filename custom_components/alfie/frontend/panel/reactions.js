// The panel's Reactions section: Triggers (when Alfie reacts), Stories (what
// he does then) and Motion & idle (glances at motion, fidgets when nothing
// happens).

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);
const Fm = await import(`../alfie-panel-forms.js${V}`);
let TRANSITIONS = ["cut", "fade"];
try { TRANSITIONS = [...(await import(`../alfie-intros.js${V}`)).STYLES]; } catch { /* the card's own intros are the truth */ }

export const id = "reactions";
export const title = "Reactions";
export const subs = [["triggers", "Triggers"], ["stories", "Stories"], ["motion", "Motion & idle"]];
export const resets = {
  triggers: ["triggers"], stories: ["stories"],
  motion: ["behaviour.motion_sensors", "behaviour.notice", "behaviour.motion_debounce", "behaviour.idle_fidgets", "behaviour.idle_interval"],
};

const L = U.LEVEL_TEXT;
const KIND_TEXT = {
  entity: "An entity changes", motion: "Motion", mood: "The mood changes", signal: "A signal goes bad or recovers",
  wake: "Alfie wakes or sleeps", mode: "A house mode starts or ends",
};
const BUSY_TEXT = [["auto", "By priority: higher interrupts"], ["queue", "Wait its turn"],
  ["interrupt", "Interrupt whatever is playing"], ["skip", "Don't play"]];
const STEP_TEXT = {
  expression: "Expression", animation: "Animation", screen: "Screen", wait: "Wait", move: "Move", resize: "Resize", speak: "Speak",
  icon: "Icon",
};
// Icons (design.md "Icons"): the words for each choice.
const ICON_TEXT = {
  styles: { transform: "Transform: he turns into it", beside: "Beside: he goes to his corner", overlay: "Badge: added to the card" },
  transforms: { whole: "Whole face", ring: "Ring only (his eyes stay)" },
  corners: { card: "Default (the card's)", top_left: "Top left", top_right: "Top right", bottom_left: "Bottom left", bottom_right: "Bottom right" },
  places: { above: "Above him", below: "Below him", left: "Left of him", right: "Right of him", top_left: "Top left",
    top_right: "Top right", bottom_left: "Bottom left", bottom_right: "Bottom right", centre: "Centre", custom: "Custom (x, y)" },
  colors: { line: "Ring colour", accent: "Eye colour", text: "Text colour" },
  fills: { none: "Outline", soft: "Soft fill", solid: "Solid" },
};
const iconOptions = (p, key) => (p.choices.icon?.[key] || Object.keys(ICON_TEXT[key])).map((x) => [x, ICON_TEXT[key][x] || U.human(x)]);
// The icon as HA draws it, beside its name, so a typo shows at once.
const iconPreview = (name) => `<ha-icon class="iconprev" icon="${U.esc(name || "")}" title="${U.esc(name || "")}"></ha-icon>`;
const PLACE_TEXT = { centre: "Centre", top_left: "Top left", top_right: "Top right", bottom_left: "Bottom left", bottom_right: "Bottom right", custom: "Custom (x, y)" };
export const PRESENT_TEXT = [["card", "Default (the card's)"], ["handover", "Hand over: Alfie steps aside"], ["corner", "Corner: Alfie shrinks into a corner"]];
export const transitionOptions = (dflt) => [["", dflt], ...TRANSITIONS.map((x) => [x, U.human(x)]), ["random", "Random: a different one each time"]];

export function render(p, sub) {
  if (sub === "stories") return stories(p);
  if (sub === "motion") return motion(p);
  return triggers(p);
}

export function mount(p, sub) {
  if (sub === "triggers") p.loadTriggerStatus();
}

// ------------------------------------------------------------ triggers

function triggers(p) {
  const trs = p.draft.triggers;
  const kinds = U.select("", "entity", p.choices.trigger_kinds.filter((k) => k !== "mode" /* house modes hidden for now */).map((k) => [k, KIND_TEXT[k] || k]), { attrs: 'id="newkind" aria-label="Fires when"' });
  return `${U.intro("A trigger makes Alfie play a story when something happens: the mood changes, a signal goes bad, an entity changes.",
      `When one change fires several triggers, only the highest priority plays. A story that fires while another plays
      waits its turn or interrupts it, as its "If a story is already playing" says. Automations can play any story too,
      with the <code>alfie.play_story</code> action.`)}
    <p class="playing muted"></p>
    ${trs.map((t, i) => trigger(p, t, i, trs.length)).join("") || U.empty("No triggers yet.")}
    ${U.addRow(kinds, "trig-add", "+ Add trigger")}`;
}

function trigger(p, t, i, n) {
  const open = p.open.has(`t:${t.id}`), c = p.choices, P = `triggers.${i}`;
  const story = p.draft.stories.find((s) => s.id === t.story);
  const names = Object.fromEntries([...p.draft.signals.map((s) => [s.id, s.name]), ...(p.draft.modes || []).map((m) => [m.id, m.name])]);
  const summary = `${U.esc(Fm.triggerSummary(t, names))} → <b>${U.esc(story?.name || t.story || "no story")}</b>`;
  if (!open) {
    return U.item({ key: `t:${t.id}`, i, n, open, enabledPath: `${P}.enabled`, enabled: t.enabled, name: t.name, summary,
      badge: `<span class="badge" data-fired="${U.esc(t.id)}">…</span>`, actions: { toggle: "trig-toggle", up: "trig-up", down: "trig-down" } });
  }
  const levels = c.levels;
  const picks = (key, all, text) => U.picks("trig-pick", i, key, all, t[key], text);
  let own = "";
  if (t.kind === "entity" || t.kind === "motion") {
    own += U.wide(t.kind === "motion" ? "Motion sensors" : "Entities",
      U.entities({ items: t.entities, i, add: "trig-add-ent", rm: "trig-rm-ent" }));
  }
  if (t.kind === "entity") {
    const ops = [["changes", "Changes at all"], ["above", "Goes above"], ["below", "Goes below"], ["is", "Becomes"], ["is_not", "Stops being"]];
    own += `${U.field("When it", U.select(`${P}.op`, t.op, ops, { rerender: true }))}
      ${t.op === "changes" ? "" : ["above", "below"].includes(t.op)
        ? U.field("Value", U.text(`${P}.value`, t.value, { kind: "value", list: "entities", placeholder: "300, or input_number.lux" }),
          "A number, or an entity whose state is the threshold (an input_number, a sensor).")
        : U.field("Value", U.text(`${P}.value`, t.value, { kind: "value" }))}`;
  } else if (t.kind === "motion") {
    own += U.check(`${P}.only_if_bad`, t.only_if_bad, "Only while something is wrong", "A walk-in reminder.");
  } else if (t.kind === "mood") {
    own += `${U.field("When the mood", U.select(`${P}.direction`, t.direction, [["any", "Changes"], ["worse", "Gets worse"], ["better", "Gets better"]]))}
      ${U.wide("From", picks("from", levels, (l) => L[l]), "None picked: any.")}
      ${U.wide("To", picks("to", levels, (l) => L[l]), "None picked: any.")}`;
  } else if (t.kind === "signal") {
    own += `${U.field("When", U.select(`${P}.edge`, t.edge, [["goes_bad", "It goes bad"], ["recovers", "It recovers"], ["either", "Either"]]))}
      ${U.wide("Signals", picks("signals", p.draft.signals.map((s) => s.id), (sid) => names[sid] || sid), "None picked: any.")}`;
  } else if (t.kind === "wake") {
    own += U.field("When Alfie", U.select(`${P}.edge`, t.edge, [["wakes", "Wakes up"], ["sleeps", "Falls asleep"]]));
  } else if (t.kind === "mode") {
    const ms = p.draft.modes || [];
    own += `${U.field("When", U.select(`${P}.edge`, t.edge, [["enter", "It starts"], ["leave", "It ends"], ["either", "It starts or ends"]]))}
      ${U.wide("House modes", picks("modes", ms.map((m) => m.id), (mid) => names[mid] || mid), "None picked: any.")}`;
  }
  const body = `
    ${U.group("Fires when", `
      ${U.field("Name", U.text(`${P}.name`, t.name, { placeholder: "The mood gets worse" }))}
      ${U.field("Fires when", U.select(`${P}.kind`, t.kind, c.trigger_kinds.map((k) => [k, KIND_TEXT[k] || k]), { rerender: true }))}
      ${own}`)}
    ${U.group("Plays", U.field("Story", U.select(`${P}.story`, t.story, p.storyOptions([], [t.story]), { rerender: true })))}
    ${U.more(p, `t:${t.id}`, `
      ${U.field("ID", U.text(`${P}.id`, t.id, { attrs: 'pattern="[a-z0-9_]+" data-rerender' }))}
      ${U.field("Priority", U.num(`${P}.priority`, t.priority, { min: 0, max: 100, step: 1 }), "0 to 100. Higher wins.")}
      ${U.field("If a story is already playing", U.select(`${P}.busy`, t.busy, BUSY_TEXT))}
      ${U.field("Cooldown", U.num(`${P}.cooldown`, t.cooldown, { min: 0, max: 86400, step: 1, unit: "s" }), "Fires at most this often. 0: any time.")}
      ${U.check(`${P}.while_asleep`, t.while_asleep, "Even while he sleeps")}
      ${U.wide("Only while the mood is", picks("moods", levels, (l) => L[l]), "None picked: any.")}`)}`;
  return U.item({ key: `t:${t.id}`, i, n, open, enabledPath: `${P}.enabled`, enabled: t.enabled, name: t.name, summary,
    badge: `<span class="badge" data-fired="${U.esc(t.id)}">…</span>`,
    actions: { toggle: "trig-toggle", up: "trig-up", down: "trig-down", dup: "trig-dup", del: "trig-del" }, body });
}

// ------------------------------------------------------------ stories

function stories(p) {
  const sts = p.draft.stories;
  return `${U.intro("A story is what Alfie does when a trigger fires, on every display together: an expression, an animation, a screen.",
      `Fill in the simple form, or switch to steps for a free sequence. <b>@mood</b> is his mood's face now and
      <b>@old_mood</b> the one before the change. <b>@why</b> shows the screens of the signals that changed, and
      <b>@wrong</b> those of everything that is wrong, one after another.`)}
    ${sts.map((st, i) => story(p, st, i, sts.length)).join("") || U.empty("No stories yet.")}
    ${U.addButton("st-add", "+ Add story")}`;
}

function story(p, st, i, n) {
  const open = p.open.has(`st:${st.id}`), P = `stories.${i}`, uses = Fm.storyUses(p.draft, st.id);
  const count = st.form === "simple" ? Fm.compileSimple(st.simple, p.choices.steps).length : st.steps.length;
  const summary = `${st.form === "simple" ? "Simple" : "Steps"} · ${count} step${count === 1 ? "" : "s"} · ${uses ? `played by ${uses} trigger${uses > 1 ? "s" : ""}` : "no trigger"}`;
  const body = !open ? "" : `
    <div class="grid">${U.field("Name", U.text(`${P}.name`, st.name, { placeholder: "Bad news" }))}</div>
    <div class="row form">${U.seg("st-form", st.form, [["simple", "Simple"], ["steps", "Steps"]], i)}
      ${st.form === "simple" ? `<button class="flat" data-action="st-to-steps" data-i="${i}">Turn into steps</button>` : ""}</div>
    ${st.form === "simple" ? simple(p, st, i) : steps(p, st, i)}
    ${U.more(p, `st:${st.id}`, U.field("ID", U.text(`${P}.id`, st.id, { attrs: 'pattern="[a-z0-9_]+" data-rerender' }),
      "Used by triggers and <code>alfie.play_story</code>."))}`;
  return U.item({ key: `st:${st.id}`, i, n, open, name: st.name, summary: U.esc(summary),
    actions: { toggle: "st-toggle", up: "st-up", down: "st-down", dup: "st-dup", del: "st-del" }, body,
    footer: `<button class="primary" data-action="st-play" data-i="${i}">Play on every display</button>` });
}

const exprOptions = (p, none) => [...(none ? [["", none]] : []), ["@mood", "@mood: his mood's face"], ["@old_mood", "@old_mood: before the change"],
  ...p.choices.expressions.map((e) => [e, U.human(e)])];
const screenOptions = (none) => [...(none ? [["", none]] : []), ["@why", "@why: what changed"], ["@wrong", "@wrong: everything wrong"]];
const animOptions = (p, none) => [...(none ? [["", none]] : []), ...p.choices.animations.map((a) => [a, U.human(a)])];

function simple(p, st, i) {
  const t = st.simple, P = `stories.${i}.simple`;
  return `<p class="muted">React, then show an icon and a screen, then close. Leave a part empty to skip it.</p>
    ${U.group("React", `
      ${U.field("Expression", U.select(`${P}.expression`, t.expression, exprOptions(p, "None")))}
      ${U.field("Animation", U.select(`${P}.animation`, t.animation, animOptions(p, "None")))}`)}
    ${U.group("Icon", `
      ${U.field("Icon", `<span class="row">${iconPreview(t.icon)}${U.text(`${P}.icon`, t.icon, { placeholder: "None, or mdi:lightbulb-on", attrs: 'data-rerender data-icons="one" autocomplete="off"' })}</span>`,
        "Any icon Home Assistant can show.")}
      ${U.field("Style", U.select(`${P}.icon_style`, t.icon_style, iconOptions(p, "styles")))}`)}
    ${U.group("Show", `
      ${U.field("Screen", p.screenSelect(`${P}.screen`, t.screen, screenOptions("No screen")))}
      ${U.field("For", U.num(`${P}.seconds`, t.seconds, { min: 3, max: 3600, step: 1, unit: "s" }))}
      ${U.field("Presenting", U.select(`${P}.present`, t.present, PRESENT_TEXT))}
      ${U.field("Transition", U.select(`${P}.transition`, t.transition, transitionOptions("Default (the card's)")))}`)}
    ${U.group("Close", U.field("Animation", U.select(`${P}.closing`, t.closing, animOptions(p, "None"))))}`;
}

function steps(p, st, i) {
  const rows = st.steps.map((s, j) => `<div class="row step">
      <span class="muted n">${j + 1}.</span>${U.chip(STEP_TEXT[s.kind] || s.kind)}
      ${stepFields(p, s, `stories.${i}.steps.${j}`)}
      <span class="tools">
        <button class="icon" data-action="st-step-up" data-i="${i}" data-j="${j}" ${j ? "" : "disabled"} title="Move up">▲</button>
        <button class="icon" data-action="st-step-down" data-i="${i}" data-j="${j}" ${j < st.steps.length - 1 ? "" : "disabled"} title="Move down">▼</button>
        <button class="icon" data-action="st-step-rm" data-i="${i}" data-j="${j}" title="Remove">✕</button></span></div>`).join("");
  const kinds = U.select("", "expression", p.choices.step_kinds.map((k) => [k, STEP_TEXT[k] || k]), { attrs: 'aria-label="Step"' });
  return `<div class="steps">${rows || U.empty("No steps yet.")}</div>
    <div class="row addrow">${kinds}<button class="add" data-action="st-step-add" data-i="${i}">+ Add step</button></div>
    <style>.steps .step { padding: 6px 0; border-bottom: 1px solid var(--line); } .steps .n { width: 22px; }
      .steps .secs { width: 84px; } .row.form { margin: 8px 0 4px; }
      .steps .step { flex-wrap: wrap; } .steps .stepmore { flex-basis: 100%; padding-left: 22px; }
      .iconprev { --mdc-icon-size: 22px; color: var(--accent, currentColor); } .steps .iconname { width: 190px; }</style>`;
}

function stepFields(p, s, P) {
  const secs = (key, lo, hi, unit = "s") => `<span class="unit secs"><input type="number" data-path="${P}.${key}" data-kind="number"
    min="${lo}" max="${hi}" step="any" value="${U.esc(s[key])}"${unit ? "" : ` aria-label="${key}"`}>${unit ? `<span>${unit}</span>` : ""}</span>`;
  switch (s.kind) {
    case "expression":
      return `${U.select(`${P}.name`, s.name, exprOptions(p))} hold ${secs("hold", 0, 3600)} blend ${secs("blend", 0, 10)}`;
    case "animation":
      return `${U.select(`${P}.name`, s.name, animOptions(p))}
        <label class="check">${U.toggle(`${P}.wait`, s.wait)}<span>Wait for it</span></label>`;
    case "screen":
      return `${p.screenSelect(`${P}.screen`, s.screen, screenOptions())} for ${secs("seconds", 3, 3600)}
        ${U.select(`${P}.present`, s.present, PRESENT_TEXT)}
        ${U.select(`${P}.transition`, s.transition, transitionOptions("Default (the card's)"))}`;
    case "wait": return secs("seconds", 0, 3600);
    case "move":
      return `to ${U.select(`${P}.to`, s.to, p.choices.places.map((x) => [x, PLACE_TEXT[x] || x]), { rerender: true })}
        ${s.to === "custom" ? `x ${secs("x", -1, 1, "")} y ${secs("y", -1, 1, "")}` : ""} over ${secs("seconds", 0, 10)}`;
    case "resize": return `to ${secs("scale", 0.3, 1.5, "×")} over ${secs("seconds", 0, 10)}`;
    case "speak":
      return `<input class="grow" data-path="${P}.text" value="${U.esc(s.text)}" placeholder="Something to say">
        <small class="muted">Speaking comes with Voice; until then this step is skipped.</small>`;
    case "icon": return iconFields(p, s, P, secs);
    default: return "";
  }
}

// An icon step: the icon, how it shows, for how long; its look under More.
function iconFields(p, s, P, secs) {
  const sel = (key, list, opts = {}) => U.select(`${P}.${key}`, s[key], iconOptions(p, list), opts);
  const how = s.style === "transform" ? sel("transform", "transforms")
    : s.style === "beside" ? `in ${sel("corner", "corners")}`
    : `at ${sel("place", "places", { rerender: true })}${s.place === "custom" ? ` x ${secs("x", -1, 1, "")} y ${secs("y", -1, 1, "")}` : ""}`;
  const own = s.style === "transform" ? "" : U.field("Transition", U.select(`${P}.transition`, s.transition,
    transitionOptions(s.style === "beside" ? "Default (the card's)" : "Default (zoom)")));
  const key = `icon:${P}`;
  return `${iconPreview(s.icon)}<input class="iconname" data-path="${P}.icon" value="${U.esc(s.icon)}" placeholder="mdi:lightbulb-on" data-rerender data-icons="one" autocomplete="off">
    ${sel("style", "styles", { rerender: true })} ${how} for ${secs("seconds", 1, 3600)}
    ${s.style === "overlay" ? `<label class="check">${U.toggle(`${P}.wait`, s.wait)}<span>Wait for it</span></label>` : ""}
    <button class="flat" data-action="st-step-try" data-path="${P}" title="Show it on the Alfie beside this page">Try it</button>
    <div class="stepmore">${U.more(p, key, `
      ${U.field("Size", U.num(`${P}.size`, s.size, { min: 0.3, max: 2, step: 0.05, unit: "×" }), "1 is its usual size.")}
      ${U.field("Colour", sel("color", "colors"))}
      ${U.field("Fill", sel("fill", "fills"))}
      ${own}`)}</div>`;
}

// ------------------------------------------------------------ motion & idle

function motion(p) {
  const b = p.draft.behaviour, anims = p.choices.animations;
  const rows = b.motion_sensors.map((g, i) => `<div class="row sensor">
      <input list="entities" class="grow" data-path="behaviour.motion_sensors.${i}.entity" value="${U.esc(g.entity)}" placeholder="binary_sensor.hall_motion">
      ${U.select(`behaviour.motion_sensors.${i}.action`, g.action, [["notice", "Notice you: one of the set below"], ...anims.map((a) => [a, U.human(a)])])}
      <button class="icon" data-action="mo-rm" data-i="${i}" title="Remove" aria-label="Remove">✕</button></div>`).join("");
  return `${U.intro("When a motion sensor turns on, Alfie glances that way or notices you. When nothing happens for a while, he fidgets.")}
    <h3>Motion sensors</h3>
    ${rows || U.empty("No motion sensors yet. Get started on the Overview can find them for you.")}
    ${U.addButton("mo-add", "+ Add motion sensor")}
    ${U.group("", U.field("Debounce", U.num("behaviour.motion_debounce", b.motion_debounce, { min: 0, max: 600, step: 1, unit: "s" }),
      "A run of motion within this is one reaction."))}
    <h4>"Notice you" picks one of</h4>${U.picks("mo-set", undefined, "notice", anims, b.notice)}
    <h3>Idle</h3>
    ${U.group("", U.field("Between fidgets", U.num("behaviour.idle_interval", b.idle_interval, { min: 10, max: 3600, step: 5, unit: "s" }),
      "When content. Lively moods fidget more often and sad ones less; Personality scales it too."))}
    <h4>Fidgets</h4>${U.picks("mo-set", undefined, "idle_fidgets", anims, b.idle_fidgets)}
    <style>.sensor select { max-width: 260px; }</style>`;
}

// ------------------------------------------------------------ editing

export function beforeInput(p, path, v, el) {
  let m = /^triggers\.(\d+)\.(kind|id|name)$/.exec(path);
  if (m) {
    const trs = p.draft.triggers, i = Number(m[1]), old = trs[i].id;
    const follow = (from, to) => Fm.renameModeRefs(p.draft, "trigger", from, to);
    if (m[2] === "kind") {
      trs[i] = Fm.changeTriggerKind(trs[i], U.clone(p.choices.triggers[v]));
      p.edited(true);
      return false;
    }
    if (m[2] === "id") { p.manualId("t", old); follow(old, v); p.renameOpen("t", old, v); }
    else p.nameToId("t", trs, i, v, "trigger", `triggers.${i}.id`, follow);
    return;
  }
  m = /^stories\.(\d+)\.(id|name)$/.exec(path);
  if (m) {
    const sts = p.draft.stories, i = Number(m[1]), old = sts[i].id;
    const follow = (from, to) => Fm.renameStoryRefs(p.draft, from, to);
    if (m[2] === "id") { p.manualId("st", old); follow(old, v); p.renameOpen("st", old, v); }
    else p.nameToId("st", sts, i, v, "story", `stories.${i}.id`, follow);
  }
}

export function afterInput(p, path, v, el) {
  if (/^(triggers|stories)\.\d+\.name$/.test(path)) {
    const head = el.closest(".item")?.querySelector(".name");
    if (head) head.textContent = v || "(no name)";
  }
}

export function click(p, a, el) {
  const d = p.draft, trs = d.triggers, sts = d.stories, i = Number(el.dataset.i), j = Number(el.dataset.j);
  const toggleIn = (list, name) => { const k = list.indexOf(name); k >= 0 ? list.splice(k, 1) : list.push(name); };
  switch (a) {
    // triggers
    case "trig-toggle": p.flip(`t:${trs[i].id}`); return true;
    case "trig-add": {
      const kind = p.root.querySelector("#newkind")?.value || "entity";
      const t = { ...U.clone(p.choices.triggers[kind]), id: U.slugId(trs, `${kind} trigger`, "trigger"), story: sts[0]?.id || "" };
      trs.push(t);
      p.autoId("t", t.id);
      p.open.add(`t:${t.id}`);
      p.edited(true);
      return true;
    }
    case "trig-dup": {
      const t = U.clone(trs[i]);
      t.id = U.slugId(trs, `${t.id}_copy`, "trigger");
      t.name = t.name ? `${t.name} (copy)` : "";
      trs.splice(i + 1, 0, t);
      p.open.add(`t:${t.id}`);
      p.edited(true);
      return true;
    }
    case "trig-del":
      if (!confirm(`Delete the trigger "${trs[i].name || trs[i].id}"?`)) return true;
      for (const m of d.modes || []) m.triggers_off = m.triggers_off.filter((x) => x !== trs[i].id);
      trs.splice(i, 1);
      p.edited(true);
      return true;
    case "trig-up": case "trig-down":
      if (Fm.moveItem(trs, i, a === "trig-up" ? i - 1 : i + 1)) p.edited(true);
      return true;
    case "trig-pick": toggleIn(trs[i][el.dataset.key], el.dataset.name); p.edited(true); return true;
    case "trig-add-ent": {
      const v = el.parentElement.querySelector("input").value.trim();
      if (!v) return true;
      if (!trs[i].entities.includes(v)) trs[i].entities.push(v);
      if (!trs[i].name) {
        trs[i].name = p.hass.states[v]?.attributes?.friendly_name || v;
        p.nameToId("t", trs, i, trs[i].name, "trigger", `triggers.${i}.id`, (f, t) => Fm.renameModeRefs(d, "trigger", f, t));
      }
      p.edited(true);
      return true;
    }
    case "trig-rm-ent": trs[i].entities.splice(j, 1); p.edited(true); return true;
    // stories
    case "st-toggle": p.flip(`st:${sts[i].id}`); return true;
    case "st-add": {
      const st = { id: U.slugId(sts, "story", "story"), name: "", form: "simple", simple: U.clone(p.choices.simple), steps: [] };
      sts.push(st);
      p.autoId("st", st.id);
      p.open.add(`st:${st.id}`);
      p.edited(true);
      return true;
    }
    case "st-dup": {
      const st = U.clone(sts[i]);
      st.id = U.slugId(sts, `${st.id}_copy`, "story");
      st.name = st.name ? `${st.name} (copy)` : "";
      sts.splice(i + 1, 0, st);
      p.open.add(`st:${st.id}`);
      p.edited(true);
      return true;
    }
    case "st-del": {
      const n = Fm.storyUses(d, sts[i].id);
      if (!confirm(`Delete the story "${sts[i].name || sts[i].id}"?${n ? ` ${n} trigger${n > 1 ? "s" : ""} play it: point them at another story before saving.` : ""}`)) return true;
      sts.splice(i, 1);
      p.edited(true);
      return true;
    }
    case "st-up": case "st-down":
      if (Fm.moveItem(sts, i, a === "st-up" ? i - 1 : i + 1)) p.edited(true);
      return true;
    case "st-form": sts[i].form = el.dataset.name; p.edited(true); return true;
    case "st-to-steps":
      sts[i].steps = Fm.compileSimple(sts[i].simple, p.choices.steps);
      sts[i].form = "steps";
      p.edited(true);
      return true;
    case "st-step-add": {
      const kind = el.parentElement.querySelector("select")?.value || "wait";
      sts[i].steps.push(U.clone(p.choices.steps[kind]));
      p.edited(true);
      return true;
    }
    case "st-step-rm": sts[i].steps.splice(j, 1); p.edited(true); return true;
    case "st-step-up": case "st-step-down":
      if (Fm.moveItem(sts[i].steps, j, a === "st-step-up" ? j - 1 : j + 1)) p.edited(true);
      return true;
    case "st-play": playStory(p, i, el); return true;
    case "st-step-try": {
      const step = el.dataset.path.split(".").reduce((o, k) => o?.[k], d);
      if (step && p.face?.showIconLocal) p.face.showIconLocal(step);
      return true;
    }
    // motion & idle
    case "mo-add": d.behaviour.motion_sensors.push({ entity: "", action: "notice" }); p.edited(true); return true;
    case "mo-rm": d.behaviour.motion_sensors.splice(i, 1); p.edited(true); return true;
    case "mo-set": {
      toggleIn(d.behaviour[el.dataset.key], el.dataset.name);
      el.classList.toggle("on");
      p.edited();
      return true;
    }
  }
  return false;
}

async function playStory(p, i, el) {
  try {
    await p.hass.callWS({ type: "alfie/story/play", draft: U.clone(p.draft.stories[i]) });
    el.textContent = "Playing…";
    setTimeout(() => { el.textContent = "Play on every display"; }, 2000);
  } catch (e) {
    alert(`Can't play it yet: ${e?.message || e}`);
  }
}
