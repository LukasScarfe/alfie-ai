# Alfie: handoff

**Milestone 2 is nearly done; M1 is done** (Lukas approved the card). Version 0.2.0.
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

1. **Finish M2.** The panel's own QA pass (every tab and interaction, save persisting across
   `./dev restart`, the error display) was running when this was written. If the step "Admin
   sidebar panel" in plan.md is still `[ ]`:
   - redo the QA with `./dev shot alfie … --eval` and `./dev js`;
   - send Lukas the four tab screenshots;
   - tick M2.
2. **M3, Screens.** Presenting and rotation are decided (design.md "Screens"):
   - presenting is **hand over** (he leaves with a transition) or **corner** (he shrinks into a
     corner and stays alive), an option per card;
   - rotation is user-built, with no default.

   The port inventory with file:line, sizes and a suggested order is `docs/m3-screens.md`. Plan
   M3 in plan mode with Lukas's OK. Lukas likes the work split across parallel Sonnet subagents,
   each owning disjoint files.

## Gotchas

- The panel can be created before its class is defined (its module awaits the card), so `hass`
  lands as an own property. The constructor re-applies it through the setter. Keep that.
- The panel's mini faces use `alfie-card.renderStill`, and the live face uses `playLocal` /
  `setPersonality` (card-only methods; the service would play on every display).
- A saved config that no longer validates is logged and run on the defaults, without being
  overwritten.
- `./dev js FILE.js [ms]` runs a script in a logged-in dev HA page and prints its console.log.
- The dev directory is `devenv/`, not `dev/`, because `./dev` is the wrapper.
- Fake entities from `./dev seed`/`state` vanish on restart. Re-seed after `./dev restart`.
- `./dev dashboard` rewrites the Alfie dev dashboard.
- node in the Chrome image is v20 and needs `--experimental-detect-module`; `./dev test`
  passes it.
- Animations never write entity state; listen for the `alfie_animation` event.
