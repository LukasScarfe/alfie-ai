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
    `alfie.set_expression`, so HA automations can drive and observe him (see "Automations").
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
  1. **Shape editor** (Appearance → Look, built 2026-10-21):
     - Sliders for every type, with a live preview.
     - A **drawn** shape (`path`) has a point editor: drag a corner, press an edge to add one,
       double-click (or Remove) to take one out. Snap (0.05) and Symmetric (moves the mirror
       corner too) are options.
     - Switching a shape to Drawn starts from about 12 corners of what it was.
     - "From a picture or icon" takes the biggest closed outline of an uploaded picture or any
       HA icon, simplified to at most 64 corners.
     - A path is always walked along its edge (not by angle from the centre), so hollows such
       as a crescent's stay.
     - "Shape the left and right eyes apart" copies the eye into `left_eye` and a mirrored
       `right_eye`. Turning it off keeps the left as `eye`.
  2. **Expression editor** (Appearance → Expressions, built 2026-10-21). Pose the shapes into
     named expressions. Presets are the 12 current moods: neutral, angry, sad, bored, skeptical,
     happy, surprised, alarmed, suspicious, sleepy, confused, closed.
     - **Config:** the `expressions` section is a list of `{id, name, left, right, size, look,
       shapes?}`.
       - Lids are `[height, tilt, lower height, lower tilt]`, as in `alfie-face.json`.
       - An id that is a built-in's name changes that built-in ("Changed", with Back to built
         in). Any other id is a new one ("Yours").
       - Its names join every expression check: mood levels, stories, modes, voice and
         `alfie.set_expression`. The services' pickers take typed names.
     - **Editor:**
       - Sliders for each lid (with "Same for both eyes"), eye size, and look across and up.
       - An optional eye shape of its own, any type, or Drawn from an icon's outline. It beats
         the look's separate eyes, so heart eyes go on both.
       - A still of it, and the open one held on the dock.
       - Renaming an ID follows it everywhere it is used (`renameFaceRefs`).
     - **Cards:** the scene carries `face_rev`. On a change each card fetches `alfie/face` (open
       to every user) and lays it over the shipped face data. The panel previews the draft's on
       its own cards before saving.
  3. **Animation editor** (Appearance → Animations, built 2026-10-21). Keyframe timelines with
     easing. The built-ins are the 20 current animations: wink_left/right, look_around,
     glance_left/right, nod, shake, eye_roll, startle, double_take, laugh, sigh, squint, flinch,
     scan, processing, glitch, dizzy, nod_off, wake_up.
     - **Config:** the `animations` section is a list of `{id, name, keys}`. A key is
       `[seconds, {channel: value}, ease]`.
       - Channels are as in `alfie-face.js` `animated`: dx, dy, lx, ly, rx, ry, fx, fy (moves),
         size, and open, shut, shut_l, shut_r, droop (0 to 1).
       - Eases are ease, spring, cut and linear.
       - Built-ins are changed by id, as expressions are. The three drawn by code (eye_roll,
         glitch, dizzy) become keys, a sample every 0.1 s, when first changed or duplicated.
     - **Editor:**
       - A bar of the keys and Play (on the dock).
       - "Hold a moment", a scrub that freezes the dock at any time (`previewAnimationAt`).
       - Each key's length, easing and channel sliders, with "+ Move something…" to add a
         channel.
       - Keys can be added (a copy of the last), moved and removed. Setting a value holds the
         moment that key ends.
     - **Cards:** they get them with the expressions (`face_rev`, `alfie/face`).
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

- An **admin-only sidebar panel** (`alfie-panel.js` and its sections in `frontend/panel/`,
  vanilla JS). Non-admins never see it, and the `alfie/config/*` and `alfie/suggest` WS commands
  require admin. `alfie/subscribe` stays open to everyone. The integration's options flow only
  points to the panel.
- **Six sections, some with sub-tabs** (2026-10-19, replacing ten flat tabs). The section and
  sub-tab are in the URL hash (`#mood/signals`). How the modules fit is in
  [settings-contract.md](settings-contract.md).

  | Section | Sub-tabs |
  |---|---|
  | **Overview** | Alfie now (face, mood, house mode, story playing, the active signals), **Get started**, and export / import under More options |
  | **Mood** | **Signals**, and **Levels** (how signals combine, and each level's expression and energy) |
  | **Reactions** | **Triggers**, **Stories**, and **Motion & idle** (motion sensors, the notice set, debounce, fidgets) |
  | **House modes** | The ordered modes, the hand pick, and the sleeping expression |
  | **Screens** | **Screens**, and **Rotations** (plus which story Alfie plays when he appears in one) |
  | **Appearance** | **Look**, **Personality**, **Playground** |

- **Every list item looks the same:**
  - a header with its on switch, chips, name, a one-line summary, a live badge, and ▲ ▼ ▸;
  - when open, the Name and its **ID** right under it (Lukas, 2026-10-20: the ID is essential,
    automations use it), then labelled groups of the fields most people need;
  - a **More options** fold (weights, priority, cooldown, repeats, overrides…);
  - Duplicate and Delete at the bottom.

  A new or duplicated item's ID follows its name until it is edited by hand (every list:
  signals, triggers, stories, house modes, screens, rotations). A saved item's ID stays put
  when the name changes, so automations keep working. Renaming an ID follows it into
  everything that refers to it.
- **Get started** (on the Overview until hidden) walks a new install through five steps, each
  ticking itself where it can:
  1. what Alfie watches, with suggested signals;
  2. motion sensors, suggested;
  3. what makes it night, with suggested sleep switches;
  4. the card YAML to put on a dashboard;
  5. an optional first screen.

  The suggestions come from `alfie/suggest` (`suggest.py`), one pass over the states when the
  Overview opens, skipping whatever the config already covers. `overview {dismissed, done}` in
  the config remembers it.
- **Export / import:** export downloads the saved config as JSON. Import sends a file through
  `alfie/config/preview` with `with_config` (which migrates an older version). It then replaces
  the draft, for the user to Save or Revert.
- **Card visual editor** (`alfie-card-editor.js`): every card option, grouped as **Display**,
  **Look** (with Shapes folded inside), **Personality** and **More options**, so no card needs
  YAML. Its labels are the panel's.
- **Live preview:** edits are sent to `alfie/config/preview`, which validates and evaluates the
  draft without saving or touching the running engine. It shows the resulting mood, the active
  signals and each pattern's matches.
- **The dock: Alfie beside every page** (2026-10-19). One live face sits in a sticky column to
  the right of every section (above the content on a phone), so settings changes show as they
  are made, before saving. It draws the draft's look and personality at once, and the draft's
  mood (expression and energy) once the preview has it, when that differs from what Alfie shows
  now; while he sleeps, is quiet or plays a story it follows the house. Appearance plays on it:
  Look adds its four stills and expression picks under it, Personality its animations, and the
  Playground's picks hold it until "Follow mood" or Reset (or leaving the page). "Hide" tucks it
  away on every page, remembered per browser; "Show Alfie" in the header brings it back.
- **Save / Revert for the whole draft, and "Reset this section"** per sub-tab. Save validates
  the whole config and lists every problem at once. Reset puts that sub-tab's part back to the
  defaults (the starter config).
- **Entities are typed into a plain text input with a `<datalist>` of entity ids**, not HA's
  internal pickers, which change between frontend versions.
- **Storage:** the first load seeds the Store from the starter defaults, plus M1's options-flow
  values, once. A stored config that no longer validates is logged and run on the defaults, but
  not overwritten until the user saves.

## Words (decided, 2026-10-19)

One vocabulary across the panel, the card editor, services, entity names and docs. The full
field-by-field list is in [settings-contract.md](settings-contract.md) "Words".

- **Terms:**
  - **signal** (good or bad, how bad);
  - **mood** and its five **mood levels**;
  - **trigger** → plays a **story** made of **steps**;
  - **house mode**: what Alfie is in it is **Awake, Asleep, Quiet or Hidden**;
  - **screen**, shown in a **rotation**;
  - **presenting**: **Hand over** or **Corner**;
  - **icon**, shown as **Transform** (whole face or ring only), **Beside** or a **Badge**;
  - **transition**, **look**, **personality**.

  "Mode" alone is never used for anything else: a card's **display** is Companion or Rotation,
  and a story's **form** is Simple or Steps.
- **Every user-made item has a Name.** Its ID is generated from the name and shown right under
  it.
- **Text:**
  - option text is in Sentence case, with a hint after a colon;
  - every default reads "Default (from …)";
  - units go in the field suffix;
  - expressions and animations show humanised names;
  - British spelling, and Alfie is "he".
- **Config keys follow the words** (config v4, `migrate_v3`):
  - signal `name`;
  - story `form` and `simple`;
  - house mode `alfie`;
  - `behaviour.motion_sensors`;
  - `look.ring_color`;
  - card `display` and `ring_color`.

  Old card YAML keys are still read.

## Panel style (agreed 2026-10-20)

The admin panel looks like part of Home Assistant, follows its light/dark theme, and is uniform
everywhere. No gradients, no decorative glyphs or emoji: icons are mdi.

- **Colours** only from HA theme variables. One radius (`--ha-card-border-radius`), one spacing
  scale (4/8/12/16/24), one type scale (page title 22, card title 16, body 14, hint 12).
- **Buttons** are 36px: one solid accent button for an area's main action, the rest outlined
  with a clear 1px border, destructive ones outlined red, icon buttons with a tooltip. Never two
  solid buttons side by side.
- **Fields** (text, number, dropdown, entity) are one outlined style, 40px, with the label in
  the border, the hint under it and errors in red under it, in a 2-column grid that goes to one
  column when narrow. Entity fields are a searchable picker (icon, friendly name, id) that also
  takes a pattern. Switches are settings rows: title and hint left, switch right.
- **Navigation** is a left menu of the sections with their sub-pages nested (a dropdown when
  narrow).
- **List pages** (signals, triggers, stories, house modes, screens, rotations) are list + detail:
  the list on the left (status, name, one-line summary, enabled switch, the selected one marked),
  the selected item's editor on the right with move, duplicate and delete in its header. Narrow:
  the editor is its own view with a back arrow. Other pages are titled cards.
- **Saving:** edits are a draft; a save bar (Unsaved changes, Discard, Save) appears only while
  the draft differs, with any problems, and leaving with unsaved changes asks first.
- **Alfie's preview** is a header toggle: a right column on wide screens, a floating panel
  otherwise.

## Display (per card)

The card's shape is its **aspect** (width over height). The panel's Look sets it for every card
(Appearance → Look, 0.5 to 3, default 1), so one change suits a new display such as the
oscilloscope; a card's own `aspect` still wins.

The card option `display` (it was `mode` before config v4; old YAML still works):

1. **Companion**: Alfie is always on screen and just reacts.
2. **Rotation**: passive screens cycle on timers. When something happens, Alfie takes over the
   screen with an animation, plays his reaction, then goes away and the cycle resumes.

## Triggers and stories

Built in M4: `triggers.py` and `stories.py` (pure models), the engine's story runner, and the
panel's **Reactions → Triggers** and **Stories**. Motion glances and idle fidgets are on
Reactions → Motion & idle; they are not triggers.

- **Triggers are fully user-chosen** (config `triggers`, a list). Kinds:
  - `entity`: an entity or pattern changes at all, or starts passing a test (above, below, is,
    is not);
  - `motion`: chosen motion sensors turn on, optionally only while something is wrong (a walk-in
    reminder);
  - `mood`: the mood level gets worse, better or either, optionally from and to chosen levels;
  - `signal`: any or chosen signals go bad, recover, or either;
  - `wake`: Alfie wakes up or falls asleep.

  - `voice`: a voice satellite (any, or chosen ones) starts listening, thinking, answering, or is
    done.

  Every trigger also has: the story it plays, a **priority**
  (0 to 100), **when busy** (`auto`: a higher priority interrupts, otherwise it queues; `queue`;
  `interrupt`; `skip`), a **cooldown**, **even while he sleeps**, and **only while the mood is**.
  Entity and motion triggers are fed by the engine's one filtered listener. The other kinds are
  checked in the mood recompute, which already knows what moved.
- **Coalescing:** when one change fires several triggers, only the highest priority plays. The
  others are noted as `outranked`. At most 3 stories queue behind the one playing, highest
  priority first, and a queued story older than 60 s is dropped.
- A **story** (config `stories`) is what every display does together when a trigger fires. Its
  `form` is one of two, and **Turn into steps** turns a simple story into steps:
  - **simple** (config `simple`): react (an expression and/or an animation), show a screen for N s
    (presented and transitioned as chosen, or as the card is set), then a closing gesture;
  - **free steps**, in order: `expression` (hold and blend), `animation` (optionally waiting for
    it), `screen` (seconds, present, transition), `wait`, `move` (centre, a corner, or custom x/y,
    springing over N s), `resize` (0.3× to 1.5×), `speak` (a placeholder until M6), and `icon`
    (see "Icons" below). The simple form can show an icon too, between the reaction and the
    screen.
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
- **An entity trigger's threshold** (above or below) is a number or **another entity**, whose
  state is read when the trigger is checked (an `input_number`, a sensor). When the threshold
  entity moves, its triggers check again, so lowering it below the reading fires too.
- **Per-signal repeats** (off by default): replay a story (default Bad news) on walk-in or every N
  hours while the signal is bad, at priority 20, queued. Or add the signal's screen to the
  rotation while it is bad (`in_rotation`).
- **Automations and the panel:** the `alfie.play_story` and `alfie.stop_story` services, and
  `alfie_story` events (`start`, `end`, `interrupted`). `alfie/story/play` plays an unsaved draft
  from the panel. `alfie/triggers/status` gives each trigger's last outcome (played, queued,
  skipped, cooling down, outranked) and what is playing now. The scene carries the playing
  `story` (id, step, expression, blend, place), which the card follows.

## Icons

Decided with Lukas (2026-10-19): Alfie can show **any Home Assistant icon** (`mdi:*`, `hass:*`,
custom iconsets) in his own line style. It comes from a story's `icon` step, the simple form,
or the `alfie.show_icon` action (with `alfie.clear_icons`), and every display shows it together.

- **Where icons come from:**
  - HA's own `<ha-icon>` resolves the name to its SVG path from HA's cache. There is no network
    of ours, and no icons are bundled (`alfie-icons.js`).
  - The path is flattened into outlines. An icon is a filled shape, so every subpath is closed,
    as SVG fill closes them.
  - An icon comes in only once its path is loaded.
- **Three styles** (`style`):
  - **Transform**: he turns into it by morph, holds it, and morphs back. It is drawn in his own
    line width and colours.
    - `transform: whole` turns his ring and eyes into it.
    - `ring` turns only his ring into it, and his eyes stay over it, alive and blinking.
  - **Beside**: the corner layout, as a corner screen. He shrinks into his corner (the card's,
    or the icon's `corner`), still alive, and the icon fills the rest by its transition.
  - **Badge** (`overlay`): it goes on the card while he carries on.
    - Its `place` is beside his ring (above, below, left, right; kept on the card), a corner,
      the centre, or custom x/y.
    - It comes and goes by its transition (zoom by default).
    - At most 4 show at once, and the oldest goes first.
- **Options** on every icon:
  - `seconds` (1 to 3600);
  - `size` (0.3× to 2× its usual size);
  - `color` (the ring's, the eyes' or the text's);
  - `fill`: outline, soft (the default) or solid. A fill is one nonzero shape, so holes stay
    holes;
  - `transition` (beside and badge);
  - a badge step's `wait` (off: the story goes straight on).
- **Under the hood:**
  - transform and beside are a screen (`@icon:<seq>`) carrying the icon, so they reuse the
    presenting and morph machinery;
  - a badge is in the scene's `icons` list, and one engine timer clears each;
  - none of it is entity state. `alfie_icon` events (`show`, `end`) tell automations.
- **Per card:** `icons: false` leaves icons out on that display.
- **In screen text and plot markers** too: see Screens.
- **The panel's Icon step** has **Try it**, which plays it on the dock's Alfie only.
- **Suggestions as you type** (Lukas, 2026-10-19), like HA's icon picker: a list of matching icons
  with previews under every icon field (the simple form, the Icon step) and, while the word being
  typed starts `mdi:`, under every screen text option, replacing just that word. An icon option
  (plot markers, the value screen's icon) is a dropdown: its built-in choices first (all of them
  when the field opens), then any matching MDI icon. The list is HA's own `/static/mdi/iconList.json` (names and keywords), fetched once on
  the first focus; not HA's `ha-icon-picker`, which a custom panel can't rely on. Typed names
  (custom sets, `hass:`) still go.
- **Lukas's house** (`devenv/house.json`):
  - **Bright living room** fires when `sensor.living_room_motion_sensor_illuminance` goes above
    `input_number.living_room_lights_on_lux`.
  - It plays **Bright in here**: surprised, then a sun he turns into for 4 s, then a nod.
  - A copy at a fixed 300 lx is there too, turned off.

## House modes

**Switched off (Lukas, 2026-10-22).** `const.HOUSE_MODES = False`: no mode is ever chosen,
`select.alfie_mode` (removed from the registry on setup) and `alfie.set_mode` are gone, and the
panel hides the House modes section, the Night "Get started" step and the mode trigger kind.
Automations steer Alfie through the holds instead, chiefly `alfie.show_rotation` with a
duration; the newest call replaces the last. The Overview and the card's why panel show the
held rotation and when it ends. The code below stays; `True` brings modes back.

Built in M5: `modes.py` (pure), the engine's mode choice, the card's hiding and rotation
handling, and the panel's **House modes** section.

- **One mode at a time.** Modes are an ordered list (config `modes`). The mode is the first
  enabled one whose condition holds, otherwise Normal (no mode).
  - A condition is an entity or pattern, an operator and a value, with match any or all, like a
    signal's. A mode with no condition is only picked by hand.
  - `select.alfie_mode`: `auto` follows the conditions, `normal` is no mode, and a mode's id
    forces it. Its options follow the config.
  - The scene carries `mode`, `mode_pick` and `mode_info {name, alfie, rotation, why}`.
    `sensor.alfie_mood` shows the mode and its why.
- **What a mode overrides:**
  - **what Alfie is** (config `alfie`, before v4 `presence`):
    - awake;
    - asleep: the sleep expression, woken only by something critical (or major, or nothing);
    - quiet: no fidgets and no glances, energy ×0.6, the face stays;
    - hidden: cards draw nothing and stop their frame loop; a story still brings him on.
  - **bad news:**
    - hold back signals at or below minor or major: they don't touch his mood or play stories;
    - a mood floor ("at least") or a fixed mood.
  - **personality:** a preset, an energy bias and a fidget rate.
  - **rotation:** rotation cards show another rotation, or pause. The card's own resumes where
    it was afterwards. A card can opt out with `follow_mode: false`.
  - **triggers:** chosen triggers are off in the mode.
- **Mode triggers:** the trigger kind `mode` fires when chosen modes (or any) start, end, or
  either.
- **Defaults** (the starter config):
  - **Night**: no condition, so it is picked by hand until Get started (or the user) gives it
    one → asleep, woken by critical. In Lukas's house (`devenv/house.json`) it is
    `switch.global_sleep_switches`, his sleep entity before M5, which `migrate_v2` moved into
    Night.
  - **Away**: `zone.home` below 1 (nobody home) → quiet, with every trigger off except Something
    turns critical.
  - **Welcome home** (a trigger, priority 60): leaving Away plays the Welcome home story
    (wake_up, happy, nod).
- **Guests:** no default for now (Lukas, 2026-10-19). `input_boolean.guest_mode` stays a good
  signal, and a guests mode can be built from the overrides above (more bubbly, hold back
  non-critical bad news).

## Screens

Screens are **templates filled by picking entities**, ported from xy-bench (Python, to JS for the
card). How the pieces fit together (types, providers, the scene fields) is in
`docs/screens-contract.md`. Each type is a pair, `frontend/screens/<type>.json` (its option schema,
which the panel turns into a form) and `<type>.js` (a pure draw function returning strokes). The
built types:

- **plot**: 1 to 6 series over a span, bucketed server-side from the recorder (long-term
  statistics for spans over 10 days), and auto, fixed or "reach" ranges. Each series has its own
  row in the panel (Lukas, 2026-10-20): a marker (ring, diamond, square, triangle, star, cross,
  x, dot, house, sun, none, or any icon), a solid or dotted line, and a label. Points per series:
  96, fixed (it was an option, 36 of 60, a limit from the oscilloscope; on a card points are
  cheap, and the history TTL floors at 15 min either way).
- **Screen options stay lean (Lukas, 2026-10-20).** A field that doesn't apply is hidden (its
  `when`: range fields on an auto range, the hourly or daily fields by forecast, a text
  screen's source fields), rarely changed ones fold under More options (`more`). Plot points
  and weather smoothing are chosen by the screen. Label and text sizes are Text size (×) like
  every type. Each point holds the bucket's mean, max, min or last value (Combine points; all
  but the mean keep a count whole), and the line is straight or steps.
- **Layout: every element in a free box (Lukas, 2026-10-22).** Each type's JSON names its
  elements in a `layout` option (kind `layout`): a plot's title, lines, value axis, time axis,
  latest values and series labels; the weather's title, icon, temperature, forecast area and
  each forecast row; and so on for every type. Per element: Show, a box of its own
  (`[x, y, w, h]` in % of the screen from its top left), Size (its text, ×) and Align.
  - Without a box an element goes where the screen's auto layout puts it. Auto layouts are
    bands that measure their text (`S.stack`), so a larger Text size squeezes, never overlaps.
  - A hidden or boxed element leaves the flow and the rest closes up. Text shrinks to fit its
    box. A chart in a box of its own (bars, the weather curve) keeps its labels inside it.
  - Panel: the **Layout** fold (greyed numbers are where the element is now; Take over copies
    them all into boxes; clicking a name outlines it dotted in the preview).
  - `S.layout` in alfie-screens.js; screen_types.py checks it and keeps only what differs.
- **Edit as YAML (Lukas, 2026-10-22):** every screen has a fold with all its options as YAML
  (defaults filled, layout included). Apply checks it on the server (`alfie/screen/yaml`,
  unknown keys are errors) and puts it in the form; Save as usual.
- **Plot axes (Lukas, 2026-10-22):** value axis on the left, right or both; ticks auto, about N,
  every step, or a list; unit on the top tick, every tick or none; tick decimals, tick marks
  (out, in, cross, none) and the axis line. A time axis (on by default) with a label every
  auto or 1 h to 30 d, as hour (midnight shows the day), time, weekday, day, date or relative.
  Gridlines for values, times or both, dotted (`S.FAINT`) or solid. Per series: line weight
  and marker size.
- Plot, value and bars take the sensor's unit unless the Unit option says otherwise; `none`
  shows no unit (a Plex sensor reports "watching").
- **value**: one big readout with an icon (auto by device class) and threshold colouring.
- **bars**: several entities as bars, e.g. soil moisture, with a highlight below a threshold.
- **weather**: the condition icon and temperature now, an hourly curve or daily columns, from
  `weather.get_forecasts`. Rain is a dotted line (Lukas, 2026-10-20; xy-bench drew bars): hourly
  against its own right axis, daily through the columns.
- **clock**: analogue or digital, a solar day/night rim from `sun.sun`, in and out temperatures,
  and a house with smoke.
- **sky** (a top-down disc with sun, moon, paths and rise/set times) and **stars** (stick-figure
  constellations, planets, the moon in phase). Both are computed in the browser from HA's home
  location with Schlyter's formulas (`alfie-sky.js`), golden-tested against xy. The
  constellation data is d3-celestial's (BSD, see `THIRD_PARTY.md`).
- **map**: streets around trackers, with markers and a house. A tracker is any entity with
  `latitude`/`longitude` attributes: a person, a phone, or a sensor such as where a car was parked. **Privacy (decided): off unless the
  screen's `allow_network` option is on.** Only a position rounded to about 100 m goes to
  Overpass, each cell is cached on disk forever, and the endpoint is an option.
- **text**: word-wrapped, shrink-to-fit titles from calendars (e.g. birthdays, with a template),
  any entity, or fixed text. `match` keeps only titles containing a word (`birthday`). In a
  rotation it can skip itself while there is nothing to show (`skip_empty`), and its turn
  lengthens so each title shows once (`extend`, on by default); titles cycle from when it
  came in.
- **Icons in screen text and markers** (2026-10-19): an icon name typed in any screen text
  (`mdi:plex Viewers`) is drawn as the icon, and a plot series marker or the value screen's
  icon may be one (`mdi:account`).
- **label**: plain text, the reference type.
- **toggle** (2026-10-22): an icon with a sliding switch, the name and the state, for one
  entity or a grid of them. Made by voice screens (see "Voice screens"), usable as any screen.
- **picture** (Lukas, 2026-10-20): an uploaded SVG (a floor plan, a logo, a drawing). Drawn in
  Alfie's line style: filled shapes as their outlines (closed, as icons are), stroke-only shapes as
  their lines.
  - Options:
    - colour: line, accent, text, or the SVG's own;
    - fill: none, soft or solid; in solid with its own colours it looks like the SVG;
    - fit (contain or stretch), size and a caption with Text size;
    - under More options: rotation, line weight, detail, and a point budget. Tiny shapes are
      dropped first, then lines thinned.
  - Uploads (**Screens → Pictures**, or the Upload button on the field):
    - Each file is up to 2 MB. The server sanitises it (`pictures.py`): only `svg`, `g`, `a`,
      `switch`, the basic shapes and paths, transforms and paint are kept; `<style>` class rules
      are folded in, and a DOCTYPE is refused.
    - Stored in `<config>/alfie/pictures/` with `index.json` for the names. That's part of HA's
      own backups.
    - Uploads save at once, outside the draft. Replacing or deleting one refreshes every card
      (`screens_rev`).
  - Text in an SVG is not drawn; it has to be turned into paths first. `<use>`, gradients and
    clip paths are dropped.
  - The card parses the SVG once (`alfie-svg.js`, a small XML reader, no DOMParser) and fits
    it to the box only when the box changes.
- **Text size (decided, 2026-10-19):** every type that draws text has a Text size option
  (`text_size`, a multiplier from 0.5 to 2, default 1), except label and text, whose `size` is
  already a height. It scales the heights of text before layout, so margins and rows make room.
  Text that is fitted to its room (bar labels, a digital clock, the value's number) still shrinks
  to fit, and a band with nowhere to grow (the sky's rows under a narrow disc) stops at the edge.

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
  `random` picks any but cut, afresh for each change: the screen leaving and the one coming
  in (or Alfie coming back) go by the same pick.
- **Condense on the card** (2026-10-19, Lukas: no field of big dots before it moves): a grain in
  flight is a dot, and grains in their places draw the stroke between them, through its own
  corners. A screen leaving stays whole lines that crumble as grains set off; one arriving
  gathers dots that join into lines as they land.
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
    only. His turn lasts exactly its seconds, like a screen's, so the rotation keeps one beat
    (a story longer than the turn is cut short when the next screen comes):
    - the card option `appear_story` is `auto` by default, which is mood-led: behaviour's
      `appear_story_bad` (Bad news) while something is wrong, otherwise `appear_story_ok`
      (Hello: his mood's face, the `@why` screens, a nod). Here `@why` is what sets his mood
      now: the bad signals' screens, or while nothing is bad, the good ones' (Bright living
      room's lux plot), so every turn explains his mood;
    - it can also be `none` or a story id;
    - the card fetches the timed actions over `alfie/story/expand` and plays them itself.
  - **Coming back:** in corner mode the screen leaves first and only then does Alfie spring out
    of his corner. In hand over he keeps a screen's beat: the screen leaves by the transition,
    then he comes in by it, and when his turn ends he leaves before the next screen comes in,
    just as one screen hands over to the next (morph turns one into the other at once). Stories keep the same timing: while a screen (the rotation's or a
    story step's) leaves and he comes back, the story waits. His own story's clock pauses; a
    trigger story's animation that arrives meanwhile plays once he is back.
  - Otherwise he appears when a trigger plays a story, on every display. In corner mode he comes
    out to the centre for it, then goes back to the corner and the rotation carries on.
  - The timer runs in the card and pauses while it is hidden or off screen.
  - `alfie.show_screen` interrupts every card, then the rotation resumes.

## Voice

Built in M6. Config section `voice`; the panel's Voice section (Assistants, Agents, Screens).

- **Works with whatever voice assistant the user already has.** Alfie watches **every
  `assist_satellite` entity** (Voice PE, ESPHome ESP32 builds, the voice-satellite card on a
  tablet) through the engine's one filtered listener, or only those in `voice.satellites`. It
  never relies on named devices. The followed satellites that are listening, thinking or answering
  go out in the scene as `voice` (never entity state); each phase also fires `alfie_voice`
  (`satellite`, `phase`: listening, processing, responding, done).
- He takes the face role and shows personality **only while a voice assistant is listening,
  thinking or speaking**. On a card that follows that satellite (card option `voice`: all, the
  default; chosen, with `voice_satellites`; or none), the rotation waits and he comes on, as for a
  story; a house mode that hides him gives way too. Listening and thinking wear
  `listening_expression` (default surprised), with `listening_animation` once as he starts.
  Thinking plays `processing_animation` (default processing) over and over. A trigger story beats
  all of this. `while_asleep` (default on) lets a sleeping Alfie take part.
- **Speaking without a mouth** (Lukas, 2026-10-20: all of them as options): `speak_style` is
  **pulse** (the ring breathes out on each syllable; the default), **eyes** (the eyes grow and lift
  a little), **both**, or **wave** (the ring ripples like a sound wave). `speak_strength` scales
  it, and a card's `speak_style` / `speak_strength` override Alfie's. The rhythm (`speechLevel` in
  alfie-face.js) is a few incommensurate sines with phrase pauses, so it never visibly repeats.
  When the satellite goes back to idle he plays `after` (default nod).
- A trigger kind `voice` fires a story when chosen (or any) satellites start a phase or are done.
- **What's wrong for voice agents**, all opt-in so installing Alfie changes no one's assistant:
  - the **Alfie LLM API**, ticked in an LLM agent's settings beside Assist. It brings the tool
    `alfie__whats_wrong` (the bad signals worst first, with up to 5 entities each with their
    states, how long, the mood, the good signals) and a prompt: the persona when `persona` is
    on (`persona_prompt`, "Alfie" becomes his name), and with `mood_aware` (default on) one line on
    how he feels and why, asking the agent to let it show a little;
  - `assist_tool` adds the same tool to Assist through HA's LLM tools platform (`llm.py`);
  - `intent` registers the intent `AlfieWhatsWrong` and `sentences` (HA's template syntax) with
    HA's own agent, answered by a short spoken summary;
  - `sensor.alfie_mood` has a `problems` attribute (unrecorded): what is wrong, in words.
- **Speaking out loud**: a story's Speak step and `alfie.say` say a line. Satellites announce it
  (`assist_satellite.announce`); media players get `tts.speak` through `tts_entity` (else the
  first TTS engine) in `language`. With no speakers named, `speak_targets`, else every satellite
  he follows. A Speak step's text takes `{name}`, `{mood}`, `{reason}` and `{wrong}`, and it can
  wait while he talks (about 14 characters a second).
- Lukas's setup today: the Android Companion app's native pipeline exposes **no** satellite states.
  The current face uses a hack that triggers on `conversation.*` entity state timestamps at reply
  time. His tablet will move to the voice-satellite card to become a real `assist_satellite`. His
  pipeline is Whisper and Piper (local) plus a Gemini brain with a SearXNG search tool; see
  `~/Documents/superintendent-plan.md`.

## Voice screens

Built in M9 (Lukas, 2026-10-22). When a voice turn switches something in the house or answers
about it, Alfie shows a screen made from that entity. All of it is the `voice` config section's,
in the panel's Voice → Screens (and Agents for the find tool).

- **What a turn was about** (`converse.py`, pure): the engine follows HA's chat logs
  (`conversation.async_subscribe_chat_logs`). HA's own agent and every LLM agent log their tool
  calls and results there, so it costs no extra request. Per turn:
  - intent results' `data.success[]` entity ids: an **action** when the intent changes something
    (HassTurnOn, HassLightSet, ...), else an **answer**;
  - else the `alfie__find_entity` answer, or the names a lookup (GetLiveContext) was given,
    resolved by the name index;
  - else exposed entities whose name or alias appears whole in what was said, then in the reply.
  - A turn is done at the reply (assistant content with no tool calls). HA's own agent logs
    its intents, results and reply as it goes. An LLM agent's subscribers only hear what was
    said and the tool results (HA 2026.10 doesn't notify its assistant messages), so once such a
    turn starts, the watcher looks at HA's stored log (`hass.data["conversation_chat_logs"]`)
    every 0.4 s for at most 30 s and reads the finished turn from it (`converse.last_turn`); a
    conversation that goes on ends with an UPDATED event carrying the whole log.
- **The screen** (`converse.screen_for`):
  - an action: the `toggle` type, its knob starting at the state before (HassTurnOn → off);
  - an answer: numbers with one unit → `plot` over `plot_hours` (default 24), titled by
    `plot_title` (Lukas, 2026-10-22: default `icon`, an MDI icon for the sensor's kind from its
    device class, e.g. a thermometer; or icon_name, name, none) at `plot_text_size` 2;
    numbers with mixed units → `bars`; `weather.*` → `weather`; anything else → `toggle`
    showing its state;
  - more than `max_grid` (6): a grid of the first ones and "+N more";
  - `screen_skip` (default script, scene, automation, todo, schedule, button, ...) leaves
    domains or entity ids out;
  - `action_screens` / `answer_screens` turn either kind off, `screens` all of it.
- **Music** (Lukas, 2026-10-22: "a cute animation should play"): a turn that asks for music
  (a tool named like play_music, Spotify, a playlist or radio; or the words music, songs, a
  playlist... with something done or looked up) gets a reaction instead of a screen: his
  `music_expression` (happy) for a while, `music_animation` (groove: a sway and bob, three
  times, ending on a wink; 4.8 s) and a `music_icon` badge (a note, top right). `music_screen`
  shows the player's screen as well.
- **The `toggle` type** (also a normal screen type): the entity's icon (its own, else by name
  words — coffee, lamp, grow, tv... — then by kind), a switch whose knob slides from `from` to the
  state (waits 0.45 s, then eases; exact at any frame rate), the name and the state ("On now"
  after an action). One entity fills the screen with layout boxes (title, icon, switch, name,
  state); several are a grid of cells. Things that aren't on or off show their state, no switch.
- **Presenting**:
  - The scene's `screen` is `{"id": "@voice:<seq>", "inline": {type, title, options}, "present",
    "hold"}`, and cards register it like an icon screen.
  - `screen_present` is corner (default), handover, or each card's own setting.
  - It shows briefly (Lukas, 2026-10-22): `screen_seconds` (5) from when it comes in. With
    `hold_while_speaking` on, it holds while a followed satellite is still answering (up to
    90 s), then stays `linger_seconds` (6).
  - A story or an automation's `show_screen` beats it.
  - A card's `voice_screens: false` (or `voice: none`) leaves voice screens out.
  - Any conversation counts, typed ones in HA's Assist dialog too: the chat log doesn't say
    which device a turn came from.
- **`alfie__find_entity`** (`finder.py`, pure index; `voice.py` tool): read-only search of every
  entity that isn't hidden or disabled, by name, aliases, device and area, with plural and
  apostrophe folding and a bonus when the room is named. Returns the top 5 with state, unit, area,
  aliases and `can_control` (exposed). In the Alfie API when `find_entity` is on (default), and
  in Assist with `assist_tool`. The index is built in an executor on first use and again only
  after an entity, device or area registry change. The Alfie API's prompt gets one line about it.
- The panel's Voice → Screens shows the last voice screen: what was said, the reply, what it
  was about and which screen was made.

## Card

- **Render styles** (eight): neon, flat, CRT, theme colours, and (2026-10-21) four with an
  effect and a paper of their own:
  - blueprint: a grid on deep blue, finer lines;
  - chalk: a hand-drawn wobble on a green board. The wobble follows distance along the line,
    so it never shimmers;
  - ink: thick dark lines on paper;
  - pastel: soft-filled pink with blue eyes.

  A style's paper shows unless a background is set. Styles are data in alfie-card.js `STYLES`
  (`color`, `eye`, `text`, `accent`, `line`, `glow`, `bg`, `grid`, `rough`, `soft`, `lw`).
- **Colours are per role:**
  - ring and eyes;
  - screen lines (`line_color`: plots, bars, pictures);
  - screen text and screen accents;
  - background.

  An empty role takes the style's, then the ring's.
- **Themes** (alfie-look.js `THEMES`): Classic, Amber CRT, Ocean, Sunset, Mono, Blueprint,
  Chalkboard, Paper and Candy. A theme is a preset that writes a style and its colours in one
  go, like personality presets. It's chips in Look and a select in the card editor; on a card
  its empty colours are kept, so they mean the style's own. `themeOf` names the theme a look
  still wears.
- **Tap: the why panel** (built 2026-10-21). An overlay on the card with:
  - his mood and its reason;
  - what's wrong and what's good, each signal with its entities' live values;
  - what's on show and why: an automation, a story (named), a voice assistant, the rotation,
    or just him;
  - the house mode (and the entities behind it);
  - his face: expression, energy and personality.

  It refreshes with each scene while open, and closes on a tap or after 20 s.
- **Actions:** `tap_action`, `hold_action` and `double_tap_action` take `why` or any HA action
  (more-info, navigate, url, perform-action, toggle, assist, none). HA's own go out as a
  `hass-action` event, as HA's cards do.
  - Defaults: tap why, hold more-info (`entity`, or his mood sensor), double tap none.
  - A tap waits for a second one only when a double-tap action is set, and a drag is no tap.
  - Set in the card editor's **Tap and hold** group.
- Gotchas from an earlier custom card (xy-scope-card):
  - Define the element after `customElements.whenDefined("home-assistant")`, because HA installs a
    scoped-registry polyfill.
  - Bump the `?v=` query on every release (31-day cache).
  - It worked in browsers but showed "Configuration error" only in the Android Companion app, and
    the cause was never found. **Test on the tablet early.**

## Oscilloscope (decided, 2026-10-19)

Alfie also shows on Lukas's X-Y oscilloscope, through xy-bench on the scope box (Scarfe-Numbat,
`192.168.1.112`), as one more xy-bench screen (`alfie`) that HA picks like any other. xy-bench
keeps the DAC, the planner, the wiring correction, music and its own screens.

- **The card is the renderer.** The options `vector_out: true` and `paint: false` make the card
  dispatch an `alfie-vector` event each frame (`{strokes, aspect, t}`) and skip the canvas. It
  sends every stroke it would have painted: head, eyes, screens, intros, badges. A stroke is
  `{p: [[x, y], …], c: closed, w: weight}` in [-1, 1] across the canvas, y up, rounded to 3
  decimals (`alfie-stage.js` `vectorStroke`). `w` is the alpha. The scope has no fill or line
  width, so filled icons show as outlines.
- **The `scope/` sidecar (`alfie-scope`)** is headless Chromium, in the same image `./dev`
  screenshots with. It loads the card from HA's own `/alfie_static/` at HA's origin, so it's
  always the installed version. The card gets a small `hass` shim (connection, states, config),
  icons resolve from bundled mdi paths, and frames go to xy-bench as `PUT /api/strokes`. The
  latest frame wins. The connection and fps are in `.env` (`scope/.env.example`). The aspect
  is Alfie's own Look aspect, like any card's (Lukas's call: the integration is set up for the
  scope, so the tube's shape goes there). It reloads when HA reconnects (a deploy).
- **The scope's settings page** (Lukas's pick: a page on Numbat, not the Alfie panel). The
  sidecar serves it on `SETTINGS_PORT` (8642), with HTTP basic auth when `SETTINGS_PASSWORD`
  is set. It hosts Alfie's own card editor (`alfie-card-editor.js`, fetched from HA through the
  sidecar), so it has every card option, plus beam order and condense. Its one WebSocket ask
  (`alfie/screens`, from an allowlist) goes through the headless page's connection, so the
  browser never sees the HA token. Edits save as you go to `data/card.json` (a volume) and reach
  the running card at once (`SCOPE_SET`, no reload). The keys the scope sets itself (`card`,
  `vector_out`, `paint`, `aspect`, `fps`) are dropped. `ALFIE_CARD` is only the start, before
  anything is saved. The preview draws the frame the scope last sent.
- **xy-bench's side** (built by the xy-scope session):
  - `PUT /api/strokes` with `{strokes, ordered, aspect, t}` and the push token. It allows up to
    600 strokes and 20000 points, and a body up to 512 KB.
  - x is scaled by aspect, then the frame to 0.95. A frame wider than xy-bench's own aspect
    setting is shrunk to fit, never squashed, so set that to the tube's shape too.
  - After 3 s without a frame it shows a struck-through ring.
  - `GET /api/status` reports `alfie {age, strokes}`.
  - Keep `ordered` true: a re-solved tour costs about 125 ms a frame. xy-bench then only picks
    each stroke's direction and each loop's entry.
  - `w` is *relative*: each stroke's share of the frame's samples. So a whole-picture fade does
    not dim the scope; only one part against another does.
- **The beam's tour is the card's job** (`vector_order: tour`, the default; `drawn` sends strokes
  as painted). An X-Y scope can't blank, so every jump between strokes is a drawn line that
  also takes samples from the strokes. `alfie-stage.js` `tourStrokes` orders each frame as a
  short closed tour (greedy walks from several starts, then 2-opt; open strokes turned, loops
  re-started at the vertex nearest their neighbours). It matches xy-bench's own full solve within
  a few percent in about 1 ms, and on Lukas's screens it halves the jumps (stars 9.3 → 4.0).
  A plan is kept per kind of frame (its open/closed strokes in order) and replaced only when
  it has grown 15% longer than when solved (checked at most every 15 frames), so moving parts
  and strokes that come and go don't make the jumps flicker.
- **Transitions keep the screen's tour.** In the vector feed a screen's strokes are toured
  before its transition reshapes them (`_tourScreen`, a plan per screen), and a frame that is
  mid-transition (`moving` from `_describe`) or has over 200 strokes is not re-toured. This is
  xy-bench's own rule for its intros. A dot goes as a two-point stroke, since xy-bench drops
  one-point strokes. No empty frame is sent while a screen comes or goes: on the scope it parks the beam
  in the middle as a dot, so xy-bench is left tracing the last frame for that moment.
- **Loop entries hold still.** A loop (the head, an eye) keeps the point where the beam enters it
  from frame to frame, as a share of the way round, unless moving it saves 0.15. So when Alfie
  glances, the jump lines follow his eyes instead of hopping round them. Loops go to xy-bench as
  open strokes back to their start (`openLoops`), because xy-bench would otherwise re-pick a
  closed stroke's entry every frame. Mid-transition `placeStrokes` keeps the order and still
  holds the entries.
- **Condense on the scope is xy-bench's** (`vector_condense: lines`, the default; `dots` is the
  canvas version). Each stroke is resampled and each pair of samples is a grain of dust drifting
  in, so until they settle the beam draws lines between random points. Each stroke stays its
  own stroke, so the joins between strokes stay faint jumps. (One path for the whole picture
  made them solid lines just before the end.) Two neighbouring grains in their places draw the
  stroke between them through its own corners. The samples alone cut corners and shrank small
  marks, so for the second or so that condense's slow ends leave the picture still, it was drawn
  a little differently from the screen itself: a visible jump just before a screen left, and
  after it arrived (Lukas saw it most on the sky).
- **60 Hz, from a timer** (Lukas: "always 60"). `scope/page.html` replaces
  `requestAnimationFrame` with a timer at `FPS` (default 60), so the feed can match xy-bench
  whatever its rate. Alfie's frames are long, so xy-bench used to stretch them to its 50 fps
  floor. Numbat's xy-bench now has `XYBENCH_MIN_FPS=60` in its `.env`, so every screen is
  60 Hz, at the cost of fewer samples per frame (sparser lines on a busy screen). A mismatched
  feed judders: 60 into 50 skips every sixth frame. The card's own cap is lifted there (fps
  120). 30 fps cost about a third of a core and ~210 MB on raccoon.
- **Pacing in the status line:** frames over 1.5 frame times late, and the longest gap. Measured
  on raccoon after the first pass through a rotation, slide, condense and materialise show 0 or
  1 late frames per 5 s. Before these changes, condense stalled up to 230 ms.

## Automations (decided, 2026-10-20)

Lukas: everything Alfie can do should be callable from an automation.

- **Actions:** `set_expression`, `play_animation`, `show_screen`, `play_story`, `stop_story`,
  `show_icon`, `clear_icons`, and for the house mode's overrides `set_mood`, `set_alfie`
  (awake, asleep, quiet, hidden), `show_rotation` (or pause), `set_personality`, plus
  `set_mode` (the select, with a duration that then goes back to what was picked) and
  `set_enabled` (a signal or trigger on or off, saved).
- **Holds:** the four override actions hold a value for a duration (or until changed, `auto`
  lets go) laid over the house mode (`modes.with_holds`), so they beat it. They don't survive a
  restart, as an expression override doesn't. The Overview says what is held and for how long.
- **Dropdowns:** the automation editor lists your own screens, stories, rotations, modes,
  signals, triggers, expressions, animations and personalities by name. `automation.py` builds
  them from the config and `services.async_describe` lays them over services.yaml after every
  config change. Typed values and templates still go.
- **Events to trigger on:** `alfie_signal` (a signal goes `bad`, `good` or `clear`, with
  `was`), `alfie_story`, `alfie_animation`, `alfie_icon`; and the entities.
- **In the panel:** under every ID, the action (or for a signal, the trigger) that uses it, with
  Copy.

## Non-goals (for now)

A body; replacing the voice pipeline itself; an add-on.

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
   "signals": [{"id": "plant_monstera", "name": "Monstera is dry", "kind": "bad",
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

## Starter defaults, and Lukas's house

**The starter** (`defaults.py`) **seeds the Store** on first load, and "Reset this section"
returns to it (decided with Lukas, 2026-10-19: a public install must not get his entities). It is
generic, so it means something in any house:
- **Signals, patterns only:**
  - a battery is low (`sensor.*_battery` below 15, major);
  - a battery-low warning (`binary_sensor.*_battery_low`, major);
  - water leaking (`binary_sensor.*leak*`, critical);
  - a smoke or CO alarm (critical);
  - an update is available (`update.*`, minor).
- **No motion sensors**, and Night picked by hand. Get started fills in both.
- **Stories, triggers and Away** as described above.

**Lukas's house** is `devenv/house.json`, a complete v4 config with the dev screens and
rotations. `./dev house` loads it into dev HA. On production it arrives through Overview → Import.
The tests use it to check Alfie still reproduces the old face (`tests/house.py`), and
`tests/house_v3.json` (the same house as a v3 store) checks the migration. It was ported from
production `configuration.yaml` (`sensor.superintendent_mood`) and the `Superintendent:`
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
  - **rest**: `switch.global_sleep_switches` on means `closed`: the Night house mode, with the
    `sleep_expression` behaviour setting.
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
- **Mood flips to critical:** a startle. **Voice reply:** processing, then a nod (Voice's
  `processing_animation` and `after`).
- **Reactions are settings:** `on_critical` (default startle), `on_recover` (nod) and `on_wake`
  (wake_up) each name an animation, and `""` means none.

## Open questions

None at the moment.

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
