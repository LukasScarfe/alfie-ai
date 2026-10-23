// The panel's Voice section (design.md "Voice"): Assistants (which voice
// satellites he follows, how he looks while one listens, thinks and answers,
// and where he speaks), Agents (what voice agents get from him: the Alfie
// LLM API, the what's-wrong and find tools, the intent, the persona and his
// mood) and Screens (design.md "Voice screens": what he shows of a voice turn).

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);

export const id = "voice";
export const title = "Voice";
export const subs = [["assistants", "Assistants"], ["agents", "Agents"], ["screens", "Screens"]];
const ASSIST_KEYS = ["enabled", "satellites", "while_asleep", "listening_expression", "listening_animation",
  "processing_animation", "speak_style", "speak_strength", "after", "speak_targets", "tts_entity", "language"];
const AGENT_KEYS = ["persona", "persona_prompt", "mood_aware", "assist_tool", "intent", "sentences", "find_entity"];
const SCREEN_KEYS = ["screens", "action_screens", "answer_screens", "screen_present", "screen_seconds",
  "hold_while_speaking", "linger_seconds", "plot_hours", "plot_title", "plot_text_size", "max_grid", "screen_skip",
  "volume_screen", "screen_text", "music_animation", "music_expression", "music_icon", "music_screen", "music_seconds",
  "music_show_title", "music_show_artist", "music_show_album", "music_show_paused"];
export const resets = { assistants: ASSIST_KEYS.map((k) => `voice.${k}`), agents: AGENT_KEYS.map((k) => `voice.${k}`),
  screens: SCREEN_KEYS.map((k) => `voice.${k}`) };

const STYLE_TEXT = { pulse: "Ring pulse", eyes: "Eye rhythm", both: "Ring and eyes", wave: "Waveform ring" };
const TRY = [["listening", "Listening"], ["processing", "Thinking"], ["responding", "Answering"]];
const SENTENCE_HINT = "One per line, in HA's sentence syntax: (a|b) picks one, [x] is optional. No punctuation.";

export function render(p, sub) {
  return sub === "agents" ? agents(p) : sub === "screens" ? screens(p) : assistants(p);
}

// A datalist of the house's entities in `domains`, for an entity input.
function domainList(p, listId, domains) {
  const st = p.hass?.states || {};
  const opts = Object.keys(st).filter((e) => domains.includes(e.split(".")[0])).sort()
    .map((e) => `<option value="${U.esc(e)}">${U.esc(st[e].attributes?.friendly_name || "")}</option>`).join("");
  return `<datalist id="${listId}">${opts}</datalist>`;
}

const none = (t) => [["", t]];

// ------------------------------------------------------------ assistants

function assistants(p) {
  const v = p.draft.voice, c = p.choices;
  const exprs = [...none("Keep his mood's face"), ...c.expressions.map((e) => [e, U.human(e)])];
  const anims = (t) => [...none(t), ...c.animations.map((a) => [a, U.human(a)])];
  const styles = (c.voice?.speak_styles || Object.keys(STYLE_TEXT)).map((s) => [s, STYLE_TEXT[s] || U.human(s)]);
  const sats = Object.keys(p.hass?.states || {}).filter((e) => e.startsWith("assist_satellite."));
  const found = sats.length
    ? `Found: ${sats.map((e) => `<code>${U.esc(e)}</code>`).join(", ")}.`
    : "No voice satellites found yet. A Voice PE, an ESPHome voice device or a tablet with the voice-satellite card makes one.";
  return `${U.intro("While a voice assistant listens, thinks or answers, Alfie takes the face role: rotation cards hand over to him, and he shows it. He works with any <code>assist_satellite</code>.",
      "A card can follow every satellite, only chosen ones (the tablet's own, say) or none, in its own editor. When the satellite goes back to idle he plays the After a reply animation, and the rotation carries on. Phone apps that don't expose a satellite can't drive him.")}
    ${U.cards(`${U.card("Satellites", `
        ${U.check("voice.enabled", v.enabled, "Follow voice assistants")}
        ${U.wide("Only these", U.entities({ items: v.satellites, i: 0, add: "voice-add-sat", rm: "voice-rm-sat",
          placeholder: "assist_satellite.kitchen", list: "voice-sats" }), `None picked: every satellite. ${found}`)}
        ${U.check("voice.while_asleep", v.while_asleep, "Even while he sleeps", "Off: a sleeping Alfie stays asleep through a voice request.")}
        ${domainList(p, "voice-sats", ["assist_satellite"])}`)}
      ${U.card("Looks", `<div class="grid">
        ${U.field("Listening, he looks", U.select("voice.listening_expression", v.listening_expression, exprs), "Also while thinking.")}
        ${U.field("As he starts listening", U.select("voice.listening_animation", v.listening_animation, anims("Nothing")))}
        ${U.field("Thinking", U.select("voice.processing_animation", v.processing_animation, anims("Nothing")), "Played again until the answer starts.")}
        ${U.field("Answering", U.select("voice.speak_style", v.speak_style, styles), "He has no mouth: the ring, the eyes or both keep a talking rhythm.")}
        ${U.field("How much it shows", U.num("voice.speak_strength", v.speak_strength, { min: 0.2, max: 5, step: 0.1, unit: "×" }),
          `<button class="link" data-action="go" data-section="appearance" data-sub="motion">Fine-tune each style in Appearance → Motion</button>`)}
        ${U.field("After a reply", U.select("voice.after", v.after, anims("Nothing")))}</div>
        <div class="row tryrow"><span class="muted">Try it here:</span>${TRY.map(([ph, t]) =>
          `<button class="chip pick ${p.voiceTry === ph ? "on" : ""}" data-action="voice-try" data-name="${ph}">${t}</button>`).join("")}
          <button class="chip pick ${p.voiceTry ? "" : "on"}" data-action="voice-try" data-name="">Off</button></div>`)}`)}
    ${U.card("Speaking", `
      <p class="muted">Where a story's Speak step and <code>alfie.say</code> talk when they name no speakers.
        Satellites announce it; media players play it through a TTS engine.</p>
      ${U.wide("Speakers", U.entities({ items: v.speak_targets, i: 0, add: "voice-add-spk", rm: "voice-rm-spk",
        placeholder: "media_player.kitchen or assist_satellite.kitchen", list: "voice-spk" }), "None picked: every satellite he follows.")}
      <div class="grid">
        ${U.field("TTS engine", U.text("voice.tts_entity", v.tts_entity, { list: "voice-tts", placeholder: "tts.piper", attrs: "data-entities" }),
          "For media players. Empty: the first one set up.")}
        ${U.field("Language", U.text("voice.language", v.language, { placeholder: "The engine's default" }))}</div>
      <div class="row"><input id="voice-line" class="grow" placeholder="Say something to test" value="${U.esc(p.voiceLine ?? `Hello, I'm ${p.name || "Alfie"}.`)}">
        <button class="flat" data-action="voice-say">${U.icon("mdi:account-voice")}Say it</button></div>
      <small class="voice-said muted"></small>
      ${domainList(p, "voice-spk", ["media_player", "assist_satellite"])}${domainList(p, "voice-tts", ["tts"])}`)}
    <style>.tryrow { gap: 6px; flex-wrap: wrap; margin-top: 8px; align-items: center; }</style>`;
}

// ------------------------------------------------------------ screens

const SCREEN_TEXT = [["minimal", "Minimal: only words that add something"], ["full", "Full: names and states"]];
const PRESENTS = [["corner", "Corner: he stays, small, while it shows"], ["handover", "Hand over: he leaves for it"],
  ["card", "Each card's own setting"]];
const PLOT_TITLES = [["icon", "An icon for its kind"], ["icon_name", "The icon and its name"], ["name", "Its name"], ["none", "None"]];

function screens(p) {
  const v = p.draft.voice, last = p.voiceStatus?.last_screen, c = p.choices;
  const exprs = [["", "Keep his face"], ...c.expressions.map((e) => [e, U.human(e)])];
  const anims = [["", "None"], ...c.animations.map((a) => [a, U.human(a)])];
  const when = last ? new Date(last.at * 1000).toLocaleTimeString() : "";
  const peek = last ? `
      <p><b>${U.esc(when)}</b> · “${U.esc(last.said || "…")}” → “${U.esc(last.reply || "")}”</p>
      <p class="muted">${last.kind ? `${last.kind === "action" ? "Did something to" : "Asked about"} ${last.entities.map((e) => `<code>${U.esc(e)}</code>`).join(", ")}: ${last.screen ? `a ${U.esc(last.screen)} screen` : "no screen (left out, or turned off)"}.` : "Nothing in the house: no screen."}</p>`
    : `<p class="muted">Nothing yet. Ask your voice assistant about something in the house.</p>`;
  return `${U.intro("When your voice assistant switches something or answers about it, Alfie shows it: a switch sliding for what was done, a plot of the last hours for a sensor, the weather for the weather.",
      "He reads what each conversation did from Home Assistant itself, so it works with HA's own agent and any LLM agent, and costs no extra request. Cards can turn it off in their editor.")}
    ${U.cards(`${U.card("Voice screens", `
        ${U.check("voice.screens", v.screens, "Show what a voice request was about")}
        ${U.check("voice.action_screens", v.action_screens, "When something is switched", "Its icon and a switch sliding to its new state; a grid for several.")}
        ${v.action_screens ? U.check("voice.volume_screen", v.volume_screen, "A volume change as a slider", "A speaker icon and a slider at the new volume, for the playing player. Off: its switch, like anything else.") : ""}
        ${U.check("voice.answer_screens", v.answer_screens, "When asked about something", "Sensors as a plot, several with one unit on one plot or as bars; things that are on or off as their switch.")}`)}
      ${U.card("How", `<div class="grid">
        ${U.field("Presenting", U.select("voice.screen_present", v.screen_present, PRESENTS))}
        ${U.field("Words", U.select("voice.screen_text", v.screen_text, SCREEN_TEXT), "Minimal: a switch is its icon and the switch, with names only on a grid. Full: the name and \"On now\" too.")}
        ${U.field("On screen for", U.num("voice.screen_seconds", v.screen_seconds, { min: 1, max: 120, step: 1, unit: "s" }))}
        ${U.field("Plot span", U.num("voice.plot_hours", v.plot_hours, { min: 1, max: 720, step: 1, unit: "h" }))}
        ${U.field("Plot title", U.select("voice.plot_title", v.plot_title, PLOT_TITLES), "The icon goes by the sensor's kind: a thermometer for a temperature, a drop for humidity.")}
        ${U.field("Plot text size", U.num("voice.plot_text_size", v.plot_text_size, { min: 0.5, max: 2, step: 0.1, unit: "×" }))}
        ${U.field("Most switches at once", U.num("voice.max_grid", v.max_grid, { min: 1, max: 12, step: 1 }), "More show as \"+N more\".")}</div>
        ${U.check("voice.hold_while_speaking", v.hold_while_speaking, "Wait until he has finished speaking",
          "With a satellite: the screen stays while it answers, then the time below. Off: the time above, from when it comes in.")}
        ${v.hold_while_speaking ? U.field("Then stays", U.num("voice.linger_seconds", v.linger_seconds, { min: 0, max: 120, step: 1, unit: "s" })) : ""}
        ${U.wide("Leave out", `<textarea data-path="voice.screen_skip" data-kind="list" rows="2">${U.esc(v.screen_skip.join(", "))}</textarea>`,
          "Domains (script, scene) or entity ids, comma separated.")}`)}`)}
      ${U.card("Music", `<div class="grid">
        ${U.field("He plays", U.select("voice.music_animation", v.music_animation, anims))}
        ${U.field("His face", U.select("voice.music_expression", v.music_expression, exprs))}
        ${U.field("Badge", U.text("voice.music_icon", v.music_icon, { placeholder: "None, or mdi:music-note" }))}</div>
        ${U.check("voice.music_screen", v.music_screen, "Now playing too", "What the player it started is playing (any Music Assistant player if it named none). Off: just his reaction.")}
        ${v.music_screen ? `${U.field("Now playing for", U.num("voice.music_seconds", v.music_seconds, { min: 1, max: 120, step: 1, unit: "s" }))}
        ${U.check("voice.music_show_title", v.music_show_title, "Song name")}
        ${U.check("voice.music_show_artist", v.music_show_artist, "Artist")}
        ${U.check("voice.music_show_album", v.music_show_album, "Album")}
        ${U.check("voice.music_show_paused", v.music_show_paused, "Also when nothing is playing", "A paused track, or the badge while the music starts. Off: only while a player is playing, so pausing the music shows nothing.")}` : ""}`)}
    ${U.card("Last voice screen", peek)}`;
}

// ------------------------------------------------------------ agents

function agents(p) {
  const v = p.draft.voice, st = p.voiceStatus;
  const status = st ? `
      <h4>What the Alfie API tells an agent now</h4><pre class="vprompt">${U.esc(st.prompt)}</pre>
      <h4>The intent's answer now</h4><p>${U.esc(st.spoken)}</p>` : `<p class="muted">Loading what agents get…</p>`;
  return `${U.intro("Let your voice assistant answer \"is anything wrong?\" from Alfie, and give it his personality. Nothing here changes your assistants until you turn it on.",
      `<b>The Alfie API</b> is how an LLM agent (Google, OpenAI, Ollama…) talks to him: in Settings → Voice assistants, open the agent's options and tick <b>${U.esc(p.name || "Alfie")}</b> under "Control Home Assistant", next to Assist. It gives the agent the <code>${U.esc(st?.tool || "alfie__whats_wrong")}</code> tool, and the persona and mood below. Saved changes apply to the next conversation.`)}
    ${U.cards(`${U.card("Persona and mood", `
        ${U.check("voice.persona", v.persona, `The agent speaks as ${p.name || "Alfie"}`, "Through the Alfie API: his persona leads the agent's prompt.")}
        ${v.persona ? U.wide("Persona", `<textarea data-path="voice.persona_prompt" rows="6">${U.esc(v.persona_prompt)}</textarea>`,
          `"Alfie" in it becomes his name.`) : ""}
        ${U.check("voice.mood_aware", v.mood_aware, "Mood-aware replies", "The agent hears how he feels and why, and lets it show a little in its tone.")}`)}
      ${U.card("What's wrong", `
        ${U.check("voice.assist_tool", v.assist_tool, "Add the tool to Assist too", "Any agent using Assist can then ask, without ticking the Alfie API.")}
        ${U.check("voice.intent", v.intent, "Answer on HA's own assistant", "For the built-in agent (no LLM): these sentences get his answer.", )}
        ${v.intent ? U.wide("Sentences", `<textarea data-path="voice.sentences" data-kind="lines" rows="5">${U.esc(v.sentences.join("\n"))}</textarea>`, SENTENCE_HINT) : ""}`)}
      ${U.card("Finding things", `
        ${U.check("voice.find_entity", v.find_entity, "Find anything in the house",
          `The <code>${U.esc(st?.find_tool || "alfie__find_entity")}</code> tool: the agent can look up a thing it wasn't given (only the exposed ones go in every request), by name, alias, device or room. Read-only: it can only switch what is exposed.`)}`)}`)}
    ${U.card("Right now", status)}
    <style>.vprompt { white-space: pre-wrap; font: inherit; background: var(--secondary-background-color); padding: 8px 10px; border-radius: 8px; }</style>`;
}

export function mount(p, sub) {
  if (sub === "agents" || sub === "screens") {
    p.hass.callWS({ type: "alfie/voice/status" })
      .then((r) => {
        // Render again only when something shown changed (a render mounts, which asks again).
        const changed = !p.voiceStatus || p.voiceStatus.last_screen?.at !== r.last_screen?.at;
        p.voiceStatus = r;
        if (changed && p.sec === "voice") p.render();
      })
      .catch(() => {});
  }
  // Try it plays on the dock's face, with the draft's looks.
  p.face?.previewVoice?.(p.voiceTry || null, p.voiceTry ? look(p) : null);
}

function look(p) {
  const v = p.draft.voice;
  return Object.fromEntries(["listening_expression", "listening_animation", "processing_animation", "speak_style", "speak_strength"]
    .map((k) => [k, v[k]]));
}

export function leave(p) {
  p.voiceTry = null;
  p.face?.previewVoice?.(null);
}

export function afterInput(p, path) {
  if (p.voiceTry && path.startsWith("voice.")) p.face?.previewVoice?.(p.voiceTry, look(p));
}

export function tool(p, ev) {
  if (ev.target.id !== "voice-line") return false;
  p.voiceLine = ev.target.value;
  return true;
}

export function click(p, a, el) {
  const v = p.draft.voice;
  const add = (key) => {
    const x = el.parentElement.querySelector("input").value.trim();
    if (x && !v[key].includes(x)) v[key].push(x);
    p.edited(true);
  };
  switch (a) {
    case "voice-add-sat": add("satellites"); return true;
    case "voice-rm-sat": v.satellites.splice(Number(el.dataset.j), 1); p.edited(true); return true;
    case "voice-add-spk": add("speak_targets"); return true;
    case "voice-rm-spk": v.speak_targets.splice(Number(el.dataset.j), 1); p.edited(true); return true;
    case "voice-try":
      p.voiceTry = el.dataset.name || null;
      p.render();
      return true;
    case "voice-say": {
      const msg = (p.voiceLine ?? p.root.querySelector("#voice-line")?.value ?? "").trim();
      const out = p.root.querySelector(".voice-said");
      if (!msg) return true;
      // Saved speakers and engine (a draft's are used once saved).
      p.hass.callWS({ type: "alfie/voice/say", message: msg })
        .then((r) => { if (out) out.textContent = r.speakers.length ? `Sent to ${r.speakers.join(", ")}.` : "No speakers: pick some, or add a satellite."; })
        .catch((e) => { if (out) out.textContent = `Couldn't: ${e?.message || e}`; });
      return true;
    }
  }
  return false;
}
