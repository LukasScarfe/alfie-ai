# Alfie: handoff

**Milestone 1 is nearly done.** One step remains: Lukas trying the card on the real tablet.
(2026-10-18)

## Working, in dev HA (`./dev up`, then `http://192.168.1.241:8125`, dashboard **Alfie dev**)

- **Integration.** The `alfie` integration loads cleanly and `custom:alfie-card` registers itself.
- **Card.** All 12 expressions and 20 animations, ported from xy-bench (`tests/face.test.mjs`
  checks 831 numbers against xy-bench's own output). Blinks, breathing and energy run per frame.
  It has styles neon, flat, crt and theme, and these options: colours, `line_width`, `glow`,
  `eye_fill`, `padding`, `aspect`, `fps` (default 30), `liveliness`, `breathing`, `blinking`
  and `card`. It pauses while hidden or off screen.
- **Engine.** Lukas's ladder is hard coded in `defaults.py`. Choose the combine mode
  (worst/weighted/count), the idle interval, the motion debounce and celebrate-the-fix in the
  integration's options.
  - Behaviour: motion glances, idle fidgets, a startle on critical, a nod when a fix lands, and
    sleep via `switch.global_sleep_switches` (only critical wakes him).
  - Entities: `sensor.alfie_mood` (state is the level, attributes give the why) and
    `select.alfie_mode` (auto/normal/night/away/guests; only night does anything yet).
  - Services: `alfie.set_expression` (with a `duration`) and `alfie.play_animation`.
  - Event: `alfie_animation`.
- **Resource budget** (Lukas's request, now a hard rule in CLAUDE.md and design.md): it's
  event driven, and animations never write entity state or recorder rows.

## Next

1. Lukas opens dev HA `http://192.168.1.241:8125` on the Galaxy Tab in the Companion app (add it
   as a server, or use the browser), logs in as `dev`/`devpass1234` and opens **Alfie dev**. This
   checks the old "Configuration error only in the Companion app" problem. If it's fine, tick M1.
   Installing on production `tablet-dash` needs his OK.
2. Then milestone 2: the panel, signals in the `Store` seeded from `defaults.py`, and
   personality presets.

## Gotchas

- The dev directory is `devenv/`, not `dev/`, because `./dev` is the wrapper.
- Fake entities from `./dev seed`/`state` vanish on restart. Re-seed after `./dev restart`.
- `./dev dashboard` rewrites the Alfie dev dashboard.
- node in the Chrome image is v20 and needs `--experimental-detect-module`; `./dev test`
  passes it.
- `alfie-face.js` is loaded by the card with the same `?v=`, through a top-level `await import`.
- The sensor's attributes don't show the last animation, on purpose: animations don't write
  state. Listen for the `alfie_animation` event instead.
