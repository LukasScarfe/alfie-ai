// The panel's Voice section (design.md "Voice"): Assistants (which voice
// satellites he follows, how he looks while one listens, thinks and answers,
// and where he speaks), Agents (what voice agents get from him: the Alfie
// LLM API, the what's-wrong and find tools, the intent, the persona and his
// mood), Screens (design.md "Voice screens": what he shows of a voice turn)
// Speech (design.md "Brain": how tts.alfie_voice says numbers, times, dates)
// and Brain (conversation.alfie: what he answers himself, the delegate, the
// turn log).

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);

export const id = "voice";
export const title = "Voice";
export const subs = [["assistants", "Assistants"], ["agents", "Agents"], ["screens", "Screens"], ["speech", "Speech"], ["brain", "Brain"]];
const ASSIST_KEYS = ["enabled", "satellites", "while_asleep", "listening_expression", "listening_animation",
  "processing_animation", "speak_style", "speak_strength", "after", "speak_targets", "tts_entity", "language"];
const AGENT_KEYS = ["persona", "persona_prompt", "mood_aware", "assist_tool", "intent", "sentences", "find_entity"];
const SCREEN_KEYS = ["screens", "action_screens", "answer_screens", "screen_present", "screen_seconds",
  "hold_while_speaking", "linger_seconds", "plot_hours", "plot_title", "plot_text_size", "max_grid", "screen_skip",
  "volume_screen", "screen_text", "music_animation", "music_expression", "music_icon", "music_screen", "music_seconds",
  "music_show_title", "music_show_artist", "music_show_album", "music_show_paused"];
export const resets = { assistants: ASSIST_KEYS.map((k) => `voice.${k}`), agents: AGENT_KEYS.map((k) => `voice.${k}`),
  screens: SCREEN_KEYS.map((k) => `voice.${k}`), speech: ["speech"], brain: ["brain"] };

const STYLE_TEXT = { pulse: "Ring pulse", eyes: "Eye rhythm", both: "Ring and eyes", wave: "Waveform ring" };
const TRY = [["listening", "Listening"], ["processing", "Thinking"], ["responding", "Answering"]];
const SENTENCE_HINT = "One per line, in HA's sentence syntax: (a|b) picks one, [x] is optional. No punctuation.";

export function render(p, sub) {
  return sub === "agents" ? agents(p) : sub === "screens" ? screens(p) : sub === "speech" ? speech(p)
    : sub === "brain" ? brainTab(p) : assistants(p);
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

// ------------------------------------------------------------ speech

const VOICE_ENTITY = "tts.alfie_voice";
const SPEECH_SAMPLE = "It's 21:45 and 18°C. Rain at 2.5 mm/h until 2026-10-31. The house was built in 1884.";
const YEARS = [["pairs", "In pairs: eighteen eighty-four"], ["number", "As a number: one thousand eight hundred…"], ["off", "Leave them"]];
const YEARS_2000 = [["twenty", "Twenty twenty-six"], ["thousand", "Two thousand twenty-six"]];
const TIMES = [["clock", "Clock: nine forty-five"], ["casual", "Casual: quarter to ten"], ["24h", "24-hour: twenty-one forty-five"], ["off", "Leave them"]];
const PERIODS = [["words", "In words: in the evening"], ["ampm", "AM and PM"], ["none", "Nothing"]];
const DATES = [["month_day", "October thirtieth"], ["day_month", "The thirtieth of October"], ["off", "Leave them"]];
const NUMERIC = [["month_first", "Month first: 10/30/2026"], ["day_first", "Day first: 30/10/2026"]];
const DATE_YEARS = [["not_this_year", "Only when it isn't this year"], ["always", "Always"]];

function speech(p) {
  const s = p.draft.speech, using = p.speechPipelines;
  const where = using == null ? "" : using.length
    ? `In use by ${using.map((n) => `<b>${U.esc(n)}</b>`).join(", ")}.`
    : `<b>Not used by any voice assistant yet.</b> Pick <b>${U.esc(p.name || "Alfie")} Voice</b> as the text-to-speech in Settings → Voice assistants.`;
  const reps = s.replacements.map((r, j) => `<div class="row rep">
      <input class="grow" data-path="speech.replacements.${j}.from" value="${U.esc(r.from)}" placeholder="As written: Monstera">
      <span class="muted">→</span>
      <input class="grow" data-path="speech.replacements.${j}.to" value="${U.esc(r.to)}" placeholder="As said: mon stair uh">
      <button class="icon" data-action="speech-rm" data-j="${j}" title="Remove">${U.icon("mdi:close")}</button></div>`).join("");
  return `${U.intro("Voice engines read digits and symbols literally: 1884 becomes \"one thousand eight hundred eighty four\", 18°C \"eighteen degrees C\". Alfie's voice says them the way a person would, then hands the words to your TTS engine.",
      `It is the TTS entity <code>${VOICE_ENTITY}</code>: use it in a voice assistant in place of your engine, and every answer is spoken this way, from HA's own intents, any LLM agent and announcements. ${where}`)}
    ${U.card("Try it", `
      <textarea id="speech-try" rows="2">${U.esc(p.speechLine ?? SPEECH_SAMPLE)}</textarea>
      <p class="speech-out">${U.esc(p.speechOut || "…")}</p>
      <div class="row"><button class="flat" data-action="speech-say">${U.icon("mdi:account-voice")}Say it</button>
        <small class="speech-sent muted"></small></div>`)}
    ${U.cards(`${U.card("Engine", `
        ${U.field("Speaks with", U.text("speech.engine", s.engine, { list: "speech-tts", placeholder: "tts.piper" }),
          "The TTS engine that makes the sound. Empty: the first one set up. Its voices and languages carry over.")}
        ${domainList(p, "speech-tts", ["tts"]).replace(new RegExp(`<option value="${VOICE_ENTITY}">[^<]*</option>`), "")}`)}
      ${U.card("Numbers", `<div class="grid">
        ${U.field("Years", U.select("speech.years", s.years, YEARS))}
        ${U.field("Years after 2009", U.select("speech.years_2000", s.years_2000, YEARS_2000))}
        ${U.field("Decimals", U.num("speech.decimals", s.decimals, { min: 0, max: 3, step: 1 }), "21.37 with 1: twenty-one point four.")}</div>
        ${U.check("speech.numbers", s.numbers, "Say other numbers in words", "Off: the engine reads them its own way.")}
        ${U.check("speech.and", s.and, "With \"and\"", "One hundred and five, two thousand and twenty-six.")}`)}
      ${U.card("Times and dates", `<div class="grid">
        ${U.field("Times", U.select("speech.time_style", s.time_style, TIMES))}
        ${U.field("Time of day", U.select("speech.time_period", s.time_period, PERIODS), "Only when the time says it: 21:45, 9 PM.")}
        ${U.field("Dates", U.select("speech.date_style", s.date_style, DATES))}
        ${U.field("Dates written with numbers", U.select("speech.numeric_dates", s.numeric_dates, NUMERIC), "When both could be a month.")}
        ${U.field("A date's year", U.select("speech.date_year", s.date_year, DATE_YEARS))}</div>`)}
      ${U.card("Units and symbols", `
        ${U.check("speech.temperature_unit", s.temperature_unit, "Say Celsius or Fahrenheit", "Off: eighteen degrees.")}
        ${U.check("speech.units", s.units, "Units in words", "km/h, kWh, µg/m³, hPa, %…")}
        ${U.check("speech.currency", s.currency, "Money in words", "$5.20: five dollars twenty.")}
        ${U.check("speech.abbreviations", s.abbreviations, "Abbreviations", "e.g., etc., AD, AQI…")}
        ${U.check("speech.markdown", s.markdown, "Drop formatting", "An agent's **bold**, # headings and bullet lists.")}
        ${U.check("speech.links", s.links, "Drop links")}
        ${U.check("speech.emoji", s.emoji, "Drop emoji")}`)}`)}
    ${U.card("Your words", `
      <p class="muted">Names it says wrong, or anything else: the word as written, and how to say it. Whole words, any case.</p>
      ${reps}
      <button class="flat" data-action="speech-add">${U.icon("mdi:plus")}Add a word</button>`)}
    <style>.speech-out { font-size: 1.1em; margin: 8px 0; } #speech-try { width: 100%; box-sizing: border-box; }
      .rep { gap: 6px; align-items: center; margin-bottom: 6px; }</style>`;
}

// The try box's text as Alfie's voice says it, by the draft's rules.
let previewSeq = 0;
function speechPreview(p) {
  const seq = ++previewSeq;
  p.hass.callWS({ type: "alfie/speech/preview", text: p.speechLine ?? SPEECH_SAMPLE, speech: p.draft.speech })
    .then((r) => { p.speechOut = r.text; })
    .catch((e) => { p.speechOut = `(${e?.message || e})`; })
    .finally(() => {
      const out = p.root.querySelector(".speech-out");
      if (out && seq === previewSeq) out.textContent = p.speechOut;
    });
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

// ------------------------------------------------------------ brain

// People with their own agent profile, and who's talking by voice (alfie-ears).
function people(p, b) {
  const users = [["", "Nobody (voice only)"], ...(p.brainUsers || []).map((u) => [u.id, u.name])];
  for (const x of b.profiles) if (x.user && !users.some(([id]) => id === x.user)) users.push([x.user, x.user]);
  const exprs = [["", "No change"], ...(p.choices?.expressions || []).map((e) => [e, U.human(e)])];
  const rows = b.profiles.map((x, i) => `<div class="card prof">
      <div class="row">${U.field("Name", U.text(`brain.profiles.${i}.name`, x.name, { placeholder: "Lukas" }))}
        ${U.field("ID", U.text(`brain.profiles.${i}.id`, x.id, { placeholder: "lukas" }), "What alfie-ears calls them.")}
        <button class="icon" data-action="brain-prof-rm" data-i="${i}" title="Remove" aria-label="Remove">${U.icon("mdi:delete-outline")}</button></div>
      <div class="row">${U.field("Home Assistant user", U.select(`brain.profiles.${i}.user`, x.user, users), "Their typed chat goes to this profile.")}
        ${U.field("Address", U.text(`brain.profiles.${i}.url`, x.url, { placeholder: "/p/lukas" }), "A path on the agent server above, or a whole address.")}</div>
      ${U.field("API key", U.text(`brain.profiles.${i}.key`, x.key, { attrs: 'type="password" autocomplete="off"' }), "This profile's own key.")}</div>`).join("");
  return U.card("People", `
    <p class="muted">Each person can have their own agent profile, with its own memory: what they say to it stays theirs. Anyone else, and every turn nobody is sure about, goes to the house's (the agent server above). A profile that can't be reached hands over to the delegate, never to the house's.</p>
    ${rows || `<p class="muted">Nobody yet: every turn is the house's.</p>`}
    <div class="row"><button class="flat" data-action="brain-prof-add">${U.icon("mdi:account-plus-outline")}Add a person</button></div>
    <h4>By voice</h4>
    ${U.field("alfie-ears", U.text("brain.ears_url", b.ears_url, { placeholder: "http://192.168.1.10:8794", attrs: "data-rerender" }),
      "A speaker-ID proxy in front of Whisper: for each voice request it says who spoke and whether it was meant for Alfie. Asked once per spoken turn, half a second at most; down means the house's.")}
    ${b.ears_url ? `
    ${U.check("brain.voice_identity", b.voice_identity, "Use voice identity", "A spoken turn goes to the profile of whoever alfie-ears recognised, told it's a shared room. Off: every spoken turn is the house's.")}
    ${U.field("Keep the last person for", U.num("brain.voice_sticky", b.voice_sticky, { min: 0, max: 900, step: 5, unit: "s" }), "When ears hears a voice it can't place, the person it last recognised at that speaker this recently keeps the turn, instead of the house's. 0: never.")}
    <div class="row">${U.field("Verdict good for", U.num("brain.ears_fresh", b.ears_fresh, { min: 1, max: 120, step: 1, unit: "s" }), "An older one is about another request.")}
    ${U.field("Words must match", U.num("brain.ears_match", b.ears_match, { min: 50, max: 100, step: 1, unit: "%" }), "What ears heard against what Home Assistant was given.")}</div>
    <div class="row">${U.field("Guests are over when", U.text("brain.guest_entity", b.guest_entity, { placeholder: "input_boolean.guest_mode", list: "entities" }), "This entity is on.")}</div>
    ${U.check("brain.guest_house_only", b.guest_house_only, "With guests, only the house's", "Nobody's private profile answers out loud while guests are over.")}
    ${U.check("brain.drop_not_meant", b.drop_not_meant, "Drop what wasn't meant for Alfie", "When alfie-ears says a request wasn't for him (the TV, a conversation in the room), it ends there: nothing runs, nothing is said. It shows in the turn log.")}
    ${b.drop_not_meant ? U.field("His face then", U.select("brain.drop_expression", b.drop_expression, exprs), "For a few seconds.") : ""}` : ""}`);
}

const BRAIN_ENTITY = "conversation.alfie";
const COMMANDS = [["whats_wrong", "What's wrong", "\"Is anything wrong?\": the same answer as the intent."],
  ["run", "Voice actions", "\"Turn on the gaming PC\", \"Start movie night\", or just \"Goodnight\": starts what carries the voice label (the card below)."],
  ["how_are_you", "How are you", "\"How are you?\": his mood, and why."],
  ["entity", "Any thing's state", "\"What's the office temperature?\", \"Is the back door open?\", \"What's the kitchen light's brightness?\", \"Is the freezer above -15?\" Tried after Home Assistant's intents."],
  ["entity_count", "How many", "\"How many lights are on?\", \"Which windows are open upstairs?\", \"Is anything on in the kitchen?\", \"Are all the doors locked?\" Tried after Home Assistant's intents."],
  ["entity_when", "When", "\"When was the front door last opened?\", \"How long has the TV been on?\""],
  ["entity_history", "History", "\"What was the highest office temperature today?\", \"How many times did the door open today?\", \"Was the heater on last night?\""],
  ["weather_now", "Weather now", "\"What's the weather?\", \"Is it raining?\", \"How cold is it outside?\", \"What's the weather in Whistler?\" Before Home Assistant's own weather intent."],
  ["weather_forecast", "Forecast", "\"Will it rain tomorrow?\", \"When will the rain stop?\", \"What's the high on Saturday?\", \"What's the forecast for the weekend?\""],
  ["weather_gear", "What to wear", "\"Do I need an umbrella?\", \"Should I wear a coat tomorrow?\", \"Do I need sunscreen?\""],
  ["sun", "The sun", "\"When is sunset?\", \"How long until sunrise?\", \"Is it dark outside?\", \"How much daylight is there today?\""],
  ["moon", "The moon", "\"What's the moon phase?\", \"Is it a full moon tonight?\", \"When is the next full moon?\""],
  ["world_time", "The time somewhere", "\"What time is it in London?\", \"What's the time difference with Tokyo?\""],
  ["dates", "Dates", "\"How many days until Christmas?\", \"What day is the 25th?\", \"What's the date in 3 weeks?\", \"What week is it?\", \"Is 2028 a leap year?\""],
  ["convert", "Converting units", "\"Convert 5 miles to km\", \"How many cups in a litre?\", \"What's 30 Celsius in Fahrenheit?\""],
  ["maths", "Sums", "\"What's 12 times 7?\", \"What is 15% of 80?\", \"What's the square root of 144?\""],
  ["people", "Who's home", "\"Who's home?\", \"Where is Michelle?\", \"How long has Lukas been out?\", \"When did Michelle get home?\""],
  ["media", "What's playing", "\"What's playing?\", \"Who sings this?\", \"What's on the TV?\", \"Is anything playing in the kitchen?\""],
  ["calendar", "The calendar", "\"What's on tomorrow?\", \"Am I free on Friday?\", \"What's next?\", \"When is my next dance?\""],
  ["lists", "Lists", "\"What's on the shopping list?\", \"How many things are on the to-do list?\", \"Do we need milk?\""],
  ["repeat", "Say that again", "\"Say that again\", \"What did you say?\", \"Sorry?\": his last reply on that speaker."],
  ["help", "What can you do", "\"What can you do?\": what he answers himself, from the answers that are on."],
  ["coin", "A coin", "\"Flip a coin\", \"Heads or tails?\""],
  ["dice", "Dice", "\"Roll a die\", \"Roll two dice\", \"Roll a d20\", \"Roll three twelve sided dice\""],
  ["number", "A random number", "\"Pick a number\", \"Give me a random number between 1 and 100\""],
  ["pick", "Pick one", "\"Pick between pizza and tacos\", \"Choose one of red, green or blue\""],
  ["joke", "Jokes", "\"Tell me a joke\", \"Make me laugh\": no repeats until he has told them all."],
  ["chat", "Small talk", "\"Hello\", \"Thank you\", \"What's your name?\", \"How old are you?\", \"Are you there?\""],
  ["wiki", "Wikipedia", "\"Who was Albert Einstein?\", \"What is a quasar?\", \"Tell me about Vancouver\": from your own offline Wikipedia (the card below). Only an article with that very name; anything else goes to the delegate. Tried last."]];
const TIER = { 1: ["mdi:lightning-bolt", "Local"], 3: ["mdi:brain", "Agent or delegate"], 0: ["mdi:help-circle-outline", "Unanswered"] };
const SOURCE = { dropped: "Not for Alfie", trigger: "Sentence trigger", own: "Alfie", intent: "Home Assistant", agent: "Agent server", delegate: "Delegate",
  none: "Fallback", error: "Delegate failed" };

function brainTab(p) {
  const b = p.draft.brain, using = p.brainPipelines;
  const where = using == null ? "" : using.length
    ? `In use by ${using.map((x) => `<b>${U.esc(x.name)}</b>${x.prefer_local_intents ? " (turn its \"Prefer handling commands locally\" off: Alfie does that himself, and logs it)" : ""}`).join(", ")}.`
    : `<b>Not used by any voice assistant yet.</b> Pick <b>${U.esc(p.name || "Alfie")}</b> as the conversation agent in Settings → Voice assistants.`;
  const st = p.hass?.states || {};
  const agents = Object.keys(st).filter((e) => e.startsWith("conversation.") && e !== BRAIN_ENTITY).sort()
    .map((e) => [e, st[e].attributes?.friendly_name || e]);
  const delegates = [["", "None: unknown questions get the reply below"], ...agents];
  const THINK = [["default", "The server's own"], ["off", "Off"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]];
  if (b.delegate && !agents.some(([e]) => e === b.delegate)) delegates.push([b.delegate, `${b.delegate} (not found)`]);
  const weathers = [["", "The house's (one named like home, else the first)"], ...Object.keys(st).filter((e) => e.startsWith("weather.")).sort()
    .map((e) => [e, st[e].attributes?.friendly_name || e])];
  if (b.weather && !weathers.some(([e]) => e === b.weather)) weathers.push([b.weather, `${b.weather} (not found)`]);
  const cals = Object.keys(st).filter((e) => e.startsWith("calendar.")).sort();
  const todos = [["", "The shopping list (todo.shopping_list)"], ...Object.keys(st).filter((e) => e.startsWith("todo.")).sort()
    .map((e) => [e, st[e].attributes?.friendly_name || e])];
  if (b.todo_list && !todos.some(([e]) => e === b.todo_list)) todos.push([b.todo_list, `${b.todo_list} (not found)`]);
  const RUNNABLE = ["script", "automation", "scene", "button", "input_button"];
  const label = (p.brainLabels || []).find((l) => l.name.toLowerCase() === (b.voice_label || "").toLowerCase());
  const acts = label ? Object.entries(p.hass?.entities || {})
    .filter(([e, x]) => (x.labels || []).includes(label.label_id) && RUNNABLE.includes(e.split(".")[0]))
    .map(([e]) => [e, st[e]?.attributes?.friendly_name || e]).sort((a, c) => a[1].localeCompare(c[1])) : [];
  const cmds = COMMANDS.map(([k, name, hint]) => `
      <label class="check"><input type="checkbox" class="switch" data-action="brain-cmd" data-name="${k}"${b.off_commands.includes(k) ? "" : " checked"}>
        <span><b>${U.esc(name)}</b><small>${U.esc(hint)}</small></span></label>
      ${b.off_commands.includes(k) ? "" : (() => {
        const his = p.brainSentences?.[k] || [], own = b.extra_sentences[k] || [];
        const open = own.length || p.brainOpen?.has(k) ? " open" : "";
        return `<details class="sents"${open}><summary data-action="brain-sents" data-name="${k}">Sentences: ${his.length} of his${own.length ? `, ${own.length} of yours` : ""}</summary>
        <ul>${his.map((x) => `<li><code>${U.esc(x)}</code></li>`).join("")}</ul>
        ${U.wide("Also these", `<textarea data-path="brain.extra_sentences.${k}" data-kind="lines" rows="2">${U.esc(own.join("\n"))}</textarea>`,
          `${SENTENCE_HINT} His own always work.`)}</details>`;
      })()}`).join("");
  return `${U.intro("Make Alfie your voice assistant's agent and he answers what he can himself, instantly and from the real states, and passes only the rest to an LLM.",
      `He is the conversation agent <code>${BRAIN_ENTITY}</code>. Each request tries, in order: an automation's sentence trigger, his own sentences, Home Assistant's built-in intents (lights, timers, the weather, \"is the door locked\"), and only then the agent server (like Hermes Agent) or the delegate, any other agent you have, like Ollama or Google. Their replies still stream to the speaker. ${where}`)}
    ${U.card("Ask him", `
      <div class="row"><input id="brain-ask" class="grow" placeholder="What's the weather?" value="${U.esc(p.brainAsk ?? "")}">
        <button class="flat" data-action="brain-ask">${U.icon("mdi:send")}Ask</button></div>
      <p class="brain-said muted">${U.esc(p.brainReply || "Saved settings answer. Nothing is spoken; actions do happen.")}</p>`)}
    ${U.cards(`${U.card("Agent server", `
        ${U.field("Address", U.text("brain.agent_url", b.agent_url, { placeholder: "http://192.168.1.10:8642", attrs: "data-rerender" }),
          "An agent with its own tools and memory, like Hermes Agent's API server (OpenAI-compatible). It answers whatever Home Assistant's intents don't. Empty: the delegate does.")}
        ${b.agent_url ? `${U.field("API key", U.text("brain.agent_key", b.agent_key, { attrs: 'type="password" autocomplete="off"' }))}
        <div class="row">${U.field("Model", U.text("brain.agent_model", b.agent_model, { placeholder: "hermes-agent" }))}
        ${U.field("Wait at most", U.num("brain.agent_seconds", b.agent_seconds, { min: 5, max: 900, step: 5, unit: "s" }))}</div>
        ${U.check("brain.agent_final_only", b.agent_final_only, "Speak only the final answer", "Spoken requests only: whatever the agent says before using a tool (\"I'll look that up\") stays silent, and the speaker starts when its whole reply is ready. Typed replies are never held.")}
        ${U.check("brain.agent_earlier", b.agent_earlier, "Tell it what Home Assistant answered", "A turn answered without it (\"Which lights are on?\" by Home Assistant's intents) is passed on with the next one it gets, so a follow-up (\"Which is brightest?\") makes sense.")}
        ${U.check("brain.room_context", b.room_context, "Share what was said in the room", "Spoken requests only: it's told what was asked aloud in the same room lately, whoever asked and whichever profile answered, so \"turn it back down\" after someone else's \"play some music\" makes sense. Typed chat stays private.")}
        ${b.room_context ? `<div class="row">${U.field("From the last", U.num("brain.room_minutes", b.room_minutes, { min: 1, max: 120, step: 1, unit: "min" }))}
        ${U.field("At most", U.num("brain.room_turns", b.room_turns, { min: 1, max: 20, step: 1, unit: "turns" }))}</div>` : ""}
        ${U.check("brain.agent_wait", b.agent_wait, "Say when it'll take a moment", "Before a web search or other slow tool, or when nothing has come for a few seconds, he says \"Give me a second while I look that up\" so nobody waits in silence.")}
        ${b.agent_wait ? `${U.field("Quiet for", U.num("brain.agent_wait_seconds", b.agent_wait_seconds, { min: 1, max: 60, step: 1, unit: "s" }), "Then he says he's still on it.")}
        ${U.wide("Quick tools", `<textarea data-path="brain.agent_quick_tools" data-kind="lines" rows="3">${U.esc((b.agent_quick_tools || []).join("\n"))}</textarea>`, "Tools fast enough to need no wait line, one per line; ending in _ means every tool starting with it.")}` : ""}
        <div class="row">${U.field("Thinking, spoken", U.select("brain.agent_think_voice", b.agent_think_voice, THINK), "Off keeps spoken answers quick.")}
        ${U.field("Typed", U.select("brain.agent_think_typed", b.agent_think_typed, THINK))}
        ${U.field("When asked to think", U.select("brain.agent_think_asked", b.agent_think_asked, [["default", "Ignore the asking"], ...THINK.slice(1)]), "He says \"Let me think about that\" first.")}</div>
        ${U.wide("What asks him to think", `<textarea data-path="brain.agent_think_phrases" data-kind="lines" rows="2" placeholder="The language's: think about it, think hard, take your time…">${U.esc((b.agent_think_phrases || []).join("\n"))}</textarea>`, "One per line, anywhere in the request: \"think hard: should I repot the monstera?\"")}
        ${U.wide("Its instructions per spoken turn", `<textarea data-path="brain.agent_prompt" rows="3" placeholder="The language's: a spoken request from the {where} speaker, keep it short, reply only with the final answer.">${U.esc(b.agent_prompt || "")}</textarea>`, "{where} is the speaker's area, {time} and {day} the time and date now.")}
        ${U.wide("Its instructions per typed turn", `<textarea data-path="brain.agent_prompt_typed" rows="3" placeholder="The language's: a typed message, answer as fully as it needs.">${U.esc(b.agent_prompt_typed || "")}</textarea>`, "{time} and {day} work here too.")}` : ""}`)}
      ${b.agent_url ? people(p, b) : ""}
      ${U.card("Delegate", `
        ${U.field(b.agent_url ? "When the agent server can't be reached" : "Everything else goes to", U.select("brain.delegate", b.delegate, delegates, { rerender: true }),
          "Usually an LLM agent. It gets the conversation so far, so follow-ups work.")}
        ${U.field("When nothing answers", U.text("brain.fallback", b.fallback, { placeholder: "Sorry, I don't know that one." }),
          "Also when the delegate fails.")}`)}
      ${U.card("Answered locally", `
        ${U.check("brain.local_intents", b.local_intents, "Home Assistant's intents", "Turn on, set, timers, the time, the weather… matched strictly against exposed entities. Off: only his own sentences are local.")}
        ${b.local_intents ? `${U.check("brain.local_states", b.local_states, "Questions about states", "\"Is the door locked?\", \"What's the weather?\" from the real state. Off: the delegate answers them (an LLM may guess).")}
        ${U.check("brain.local_media_search", b.local_media_search, "\"Play …\" searches", "Home Assistant's media search. Off: the delegate, with its own music tools.")}` : ""}`)}
      ${U.card("His own sentences", `
        ${U.check("brain.own_sentences", b.own_sentences, "Answer his own sentences")}
        ${b.own_sentences ? `<div class="row"><input id="brain-try" class="grow" placeholder="Try a sentence: roll two dice" value="${U.esc(p.brainTry ?? "")}">
          <button class="flat" data-action="brain-try">${U.icon("mdi:magnify")}Which one?</button></div>
        <p class="brain-tried muted">${p.brainTried || "Which of his answers takes a sentence, with the saved settings. Nothing is answered or done."}</p>
        ${cmds}
        ${U.check("brain.exposed_only", b.exposed_only, "Only things exposed to Assist", "Off: he answers about every entity (the answer stays in the house). On: only those exposed in Settings → Voice assistants → Expose.")}
        ${U.check("brain.ask_which", b.ask_which, "Ask which one", "When two things fit a name equally, he asks. Off: the delegate gets the question.")}
        ${U.check("brain.say_unknown", b.say_unknown, "Say when he doesn't know a thing", "\"When was the front door last opened?\" with no front door: he says so. Off: the delegate gets it (an LLM may make up an answer).")}
        ${U.wide("\"How many\" ignores these integrations", `<textarea data-path="brain.count_skip" data-kind="lines" rows="2">${U.esc((b.count_skip || []).join("\n"))}</textarea>`, "One integration per line, like adaptive_lighting: their switches aren't things that are \"on\".")}
        ${U.field("How sure a name must be", U.num("brain.match_floor", b.match_floor, { min: 30, max: 120, step: 5 }), "70: the whole name was said. Lower finds more, and guesses more.")}` : ""}`)}
      ${b.own_sentences ? U.card("Outside", `
        ${U.field("Weather from", U.select("brain.weather", b.weather, weathers),
          "For the weather, the forecast and what to wear. \"In Whistler\" picks the weather entity with that name.")}
        <div class="grid">
        ${U.field("Cold below", U.num("brain.cold_below", b.cold_below, { min: -40, max: 40, step: 1, unit: "°C" }), "\"Is it cold?\", \"Do I need a coat?\"")}
        ${U.field("Warm from", U.num("brain.warm_above", b.warm_above, { min: -20, max: 50, step: 1, unit: "°C" }), "\"Is it warm?\", \"Do I need shorts?\"")}
        ${U.field("Windy from", U.num("brain.windy_speed", b.windy_speed, { min: 1, max: 200, step: 1, unit: "km/h" }), "\"Is it windy?\"")}
        ${U.field("Rain when the chance is", U.num("brain.rain_chance", b.rain_chance, { min: 1, max: 100, step: 5, unit: "%" }), "An hour this likely to rain counts as rain.")}
        ${U.field("Or with no chance given", U.num("brain.rain_mm", b.rain_mm, { min: 0, max: 50, step: 0.1, unit: "mm" }), "Some forecasts (met.no) give only the amount.")}
        ${U.field("Sunscreen from UV", U.num("brain.sun_uv", b.sun_uv, { min: 0, max: 15, step: 1 }), "\"Do I need sunscreen?\"")}</div>
        <p class="muted">Converted when the weather is in °F or mph. The sun and the moon need no entity: Home Assistant's location is enough.</p>`) : ""}
      ${b.own_sentences ? U.card("Dates and units", `
        ${U.wide("Your own dates", `<textarea data-path="brain.dates" data-kind="lines" rows="3" placeholder="Lukas's birthday: 03-14&#10;Our anniversary: 2019-06-01">${U.esc((b.dates || []).join("\n"))}</textarea>`,
          "One per line, \"name: MM-DD\" (or YYYY-MM-DD). Then \"How many days until Lukas's birthday?\" works. Holidays like Christmas, Easter and Thanksgiving he knows already.")}
        ${U.field("Cups, pints and gallons", U.select("brain.imperial", b.imperial, [["us", "US"], ["uk", "UK (imperial)"]]),
          "A UK pint is 568 ml, a US one 473 ml.")}`) : ""}
      ${b.own_sentences && !b.off_commands.includes("run") ? U.card("Voice actions", `
        ${U.field("Label", U.text("brain.voice_label", b.voice_label, { placeholder: "Alfie voice" }),
          "Give this label to a script, automation, scene or button in Home Assistant's own editor (its settings, Labels), and he starts it by voice: \"turn on\", \"start\" or \"run\" and its name or an alias. He makes the label if it's missing.")}
        <p class="muted">${!b.voice_label ? "No label: voice actions are off." : p.brainLabels == null ? "Loading…"
          : !label ? `No label called <b>${U.esc(b.voice_label)}</b> yet: he makes it when you save.`
          : acts.length ? `Carrying it: ${acts.map(([e, n]) => `<b>${U.esc(n)}</b> <code>${U.esc(e)}</code>`).join(", ")}.`
          : "Nothing carries it yet."}</p>
        ${U.check("brain.run_bare", b.run_bare, "Its name alone starts it", "\"Movie night\" or \"Goodnight\" by itself. Only a whole name or alias counts.")}
        ${U.check("brain.run_conditions", b.run_conditions, "Automations check their conditions", "Off: started by voice, an automation runs its actions whatever its conditions say, like its Run button.")}
        ${U.field("He says", U.text("brain.run_reply", b.run_reply, { placeholder: "OK, {name}." }), "{name} is its name.")}`) : ""}
      ${b.own_sentences ? U.card("Home and calendar", `
        ${U.wide("\"What's on\" reads these calendars", `<textarea data-path="brain.calendars" data-kind="lines" rows="2" placeholder="Every calendar">${U.esc((b.calendars || []).join("\n"))}</textarea>`,
          `One calendar entity per line; empty reads every one. ${cals.length ? `You have ${cals.map((e) => `<code>${U.esc(e)}</code>`).join(", ")}.` : "You have no calendars."} \"When is …\" looks in all of them.`)}
        ${U.check("brain.calendar_dates", b.calendar_dates, "Take named dates from the calendars", "\"How many sleeps until Christmas?\" uses a holidays calendar's date, and \"when is Dad's birthday\" finds \"Dad Birthday\". Your own dates above still win.")}
        <div class="grid">
        ${U.field("Read calendars again after", U.num("brain.calendar_minutes", b.calendar_minutes, { min: 1, max: 1440, step: 5, unit: "min" }), "Or as soon as a calendar changes.")}
        ${U.field("Events said at most", U.num("brain.event_max", b.event_max, { min: 1, max: 30, step: 1 }))}
        ${U.field("List items said at most", U.num("brain.list_max", b.list_max, { min: 1, max: 50, step: 1 }))}</div>
        ${U.field("\"The list\" and \"what do we need\"", U.select("brain.todo_list", b.todo_list, todos),
          "Other lists by name: \"what's on the groceries list\".")}
        ${U.wide("\"What's playing\" asks these players", `<textarea data-path="brain.media_players" data-kind="lines" rows="2" placeholder="Every player">${U.esc((b.media_players || []).join("\n"))}</textarea>`,
          "One media player per line; empty asks every one but Music Assistant groups.")}
        ${b.media_players?.length ? "" : U.wide("…but not these integrations'", `<textarea data-path="brain.media_skip" data-kind="lines" rows="1">${U.esc((b.media_skip || []).join("\n"))}</textarea>`,
          "One integration per line. Plex lists everyone streaming from your server, not just the house.")}`) : ""}
      ${b.own_sentences ? U.card("Fun", `
        ${U.check("brain.builtin_jokes", b.builtin_jokes, "His own jokes", "Thirty or so clean ones. Off: only yours below.")}
        ${U.wide("Your jokes", `<textarea data-path="brain.jokes" data-kind="lines" rows="3" placeholder="Why did the robot go on holiday? | It needed to recharge.">${U.esc((b.jokes || []).join("\n"))}</textarea>`,
          "One per line. A | splits the setup from the punchline, with a pause between.")}
        <div class="grid">
        ${U.field("Telling one, he looks", U.select("brain.joke_expression", b.joke_expression, [["", "Keep his face"], ...(p.choices?.expressions || []).map((e) => [e, U.human(e)])]))}
        ${U.field("And plays", U.select("brain.joke_animation", b.joke_animation, [["", "Nothing"], ...(p.choices?.animations || []).map((a) => [a, U.human(a)])]))}
        ${U.field("\"Pick a number\" goes up to", U.num("brain.random_max", b.random_max, { min: 2, max: 1000000, step: 1 }), "Unless a range is said.")}
        ${U.field("\"Say that again\" remembers", U.num("brain.repeat_minutes", b.repeat_minutes, { min: 1, max: 1440, step: 1, unit: "min" }))}</div>`) : ""}
      ${b.own_sentences && !b.off_commands.includes("wiki") ? U.card("Wikipedia", `
        ${U.field("kiwix-serve", U.text("brain.wiki_url", b.wiki_url, { placeholder: "http://192.168.1.10:8080" }),
          "An offline Wikipedia served by kiwix-serve (a Docker container with a Wikipedia .zim file). Empty: no Wikipedia answers.")}
        ${b.wiki_url ? `${U.field("Book", U.text("brain.wiki_book", b.wiki_book, { placeholder: "The first Wikipedia it serves" }), "Its name in kiwix-serve, like wikipedia_en_all_nopic_2026-06, or the start of it.")}
        <div class="grid">
        ${U.field("Sentences said", U.num("brain.wiki_sentences", b.wiki_sentences, { min: 1, max: 10, step: 1 }), "From the start of the article.")}
        ${U.field("Wait at most", U.num("brain.wiki_seconds", b.wiki_seconds, { min: 1, max: 30, step: 1, unit: "s" }), "Then the delegate answers.")}</div>
        ${U.check("brain.wiki_brackets", b.wiki_brackets, "Say what's in brackets", "Birth dates, pronunciations, other names. Off: \"Paris (French pronunciation: …) is\" becomes \"Paris is\".")}
        ${U.check("brain.wiki_credit", b.wiki_credit, "Say where it's from", "\"Wikipedia says: …\"")}` : ""}`) : ""}
      ${U.card("Face and log", `<div class="grid">
        ${U.field("Local badge", U.text("brain.local_icon", b.local_icon, { placeholder: "None, or mdi:lightning-bolt" }))}
        ${U.field("Delegate badge", U.text("brain.delegate_icon", b.delegate_icon, { placeholder: "None, or mdi:brain" }))}
        ${U.field("Badge for", U.num("brain.icon_seconds", b.icon_seconds, { min: 0, max: 60, step: 1, unit: "s" }), "0: no badge.")}
        ${U.field("Turns kept", U.num("brain.log_size", b.log_size, { min: 1, max: 200, step: 1 }), "In memory only: a restart clears them.")}</div>`)}`)}
    ${U.card("Turn log", `<div class="brain-log">${brainLog(p)}</div>`)}
    <style>.brain-said, .brain-tried { margin: 8px 0 12px; } .sents { margin: -4px 0 8px 52px; font-size: .9em; }
      .sents summary { cursor: pointer; color: var(--secondary-text-color); } .sents ul { margin: 4px 0; padding-left: 18px; } .sents code { white-space: normal; } .turn { display: grid; grid-template-columns: auto 1fr auto; gap: 2px 10px; padding: 8px 0; border-top: 1px solid var(--divider-color); }
      .turn:first-child { border-top: 0; } .turn ha-icon { --mdc-icon-size: 20px; grid-row: span 3; color: var(--secondary-text-color); }
      .turn.t1 ha-icon { color: var(--success-color, #43a047); } .turn.t3 ha-icon { color: var(--info-color, #039be5); }
      .turn .said { font-weight: 500; } .turn .meta, .turn .why { grid-column: 2 / 4; } .turn .ms { color: var(--secondary-text-color); font-size: .85em; }</style>`;
}

function brainLog(p) {
  const turns = p.brainTurns;
  if (turns == null) return `<p class="muted">Loading…</p>`;
  if (!turns.length) return `<p class="muted">No turns since Home Assistant started. Ask him something.</p>`;
  return turns.map((t) => {
    const [ic, tier] = TIER[t.tier] || TIER[0];
    const at = new Date(t.at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `<div class="turn t${t.tier}" title="${U.esc(tier)}">${U.icon(ic)}
      <span class="said">“${U.esc(t.said)}”</span><span class="ms">${t.speaker ? `${U.esc(t.speaker)} · ` : ""}${t.profile ? `${U.esc(t.profile)}'s profile · ` : ""}${at} · ${t.ms} ms</span>
      <span class="meta">${U.esc(SOURCE[t.source] || t.source)}: ${U.esc(t.reply || (t.source === "dropped" ? "(silent)" : "(no reply)"))}</span>
      <small class="why muted">${U.esc(t.why)}</small></div>`;
  }).join("");
}

// The live turn log: the brain's turns, then each new one (alfie/brain/turns).
function brainWatch(p) {
  if (p.brainUnsub) return;
  p.brainUnsub = p.hass.connection.subscribeMessage((m) => {
    if (m.turns) p.brainTurns = m.turns;
    if (m.turn) p.brainTurns = [m.turn, ...(p.brainTurns || [])].slice(0, 200);
    const box = p.root.querySelector(".brain-log");
    if (box) box.innerHTML = brainLog(p);
  }, { type: "alfie/brain/turns" }).catch(() => { p.brainUnsub = null; p.brainTurns = []; });
}

export function mount(p, sub) {
  if (sub === "brain") {
    brainWatch(p);
    if (!p.brainUsers) p.hass.callWS({ type: "config/auth/list" })
      .then((r) => {
        p.brainUsers = (r || []).filter((u) => !u.system_generated && u.is_active)
          .map((u) => ({ id: u.id, name: u.name || u.username || u.id }));
        if (p.sec === "voice" && p.sub === "brain") p.render();
      })
      .catch(() => { p.brainUsers = []; });
    if (!p.brainSentences) p.hass.callWS({ type: "alfie/brain/sentences" })
      .then((r) => { p.brainSentences = r.sentences; if (p.sec === "voice" && p.sub === "brain") p.render(); })
      .catch(() => {});
    p.hass.callWS({ type: "config/label_registry/list" })
      .then((r) => {
        const got = (r || []).map((l) => ({ label_id: l.label_id, name: l.name }));
        const changed = JSON.stringify(got) !== JSON.stringify(p.brainLabels);
        p.brainLabels = got;
        if (changed && p.sec === "voice" && p.sub === "brain") p.render();
      })
      .catch(() => { p.brainLabels = []; });
    p.hass.callWS({ type: "assist_pipeline/pipeline/list" })
      .then((r) => {
        const using = (r.pipelines || []).filter((x) => x.conversation_engine === BRAIN_ENTITY)
          .map((x) => ({ name: x.name, prefer_local_intents: x.prefer_local_intents }));
        const changed = JSON.stringify(using) !== JSON.stringify(p.brainPipelines);
        p.brainPipelines = using;
        if (changed && p.sec === "voice" && p.sub === "brain") p.render();
      })
      .catch(() => {});
  }
  if (sub === "speech") {
    speechPreview(p);
    p.hass.callWS({ type: "assist_pipeline/pipeline/list" })
      .then((r) => {
        const using = (r.pipelines || []).filter((x) => x.tts_engine === VOICE_ENTITY).map((x) => x.name);
        const changed = JSON.stringify(using) !== JSON.stringify(p.speechPipelines);
        p.speechPipelines = using;
        if (changed && p.sec === "voice" && p.sub === "speech") p.render();
      })
      .catch(() => {});
  }
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
  p.brainUnsub?.then((u) => u()).catch(() => {});
  p.brainUnsub = null;
  p.face?.previewVoice?.(null);
}

export function afterInput(p, path) {
  if (path.startsWith("speech.")) speechPreview(p);
  if (p.voiceTry && path.startsWith("voice.")) p.face?.previewVoice?.(p.voiceTry, look(p));
}

export function tool(p, ev) {
  if (ev.target.id === "speech-try") {
    p.speechLine = ev.target.value;
    speechPreview(p);
    return true;
  }
  if (ev.target.id === "brain-try") {
    p.brainTry = ev.target.value;
    return true;
  }
  if (ev.target.id === "brain-ask") {
    p.brainAsk = ev.target.value;
    return true;
  }
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
    case "brain-prof-add": {
      const b = p.draft.brain;
      b.profiles.push({ id: U.slugId(b.profiles, "", `person_${b.profiles.length + 1}`), name: "", user: "", url: "", key: "" });
      p.edited(true);
      return true;
    }
    case "brain-prof-rm": p.draft.brain.profiles.splice(Number(el.dataset.i), 1); p.edited(true); return true;
    case "brain-cmd": {
      const b = p.draft.brain, k = el.dataset.name;
      b.off_commands = b.off_commands.includes(k) ? b.off_commands.filter((x) => x !== k) : [...b.off_commands, k];
      p.edited(true);
      return true;
    }
    case "brain-ask": {
      const text = (p.brainAsk ?? "").trim(), out = p.root.querySelector(".brain-said");
      if (!text) return true;
      if (out) out.textContent = "…";
      p.hass.callWS({ type: "conversation/process", text, agent_id: BRAIN_ENTITY })
        .then((r) => { p.brainReply = r.response?.speech?.plain?.speech || "(no reply)"; })
        .catch((e) => { p.brainReply = `Couldn't: ${e?.message || e}`; })
        .finally(() => { const o = p.root.querySelector(".brain-said"); if (o) o.textContent = p.brainReply; });
      return true;
    }
    case "brain-sents": {
      // The native toggle opens it; remember it across renders.
      p.brainOpen ??= new Set();
      const k = el.dataset.name;
      if (p.brainOpen.has(k)) p.brainOpen.delete(k); else p.brainOpen.add(k);
      return true;
    }
    case "brain-try": {
      const text = (p.brainTry ?? "").trim();
      if (!text) return true;
      const name = (k) => COMMANDS.find(([c]) => c === k)?.[1] || k;
      const slots = (s) => { const e = Object.entries(s); return e.length ? ` (${e.map(([k, v]) => `${k}: ${U.esc(v)}`).join(", ")})` : ""; };
      p.hass.callWS({ type: "alfie/brain/match", text })
        .then((r) => {
          const seen = new Set(), rs = r.readings.filter((x) => !seen.has(x.command) && seen.add(x.command));
          // Voice actions' bare "{name}" reads every sentence: only a real name answers it.
          const bare = (x) => x.command === "run" && x.slots.name?.toLowerCase() === text.toLowerCase().replace(/[^\w\s']/g, "").trim();
          p.brainTried = !rs.length ? "None of his sentences: Home Assistant's intents, then the delegate."
            : `${rs.map((x, i) => `${i ? "" : "Tried first: "}<b>${U.esc(name(x.command))}</b>${bare(x) ? " (only if something is called that)" : slots(x.slots)}${x.late ? ", after Home Assistant's intents" : ""}`).join("; then ")}. The first that can answer does.`;
        })
        .catch((e) => { p.brainTried = `Couldn't: ${U.esc(e?.message || e)}`; })
        .finally(() => { const o = p.root.querySelector(".brain-tried"); if (o) o.innerHTML = p.brainTried; });
      return true;
    }
    case "speech-add": p.draft.speech.replacements.push({ from: "", to: "" }); p.edited(true); return true;
    case "speech-rm": p.draft.speech.replacements.splice(Number(el.dataset.j), 1); p.edited(true); return true;
    case "speech-say": {
      const out = p.root.querySelector(".speech-sent");
      p.hass.callWS({ type: "alfie/voice/say", message: p.speechLine ?? SPEECH_SAMPLE })
        .then((r) => { if (out) out.textContent = r.speakers.length ? `Sent to ${r.speakers.join(", ")}, with the saved rules.` : "No speakers: pick some in Assistants."; })
        .catch((e) => { if (out) out.textContent = `Couldn't: ${e?.message || e}`; });
      return true;
    }
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
