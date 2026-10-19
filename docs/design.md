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
    `Store` (key `alfie.config`: signals, mood, behaviour, personality). A save is validated and
    applies **live**, with no reload. See "Panel".
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

## Resource budget (decided)

Alfie must run comfortably on a Raspberry Pi HA install. The engine:

- is event driven: one filtered `state_changed` listener, plus one timer for idle fidgets. It
  never polls.
- resolves wildcard signal patterns once at start, and again only when a new entity appears. A
  state change costs a dict lookup, and a recompute evaluates only the watched entities.
- writes entity state only when the mood level, expression, sleep, mode or active signals
  change. Animations go to the cards over WS and never touch the recorder. Bulky attributes
  (`signals`, `energy`, `score`, last animation) are unrecorded.
- sends a scene of a few hundred bytes per change. All animation runs in the browser.
- caches every network fetch for screens (M3), and does any heavy work, such as history or
  geometry, in an executor at low rate.

The card caps its frame rate (option `fps`, default 30), pauses while the tab is hidden or the
card is off screen, and sizes its canvas to the device pixel ratio once per resize.

## The character

- **Face only, never a body.** By default it keeps the Superintendent look: a circle face ring and
  two circle eyes. The head and each eye are **separate malleable shapes** (size, eccentricity,
  position, rotation, lids/closure).
- **Shapes are swappable data (decided).** The head and the eyes can be any shape, not only
  circles. A shape is a spec, which `outline()` in `alfie-face.js` turns into an outline:
  - `circle`
  - `polygon {sides, roundness}`
  - `star {points, inner, roundness}`
  - `superellipse {n}`, a squircle
  - `path {points}`, anything custom
  - and on any of them `rotation` (degrees) and `stretch [sx, sy]`.

  How shapes behave:
  - Built-in shapes are sampled as a radius per angle, at the same 120 angles, and normalised to
    the box [-1, 1]². So lids, gaze and every animation work unchanged on any shape, and any two
    shapes **morph** by a plain lerp.
  - The right eye mirrors the left, unless `right_eye` is given.
  - Shapes live in the `shapes` block of `alfie-face.json` (`head`, `eye`, `left_eye`,
    `right_eye`). They are part of the one Alfie: global, edited in the M7 panel and saved in
    the `Store`.
  - A card can override them with its `shapes:` option.
  - An expression may carry its own eye `shapes` (heart eyes for a "love" expression, say), and
    the spring blend morphs into them.
  - `roundness` (polygon, star, path) is a **true fillet**: each corner becomes a circular arc
    tangent to both edges, sized as a share of half the shorter edge, so 1 turns a regular
    polygon into a circle. A rounded shape is sampled evenly along its outline, not by angle,
    so corners get enough points. It keeps the same point count, with point 0 at angle 0.
  - The card strokes outlines as smooth curves through the points. A vertex that turns more
    than 25° (a lid cut, a sharp tip) stays a crisp corner.
- Editors, all in scope:
  1. **Shape sliders** with a live preview.
  2. **Expression editor**: pose the shapes into named expressions. Presets are the 12 current
     moods: neutral, angry, sad, bored, skeptical, happy, surprised, alarmed, suspicious, sleepy,
     confused, closed.
  3. **Animation editor**: keyframe timelines with easing. The built-ins are the 20 current
     animations: wink_left/right, look_around, glance_left/right, nod, shake, eye_roll, startle,
     double_take, laugh, sigh, squint, flinch, scan, processing, glitch, dizzy, nod_off, wake_up.
  4. **Personality presets**: decided, see "Personality (decided)" below.
- **Very lively.** He is over-exaggerated and bubbly when nothing is wrong, and gets more sluggish
  and sadder as things get worse. Mood drives both the baseline expression and the energy of all
  motion.

### Personality (decided)

A personality is six sliders plus a named preset. Alfie has one; a card may override it.

| Slider | Range | Does | Applied |
|---|---|---|---|
| `exaggeration` | 0.3 to 2 | size of expressions and animations | card |
| `speed` | 0.3 to 2.5 | animation and blend rate | card |
| `bounce` | 0 to 2 | spring overshoot | card |
| `blink_rate` | 0.2 to 3 | how often he blinks | card |
| `energy_bias` | -0.5 to 0.5 | added to the mood's energy | engine (scene `mood.energy`) |
| `fidget_rate` | 0 to 4 | idle fidgets per interval; 0 never | engine only |

- **Presets** live in the `personalities` block of `alfie-face.json`: `bubbly`, `stoic`, `grumpy`,
  `sleepy`, `nervous`. **Bubbly is the identity** (all 1, bias 0), so a fresh install moves as
  the M1 face did. Choosing a preset sets all six; `custom` keeps the sliders as given.
- Saved as `personality {preset, …sliders}` in the Store and sent in the scene (below). The card
  reads it with `personalityOf`, and `bounced` and `exaggerated` apply bounce and exaggeration.
- **Per-card override:** the card option `personality` is a preset name or a slider object, laid
  over Alfie's own for that card. The card swaps `energy_bias` for its own, so one tablet can be
  calmer. `fidget_rate` cannot be overridden, because fidgets are chosen by the engine.

## Signals and mood

- **Good and bad signals**, picked in the panel. Each one is one or more entities or patterns,
  an operator (**above / below / is**, plus is-not), and a value that may be a number, on/off or
  free text, so any entity type works. Each signal has an `enabled` switch, a **match any/all**
  (any one of its entities, or all of them) and an optional weight. In the panel a live preview
  shows which signals are active right now and which entities each pattern matches. Examples: a
  motion-sensor battery below 15 is bad, CO2 above 1200 is bad, guest mode on is good.
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

## Panel (decided)

- An **admin-only sidebar panel** (`alfie-panel.js`, vanilla JS). Non-admins never see it, and the
  `alfie/config/get|set|reset|preview` WS commands require admin. `alfie/subscribe` stays open to
  everyone. The integration's options flow only points to the panel.
- **Tabs:**
  - **Signals**: add, edit, remove and enable signals (entities, operator, value, kind, severity,
    weight, match any/all, screen).
  - **Mood**: combine mode, weights, thresholds, severity-to-level ladder, expression and energy
    per level.
  - **Behaviour**: sleep entity and expression, the motion gaze map, notice and idle fidgets,
    idle interval, motion debounce, celebrate, and the critical/recover/wake reactions.
  - **Personality**: preset and the six sliders.
  - **Screens** (M3): build screens from each type's schema, plus the named rotations.
  - **Look** (M3, decided): Alfie's global default look: style, colours, line width, glow, eye
    fill, padding, and the head and eye shapes (type plus parameter sliders). It's stored as a
    `look` section and sent to every card. Precedence is the card's own option, then the global
    look, then the style's default.
  - **Playground** (M3, decided): a big live face with a button per expression and animation, a
    mood-level picker, and energy and personality sliders. It plays on the panel only, with an
    optional "play on every display" that uses the services.
- **Card visual editor** (M3, decided): `custom:alfie-card` has a Lovelace visual editor for
  every option, grouped (look, display mode and rotation, presenting, personality, advanced), so
  no card needs YAML.
- **Live preview:** edits are sent to `alfie/config/preview`, which validates and evaluates the
  draft without saving or touching the running engine. It shows the resulting mood, the active
  signals and each pattern's matches.
- **Save / Revert / Reset per section.** Save validates the whole config and every problem is
  listed at once. Reset puts one section back to the defaults.
- **Entities are typed into a plain text input with a `<datalist>` of entity ids**, not HA's
  internal pickers, which change between frontend versions.
- **Storage:** first load seeds the Store from the defaults plus M1's options-flow values, once.
  A stored config that no longer validates is logged and run on the defaults, but not overwritten
  until the user saves.

## Display modes (per card)

1. **Companion**: Alfie is always on screen and just reacts.
2. **Rotation**: passive screens cycle on timers. When something happens, Alfie takes over the
   screen with an animation, plays his reaction, then goes away and the cycle resumes.

## Triggers and stories

Built in M4: `triggers.py` and `stories.py` (pure models), the engine's story runner, and the
panel's **Triggers** and **Stories** tabs. Motion gaze and idle fidgets stay in Behaviour; they
are not triggers.

- **Triggers are fully user-chosen** (config `triggers`, a list). Kinds:
  - `entity`: an entity or pattern changes at all, or starts passing a test (above, below, is,
    is not);
  - `motion`: chosen motion sensors turn on, optionally only while something is wrong (a walk-in
    reminder);
  - `mood`: the mood level gets worse, better or either, optionally from and to chosen levels;
  - `signal`: any or chosen signals go bad, recover, or either;
  - `wake`: Alfie wakes up or falls asleep.

  Voice activity becomes a kind in M6. Every trigger also has: the story it plays, a **priority**
  (0 to 100), **when busy** (`auto`: a higher priority interrupts, otherwise it queues; `queue`;
  `interrupt`; `skip`), a **cooldown**, **even while he sleeps**, and **only while the mood is**.
  Entity and motion triggers are fed by the engine's one filtered listener. The other kinds are
  checked in the mood recompute, which already knows what moved.
- **Coalescing:** when one change fires several triggers, only the highest priority plays. The
  others are noted as `outranked`. At most 3 stories queue behind the one playing, highest
  priority first, and a queued story older than 60 s is dropped.
- A **story** (config `stories`) is what every display does together when a trigger fires. The
  panel offers both forms, and **Convert to steps** turns a template into steps:
  - a **fill-in template**: react (an expression and/or an animation), show a screen for N s
    (presented and transitioned as chosen, or as the card is set), then a closing gesture;
  - **free steps**, in order: `expression` (hold and blend), `animation` (optionally waiting for
    it), `screen` (seconds, present, transition), `wait`, `move` (centre, a corner, or custom x/y,
    springing over N s), `resize` (0.3× to 1.5×), and `speak` (a placeholder until M6).
  - Tokens: `@mood` is the mood's face now and `@old_mood` the one before the change. `@why` shows
    the screens of the signals that caused the trigger, and `@wrong` those of everything bad, one
    after another. A token with no screens adds nothing.
- **Defaults** (seeded, and migrated from v1's reactions):
  - **Something turns critical → Alarm** (priority 90): startle, the `@wrong` screens, shake;
  - **Mood gets worse → Bad news** (50): old mood, morph to the new one, the `@wrong` screens,
    shake;
  - **Something bad is fixed → Celebrate the fix** (45): happy, nod, laugh;
  - **Mood gets better → Mood change** (40): morph, the `@why` screens, nod;
  - **Waking up → Wake up** (30).
  - **Hello**, played by no trigger: his mood's face and a nod, for appearing while all's well.
- **When Alfie appears in a rotation** (an Alfie step), he plays the most relevant story on that
  card: Bad news while something is wrong, Hello otherwise (behaviour `appear_story_bad` /
  `appear_story_ok`, a card's `appear_story` overrides). See "Screens → Rotation".
- **Per-signal repeats** (off by default): replay a story (default Bad news) on walk-in or every N
  hours while the signal is bad, at priority 20, queued. Or add the signal's screen to the
  rotation while it is bad (`in_rotation`).
- **Automations and the panel:** the `alfie.play_story` and `alfie.stop_story` services, and
  `alfie_story` events (`start`, `end`, `interrupted`). `alfie/story/play` plays an unsaved draft
  from the panel. `alfie/triggers/status` gives each trigger's last outcome (played, queued,
  skipped, cooling down, outranked) and what is playing now. The scene carries the playing
  `story` (id, step, expression, blend, place), which the card follows.

## House modes

- **Night/asleep:** he sleeps, and only critical signals wake him. The user picks the entity; for
  Lukas it's `switch.global_sleep_switches`.
- **Away:** he idles or blanks, then wakes up and greets on arrival.
- **Guests:** extra bubbly, or a "company manners" setting that holds back non-critical bad news.
- **User-defined modes:** each is a condition plus overrides for mood, liveliness, rotation and
  active triggers.

## Screens

Screens are **templates filled by picking entities**, ported from xy-bench (Python, to JS for the
card). How the pieces fit together (types, providers, the scene fields) is in
`docs/screens-contract.md`. Each type is a pair, `frontend/screens/<type>.json` (its option schema,
which the panel turns into a form) and `<type>.js` (a pure draw function returning strokes). The
built types:

- **plot**: 1 to 6 series over a span, bucketed server-side from the recorder (long-term
  statistics for spans over 10 days), with markers, dotted or solid lines, and auto, fixed or
  "reach" ranges.
- **value**: one big readout with an icon (auto by device class) and threshold colouring.
- **bars**: several entities as bars, e.g. soil moisture, with a highlight below a threshold.
- **weather**: the condition icon and temperature now, an hourly curve with rain bars, or daily
  columns, from `weather.get_forecasts`.
- **clock**: analogue or digital, a solar day/night rim from `sun.sun`, in and out temperatures,
  and a house with smoke.
- **sky** (a top-down disc with sun, moon, paths and rise/set times) and **stars** (stick-figure
  constellations, planets, the moon in phase). Both are computed in the browser from HA's home
  location with Schlyter's formulas (`alfie-sky.js`), golden-tested against xy. The
  constellation data is d3-celestial's (BSD, see `THIRD_PARTY.md`).
- **map**: streets around trackers, with markers and a house. **Privacy (decided): off unless the
  screen's `allow_network` option is on.** Only a position rounded to about 100 m goes to
  Overpass, each cell is cached on disk forever, and the endpoint is an option.
- **text**: word-wrapped, shrink-to-fit titles from calendars (e.g. birthdays, with a template),
  any entity, or fixed text.
- **label**: plain text, the reference type.

Data and cost:
- Server data (history, forecast, calendar, streets) comes from providers in `providers/`. They
  are lazy (fetched only when a card asks), cached with a TTL and a backoff, and run in executors
  where blocking.
- Everything else reads `hass.states` in the card. Slow work (ephemeris, layouts) is memoised
  per minute.

The vector font is xy's, dumped to `alfie-font.json` (`tools/font_dump.py`). It has no accented
letters: accents drop to the base letter, and letters it can't decompose (Ł) are dropped.

- **Transitions (decided):** 13 styles from xy's intros, used both ways (a screen arriving, and
  Alfie leaving in "hand over"): cut, fade, draw, stagger, zoom, power_on, slide, flip, wipe,
  tune, materialise, condense and morph. Morph turns the face itself into the screen, and
  `random` picks any but cut.
- **Presenting (decided):** two styles, a user option per card (and per story step later):
  - **Hand over:** Alfie leaves with a transition, the screen takes the whole card, then he
    comes back when it ends.
  - **Corner:** Alfie shrinks into a corner and stays there, still alive (blinks, glances,
    mood), while the screen fills the rest. The corner and his size there are options too.
- **Rotation (decided):** the user builds their own screens first, then picks which ones rotate,
  in what order and for how long each. Alfie ships no fixed default rotation; with no screens
  built, a rotation card is simply the face.
  - Named rotations are built in the panel (steps and transition), and a card picks one or
    lists its own steps.
  - **Screens follow screens.** Between two screens Alfie stays as he is: gone (hand over) or
    in his corner. The old screen leaves and the next arrives by the rotation's transition.
  - **Alfie comes on** only for an **Alfie step** (`{alfie: true, seconds}`, anywhere in the
    list), or between every pair of screens when the rotation's `face_seconds` is over 0 (off by
    default; older rotations keep theirs). He then plays **the most relevant story** on that card
    only, and the step lasts at least as long as the story:
    - the card option `appear_story` is `auto` by default, which is mood-led: behaviour's
      `appear_story_bad` (Bad news) while something is wrong, otherwise `appear_story_ok`
      (Hello: his mood's face and a nod);
    - it can also be `none` or a story id;
    - the card fetches the timed actions over `alfie/story/expand` and plays them itself.
  - **Coming back waits for the screen:** when Alfie takes the stage back, the screen leaves
    first and only then does he come in, out of his corner or by the transition (morph alone
    turns one into the other). A story he plays himself starts once he is back.
  - Otherwise he appears when a trigger plays a story, on every display. In corner mode he comes
    out to the centre for it, then goes back to the corner and the rotation carries on.
  - The timer runs in the card and pauses while it is hidden or off screen.
  - `alfie.show_screen` interrupts every card, then the rotation resumes.

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
   "personality": {"preset": "bubbly", "exaggeration": 1.0, "speed": 1.0, "bounce": 1.0,
                   "fidget_rate": 1.0, "energy_bias": 0.0, "blink_rate": 1.0},
   "story": null, "screen": null}
  ```

  `expression` is what he wears now. It is usually the mood's baseline, but a service or story
  can override it. `gaze` is null when he looks ahead. Times are epoch seconds from the server.
  `personality` is additive (`v` stays 1); a card that predates it uses the bubbly numbers.
  `mood.energy` already includes the energy bias. The card ignores an `animation` whose `at` is
  more than a few seconds old (so a reconnect doesn't replay it) or whose `id` it has already
  played.
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

## Defaults ported from Lukas's house (the Store's seed)

These live in `defaults.py` and **seed the Store** on first load, so a fresh install behaves like
Lukas's house. After that they are ordinary config, editable in the panel, and "Reset" returns a
section to them. From production `configuration.yaml` (`sensor.superintendent_mood`) and the
`Superintendent:` automations, as of 2026-10-18:

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
    in M5; for now it is the `sleep_entity` and `sleep_expression` behaviour settings.
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
- **Reactions are settings:** `on_critical` (default startle), `on_recover` (nod) and `on_wake`
  (wake_up) each name an animation, and `""` means none.

## Open questions

1. How Alfie shows "speaking" without a mouth (ring pulse? eye rhythm?).

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
