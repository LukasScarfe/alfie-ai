// The panel's Voice section (design.md "Voice"): Assistants (which voice
// satellites he follows, how he looks while one listens, thinks and answers,
// and where he speaks) and Agents (what voice agents get from him: the Alfie
// LLM API, the what's-wrong tool and intent, the persona and his mood).

const V = new URL(import.meta.url).search;
const U = await import(`./ui.js${V}`);

export const id = "voice";
export const title = "Voice";
export const subs = [["assistants", "Assistants"], ["agents", "Agents"]];
const ASSIST_KEYS = ["enabled", "satellites", "while_asleep", "listening_expression", "listening_animation",
  "processing_animation", "speak_style", "speak_strength", "after", "speak_targets", "tts_entity", "language"];
const AGENT_KEYS = ["persona", "persona_prompt", "mood_aware", "assist_tool", "intent", "sentences"];
export const resets = { assistants: ASSIST_KEYS.map((k) => `voice.${k}`), agents: AGENT_KEYS.map((k) => `voice.${k}`) };

const STYLE_TEXT = { pulse: "Ring pulse", eyes: "Eye rhythm", both: "Ring and eyes", wave: "Waveform ring" };
const TRY = [["listening", "Listening"], ["processing", "Thinking"], ["responding", "Answering"]];
const SENTENCE_HINT = "One per line, in HA's sentence syntax: (a|b) picks one, [x] is optional. No punctuation.";

export function render(p, sub) {
  return sub === "agents" ? agents(p) : assistants(p);
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
        ${U.field("How much it shows", U.num("voice.speak_strength", v.speak_strength, { min: 0.2, max: 3, step: 0.1, unit: "×" }))}
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
        ${v.intent ? U.wide("Sentences", `<textarea data-path="voice.sentences" data-kind="lines" rows="5">${U.esc(v.sentences.join("\n"))}</textarea>`, SENTENCE_HINT) : ""}`)}`)}
    ${U.card("Right now", status)}
    <style>.vprompt { white-space: pre-wrap; font: inherit; background: var(--secondary-background-color); padding: 8px 10px; border-radius: 8px; }</style>`;
}

export function mount(p, sub) {
  if (sub === "agents") {
    p.hass.callWS({ type: "alfie/voice/status" })
      .then((r) => { const first = !p.voiceStatus; p.voiceStatus = r; if (first && p.sec === "voice") p.render(); })
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
