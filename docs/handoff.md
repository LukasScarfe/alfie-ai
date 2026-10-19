# Alfie: handoff

**Milestones 1 to 3 are done.**
- **M4 (Triggers and stories):** approved by Lukas from the screenshots. Its tablet check F is
  still open.
- **M5 (House modes):** built and checked in dev HA. Its tablet check F is still open.
- **5½ (Settings tidy-up):** built and checked in dev HA, with the PNGs sent to Lukas (A to E).
  F is waiting on his review.

Version 0.6.0.

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
1. Lukas's review of the PNGs (5½ F), and fixes from it.
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
