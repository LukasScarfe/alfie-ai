# Alfie: handoff

**Milestones 1 and 2 are done; M3 (Screens) is claimed.** Version 0.2.0.
(2026-10-18)

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
- `./dev test` is green: pytest, including `tests/test_config.py`, plus 937 face-maths checks.

## Next

**M3, Screens.** The steps are in plan.md, and the full approved plan is summarised there.
Presenting and rotation are decided (design.md "Screens"):
- presenting is **hand over** (he leaves with a transition) or **corner** (he shrinks into a
  corner and stays alive), an option per card;
- screens and named rotations are built in the panel, and a card picks a rotation or lists its
  own;
- the map is opt-in, sends only rounded cells to Overpass, and its endpoint is configurable.

The port inventory with file:line, sizes and order is `docs/m3-screens.md`. Phase A (the
foundation) comes first. Then B1 to B6 (one agent per screen family, disjoint files) run in
parallel, then C (the panel Screens tab).

Ways of working:
- Lukas likes Sonnet subagents in parallel.
- Only the lead agent restarts dev HA.
- **Don't enter plan mode while subagents run**: it stops them.

## Gotchas

- The panel compares configs ignoring key order, and `validate()` emits the defaults' key order.
  Keep both, or a reset section looks unsaved.
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
