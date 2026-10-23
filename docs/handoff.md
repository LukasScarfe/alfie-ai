# Alfie: handoff

**Milestones 1 to 6 are done.** Lukas approved everything up to M6 on 2026-10-20.

**M7 (Editors and polish): built and deployed, 0.12.0.** Only H, Lukas's review, is open.
Steps A to G are in plan.md M7:
- A: pictures (uploaded SVGs as the Picture screen);
- B: the shape editor;
- C: the expression editor;
- D: the animation editor;
- E: styles and themes;
- F: the why panel and tap actions;
- G: the 0.12.0 release.

Each step sent Lukas PNGs as it went.

**Next after his review: M8 (Release).** HACS packaging and README, install on production
(already the dev loop), put it on `tablet-dash`. Retire the old Superintendent automations only
with his OK.

Version 0.16.2.

**Latest (0.16.2, 2026-10-23, Lukas): Now playing shows only while something is PLAYING.**
The type's `show_paused` defaults off (a rotation skips it while paused), and a voice music
turn makes no screen unless a named player (or, none named, any Music Assistant player) is
playing; `music_show_paused` (Voice → Screens → Music, off) brings back paused tracks and the
waiting badge. Lukas's production nowplaying screen had `show_paused: true` stored; set off.

**Latest (0.16.1, 2026-10-22, Lukas):** the nowplaying type's song name, artist and album each
turn off (`show_title`, `show_artist`, `show_album`), and the voice music screen has the same
three as settings (`music_show_title` / `_artist` on, `music_show_album` off) under Voice →
Screens → Music. PNGs sent.

**Latest (0.16.0, 2026-10-22, Lukas): voice volume changes show the `volume` screen** (plan.md
M11, design.md "Voice screens" Volume and "Screens" volume): a speaker icon and a slider for
one player (the playing one), not a toggle grid of every player the intent set. Volume intents
beat the music reaction. Setting `volume_screen` (on). Only Lukas's review is open (PNGs sent).
`devenv/icons.json` gained the four mdi:volume-* paths for the harness.
Same day, on production outside the repo: `script.play_music` with no query (or "music",
"some music"...) plays the "Michelle + Lukas" Blend (`library://playlist/39`, the tangerine-red
one Lukas picked); HA's own agent matches "play music" as turning that script on. Not run for
real yet (it would start music in the house); its templates were rendered on production.

**Latest (0.15.1, 2026-10-22, Lukas): a voice music request shows Now playing**, just the song
and the artist (`converse.music_screen`, `SONG_AND_ARTIST`), for `music_seconds` (15);
`music_screen` now defaults on (set on in production's config too). The type's elements are
now one centred block.

**0.15.0: the `nowplaying` screen type** (plan.md M10, design.md
"Screens"): title, artist, album and a play bar for the playing Music Assistant player, drawn
client side from the media_player attributes. Built, tested and deployed; only Lukas's review is
open (PNGs sent: playing, paused with blocks, long title in the corner, nothing playing). No
nowplaying screen is configured on production yet; one has to be built in the panel to use it.

**Latest (0.14.1, 2026-10-22, Lukas):** voice plots are titled by an MDI icon for the sensor's
kind (`converse.plot_icon`, setting `plot_title`) at `plot_text_size` 2; voice screens show
for `screen_seconds` 5 (`hold_while_speaking` off by default); a music request gets
`engine.music_reaction()` (happy face, the new `groove` animation in alfie-face.json, a note
badge) instead of a screen (`music_screen`). Checked on dev (music) and prod (plot).

**Latest (0.14.0, 2026-10-22, Lukas): M9 voice screens, built and on production; only H, his
review, is open** (design.md "Voice screens", plan.md M9).
- `finder.py` (pure name index + `alfie__find_entity` scoring), `converse.py` (pure: a `Turn`
  fed chat-log contents, `last_turn`, `subject`, `screen_for`), the `toggle` screen type, and
  voice.py's `FindEntityTool`, index (`Voice.index()`, rebuilt on registry events) and chat-log
  watcher (`_on_chat`, `_checker`, `_finish`). Engine: `show_voice_screen`, `_linger`,
  `@voice:<seq>` ids in `screen_data`. Card: `_inlineScreen`, card option `voice_screens`.
  Panel: Voice → Screens, find tool under Agents.
- **Gotcha:** HA 2026.10 notifies chat-log subscribers of an LLM agent's user words and tool
  results only, not its assistant messages, so LLM turns are read back from
  `hass.data["conversation_chat_logs"]` (every 0.4 s, at most 30 s, only while a turn is open).
  Right after the first deploy a few Gemini turns made no screen; not reproduced since.
- Checked on production: "is the coffee maker on" → toggle, "how dry is the monstera" → plot,
  "how hot is the server CPU" → `alfie__find_entity` (unexposed sensor). A real household
  request ("play my liked songs") made a toggle of the record player.
- Open for Lukas: on square cards the corner Alfie sits close to a single toggle's name (corner
  layout is the same for every screen type).
- Dev HA now has an Ollama agent (`conversation.ollama_conversation`, qwen2.5:3b on raccoon)
  and a pipeline "LLM test" with prefer-local, for testing LLM turns; `input_boolean.espresso_machine`
  exposed. `./dev shot` needs the `alfie-dev/alfie` path (not `lovelace/0`).
- Production house (2026-10-22, outside the repo): voice runs on Gemini 3.5 Flash-Lite (free
  tier); every exposed entity has a plain name and aliases (backup
  `devenv/out/registry_backup_2026-10-22.json`); see `~/claude/docs/homeassistant.md`.

**Latest (0.13.0, 2026-10-22, Lukas): layout boxes, Edit as YAML, plot axes** (design.md
"Layout", "Edit as YAML", "Plot axes").
- `S.layout` / `S.stack` / `S.fitText` / `S.lines` / `S.bounds` / `S.shift` in alfie-screens.js;
  every type's JSON has a `layout` option listing its elements, and each draw puts
  `memo.boxes` (the boxes in %) for the panel.
- Panel (panel/screens.js): the Layout fold (`layoutTable`, `layInput`, Take over, outlines via
  `renderScreenStill({highlight})` and `card.stillBoxes()`), and the YAML fold
  (`fillYaml`, `applyYaml`, WS `alfie/screen/yaml`).
- Weather is bands now; Text size 2 no longer overlaps (a test checks the boxes stay apart).
- Tests: tests/screens/layout.test.mjs (every element of every type hidden and boxed),
  layout and YAML pytest in test_screens_config.py. `./dev test` installs pyyaml too.
- Waiting on Lukas's look at it on production.

**Latest: house modes switched off (2026-10-22, Lukas).** `const.HOUSE_MODES = False` hides
them everywhere (design.md "House modes"). Rotations are now set by automations with
`alfie.show_rotation` + `duration`. On production, "Schedule: Sleep and Wake Cycle" calls it
on the first unplug at home 05:00-11:00 (`morning`, 10800 s); its 10:30 end trigger and the
Away automation's mode reset are removed. Without Night/Away, Alfie no longer sleeps or goes
quiet by himself; `alfie.set_alfie` can do that from an automation if Lukas wants it.

**Latest (0.12.0): the why panel and tap actions** (design.md "Card").
- **Card:**
  - `_gestures` handles tap, hold (500 ms) and double tap (250 ms), and a drag is no tap.
  - `_act` opens the why panel or fires `hass-action`.
  - `_showWhy` / `_whyHtml` build the overlay `.why` in the card. It refreshes on each scene
    while open.
  - DEFAULTS gained `tap_action`, `hold_action`, `double_tap_action` and `entity`.
- **Card editor:** the "Tap and hold" group (`_actions`, `ACTIONS`, `ACTION_FIELD`).
- **Checked in dev HA:** with the Monstera dry, a scripted tap (`devenv/out/m7/tap.js`) opens
  the panel: uneasy, the dry Monstera at 13 %, on show, house mode, face.
- Dev HA state left behind: pictures floorplan, logo and tree; screens pic_plan, pic_logo and
  pic_tree; expressions smug and love; animation wiggle. The look is reset to circles.

**Before that (0.11.5): styles and themes** (design.md "Card").
- **Card:**
  - `STYLES` gained blueprint, chalk, ink and pastel; `backgroundOf` gives a style's paper.
  - `roughen` makes the chalk line, `_line` draws a face line in the style (rough, soft fill),
    and `_grid` draws the blueprint paper.
  - `_colors` gained `line` and the effect flags, and screen strokes use `line`.
- **Shared:** `alfie-look.js` gained `STYLE_TEXT`, `THEMES`, `THEME_KEYS`, `themeOf`, and
  `line_color` in `LOOK_KEYS`.
- **Panel:** Look gained Theme chips (`look-theme`) and Screen line colour.
- **Card editor:** a Theme select, every style, and Screen line colour.
- **Config:** `STYLES` has eight; `look.line_color`.
- `./dev face sheet=styles` renders every theme with a Picture screen and Alfie in the corner
  (`devenv/out/m7/styles.png`).

**Before that (0.11.4): the animation editor** (design.md "The character" → Editors 3).
- **Config and engine:** `config._animations` checks the section, and `face_extras` now carries
  animations too. `validate` adds the names, and the engine's `self.animations` includes them.
- **Card:** a scrub (`FaceState.scrub`) holds one moment, through
  `previewAnimationAt(name, seconds)`.
- **Panel:** Appearance → Animations (`animList`, `keysOf` samples the code-drawn built-ins,
  `ownAnim`, `animInput`, `animClick`, `keysView`). A rename follows the animation through
  `renameFaceRefs`.
- **Checked in dev HA:** "Wiggle" was made by script (`devenv/out/m7/anim.js`) and saved, and
  Dizzy opened as 20 sampled keys. `anim2.js` holds Wiggle at 0.25 s on the floating preview.

**Before that (0.11.3): the expression editor** (design.md "The character" → Editors 2).
- **Config:** `config._expressions` checks the section; `face_extras` builds the card's form.
  `validate` adds the custom ids to the expression names.
- **Engine:** `face_rev` sits in the scene, `self.expressions` includes the custom ids, and WS
  `alfie/face` returns them.
- **Card:**
  - `layFace(face, extra)` lays the custom data over the shared face data, and `_fetchFace`
    fetches it once per rev, per card.
  - `previewFace(extra)` is the panel's draft preview.
  - The expression key includes `face.rev`, so changed poses re-blend.
  - In `_parts`, an expression's `eye` beats the look's `left_eye` / `right_eye`.
- **Panel:**
  - `choices.expressions` and `choices.animations` are getters: the built-ins, then the
    draft's own.
  - `syncFace` previews the draft's expressions on the page's cards.
  - Appearance → Expressions: list and editor (`exprList`, `ownExpr`, `exprInput`,
    `exprClick`).
- `services.yaml`: the expression and animation selects take custom values.
- **Checked in dev HA:**
  - "Smug" (sliders, star eyes) and "Love" (heart eyes from mdi:heart) were made in the panel
    by script (`devenv/out/m7/expr.js`, `love.js`) and saved.
  - `alfie.set_expression love` shows them on the dashboard cards.

**Before that (0.11.2): the shape editor** (design.md "The character" → Editors 1).
- **Point editor:** `panel/shape-editor.js` is an SVG point editor (`html`, `wire`, `paint`,
  `removeAt`). Appearance → Look uses it for every `path` part.
- **Look changes:**
  - Drawn is now a normal shape type.
  - "Shape the left and right eyes apart" (`eyes-apart`).
  - "From a picture or icon" under each shape.
- **Pure helpers:**
  - `alfie-svg.js` `outlinePoints` takes the biggest ring, simplifies it by RDP and fits it to
    [-1, 1] counter-clockwise.
  - `alfie-panel-forms.js` gains `mirrorSpec`, `pathSeed` and `changeShapeType(spec, type,
    outlineOf)`.
- **Face:** `alfie-face.js` `outline` now walks a path along its edge even at roundness 0.
- `panel/screens.js` exports `pics`, `loadPictures` and `pictureSvg` for Look.
- **Checked in dev HA:**
  - A drawn rounded head, a star left eye and a concave drawn right eye render on the
    dashboard.
  - A scripted drag, add, remove and "mdi:heart outline" in the panel all land in the draft:
    `devenv/out/m7/drag.js` (shot `--eval`).


**Before that (0.11.1): Pictures** (design.md "Screens" → picture; screens-contract.md).
- **Server:**
  - `pictures.py` (pure): `sanitise` keeps the drawable SVG subset and `PictureStore` handles
    `<config>/alfie/pictures/<id>.svg` plus `index.json`.
  - `providers/picture.py` serves `needs: "picture"`.
  - WS commands `alfie/pictures/list|get|upload|rename|delete`. All are admin-only except `get`.
  - `engine.pictures_changed()` clears the provider cache and folds `pictures_rev` into
    `screens_rev`.
- **Card:**
  - The `picture` screen type (`screens/picture.{json,js}`), with `alfie-svg.js` as its XML
    reader and flattener (it reuses `alfie-icons.js` `flatten`).
  - Strokes may carry `color` and `rule`. Fill groups paint in order.
  - A type with `refresh: false` is fetched once.
- **Panel:**
  - Screens → **Pictures**: drop or pick files, thumbnails, rename, replace, delete, "Make a
    screen", and "used by".
  - The `picture` option kind is a select with an Upload… button. Screen previews show the
    draft's picture before saving.
- **Checked in dev HA:**
  - Three SVGs were uploaded and drawn on the dev dashboard: a stroked floor plan, a filled
    logo with an even-odd hole and own colours, and a tree with nested transforms in solid fill.
    The tree matches Chrome's own render.
  - Test SVGs and the scratch WS helper were made in the session's scratchpad. To redo it, post
    `alfie/pictures/upload` with `{name, svg}`.
- Tests: `tests/test_pictures.py`, `tests/svg.test.mjs`, picture field cases in
  `tests/screens/panel.test.mjs`.
- Shots: `./dev shot alfie-dev/0` is the dev dashboard (`lovelace/0` is HA's loading page).

**Before that (0.11.0): Voice** (design.md "Voice"; plan.md M6 for the steps).
- **Model:**
  - Config section `voice` (missing → defaults, so no version bump).
  - Trigger kind `voice` (`satellites`, `phase`; `triggers.voice_phase` / `voice_fires`).
  - The speak step gained `targets`, `tts_entity`, `wait` and `{name} {mood} {reason} {wrong}`
    (`stories.fill`, Context gained name / level / reason / wrong_names).
- **Engine:**
  - `assist_satellite.*` joins `_relevant` while voice is on or a voice trigger exists.
  - `_voice_change` keeps `self.voice` (followed, active only), fires `alfie_voice`, plays
    `after` on done, and returns voice triggers. The scene gains `voice`
    (`{satellites, look}`), not in `state_key`.
  - `speak()`: satellites announce it, media players get `tts.speak`, all non-blocking.
    `alfie.say` and WS `alfie/voice/say` use it.
- **Agents:**
  - `tell.py` (pure) builds the tool data, the spoken answer, the mood line and the sensor's
    `problems`.
  - `voice.py`: `AlfieAPI` (always registered; the user ticks it in an agent), `WhatsWrongTool`
    (`alfie__whats_wrong`) and `WhatsWrongIntent`. Its sentences go through
    `conversation.agent_manager.get_agent_manager().register_trigger`, an internal API wrapped
    in try/except.
  - `llm.py` is HA's LLM tools platform (HA 2026.x): the tool joins Assist when `assist_tool`
    is on.
  - Persona, Assist tool and intent all default **off**. WS `alfie/voice/status` shows what
    agents get.
- **Card:**
  - Options `voice` (all / chosen / none), `voice_satellites`, `speak_style` and
    `speak_strength`.
  - `_voice()` picks the latest followed satellite, and `_wanted` waits like a story.
    `_blank()` gives way to it.
  - The listening expression covers listening and thinking. The thinking animation loops in
    `_loop`.
  - Speaking: `F.speechLevel`, `speakingChannels` (eyes) and `speakingHead` (pulse, wave) in
    `alfie-face.js`.
  - `previewVoice(state, look)` is the panel's Try it. The harness has `sheet=voice`.
- **Panel:**
  - `panel/voice.js` (Assistants, Agents).
  - The shell gained input kinds `list` (comma separated) and `lines`.
  - Reactions has the voice trigger kind and the speak step's speakers. The card editor has
    the voice rows.
- **Checked:**
  - In dev HA: a fake `assist_satellite.fake_tablet` drives the cards, and the intent answers
    "is anything wrong" and "what's wrong at home" through `conversation/process` (and stops
    when it is off). `llm/api/list` shows Alfie.
  - On production: no errors, the S7+ is followed, the Alfie API is listed.
  - Not yet: a real LLM tool call, real TTS (neither exists in dev).
- **Gotchas:**
  - Shot stills of the speaking styles can land on a pause between syllables.
  - The dev HA's saved voice config keeps the sentences it was saved with.
  - `devws.py`-style access to dev HA: prodtool's `WS` with HOST, PORT and `_token`
    overridden by devtool's token.

**Before that (0.10.0): automation hooks** (design.md "Automations"). Services moved to
`services.py` (a table of handlers and schemas); `automation.py` (pure) builds the dropdowns,
set at runtime with `async_set_service_schema` on start and through `engine.config_hooks`
after each config change. Engine: `holds` / `hold()` / `_release` laid over the mode as
`self.effective` (`modes.with_holds`), which everything that read `self.active`'s overrides now
reads; `set_mode(mode, duration)`; `set_enabled`; `_signal_events` fires `alfie_signal` per
edge. Checked in dev HA through REST and a stdlib WS listener: holds, durations, bad values
refused with the choices, the dropdowns in `/api/services`, one event per edge.

**Before that (0.9.3): weather rain is a dotted line, not bars** (Lukas). Hourly: every hour, on the
temperature's x positions, against the right axis; daily: through the column centres. `group`
and `RAIN_WEIGHT` are gone. PNGs sent.

**Before that (0.9.2): leaner screen options, IDs beside names.** Lukas reviewed every screen option
(design.md "Screen options stay lean") and asked for IDs to be visible and made from names.
- Screen type JSON gained `when` (shown only while other options hold some values) and `more`
  (folded). `Fm.optionShown`; a field others depend on gets `data-rerender`. screens.js draws
  the fold as `U.more(p, so:<id>)`.
- Gone as options: plot `buckets` (96, `DEFAULT_BUCKETS`) and `ticks` (3, from the height),
  weather `smooth` (1 pass) and `rain_group`. Saved values drop out.
- Label and text `size` became `text_size` (×, of 0.3): `migrate_v5`, CONFIG_VERSION 6.
- `U.idField` puts the ID under the Name in every list. Screens and rotations now use
  `autoId`/`nameToId` too, and duplicates are automatic again. Saved items' IDs never follow.
- Raised with Lukas, not built: `show_screen`/`play_story` take typed IDs (HA service
  selectors can't list them), there's no service to set a mood or start a rotation.

**Before that (0.9.1): icon options, per-series rows, more plot points, dead code out.** Lukas asked
for dropdowns of common choices that still take any MDI icon, asked why plots had so few points,
and asked for redundancy cut.
- New option kind `icon` (`screen_types.py`, `presets` list) and `"per": "<entities key>"` for
  text/choice/icon options held per entity (still comma strings, so saved screens load as they
  are). The panel draws per options as columns on each entity's row (`alfie-panel-forms.js`
  `perControl`, kind `optper` in `_onInput`, `perSet`/`perDrop`); removing an entity drops its
  item. `panel/icon-picker.js` `suggest` lists `data-presets` first (all of them when the field
  opens), then MDI matches; previews come from `PRESET_ICONS`.
- Plot markers, lines and labels and bars labels are per entity. New marker shapes in
  `S.MARKER_SHAPES`: triangle, star, cross, x, dot. An empty line style is solid now (a lone
  `dotted` no longer applies to every series; no prod plot relied on it). The value screen's
  icon is an `icon` option (adds car, and any MDI icon).
- Points per series: default 96, max 240 (`MAX_BUCKETS`, `DEFAULT_BUCKETS`). Saved screens
  keep their saved count (prod: plants_moisture 60, plot 36).
- Removed: `chart2`, the `nice_ticks`/`weather_icon`/`polylineLength` aliases,
  `triggers.watches_threshold`, and duplicate `esc`/`human`/`swatchValue` (`ui.js` and
  `icon-picker.js` take them from `alfie-panel-forms.js`). Left: the card editor's own `esc`,
  and `alfie-card.js` (1450 lines) is still one file.
- The harness only has the icons in `devenv/icons.json`; any other `mdi:` name never loads there
  and the frame stays blank. Use one of those for `./dev face`.

**Before that (0.9.0): the panel restyle, and house modes back.** Agreed with Lukas in an interview
(design.md "Panel style"): native HA look, no gradients or glyphs. `panel/style.js` holds all the
shell's CSS. The shell has a left menu (a dropdown under 1280px), a header Alfie toggle (a column
from 1800px, otherwise a floating panel that starts closed each visit), and a bottom save bar
(Unsaved changes · Discard · Save, centred under the body by `_placeBar`). List pages are
`U.list` + `U.item`: the shell's `_placeDetails` moves the open item's `.detail` into the
`.ld-detail` column, keeps one open per list (the last opened) and opens the first when wide;
when the body is under 760px (`STACK`, and the `main` container query) the list and editor take
turns, with a back arrow. Settings pages are `U.card` / `U.cards`. Entity inputs are
`data-entities` + `data-list`, served by `panel/entity-picker.js` (tests/entpick.test.mjs). The
card editor has the same field, switch and button style. House modes (hidden in d9c273b) are back:
panel section, mode trigger kind, card editor toggle, Overview line, `select.alfie_house_mode`.
- Screenshot tips: `./dev shot` hard-codes `--wait 3000` (a later `--wait` is ignored), so an
  `--eval` must act within ~2.5 s. `--light` gives HA's light theme. The dev HA loses its fake
  entities on restart: `./dev seed` before shooting the entity picker.

**Before that (scope only): the sidecar takes Alfie's own aspect.** Lukas will set the integration up for
the scope, so the sidecar no longer forces `ASPECT` from `.env` (gone): the card falls back to the
Look aspect like any card, and frames carry it. The viewport is 640 x 1280 so any aspect down to
0.5 fits on screen. xy-bench shrinks a frame wider than its own aspect setting to fit, so that
setting should be the tube's shape too. The settings page shows the aspect of the last frame.

**Before that (0.8.12): icon suggestions as you type.** Lukas wanted HA's icon dropdown wherever an
icon is typed. `panel/icon-picker.js` (attached once in `alfie-panel.js` `_frame`) suggests from
HA's `/static/mdi/iconList.json` for inputs with `data-icons`: `one` (the simple form's icon, the
Icon step; whole value) and `word` (every text-kind screen option, while the word at the caret
starts `mdi:`; just that word). Picking fires input and change, so the draft and the preview
icon update as if typed. Checked in dev HA: keyboard and click picks land in the draft.
`tests/iconpick.test.mjs` pins ranking and word replacement.

**Before that: scope animations at the full 60 (xy-bench side, no Alfie change).** Lukas found animations on
the tube very laggy. The card and sidecar sent a steady 60 fps, but xy-bench drew "the latest
pushed frame" while its pump renders in bursts of ~4 frames per aplay period (3000 samples), so
each Alfie picture showed for 3 to 4 frames: 40 distinct pictures in 360 frames. xy-bench's
`figures._Feed` now queues pushed frames (up to `ALFIE_QUEUE` = 8) and the pump takes one per
frame drawn (`ALFIE.step()` in `server.py` `_pump`): 271 of 275 pictures held one frame during
look_around and nod_off. Then, at Lukas's ask, the output buffer shrank: aplay 100 ms
(`XYBENCH_BUFFER_MS`), one-frame periods, the pipe to aplay a page, so the beam runs ~0.14 s
behind the card instead of ~0.6 s; no underruns over a story. Committed in xy-bench on Numbat
(`042a8ad`, `809e343`); that repo has no remote, so nothing is pushed from it.

**Before that (0.8.11): map trackers can be any located entity.** Lukas wants his parked-car sensors
(`sensor.lukas_last_car_location`, `sensor.michelle_last_car_location`: a timestamp state with
`latitude`/`longitude` attributes) on the map. The drawing and the streets provider already read
those attributes from any entity; only the option's `domain` (device_tracker, person) stood in
the way, in the panel's suggestions and the server check. The option is now `located: true`: no
domain check, and the panel suggests every entity whose state has a position (`Fm.located`).
Open from the same talk: Lukas would rather not use Overpass. Choices raised (not decided):
zones from HA drawn locally, a user-supplied GeoJSON street file, and reusing a nearby cached
cell while a tracker stays inside it.

**Before that (0.8.10): Alfie comes and goes like a screen.** After 0.8.9 Lukas still saw Alfie
come in a moment early. In hand over he came in while the screen left, and left while the next
screen came in, where one screen to the next is leave, then arrive. Now `_presentation` does the
same for him: after a screen leaves, he comes in by the transition (the `back` phase, as the
corner spring was), and a screen coming after him waits for him to go (`cur.pre`). Morph still
turns one into the other at once. A recorded feed (fade and draw) showed every hand-over on the
same beat, Alfie or not. Also `const.py` `VERSION` had stayed at 0.8.8 under 0.8.9 (the test
caught it); both are 0.8.10.

**Before that (0.8.9): Alfie keeps the rotation's beat.** Lukas saw Alfie come in and out of a
rotation at odd times. A screen's turn lasted its seconds, but an Alfie step (or `face_seconds`
gap) also waited, with no end, while his story was fetched, then lasted as long as the story when
that was longer, plus the time the screen took to leave and him to come back. Now his turn lasts
exactly its seconds (`alfie-stage.js` `duration`, no `hold`), and the card ends his story when the
turn ends (`_local.turn`; a fetch that lands after his turn is dropped). design.md "Rotation"
says so.

**Before that (0.8.8): no dot between screens on the scope.** Lukas saw a frame or two of blank
screen with a dot in the middle between one screen's exit and the next one's entry. A recording
showed one or two frames with no strokes at each hand-over, which park the beam in the middle.
The card now sends no empty frame while a screen is coming or going. xy-bench goes on tracing
the last one (the leaving screen's last grains), so the feed pauses 2 to 4 frames there.
Re-recorded: no empty frames.

**Before that (0.8.7): no jump before a screen leaves on the scope.** Lukas saw screens glitch just
before their transition, the sky most and the plants too. A recording of the feed showed each
screen drawn two ways during its turn. In the second or so that condense's slow ends leave
nothing visibly moving, `condenseLines` drew the evenly spaced samples, which cut corners and
shrink small marks. So the picture changed shape when the leave began, and again a second after
it arrived. Settled neighbouring grains now draw the stroke between them through its own
vertices, and a stroke wholly in place is its own path. Re-recorded: one shape for the whole
turn, and the same beam path into the leave.
- The scope page retries (reloads after 5 s) when HA isn't serving `alfie-card.js` yet. After a
  deploy it had reloaded too early, got a 404 and sat on its last frame until restarted.
- `bridge.js` gained `RECORD=<file>`: every frame appended as a JSON line, for this kind of
  check (`./dev scope` doesn't set it; run the container by hand with a volume).

**Before that (0.8.6): Text size on every screen, the scope's settings page, condense without dots.**
Lukas asked for a text size wherever a screen has text, a graphical way to set the scope's card
(he picked a page on Numbat), and a condense that starts disintegrating at once instead of
first turning into big dots.
- **Text size:** `text_size` (0.5 to 2, default 1) on bars, clock, map, plot, sky, stars, value
  and weather. Each draw module scales its text heights before layout. At 1 every drawing is
  unchanged, which `tests/screens/text_size.test.mjs` checks along with valid, in-box drawings
  at 0.5 and 2. The fixed-band layouts (weather, sky) move their rows by it. `devenv/house.json`
  gained the key.
- **Settings page:** `scope/settings.html`, served by `bridge.js` on `SETTINGS_PORT` (8642;
  8099 was taken on raccoon). `SETTINGS_PASSWORD` turns on basic auth. It loads
  `alfie-card-editor.js` through `/alfie_static/` proxied from HA. `/api/ws` forwards only
  `alfie/screens`, through the headless page (`window.SCOPE_WS`). `PUT /api/card` writes
  `data/card.json` (a compose volume) and calls `window.SCOPE_SET`, live. Checked against dev HA:
  a ring colour and beam order saved from the editor, and a rotation change took effect without
  a reload.
- **Not yet on Numbat:** there, `git pull`, add `SETTINGS_PASSWORD=` and `SETTINGS_PORT=8642` to
  `.env`, then `docker compose up -d --build`. The current `ALFIE_CARD` stays the start until
  the page saves.
- **Condense:** `alfie-intros.js` `condense` draws settled grains as their stroke
  (`subPath`, through the original corners) and only grains in flight as dots. A fully settled
  stroke is the stroke itself. The harness's `sheet=intros` takes `us=` for chosen u values.

**Before that (0.8.5): 60 Hz, steady loop entries, condense joins, a joined clock.** Lukas still
saw choppy transitions, condense's joins turned solid just before the end, and the jump lines
moved when Alfie glanced. He asked for 60 Hz always, and for a clock with no second hand whose
minute hand reaches the rim, as one line.
- **60 Hz:** the sidecar's default `FPS=60` (Numbat's `.env` too), and xy-bench's
  `XYBENCH_MIN_FPS=60` in `~/xy-bench/.env` on Numbat (xy-bench config, set at Lukas's ask).
- **Loops:** `placeTour` holds each loop's entry (`ent` in the plan, `LOOP_HOLD`);
  `G.placeStrokes` runs mid-transition and `G.openLoops` runs on every frame sent.
- **Condense:** `condenseLines` makes one stroke per stroke.
- **Clock:** a new `joined` option ("Minute hand reaches the rim"; when the rim is one stroke,
  the rim and both hands are one line). On production Lukas's clock has `joined: true` and
  `seconds: false`.

**Before that (0.8.4): smooth transitions on the scope, xy-bench's condense.** Lukas found the
screens good after 0.8.3, but transitions very choppy on the tube, and wanted condense to look
like xy-bench's (lines between random points). design.md "Oscilloscope" has the design.
- **Choppy:** dot transitions sent hundreds of strokes, and each frame re-solved the tour
  (stalls up to 230 ms). Fixed by `_tourScreen` (tour before the intro), no frame tour while
  `moving`, a plan memo per kind of frame (`G.tourStrokes(strokes, memo)`), and `trace`
  skipping `NO_PAINT`.
- **Judder:** xy-bench plays Alfie at exactly 50 fps, so the 60 fps feed skipped frames.
  `page.html` now runs the card on a 50 Hz timer (`FPS=50`; Numbat's `.env` too).
- **Condense:** `I.apply(..., opts)` with `{lines: true}` (`condenseLines`). The card passes it
  in vector mode unless `vector_condense: dots`.
- **Status line:** gains `N late, longest gap M ms`. On Numbat, check it after a rotation pass.

**Before that (0.8.3): the scope's beam tour.** `tourStrokes` and `vector_order`.
`vectorStroke` drops non-finite points. The live sidecar had logged a few HTTP 400s; the status
line now shows xy-bench's reason, and none have been seen since.

**Before that (0.8.2): Alfie on the oscilloscope.** design.md "Oscilloscope" has the design.
- **The card:** `vector_out` / `paint` (`_tap` at the head, eyes and `_drawStrokes`;
  `G.vectorStroke`; `NO_PAINT` is a no-op 2D context). The harness has `vec=1` (feed under each
  card) and `vecjson=` (plot a dumped frame).
- **The sidecar:** `scope/`, headless card to xy-bench, served at HA's origin by request
  interception. Try it with `./dev scope`. Checked against dev HA: 30 fps, 0 dropped, about a
  third of a core and ~210 MB.
- **xy-bench side:** built and live on Numbat by the xy-scope session (`PUT /api/strokes`,
  screen `alfie`). It's not committed in xy-bench; Lukas commits it.
- **Live on Numbat:** `~/alfie-ai/scope`, `docker compose up -d --build`. Its `.env` holds the
  production HA_TOKEN (Lukas chose to reuse it) and xy-bench's token; never print it. It runs
  at 29.8 fps with 0 dropped, about 14% of a core and 218 MB. xy-bench `/api/status` shows
  `alfie.age` 0. To update: `git pull` there, then `docker compose up -d --build`.
- **On the scope now:** Lukas disabled the HA automations that switched xy-bench's screens. The
  scope shows `alfie`, and the sidecar runs `ALFIE_CARD={"display": "rotation", "rotation":
  "default"}` (the id; `Default` is only the name and silently gave the face alone).
- **Not done:** switching the scope to `alfie` (`PUT /api/screen {"screen": "alfie"}`) is
  Lukas's call, because it's the household's display. The same goes for adding `alfie` to HA's
  xy_scope screen choices.
- `const.VERSION` had been left at 0.8.0 by 0.8.1 (a failing test); both are 0.8.2 now.

**Before that (0.8.1): his rotation turn explains his mood.** Hello gained a `@why` screen step
(config v5, `migrate_v4` upgrades a Hello still as shipped), and `engine.expand_story` makes
`@why` the bad signals, or the good ones while nothing is bad. On production Hello is upgraded
and deployed; Bright Living Room (good, above 300 lx) wasn't on at deploy time (267 lx), so its
screen showing on Alfie's turn is not yet seen live.


**Before that (0.8.0): aspect, icons in text, a smarter text screen.**
- **Global aspect:** `look.aspect` (config.py, `LOOK_KEYS`), the Appearance → Look slider, and
  the card editor's Aspect is unset (follows the panel) until moved. `_applyLook` rebuilds the
  card when the aspect or background changes.
- **Icons in text and markers:** `alfie-screens.js` `pieces()` lays out glyphs and icon words;
  `setIconSource` / `iconLoaded` / `iconStamp`; `marker()` takes icon names. The card's source
  is at the top of `alfie-card.js`; `renderScreenStill` dry-draws, then waits for icons.
  `devenv/icons.json` gained mdi:plex, mdi:account and mdi:cake-variant (paths from dev HA's
  `hass_frontend/static/mdi`).
- **Text screen:** `match`, `skip_empty`, `extend`; modules may export `rotation()`, which
  `G.advance(rot, clock, fit)` asks as a turn starts (card `_fit`); `shown` in the draw ctx.
- **Checks:** `devenv/out/plex-icons.png`, `aspect-dash.png`, `aspect-panel.png` (sent to Lukas);
  `devenv/out/aspect.js` sets the look's aspect in dev HA.

**Before that (0.7.1): counts on a plot.** Lukas plotted Plex viewers (`3 watching`). The Unit
option on plot, value and bars takes `none` (`S.unitOf`). Plot gained Combine points
(`combine`: mean, max, min, last; `bucketize(..., combine)` in `providers/history.py`, and the
matching statistics field for long spans, mean standing in for last) and Line shape
(`shape`: straight or steps; `S.curve(..., { steps })`).

**Before that (0.7.0): icons.** Lukas asked for Alfie to show any HA icon in stories and from
automations. design.md "Icons" has what was decided; here is where it lives:
- **`alfie-icons.js`:**
  - `iconPath` asks an off-DOM `<ha-icon>` for the path (it reads the inner
    `ha-svg-icon.path`);
  - `pathStrokes` is the SVG parser and flattener, with every subpath closed;
  - fill is a stroke `group` + `solid`, filled as one nonzero shape in `_drawStrokes`.
- **Stories (`stories.py`):** `check_icon`, then `icon_action`. Transform and beside become a
  `screen` action with `icon` (id `@icon`); the engine makes it `@icon:<seq>`. A badge is an
  `icon` action, and the engine keeps it in `self.overlays` (the scene's `icons`).
- **The card:**
  - `_iconScreen` registers a virtual screen whose module is `ICON_MODULE`. It is re-added
    after `_fetchScreens`. `_ready` holds it back until the path is in.
  - Ring mode is `_describe`'s `noHead`. The morph comes from the head stroke only, and the
    icon is drawn under the eyes.
  - Badges are `_syncBadges` / `_drawBadges` with `G.badgeAt`.
  - `showIconLocal` is the panel's Try it, run as a one-action local story. A local story's
    screen now shows on a companion card and with no rotation (`_localScreen`).
- **Triggers:** an above/below `value` may be an entity id (`threshold_entity`). The engine's
  `_thresholds` map gets the threshold entity into the filtered listener, and a threshold move
  re-checks with `entity_fires(t, s, s, new, old)`.
- **Services:** `alfie.show_icon` and `alfie.clear_icons`, plus the `alfie_icon` event.
- **Lukas's house:**
  - `house.json` and `tests/house_v3.json` gained the **Bright in here** story and the
    **Bright living room** triggers;
  - `./dev seed` fakes the lux sensor (120) and `input_number.living_room_lights_on_lux` (300);
  - `./dev state sensor.living_room_motion_sensor_illuminance 900` fires it, then there is a
    30 min cooldown.
- **Checks:**
  - `./dev face sheet=icons` (fixtures in `devenv/icons.json`, ten real mdi paths);
  - the live shots and click scripts are in `devenv/out/icons/` (`panel.js` opens the story and
    presses Try it).
- **Gotcha:** calling an `alfie.*` action straight after `./dev restart && ./dev wait` can 400
  ("Alfie is not set up"), because HA is up before the integration. Wait a few seconds.

**Before that (0.6.1): the dock.** Lukas asked for the settings' Alfie preview on every page. The
panel shell now draws one live face in a sticky right-hand column on every section (design.md
"The dock"; settings-contract.md `p.face`, `p.syncFace`, `p.faceHold`, a section's `dock()`).
The shell's header, tabs and dock are built once (`_frame`), and only the body redraws, so the
face keeps running. Overview and Appearance lost their own big faces; Look's stills and picks and
Personality's animations sit under the dock face. Checked in dev HA (wide and phone width, a
draft look and mood showing on Reactions). Waiting on Lukas's look.

## 5½ status: settings tidy-up (2026-10-19)

Lukas asked for every control and word to be gone over: settings grouped clearly, one
vocabulary everywhere, simple first setup, more nesting, nicer looking.
- design.md "Words" and "Panel" record what was decided.
- [settings-contract.md](settings-contract.md) has how the parts fit and the field-by-field
  words.

**What was built:**
- **Config v4** (`config.migrate_v3`, item by item and idempotent):
  - signal `label` → `name`;
  - story `mode`/`template` → `form` (`simple`|`steps`)/`simple`;
  - house mode `presence` → `alfie` (`awake`, `asleep`, `quiet`, `hidden`; was normal, asleep,
    idle, blank);
  - `behaviour.gaze_map` → `motion_sensors`;
  - `look.face_color` → `ring_color`;
  - a new `overview {dismissed, done}` section.

  `config.migrate()` runs every migration, and `validate` calls it.
- **Versionless configs:** a config with no `version` is now taken as current, not as v1 (every
  store carries its version). A config without `modes` gets the default modes, minus any
  `triggers_off` it has no trigger for.
- **Elsewhere:**
  - the scene's `mode_info.alfie`;
  - the choices `alfie_states` and `simple`;
  - `show_screen` takes `duration`, with `seconds` still accepted;
  - the select's name is "House mode".
- **Card:**
  - YAML `display` (was `mode`) and `ring_color` (was `face_color`);
  - `alfie-look.renameOld` maps the old keys, in the card and the editor.
- **Starter defaults:** `defaults.py` is generic now:
  - pattern signals: low battery, battery-low warning, leak, smoke/CO, update;
  - no motion sensors;
  - Night picked by hand.
- **Lukas's house:**
  - `devenv/house.json` (v4, the dev store's config with its screens and rotations);
  - `./dev house` loads it (it was loaded last; dev HA is his house now);
  - `tests/house.py` reads it for the old-face tests;
  - `tests/house_v3.json` checks the v3 → v4 migration.
- **`alfie/suggest`** (`suggest.py`, pure): signals (moisture, battery, door/window, problem),
  motion sensors and sleep switches the house has and the config doesn't cover. One pass per
  call, made when the Overview opens.
- **`alfie/config/preview` with `with_config`** returns the checked, migrated config, which is
  what Import uses.
- **The panel:**
  - **The shell** (`alfie-panel.js`) has six sections with sub-tabs in the hash (`#mood/signals`),
    and keeps Save/Revert, the preview, the badges and trigger statuses.
  - **The sections** are modules in `frontend/panel/`: `overview`, `mood`, `reactions`, `modes`,
    `screens` and `appearance`.
  - **`panel/ui.js`** has the pure HTML builders: the uniform `item`, `more` folds that stay
    open, switches, `field`/`group`, `seg` and `picks`.
  - **A new item's ID follows its name** (`p.autoId`/`nameToId`) until it is edited by hand.
- **The Overview:**
  - Alfie now: face, mood, house mode, story playing, and the active signals, which link to the
    signal;
  - **Get started**, in 5 steps;
  - export / import under More options.
- **Screen option schemas:** labels lost their parenthetical notes. Notes went into `hint`,
  units into `unit` (screens-contract.md), and `optionField` shows both.
- **The card editor** is grouped Display → Look (Shapes nested) → Personality → More options,
  with the panel's labels and switches.

**Checked live:**
- **Fresh install** (dev store moved aside):
  - Get started showed suggestions from the fake entities;
  - its click-through (`devenv/out/tidy/guide.js`) added a signal and a motion sensor, set
    Night, and saved clean.
- **`./dev house`:**
  - a dry Monstera makes Alfie uneasy;
  - the sleep switch makes it Night (asleep).
- **Old-key card YAML** on the dev Rotation view rotated fine, before `./dev dashboard`
  rewrote it to `display`.
- **Panel PNGs** are in `devenv/out/tidy/`. Their scripts:
  - `open.js` (`window.OPEN`, `window.MORE`) opens items for a shot:
    `./dev shot "alfie#mood/signals" out.png --size 1200x1500 --wait 4000 --eval "window.OPEN=1; $(cat devenv/out/tidy/open.js)"`;
  - `guide.js` clicks through Get started.
- **Backups and stale scripts:**
  - the moved-aside v3 dev store is in this session's scratchpad only. `house.json` and
    `tests/house_v3.json` hold the same thing.
  - The old M4/M5 click-throughs (`devenv/out/m4-click.js`, `m5-click.js`) use the old tabs and
    `p._draft`, so they no longer work. Use `p.draft` and the hash routes.

**Next:**
1. Lukas's review of the PNGs (5½ F and 5¾ F), and fixes from it.
2. The tablet check for M4 and M5 (F).
3. Claim M6 (Voice) and plan it in plan mode with Lukas's OK.

## M5 notes: house modes

- **`modes.py`** (pure) handles validate, choose, held_back, mood_level, wakes and
  personality. The engine's `_recompute` chooses the mode (conditions are signals, so the
  filtered listener is reused) and applies what the mode says Alfie is, hold back, mood
  floor/fixed and personality, and it fires mode triggers. `_fire` skips the mode's
  `triggers_off`.
- **`select.alfie_mode`** options are `auto`, `normal` and the mode ids.
- **The card:** `hidden` clears the canvas and stops the loop (unless a story plays). A mode
  rotation swaps in and the card's own resumes where it was; `pause` holds the clock.
  `follow_mode: false` opts out.
- **Checked live:**
  - `./dev state zone.home 0` → Away, then `1` → Welcome home plays;
  - the sleep switch → Night;
  - a critical signal wakes him, and Alarm plays.
- **Gotchas:**
  - `./dev seed` sets `zone.home` to 2 (dev's real zone.home counts no one, which is Away).
    Seeding straight after a restart logs a harmless "Entity id already exists: zone.home".
  - `self.active` is the mode dict; `mode_id` is its id or "normal"; `self.mode` is the
    select's pick; `alfie_state` is what the mode makes him.
  - `_schedule_idle` cancels any pending timer first, so a mode change reschedules it.

## M4 notes: triggers and stories

- **`stories.py` and `triggers.py`** are the pure models. The engine runs stories (priority,
  queue, coalescing) and offers `play_story`, `stop_story`, the `alfie_story` events, and WS
  `alfie/story/play`, `alfie/story/expand` and `alfie/triggers/status`.
- **In a rotation, screens follow screens** with Alfie kept away or in his corner (`swap` and
  `held` on the card's `_cur`). He comes on for an Alfie step (`{alfie: true, seconds}`) or a
  `face_seconds` gap (default 0). Then he plays the most relevant story on that card only:
  - `alfie-stage.js` `advance` returns `appear`, and the card plays `alfie/story/expand` as a
    local overlay;
  - the story is behaviour `appear_story_bad` / `appear_story_ok`, or the card's `appear_story`.
- **Lukas's later card work** (before 5½), now in design.md:
  - screen changes on `random` share one transition;
  - stories wait while a screen leaves and Alfie comes back (`screenEnd`);
  - a screen module loads ahead with its data, so the stand-in title never flashes.
- **Dev checks:** the dashboard view **Alfie dev → Rotation** has two `g_test` cards.
  `devenv/out/m4g-trace.js` and `m4g-freeze*.js` trace or freeze them.
- **Gotchas:**
  - Timers passed to `async_call_later` must be `@callback` (or `callback(lambda ...)`).
  - A story whose `@why` / `@wrong` resolve to no screens skips those steps (by design).

## Working, in dev HA (`./dev up`, then `http://192.168.1.241:8125`)

- **Config in the Store.** `config.py` (pure) is the whole user config. `store.py` keeps it in
  `.storage/alfie.config`, seeded on the first load from the starter defaults plus M1's
  options-flow values. `engine.apply_config` runs a save live, with no reload and no reaction
  played.
- **Admin WS:**
  - `alfie/config/get|set|reset|preview`: preview evaluates an unsaved draft against the house
    now;
  - `alfie/suggest`.
- **Personality:**
  - six sliders, with five presets in `alfie-face.json` `personalities`; bubbly is the
    identity;
  - the card applies exaggeration, speed, bounce and blink_rate;
  - the engine applies energy_bias and fidget_rate;
  - see them with `./dev face sheet=personality`.
- **Screens:** every type, the providers, 13 transitions, rotations and both presenting styles
  work live on **Alfie dev → Screens**. Each screen has a card on its own one-step `only_<id>`
  rotation.
- `./dev test` is green: 161 pytest tests, plus the node checks (face maths, stage, screens,
  panel forms, panel ui, look, editor).

Known gaps:
- the font has no accented letters;
- neon looks poor on HA's light theme (the "theme" style follows it);
- once glow is set in the card editor, it can't be put back to the default except in YAML.

Ways of working:
- **No subagents** (Lukas, 2026-10-19: they use up usage too fast). Do the work inline.
- Interfaces are written down first (`docs/screens-contract.md`, `docs/settings-contract.md`).

Dev data:
- dev HA's home is set to London (Europe/London);
- `weather.dev_weather` is a template entity with hourly and daily forecasts;
- `calendar.birthdays` is a local calendar (add events for HA's today);
- `device_tracker.dev_phone` and `sensor.dev_inside` / `sensor.dev_outside` are fake states.
  They vanish on restart; re-run the posts in `devenv/out/` scripts or `./dev state`.

## Gotchas

- **Panel:**
  - It compares configs ignoring key order, and `validate()` emits the defaults' key order.
    Keep both, or a reset section looks unsaved.
  - A section module must not import `alfie-panel.js` (the shell awaits the sections, so that
    would be a cycle). Shared things go in `panel/ui.js`.
  - It can be created before its class is defined (its module awaits the card), so `hass`
    lands as an own property. The constructor re-applies it through the setter. Keep that.
  - Its mini faces use `alfie-card.renderStill`, and its live faces use `playLocal` /
    `setPersonality` (card-only methods; the action would play on every display).
- **The map screen** never touches the network unless its `allow_network` option is on: it's
  Lukas's privacy rule. Only a position rounded to about 100 m is sent, and cells are cached on
  disk.
- **The card's `_draw`** returns early on a canvas with no size. Resizing from `_draw` must not
  redraw, or it recurses.
- **A saved config that no longer validates** is logged and run on the defaults, without being
  overwritten.
- **Dev tooling:**
  - `shot.js` falls back to shooting after 30 s on pages that never go network-idle (many live
    cards).
  - `./dev js FILE.js [ms]` runs a script in a logged-in dev HA page and prints its
    console.log. HA's frontend reloads a headless page about 10 s in, so keep in-page scripts
    short. Load the URL (with its hash) directly rather than using `pushState`.
  - The dev directory is `devenv/`, not `dev/`, because `./dev` is the wrapper.
  - Fake entities from `./dev seed`/`state` vanish on restart, so re-seed after
    `./dev restart`.
  - `./dev dashboard` rewrites the Alfie dev dashboard, and `./dev house` loads Lukas's
    config.
  - node in the Chrome image is v20 and needs `--experimental-detect-module`; `./dev test`
    passes it.
- **Animations never write entity state;** listen for the `alfie_animation` event.
