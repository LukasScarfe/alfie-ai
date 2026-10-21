# Alfie: plan

Milestones in order. `[ ]` todo, `[~]` in progress (claimed), `[x]` done. Each milestone is broken
into smaller steps by the agent that claims it (in plan mode, with Lukas's OK) and recorded here.

- [x] **0. Ground truth.** Read xy-bench (face, moods, animations, screens, intros) and the current
      HA mood/automation YAML. Settle the scene-state format (open question 1) and the dev loop: a
      dev HA container on raccoon in the ha-sun-beams style, the test command, and how to screenshot
      the card. Update design.md and CLAUDE.md "Finishing a change".
  - [x] Read xy-bench face/moods/animations and the production Superintendent YAML; ported
        defaults recorded in design.md.
  - [x] Reference renders of the 12 moods in `docs/reference/`.
  - [x] Scene-state format decided (design.md "Scene state").
  - [x] Dev HA `alfie-dev-ha` on :8125, the `./dev` wrapper (test, shot, face, sheet, fake
        states), and CLAUDE.md "Dev loop" + "Finishing a change".
- [x] **1. Living face (first win, on the tablet).** Integration skeleton, the card auto-registers,
      the face renders with all 12 expressions and 20 animations, mood comes from a hard-coded set
      of good/bad signals, motion gaze works. Shown on the real tablet.
  - [x] Integration skeleton: manifest, config flow (name), frontend auto-registration.
  - [x] Engine core, pure Python: signals.py, mood.py (3 combine modes), defaults.py.
  - [x] Engine runtime: state listeners, motion gaze, idle fidgets, `alfie/subscribe`,
        `sensor.alfie_mood`, `select.alfie_mode`, `alfie.set_expression` / `alfie.play_animation`.
  - [x] `alfie-face.json` and the canvas card: 12 expressions, 20 animations, blink, energy.
  - [x] Tests (signals, mood, face data, a JS/Python pose cross-check) and `./dev face` sheet.
  - [x] Dev HA screenshot: mood and gaze change with poked signals and motion.
  - [x] Shown and approved by Lukas ("the card looks good").
- [x] **2. Signals and personality.** Panel page for signals (entity / operator / value, severity,
      linked screen), the combine-mode options, mood levels, personality presets.
  - [x] Config model, pure Python (`config.py`): defaults seed, validate, build; `Signal.enabled`.
  - [x] Store (`alfie.config`) seeded from defaults, options-flow values migrated; live
        `engine.apply_config` with no reload.
  - [x] Admin WS API: `alfie/config/get|set|reset|preview`.
  - [x] Personality presets (bubbly, stoic, grumpy, sleepy, nervous, custom) in the engine, the
        scene and the card; per-card `personality` override.
  - [x] Admin sidebar panel: Signals, Mood, Behaviour, Personality tabs with live preview.
  - [x] Tests, design.md, dev HA screenshots of the panel and a personality sheet.
  - [x] True rounded corners (pulled forward from M7): fillets, arc-length sampling, smooth
        stroke with crisp lid corners.
  - [x] M3 groundwork: presenting and rotation decided (design.md "Screens"); xy-bench port
        inventory in `docs/m3-screens.md`.
- [x] **3. Screens.** Port the templates to JS (plot, bars/value, weather, home clock, sky, stars,
      map, text) with entity pickers, add the rotation display mode and transitions. Built by
      parallel Sonnet agents with disjoint files; the research is in `docs/m3-screens.md`.
  - [x] A. Foundation: the stroke model and the card's screen renderer, the font (JSON from
        xy), the view helpers and icons, `screens` and `rotations` in the config,
        `alfie/screen_data` and the provider registry, the card's rotation mode and presenting
        (handover and corner), `alfie.show_screen`, and the harness `sheet=screen`.
  - [x] B1. Plot plus the history provider.
  - [x] B2. Weather plus the forecast provider.
  - [x] B3. Home clock, value and bars.
  - [x] B4. Sky maths (golden-tested against xy), sky and stars.
  - [x] B5. Map (opt-in Overpass, rounded cells, disk cache) and text (calendar).
  - [x] B6. Intros: the stroke transforms and fade, then materialise, condense and morph.
  - [x] C. The panel's Screens tab: build screens from each type's schema, rotations, and a
        live preview.
  - [x] D. Card visual editor (`alfie-card-editor.js`, the card's `getConfigElement`): every card
        option in groups (look, display mode and rotation, presenting, personality, advanced),
        with a live preview, so no YAML is needed. Runs in parallel with B.
  - [x] E. **Look** tab and **Playground** in the panel (after C, same file):
    - Alfie's global default look: style, colours, line width, glow, eye fill, padding and the
      head and eye shapes (type plus parameter sliders). It's saved in a new `look` section of
      the config and sent to the cards, and a card's own options still win.
    - A playground with a big live face: a button for each of the 12 expressions and 20
      animations, a mood-level picker, and energy and personality sliders. It plays locally,
      with an optional "play on every display".
    - The full shape, expression and animation editors stay in M7.
  - [x] Dev HA: a rotation card in both presenting styles, screenshots for Lukas.
  - [x] Shown on the real tablet against dev HA (Lukas): screens, rotation, both presenting
        styles, the card editor.
- [x] **4. Triggers and stories.** Trigger config (any entity, per-motion-sensor actions, mood
      changes, signal crossings), the fill-in story template and the advanced sequence builder, the
      default mood-change, bad-news and celebrate stories. Presenting is agreed (design.md
      "Screens": hand over or corner).
  - [x] A. Model (pure): `stories.py`, `triggers.py` (validate, template compile, defaults),
        config v2 with the v1 reactions migrated into triggers; tests.
  - [x] B. Engine: trigger matching and coalescing, the story runner with priority/queue,
        scene `story`, `alfie.play_story` / `stop_story`, `alfie_story` events, WS
        `alfie/story/play` and `alfie/triggers/status`, per-signal repeats; tests.
  - [x] C. Card: story interrupts rotation, `place` spring (move/resize), per-step present and
        transition, rotation `bad_news` and per-signal `in_rotation`; face checks.
  - [x] D. Panel: Triggers and Stories tabs, Behaviour reactions removed, Signals repeat row,
        play-draft and last-fired status.
  - [x] E. Dev HA: each default story live, PNGs to Lukas; design.md, version 0.4.0.
  - [x] G. Rotations without Alfie in between (Lukas's review): screens follow screens and he
        stays gone or in his corner; Alfie steps; `face_seconds` optional (default 0); on
        appearing he plays the most relevant story on that card (`alfie/story/expand`,
        behaviour `appear_story_bad` / `_ok`, the new Hello story, card `appear_story`).
  - [x] F. Shown on the real tablet against dev HA (Lukas).
- [x] **5. House modes.** Night, away, guests and user-defined modes with overrides. Decided with
      Lukas: one mode at a time (list order wins), away idles and greets on arrival, no guests
      default for now; a mode overrides presence, mood/bad news, personality, rotation, triggers.
  - [x] A. Model (pure): `modes.py`, trigger kind `mode`, config v3 (sleep_entity → Night),
        defaults Night and Away, Welcome home story and trigger; tests.
  - [x] B. Engine: mode resolution and overrides, mode triggers, scene `mode_info`, dynamic
        `select.alfie_mode` options; tests.
  - [x] C. Card: blank presence (nothing drawn, loop paused), mode rotation or pause,
        `follow_mode` option and editor; checks.
  - [x] D. Panel: Modes tab, mode trigger kind, Behaviour sleep pointer; click-through.
  - [x] E. Dev HA: Night, Away and Welcome home live, PNGs to Lukas; design.md; version 0.5.0.
  - [x] F. Shown on the real tablet against dev HA (Lukas).
- [x] **5½. Settings tidy-up.** One vocabulary everywhere (design.md "Words"), the panel
      regrouped into six sections with sub-tabs and "More options" folds, a generic starter config
      with a Get started guide (Lukas's house moves to `devenv/house.json`), config v4 key renames.
      Interfaces: [settings-contract.md](settings-contract.md).
  - [x] A. Backend: config v4 + `migrate_v3`, starter defaults, `alfie/suggest`, house.json and
        `./dev house`, strings and services; tests.
  - [x] B. Panel shell, `panel/ui.js`, Overview with Get started, import and export.
  - [x] C. Panel sections: Mood, Reactions, House modes, Screens, Appearance.
  - [x] D. Card and card editor: regrouped editor, new keys with old ones still read.
  - [x] E. Dev HA: fresh install and house import checked, PNGs to Lukas; design.md; 0.6.0.
  - [x] F. Lukas's review of the PNGs (and the panel itself); fixes from it.
- [x] **5¾. Icons.** Any HA icon in Alfie's line style: he turns into it (whole face or ring
      only), it shows beside him (his corner), or it goes on the card as a badge. It plays from a
      story step, the simple form, and `alfie.show_icon` / `clear_icons`, and entity triggers take
      a threshold entity. design.md "Icons".
  - [x] A. Model: the `icon` step and simple field, `check_icon` / `icon_action`, threshold
        entities on triggers; tests.
  - [x] B. Engine and services: icon screens, badges, `show_icon`, `clear_icons`, `alfie_icon`
        events, threshold re-checks.
  - [x] C. Card: `alfie-icons.js` (HA's paths to strokes, fill), transform / ring / beside /
        badge, local stories and Try it, `icons` option; harness `sheet=icons`.
  - [x] D. Panel: the Icon step, the simple form's icon, number-or-entity thresholds; editor.
  - [x] E. Lukas's house: Bright living room → Bright in here; checked live in dev HA, PNGs.
  - [x] F. Lukas's review of the PNGs and the choreography.
- [x] **5⅞. Oscilloscope.** Alfie on the X-Y scope through xy-bench: the card's vector output, the
      `scope/` sidecar (headless card to xy-bench), and xy-bench's `alfie` screen. design.md
      "Oscilloscope".
  - [x] A. Card: `vector_out` / `paint`, `G.vectorStroke`, the `alfie-vector` event; tests;
        harness `vec=1` and `vecjson=`.
  - [x] B. Sidecar `scope/` (Dockerfile, bridge.js, page.html, compose, .env.example) and
        `./dev scope` (dry run against dev HA).
  - [x] C. xy-bench `PUT /api/strokes` and the `alfie` screen (xy-scope session; live, not yet
        committed in xy-bench).
  - [x] D. Deployed on Numbat (`~/alfie-ai/scope`, Lukas chose the existing HA token).
  - [x] F. Settings page on the sidecar (`scope/settings.html`, port 8642): the card editor,
        beam order and condense, a live preview, saved to a volume and applied live.
  - [x] E. On the CRT: Lukas looks; tune fps, weights and aspect.
- [x] **5⅝. Panel style.** House modes back in the UI, and a cleaning pass over the panel: native
      HA look, left menu, list + detail, outlined fields, entity picker, save bar. Agreed with Lukas
      2026-10-20; design.md "Panel style".
  - [x] A. House modes back: panel section, mode trigger kind, card editor toggle, Overview line,
        `select.alfie_mode`; 0.8.13.
  - [x] B. Foundation: `panel/style.js` and the `panel/ui.js` builders (fields, buttons, switch
        rows, titled cards, list + detail); tests.
  - [x] C. Shell: left menu, Alfie toggle (column or floating), save bar and leave guard, narrow
        widths, item in the URL hash.
  - [x] D. Entity picker (`panel/entity-picker.js`, the icon-picker pattern); test.
  - [x] E. Sections onto list + detail / titled cards: mood, reactions, modes, screens,
        appearance, overview, `alfie-panel-forms.js`.
  - [x] F. Card editor in the same style.
  - [x] G. Lukas's review of the screenshots (light/dark, wide/narrow) and the panel; fixes.
- [x] **6. Voice.** React to all `assist_satellite` states, the what's-wrong LLM tool and intent,
      optional persona, mood-aware replies, TTS announcement step. Agreed with Lukas 2026-10-20:
      speaking looks are options (ring pulse default, eye rhythm, both, waveform ring); each card
      follows all, chosen or no satellites; an "Alfie" LLM API (whats_wrong tool, optional persona
      and mood prompt) plus a plain intent; default speakers and TTS engine in Voice settings, a
      speak step can override them.
  - [x] A. Model (pure): a `voice` config section (missing: the defaults, so no version bump), trigger kind `voice`
        (satellites, phase), speak step targets / engine / fill-ins; tests.
  - [x] B. Engine: satellites in the one filtered listener, `voice` in the scene (no state
        writes), voice triggers, the `after` reaction, speak via `tts.speak` /
        `assist_satellite.announce`, `alfie_voice` events.
  - [x] C. Agents (`voice.py`, `tell.py`, `llm.py`): the Alfie LLM API (`alfie__whats_wrong`,
        persona + mood prompt), Assist's tool (`assist_tool`), intent `AlfieWhatsWrong` and its
        sentences (`intent`), `problems` on `sensor.alfie_mood`, `alfie.say`, WS
        `alfie/voice/status` and `alfie/voice/say`. All opt-in, off by default.
  - [x] D. Card: `voice` option (all / chosen / none), phase looks interrupt the rotation, the
        four speaking styles, harness `sheet=voice`; checks.
  - [x] E. Panel: Voice section (Assistants, Agents; Try it on the dock face, Say it), `voice` trigger
        kind, speak step speakers and wait, card editor rows (voice, satellites, speaking).
  - [x] F. Dev HA PNGs to Lukas (sent); prod deploy (done, 0.11.0) against the S7+ (Lukas's OK before ticking the
        API on the Gemini agent); design.md; 0.11.0.
  - [x] G. Lukas's review.
- [~] **7. Editors and polish.** Shape (freehand path), expression and animation editors,
      building on M3's Look tab and Playground; card render styles and
      themes; the why panel; standard tap actions. The shape editor covers the head and the eyes,
      with every shape type in design.md ("Shapes are swappable data"), plus a freehand `path`
      (true rounded corners are already done). Lukas (2026-10-20) added uploaded SVGs
      as screens. New config sections default when missing (no version bump).
  - [x] A. SVG uploads and the `picture` screen type: `<config>/alfie/pictures/`, admin WS
        `alfie/pictures/upload|list|rename|delete` and `alfie/pictures/get`, sanitised;
        `alfie-svg.js` flattens basic shapes, transforms and viewBox to strokes (fill as outline,
        stroke-only as the line); options picture, colour, fill, fit, size, caption; Screens →
        Pictures sub-tab. 0.11.1.
  - [ ] B. Shape editor: a `path` point editor (drag, add, delete, roundness), left and right
        eyes apart, "From picture" (an SVG or icon outline as a path).
  - [ ] C. Expression editor: config `expressions` (custom and overridden built-ins), merged
        everywhere names are checked, sent to the cards; Appearance → Expressions.
  - [ ] D. Animation editor: config `animations` (keyframes: seconds, channels, easing),
        Appearance → Animations with play and scrub.
  - [ ] E. Render styles and themes: new styles, a plot line colour role, named palettes.
  - [ ] F. Why panel on tap, and standard tap / hold / double-tap actions in the card editor.
  - [ ] G. Tests, PNGs to Lukas, prod deploy, design.md, 0.12.0.
  - [ ] H. Lukas's review.
- [ ] **8. Release.** HACS packaging and README, install on production HA (with Lukas), put it on
      `tablet-dash`. Retire the old Superintendent HA automations only with Lukas's OK.

## How an agent continues development

1. Read `docs/handoff.md`, then the relevant parts of `docs/design.md`.
2. Resume the `[~]` milestone, or claim the first `[ ]` one (mark it `[~]`, commit).
3. For a new milestone, plan it in plan mode and get Lukas's OK, then add its steps here as a nested
   checklist.
4. Implement, keep tests green, push and `./dev prod deploy` to production HA, and check it there.
   Show Lukas visual results as images.
5. Tick what's done, rewrite `docs/handoff.md` (state, next step, gotchas), and commit as Lukas
   Scarfe with no Claude attribution. Push.
