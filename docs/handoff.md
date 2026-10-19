# Alfie: handoff

**Milestones 1 to 3 are done (M3 approved on the tablet 2026-10-19). M4 (Triggers and stories)
is built and verified in dev HA, including G (Lukas's rotation review); only F, the tablet check
with Lukas, is left.** Version 0.4.0.

## M4 status (2026-10-19)

- **A to E and G are done.**
  - `stories.py` and `triggers.py` are the pure models. Config is v2: the old behaviour
    reactions became the default triggers and stories via `migrate_v1`.
  - The engine runs stories (priority, queue, coalescing) and offers `play_story`,
    `stop_story`, the `alfie_story` events, and WS `alfie/story/play`, `alfie/story/expand` and
    `alfie/triggers/status`.
  - The card follows `scene.story`. The panel has the Triggers and Stories tabs.
  - design.md "Triggers and stories" and "Screens → Rotation" describe it as built.
- **G, from Lukas's review:**
  - In a rotation, screens follow screens with Alfie kept away or in his corner (`swap` and
    `held` on the card's `_cur`).
  - He comes on only for an Alfie step (`{alfie: true, seconds}`) or a `face_seconds` gap. That
    is now optional and defaults to 0; dev's `demo` rotation was set to 0 with one Alfie step.
  - When he appears he plays the most relevant story on that card only: `alfie-stage.js`
    `advance` returns `appear`, the card fetches `alfie/story/expand`, and `runStory` drives a
    local overlay.
  - Mood-led: behaviour `appear_story_bad` (bad_news) while something is wrong, otherwise
    `appear_story_ok` (the new Hello story). The card option `appear_story` (auto, none, or a
    story id) replaces `bad_news` / `bad_seconds`; an old `bad_news: false` maps to none.
  - Configs from before G get Hello and the two keys once (`config._add_appear`).
  - Trigger stories still play on every display and beat a card's own; in corner mode Alfie
    comes out and goes back.
- **Dev checks** (dev dashboard view **Alfie dev → Rotation**, two `g_test` cards, hand-over
  and corner; `g_test` is 3 s steps, Alfie first):
  - `devenv/out/m4g-trace.js` logs both cards every 250 ms;
  - `m4g-freeze.js` / `m4g-freeze2.js` freeze the cards on a `window.WHEN(card)` condition, for
    a frame;
  - frames are in `devenv/out/m4g/`, and were sent to Lukas with the panel shots
    `m4g-panel-rotation.png` and `m4g-panel-behaviour.png`.
  - HA reloads a headless page about 10 s in, so keep what you shoot well before that.
- The panel's M4 click-through is `devenv/out/m4-click.js`. Run it in parts
  (`window.PART='A'|'B'|'C'`, plus `window.FAST=1`):
  `SHOT_VERBOSE=1 ./dev shot alfie out.png --size 1200x1500 --wait 6000 --eval "window.PART='B'; window.FAST=1; $(cat devenv/out/m4-click.js)"`.
  Part C saves a test story; `./dev js devenv/out/m4-reset.js` puts triggers and stories back.
- **Next: F.** Lukas checks M4 on the real tablet against dev HA, rotations included. Then claim
  M5 (house modes), planned in plan mode with Lukas's OK first.
- Gotchas:
  - Timers passed to `async_call_later` must be `@callback` (or `callback(lambda ...)`), or they
    run in an executor thread and HA raises.
  - A story whose `@why` / `@wrong` resolve to no screens skips those steps (by design).
  - An `alfie-panel` "already been used" error from Lukas's browser came from a panel module it
    loaded before `customElements.define` was guarded. It should stop after a reload.

## Working, in dev HA (`./dev up`, then `http://192.168.1.241:8125`)

- **Config in the Store.** `config.py` (pure) is the whole user config: signals, mood, behaviour
  and personality. `store.py` keeps it in `.storage/alfie.config`. On the first load it is seeded
  from `defaults.py` (Lukas's house) plus M1's options-flow values. `engine.apply_config` runs a
  save live, with no reload and no reaction played. The options flow now only points to the panel.
- **Admin WS:** `alfie/config/get|set|reset|preview`. Preview evaluates an unsaved draft against
  the house now.
- **Panel:** an admin sidebar panel, **Alfie** (`frontend/alfie-panel.js`), with four tabs:
  - **Signals:** live active/ok badges and matched entities;
  - **Mood:** combine mode and its knobs, plus each level's expression and energy, with a mini
    face;
  - **Behaviour:** sleep, the motion map, the notice and fidget sets, the reactions;
  - **Personality:** presets and sliders, with a live face and local-only play buttons.

  Save / Revert / Reset per section. Entity inputs are a datalist of entity ids, not HA pickers.
- **Personality:** six sliders with five presets in `alfie-face.json` `personalities`.
  - bubbly is the identity.
  - The card applies exaggeration, speed, bounce and blink_rate.
  - The engine applies energy_bias, inside the scene's `mood.energy`, and fidget_rate.
  - The card option `personality` overrides them per card.
  - See it with `./dev face sheet=personality`.
- **True rounded corners** (pulled forward from M7): roundness is a real fillet and rounded
  outlines are sampled by arc length. The card strokes smooth curves but keeps corners over 25°
  sharp. Compare `devenv/out/corner-before.png` with `corner-after.png`.
- `./dev test` is green: 144 pytest tests, plus the node checks (face maths, stage, screens, panel forms).

## Screens (M3)

- Every screen type, the providers, 13 transitions, rotations and both presenting styles work
  live on the **Alfie dev → Screens** view, with one card per screen held on its own one-step
  `only_<id>` rotation.
- The card has a visual editor.
- The panel has the Screens, Look and Playground tabs, and the global `look` reaches every
  card (a card's own options win).

Known gaps:
- the font has no accented letters;
- neon looks poor on HA's light theme (the "theme" style follows it);
- once glow is set in the card editor, it can't be put back to "inherit" except in YAML.

Ways of working:
- Lukas likes Sonnet subagents in parallel, each owning disjoint files.
- Interfaces are written down first (`docs/screens-contract.md`).
- Only the lead agent restarts dev HA and commits.
- **Don't enter plan mode while subagents run**: it stops them.

Dev data:
- dev HA's home is set to London (Europe/London);
- `weather.dev_weather` is a template entity with hourly and daily forecasts;
- `calendar.birthdays` is a local calendar (add events for HA's today);
- `device_tracker.dev_phone` and `sensor.dev_inside` / `sensor.dev_outside` are fake states.
  They vanish on restart; re-run the posts in `devenv/out/` scripts or `./dev state`.

## Gotchas

- The panel compares configs ignoring key order, and `validate()` emits the defaults' key order.
  Keep both, or a reset section looks unsaved.
- The map screen never touches the network unless its `allow_network` option is on: it's
  Lukas's privacy rule. Only a position rounded to about 100 m is sent, and cells are cached on
  disk.
- `shot.js` falls back to shooting after 30 s on pages that never go network-idle (many live
  cards).
- The card's `_draw` returns early on a canvas with no size. Resizing from `_draw` must not
  redraw, or it recurses.
- The panel can be created before its class is defined (its module awaits the card), so `hass`
  lands as an own property. The constructor re-applies it through the setter. Keep that.
- The panel's mini faces use `alfie-card.renderStill`, and the live face uses `playLocal` /
  `setPersonality` (card-only methods; the service would play on every display).
- A saved config that no longer validates is logged and run on the defaults, without being
  overwritten.
- `./dev js FILE.js [ms]` runs a script in a logged-in dev HA page and prints its console.log.
  HA's frontend reloads a headless page about 10 s in, so a longer in-page trace gets cut
  ("Execution context was destroyed"). That's the harness, not Alfie. Load the dashboard URL
  directly with shot.js rather than using `pushState`.
- The dev directory is `devenv/`, not `dev/`, because `./dev` is the wrapper.
- Fake entities from `./dev seed`/`state` vanish on restart. Re-seed after `./dev restart`.
- `./dev dashboard` rewrites the Alfie dev dashboard.
- node in the Chrome image is v20 and needs `--experimental-detect-module`; `./dev test`
  passes it.
- Animations never write entity state; listen for the `alfie_animation` event.
