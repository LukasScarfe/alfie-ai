// The panel's House modes section: what kind of time it is (night, away, your
// own), and what each one makes Alfie.

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);
const Fm = await import(`../alfie-panel-forms.js${V}`);

export const id = "modes";
export const title = "House modes";
export const subs = [];
export const resets = { "": ["modes", "behaviour.sleep_expression"] };

const L = U.LEVEL_TEXT;
const SHORT = { awake: "Awake", asleep: "Asleep", quiet: "Quiet", hidden: "Hidden" };
const ALFIE_HINT = { awake: "As usual.", asleep: "His sleeping face; only bad enough news wakes him.",
  quiet: "No fidgets or glances, and calmer.", hidden: "Cards draw nothing, until a story brings him on." };

export function render(p) {
  const ms = p.draft.modes, b = p.draft.behaviour;
  const pick = [["auto", "Auto: follow the conditions"], ["normal", "Normal: no house mode"],
    ...(p.saved.modes || []).map((m) => [m.id, m.name || m.id])];
  return `${U.intro("A house mode is what kind of time it is: night, away, or one of your own. Alfie is in one at a time: the first in this list whose condition holds.",
      "A mode with no condition is only ever picked by hand, here or with the <code>select.alfie_mode</code> entity. Each mode can put Alfie to sleep, quieten him, hold back bad news, fix his mood, change his personality or what rotation cards show, and switch triggers off.")}
    <div class="card now">
      <div class="grow"><h4>Now</h4><span class="modenow"></span></div>
      ${U.field("House mode", U.select("", p.scene?.mode_pick || "auto", pick, { attrs: 'id="modepick"' }))}
    </div>
    ${U.list({ items: ms.map((m, i) => mode(p, m, i, ms.length)).join(""), empty: "No house modes: Alfie is always himself.",
      add: U.addButton("mode-add", "+ Add house mode"), what: "a house mode" })}
    <h3>Asleep</h3>
    ${U.group("", U.field("Asleep, Alfie looks", U.select("behaviour.sleep_expression", b.sleep_expression, p.choices.expressions.map((e) => [e, U.human(e)]))))}
    <style>.card.now { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; } .card.now .field { min-width: 240px; }</style>`;
}

function mode(p, m, i, n) {
  const open = p.open.has(`m:${m.id}`), c = p.choices, P = `modes.${i}`;
  const badge = `<span class="badge good" data-mode-now="${U.esc(m.id)}" hidden>Now</span>`;
  const chips = m.alfie !== "awake" ? U.chip(SHORT[m.alfie]) : "";
  if (!open) {
    return U.item({ key: `m:${m.id}`, i, n, open, enabledPath: `${P}.enabled`, enabled: m.enabled, chips, name: m.name,
      summary: U.esc(Fm.modeSummary(m)), badge, actions: { toggle: "mode-toggle", up: "mode-up", down: "mode-down" } });
  }
  const cond = m.condition;
  const levels = [["", "Default (as the signals say)"], ...c.levels.map((l) => [l, L[l]])];
  const presets = Object.keys(c.personalities).filter((k) => k !== "custom");
  const rots = [["", "Default (the card's own)"], ["pause", "Pause it"], ...p.draft.rotations.map((r) => [r.id, r.name || r.id])];
  if (m.rotation && !rots.some(([v]) => v === m.rotation)) rots.push([m.rotation, `${m.rotation} (missing)`]);
  const when = cond ? `
      ${U.wide("While", U.entities({ items: cond.entities, i, add: "mode-add-ent", rm: "mode-rm-ent" }))}
      ${cond.entities.length > 1 ? U.field("Match", U.select(`${P}.condition.match`, cond.match, [["any", "Any of them"], ["all", "All of them"]])) : ""}
      ${U.field("Is", U.select(`${P}.condition.op`, cond.op, c.operators.map((o) => [o, U.human(o)])))}
      ${U.field("Value", U.text(`${P}.condition.value`, cond.value, { kind: "value" }))}` : "";
  const body = `
    ${U.group("When", `
      ${U.field("Name", U.text(`${P}.name`, m.name, { placeholder: "Night" }))}
      ${U.idField(`${P}.id`, m.id, "triggers and <code>select.alfie_mode</code>")}
      <label class="check wide">${U.toggle(null, !!cond, { action: "mode-cond", i })}<span><b>Has a condition</b>
        <small>Off: only when picked by hand.</small></span></label>
      ${when}`)}
    ${U.group("Then", `
      ${U.field("Alfie is", U.select(`${P}.alfie`, m.alfie, Object.entries(SHORT), { rerender: true }), ALFIE_HINT[m.alfie])}
      ${m.alfie === "asleep" ? U.field("Woken by", U.select(`${P}.wake`, m.wake, [["critical", "Something critical"], ["major", "Something major or worse"], ["never", "Nothing"]])) : ""}
      ${U.field("Hold back bad news", U.select(`${P}.hold_back`, m.hold_back, [["none", "None"], ["minor", "Minor"], ["major", "Minor and major"]]),
        "Held-back signals don't touch his mood or play stories in this mode.")}
      ${U.field("Rotation cards show", U.select(`${P}.rotation`, m.rotation, rots))}`)}
    ${U.more(p, `m:${m.id}`, `
      ${U.field("Mood at least", U.select(`${P}.mood_floor`, m.mood_floor, levels))}
      ${U.field("Mood fixed at", U.select(`${P}.mood_fixed`, m.mood_fixed, levels))}
      ${U.field("Personality", U.select(`${P}.personality`, m.personality, [["", "Default (Alfie's personality)"], ...presets.map((x) => [x, U.human(x)])]))}
      ${U.field("Energy", U.num(`${P}.energy_bias`, m.energy_bias, { min: -0.5, max: 0.5, step: 0.05, empty: "null" }), "Added to every mood's energy. Empty: the personality's.")}
      ${U.field("Fidgeting", U.num(`${P}.fidget_rate`, m.fidget_rate, { min: 0, max: 4, step: 0.1, empty: "null" }), "Empty: the personality's.")}
      ${U.wide("Triggers off in this mode", U.picks("mode-trig-off", i, "triggers_off", p.draft.triggers.map((t) => t.id), m.triggers_off,
        (tid) => p.draft.triggers.find((t) => t.id === tid)?.name || tid))}`)}`;
  return U.item({ key: `m:${m.id}`, i, n, open, enabledPath: `${P}.enabled`, enabled: m.enabled, chips, name: m.name,
    summary: U.esc(Fm.modeSummary(m)), badge, actions: { toggle: "mode-toggle", up: "mode-up", down: "mode-down", dup: "mode-dup", del: "mode-del" }, body });
}

export function mount(p) { scene(p, p.scene); }

export function scene(p, s) {
  const el = p.root.querySelector(".modenow");
  if (!el) return;
  const info = s?.mode_info;
  el.innerHTML = info ? `<b>${U.esc(info.name)}</b>${info.why?.length ? ` <span class="muted">(${U.esc(info.why.join(", "))})</span>` : ""}${s.mode_pick && s.mode_pick !== "auto" ? ", picked by hand" : ""}` : "";
  const pick = p.root.querySelector("#modepick");
  if (pick && s?.mode_pick && pick !== p.root.activeElement) pick.value = s.mode_pick;
  p.root.querySelectorAll("[data-mode-now]").forEach((b) => { b.hidden = b.dataset.modeNow !== s?.mode; });
}

// The hand pick drives the select entity; it is not part of the draft.
export function tool(p, ev) {
  if (ev.target.id !== "modepick") return false;
  if (ev.type === "change") p.hass.callService("select", "select_option", { entity_id: p.modeEntity(), option: ev.target.value });
  return true;
}

export function beforeInput(p, path, v) {
  const m = /^modes\.(\d+)\.(id|name)$/.exec(path);
  if (!m) return;
  const ms = p.draft.modes, i = Number(m[1]), old = ms[i].id;
  const follow = (from, to) => Fm.renameModeRefs(p.draft, "mode", from, to);
  if (m[2] === "id") { p.manualId("m", old); follow(old, v); p.renameOpen("m", old, v); }
  else p.nameToId("m", ms, i, v, "mode", `modes.${i}.id`, follow);
}

export function afterInput(p, path, v, el) {
  if (/^modes\.\d+\.name$/.test(path)) {
    const head = el.closest(".item")?.querySelector(".name");
    if (head) head.textContent = v || "(no name)";
  }
}

export function click(p, a, el) {
  const ms = p.draft.modes, i = Number(el.dataset.i), j = Number(el.dataset.j);
  switch (a) {
    case "mode-toggle": p.flip(`m:${ms[i].id}`); return true;
    case "mode-add": {
      const m = { ...U.clone(p.choices.mode), id: U.slugId(ms, "mode", "mode"), condition: U.clone(p.choices.condition) };
      ms.push(m);
      p.autoId("m", m.id);
      p.open.add(`m:${m.id}`);
      p.edited(true);
      return true;
    }
    case "mode-dup": {
      const m = U.clone(ms[i]);
      m.id = U.slugId(ms, `${m.id}_copy`, "mode");
      p.autoId("m", m.id);
      m.name = m.name ? `${m.name} (copy)` : "";
      ms.splice(i + 1, 0, m);
      p.open.add(`m:${m.id}`);
      p.edited(true);
      return true;
    }
    case "mode-del":
      if (!confirm(`Delete the house mode "${ms[i].name || ms[i].id}"?`)) return true;
      for (const t of p.draft.triggers || []) if (t.kind === "mode") t.modes = t.modes.filter((x) => x !== ms[i].id);
      ms.splice(i, 1);
      p.edited(true);
      return true;
    case "mode-up": case "mode-down":
      if (Fm.moveItem(ms, i, a === "mode-up" ? i - 1 : i + 1)) p.edited(true);
      return true;
    case "mode-cond": {
      // Turning the condition back on brings back the one it had.
      const memo = (p._condMemo ??= new Map());
      if (ms[i].condition) memo.set(ms[i].id, ms[i].condition);
      ms[i].condition = ms[i].condition ? null : memo.get(ms[i].id) || U.clone(p.choices.condition);
      p.edited(true);
      return true;
    }
    case "mode-add-ent": {
      const v = el.parentElement.querySelector("input").value.trim();
      if (!v) return true;
      const c = ms[i].condition;
      if (!c.entities.includes(v)) c.entities.push(v);
      p.edited(true);
      return true;
    }
    case "mode-rm-ent": ms[i].condition.entities.splice(j, 1); p.edited(true); return true;
    case "mode-trig-off": {
      const list = ms[i].triggers_off, tid = el.dataset.name, k = list.indexOf(tid);
      k >= 0 ? list.splice(k, 1) : list.push(tid);
      p.edited(true);
      return true;
    }
  }
  return false;
}
