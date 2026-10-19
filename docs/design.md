# Alfie: design

Agreed with Lukas in a planning interview on 2026-10-18. This is the source of truth for *what* to
build. Edit it in place as decisions are made.

## Why

Today the "Superintendent" face is one screen among many on Lukas's living-room oscilloscope, and
the home's "soul" logic is scattered across HA template sensors and automations. Alfie makes that
character a first-class, public Home Assistant app. He is always around, reacts to the house, and
looks good as a card on a wall tablet. A rewritten scope container may later become just another
display, but that is **not** designed in now (card first).

**Guiding principle: lots of options.** Wherever a reasonable choice exists, the user chooses. Ship
good defaults, not fixed behaviour.

## Architecture (decided)

- **One HACS integration**, `custom_components/alfie`, in **one public repo**
  (`LukasScarfe/alfie-ai`). **No add-on**: an integration works on every HA install type, can talk
  to HA's voice agents, and reaches the card over HA's own connection. It contains:
  - **Engine** (Python, inside HA): signals, mood, house modes, triggers, stories, rotation and
    voice hooks. It must never block HA's event loop.
  - **Sidebar editor panel**, admin only, for all configuration. Config is persisted with HA's
    `Store`.
  - **Bundled Lovelace card**, auto-registered (no manual resource), doing **browser-side
    rendering**. The integration pushes low-rate *scene state* (mood, expression, gaze, active
    story step, screen + its data) over a custom WebSocket subscription on the user's normal HA
    connection, so it works for non-admin users such as the wall tablet, on LAN and through the
    tunnel. The card animates the face and draws the screens locally at full frame rate.
  - **Real HA entities and services**, for example `sensor.alfie_mood` (with the active signals as
    attributes), `select.alfie_mode`, and the services `alfie.play_story`, `alfie.show_screen` and
    `alfie.set_expression`, so HA automations can drive and observe him.
- **Pattern to copy:** `~/Documents/ha-sun-beams` (Lukas's own repo: an integration with a bundled
  card, a sidebar panel, a WS API and a throwaway dev HA container on raccoon:8124). The card and
  panel are vanilla JS with no build step, unless there's a strong case for one.
- **One Alfie, many displays.** There is one soul and one mood. Each card picks its own size,
  colours, render style and display mode.
- The name is **"Alfie" by default and renamable**. The name flows into the panel, the persona and
  the voice context.

## The character

- **Face only, never a body.** It keeps the Superintendent look: a circle face ring and two circle
  eyes, each a **separate malleable shape** (size, eccentricity, position, rotation, lids/closure).
- Editors, all in scope:
  1. **Shape sliders** with a live preview.
  2. **Expression editor**: pose the shapes into named expressions. Presets are the 12 current
     moods: neutral, angry, sad, bored, skeptical, happy, surprised, alarmed, suspicious, sleepy,
     confused, closed.
  3. **Animation editor**: keyframe timelines with easing. The built-ins are the 20 current
     animations: wink_left/right, look_around, glance_left/right, nod, shake, eye_roll, startle,
     double_take, laugh, sigh, squint, flinch, scan, processing, glitch, dizzy, nod_off, wake_up.
  4. **Personality presets** (bubbly, stoic, grumpy…) that scale exaggeration, speed and bounce.
- **Very lively.** He is over-exaggerated and bubbly when nothing is wrong, and gets more sluggish
  and sadder as things get worse. Mood drives both the baseline expression and the energy of all
  motion.

## Signals and mood

- **Good and bad signals**, picked in the panel. Each one is an entity, an operator (**above /
  below / is**, plus is-not), and a value that may be a number, on/off or free text, so any entity
  type works. Examples: a motion-sensor battery below 15 is bad, CO2 above 1200 is bad, guest mode
  on is good.
- Each signal can link to the **screen that explains it** (plant moisture links to the plant plot).
- **How signals combine is a user option:**
  - weighted severities (minor/major/critical, with weights on good signals too);
  - simple count (each good cancels a bad);
  - worst-one-wins (a priority ladder).

  The result sets the mood level: bubbly, content, uneasy, sad, miserable.
- **Lukas's house as the reference default**, reproducing his current ladder:
  - alert: NAS drive health (`binary_sensor.scarfe_218j_*`);
  - attention: plant moisture below 25% (`sensor.fineoffset_wh51_0ee63f*` is the Monstera,
    `…0ee64d*` is the Ficus) and motion-sensor `*_battery_low`;
  - guests (`input_boolean.guest_mode`) as a good signal.

  His preferences: no "happy just because people are home", no bored look, happy when guests are
  over.

## Display modes (per card)

1. **Companion**: Alfie is always on screen and just reacts.
2. **Rotation**: passive screens cycle on timers. When something happens, Alfie takes over the
   screen with an animation, plays his reaction, then goes away and the cycle resumes.

## Triggers and stories

- **Triggers are fully user-chosen**:
  - any entity change;
  - specific motion sensors, each with its own action (look in a direction, appear, play a story);
  - voice activity;
  - **mood changes**;
  - signals going bad or recovering.

  Lukas will use motion plus house events.
- A **story** is what Alfie does when a trigger fires. The panel offers both:
  - a **fill-in template**: react (expression and/or animation), then show a screen for N s, then
    return with a closing gesture, then resume;
  - an **advanced free sequence builder**: an ordered list of steps (expression, animation, screen,
    wait, move, resize, speak).
- **Mood-change story (default):** Alfie comes up, visibly morphs from the old mood to the new one,
  shows the screen explaining why (if there is one), then leaves.
- **Bad news (default):** every time he appears while sad, he shows the screens for what's wrong,
  **one after another if several things are wrong**, then shakes his head and returns to the
  rotation.
- **Celebrate the fix (default on):** when a bad signal clears, a happy story plays (nod, bounce).
- Per-signal repeat options exist but are off by default: replay on walk-in, every N hours, or add
  the screen to the rotation.

## House modes

- **Night/asleep:** he sleeps, and only critical signals wake him. The user picks the entity; for
  Lukas it's `switch.global_sleep_switches`.
- **Away:** he idles or blanks, then wakes up and greets on arrival.
- **Guests:** extra bubbly, or a "company manners" setting that holds back non-critical bad news.
- **User-defined modes:** each is a condition plus overrides for mood, liveliness, rotation and
  active triggers.

## Screens

Screens are **templates filled by picking entities**, ported from xy-bench (Python, to JS for the
card):

- **Plot:** multiple series with customisable ranges and span, for example temperature in and out
  over N days (HA history).
- **Bars and single value:** plant moisture; a big readout with an icon.
- **Weather:** forecast curves, rain bars and a condition icon from any `weather.*`. **Home clock:**
  in and out temperatures with a day/night rim.
- **Sky** (sun, moon, planets) and **stars** (constellations), from HA's home location.
- **Map:** streets around chosen device trackers (fetched from Overpass and cached).
- **Text/names:** calendar-driven, such as birthdays.
- **Transitions** between screens come from xy-bench's intros (draw, zoom, slide, condense,
  morph…), as options.
- **Presenting:** Alfie presents a screen beside it, growing and shrinking with context. **The
  choreography is still open; discuss it with Lukas before building it.**

## Voice

- **Works with whatever voice assistant the user already has.** Alfie watches **every
  `assist_satellite` entity** (Voice PE, ESPHome ESP32 builds, the voice-satellite card on a
  tablet). It never relies on named devices.
- He takes the face role and shows personality **only while a voice assistant is listening,
  thinking or speaking**.
- The integration exposes **what's wrong** to HA's voice agents (an LLM API/tool and an intent,
  plus readable entity state), so "is anything wrong?" gets a real answer from any agent.
- Optional deeper control: a persona prompt in his name, mood-aware replies, and unprompted TTS
  announcements on chosen speakers as a story step.
- Lukas's setup today: the Android Companion app's native pipeline exposes **no** satellite states.
  The current face uses a hack that triggers on `conversation.*` entity state timestamps at reply
  time. His tablet will move to the voice-satellite card to become a real `assist_satellite`. His
  pipeline is Whisper and Piper (local) plus a Gemini brain with a SearXNG search tool; see
  `~/Documents/superintendent-plan.md`.

## Card

- Render styles: **flat vector, neon glow, CRT phosphor, follow HA theme**, and more. Lots of
  options. Colours are per role: face, eyes, plot lines, text, accents, background.
- Tap: a **why panel** (current mood, active signals, why he's showing what he's showing), plus
  standard HA tap, hold and double-tap action config.
- Gotchas from an earlier custom card (xy-scope-card):
  - Define the element after `customElements.whenDefined("home-assistant")`, because HA installs a
    scoped-registry polyfill.
  - Bump the `?v=` query on every release (31-day cache).
  - It worked in browsers but showed "Configuration error" only in the Android Companion app, and
    the cause was never found. **Test on the tablet early.**

## Non-goals (for now)

Talking to the oscilloscope box or rewriting its container; a body; replacing the voice pipeline
itself; an add-on.

## Scene state: engine to card (decided)

The engine says **what Alfie is and what he should do**. The card works out **how it looks
frame by frame**.

- **Transport:** the WS command `alfie/subscribe`, open to non-admin users. It sends the full
  scene state once, then the full state again on every change. The state is a few hundred bytes,
  so there are no diffs.
- **The state** (`v` is the format version and `seq` is a counter that only goes up):

  ```json
  {"v": 1, "seq": 42, "name": "Alfie",
   "mood": {"level": "uneasy", "score": -1.0, "expression": "skeptical", "energy": 0.55},
   "expression": "skeptical",
   "gaze": {"x": -0.16, "y": 0.0, "until": 1760000000.0},
   "animation": {"name": "glance_left", "id": 17, "at": 1760000000.0},
   "mode": "normal",
   "signals": [{"id": "plant_monstera", "label": "Monstera is dry", "kind": "bad",
                "severity": "major", "entity_id": "sensor.…", "screen": null}],
   "reason": "Monstera is dry",
   "story": null, "screen": null}
  ```

  `expression` is what he wears now. It is usually the mood's baseline, but a service or story
  can override it. `gaze` is null when he looks ahead. Times are epoch seconds from the server.
  The card ignores an `animation` whose `at` is more than a few seconds old (so a reconnect
  doesn't replay it) or whose `id` it has already played.
- **The card computes:** the spring blend between expressions, blinks, breathing and idle
  bounce, animation keyframes, and **energy** scaling of speed, amplitude and overshoot. Energy
  is 1 for bubbly and about 0.2 for miserable, so sad Alfie is slow and small. Idle fidgets are
  chosen **by the engine** (so every display does the same fidget) and sent as animations.
- **Face data** lives in one file, `custom_components/alfie/frontend/alfie-face.json`. It holds
  the geometry constants, the 12 expressions as lid lines, and the 20 animations as keyframes
  (`eye_roll`, `glitch` and `dizzy` are named procedural generators in the card). The card loads
  it and the Python tests check it. M7's editors save user overrides in the `Store`, and the
  engine merges them into the scene, so this file is only the defaults.
- **Face model**, ported from xy-bench `superintendent_face`, in ring radii (the ring is radius
  1, y points up). The eyes sit at x = ±0.42 with radius 0.25 × size. Each eye is a disc cut by
  two straight lid lines `y = h + s·u`, in eye radii, where u points toward the nose. A pose is
  `(left lids hu su hl sl, right lids, size, look x, look y)`. Animation channels are shut,
  shut_l/r, open, droop, size, dx/dy, lx/ly/rx/ry and fx/fy, all 0 at rest.

## Defaults ported from Lukas's house (M1 hard-codes these; M2 makes them editable)

From production `configuration.yaml` (`sensor.superintendent_mood`) and the `Superintendent:`
automations, as of 2026-10-18:

- **Ladder** (worst wins, top first):
  - **critical**: any NAS drive problem, i.e. one of
    `binary_sensor.scarfe_218j_drive_{1,2}_exceeded_max_bad_sectors`,
    `…_drive_{1,2}_below_min_remaining_life` or `binary_sensor.scarfe_218j_security_status`
    is on. The old face showed `alarmed`.
  - **major**: Monstera `sensor.fineoffset_wh51_0ee63f_moisture` or Ficus
    `sensor.fineoffset_wh51_0ee64d_moisture` below 25 %, or one of
    `binary_sensor.{bathroom,hallway,hallway_closet}_motion_sensor_battery_low` is on. The old
    face showed `skeptical`.
  - **rest**: `switch.global_sleep_switches` on means `closed`. This becomes the Night house mode
    in M5; M1 treats it as an expression override.
  - **good**: `input_boolean.guest_mode` on means `happy`.
  - Otherwise `neutral`. The old face never used "happy because people are home" and never bored.
- **Mood levels to expressions** (default): bubbly → happy, content → neutral, uneasy →
  skeptical, sad → sad, miserable → alarmed. The default combine mode is **worst-one-wins**, so
  Lukas's ladder reproduces exactly: critical → miserable, major → uneasy, guests → bubbly.
- **Motion gaze map:**
  - `binary_sensor.living_room_motion_sensor_occupancy` means he notices you: a random
    glance_left, glance_right, look_around or double_take;
  - the hallway, hallway closet, bathroom and `bedroom_light` `…_motion_sensor_occupancy`
    sensors mean glance_left;
  - `binary_sensor.dining_room_presence_motion_sensor_presence` means glance_right.

  A 20 s debounce turns a run of motion across rooms into one glance.
- **Idle fidget:** one random animation every 3 min (squint, eye_roll, scan, glance_left,
  glance_right, sigh or look_around). Alfie scales the interval with energy.
- **Mood flips to critical:** a startle. **Voice reply:** processing, then a nod after 2 s
  (moves to M6).

## Open questions

1. Presenting choreography (see Screens).
2. How Alfie shows "speaking" without a mouth (ring pulse? eye rhythm?).
3. Default screen rotation and timings.

## Reference: Lukas's environment

- **Production HA:** HA OS at `192.168.1.217:8123` (always use the IP; `homeassistant.local` doesn't
  resolve from raccoon), Core 2026.10.x, a multi-person household, so treat it as production. Its
  config is SMB-mounted read-write at `/mnt/homeassistant`. A long-lived token is `HA_TOKEN` in
  `/mnt/homeassistant/.env`: load it inside a script and **never print it** (cat/grep of `.env` is
  blocked). Full access guide: `/home/lukas/claude/docs/homeassistant.md`.
- **Wall tablet:** Galaxy Tab S7+, dashboard `tablet-dash`, signed in as the non-admin
  `tablet-livingroom` user over LAN `http://192.168.1.217:8123`, Companion app.
- **xy-bench source** (the face, screens and intros to port): `ssh lukas@192.168.1.112`, at
  `~/xy-bench`. Read only; it's a live system. Start with its `CLAUDE.md`. Key files:
  `xy/figures.py` (the superintendent face, moods, animations, all screens), `xy/views.py`,
  `xy/font.py`, `xy/sky.py`, `xy/streets.py`, `xy/intros.py`, `xy/geometry.py`. `scopepreview.py`
  renders any screen to PNG. A separate `xy-scope` Claude session may be able to answer questions.
- **Current HA soul logic** (to port as defaults, not to edit): `sensor.superintendent_mood` and
  `sensor.scope_scheduled_screen` in `configuration.yaml`; the automations `Superintendent: Sync
  Mood / Motion Glance / Idle Fidget / Alert Surface` and `superintendent_assist_face` in
  `automations.yaml`. Motion gaze map today: living-room motion means a glance at the viewer;
  hallway, closet, bathroom and bedroom mean look left; dining means look right.
