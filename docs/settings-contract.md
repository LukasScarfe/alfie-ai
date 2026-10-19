# Settings tidy-up: the contract between backend, panel and card

The interfaces for the settings tidy-up (plan.md step 5½), fixed before the code so the parts fit
together. design.md "Words" is the vocabulary. This doc says how the pieces fit
together. Change it only together with every side that uses it.

## Parts and their files

| Part | Files |
|---|---|
| **A, backend** | `config.py`, `defaults.py`, `engine.py`, `modes.py`, `stories.py`, `triggers.py`, `websocket_api.py`, `__init__.py`, `select.py`, `sensor.py`, `strings.json`, `translations/en.json`, `services.yaml`, `devenv/house.json` (new), `devenv/devtool.py`, `dev`, `tests/test_*.py` |
| **B, panel shell** | `frontend/alfie-panel.js`, `frontend/panel/ui.js` (new), `frontend/panel/overview.js` (new), `frontend/alfie-panel-forms.js`, `tests/screens/panel.test.mjs`, a new `tests/screens/ui.test.mjs` |
| **C1, panel sections** | `frontend/panel/mood.js`, `frontend/panel/reactions.js` |
| **C2, panel sections** | `frontend/panel/modes.js`, `frontend/panel/screens.js`, `frontend/panel/appearance.js`, `frontend/screens/*.json` (option labels only) |
| **D, card** | `frontend/alfie-card.js`, `frontend/alfie-card-editor.js`, `frontend/alfie-look.js`, `tests/screens/editor.test.mjs`, `tests/screens/look.test.mjs`, `tests/screens.test.mjs`, `devenv/dashboard.js`, `devenv/harness.html` |

Built in order: A, then B, C1 and C2, then D.

## Key renames (config v4)

`config.py` sets `CONFIG_VERSION = 4`, and `migrate_v3(raw)` runs on any stored config below 4
(after v1 and v2). Validation accepts **only** the new keys. The migration is the only place
that knows the old ones.

| Where | Old | New |
|---|---|---|
| `signals[]` | `label` | `name` |
| `stories[]` | `mode: "template" \| "steps"` | `form: "simple" \| "steps"` |
| `stories[]` | `template: {...}` | `simple: {...}` (same fields) |
| `modes[]` | `presence: normal \| asleep \| idle \| blank` | `alfie: awake \| asleep \| quiet \| hidden` |
| `behaviour` | `gaze_map: [{entity, action}]` | `motion_sensors: [{entity, action}]` |
| `look` | `face_color` | `ring_color` |
| new section | none | `overview: {dismissed: false, done: []}` |

`overview.done` is a list of Get started step ids that were marked done or skipped by hand:
`signals`, `motion`, `sleep`, `dashboard` and `screens`. `overview` is in `SECTIONS`, and
default_config has it.

**Elsewhere:**
- **Scene:** `mode_info.presence` becomes `mode_info.alfie`, with the new values.
- **`alfie/config/get` choices:** `presences` becomes `alfie_states`, and `template` becomes
  `simple` (the default simple-story fields). `choices.mode` and `choices.steps` use the new keys.
- **Card config (YAML and editor):**
  - `mode` becomes `display` (values `companion` | `rotation`);
  - `face_color` becomes `ring_color`;
  - the card's `setConfig` maps the old keys when the new ones are absent, so old dashboards keep
    working;
  - the editor emits only the new keys.
- **Service `alfie.show_screen`:** the field `seconds` becomes `duration` (1 to 3600, default
  20). `seconds` is still accepted when `duration` is absent.
- **Select entity:** its translated name becomes "House mode", and the entity id stays
  `select.alfie_mode`.

## Starter defaults (`defaults.py`)

A fresh install no longer gets Lukas's house:
- **Signals** (patterns only, all enabled):
  - `low_battery` "A battery is low": `sensor.*_battery` below 15, bad, major;
  - `battery_warning` "A battery-low warning is on": `binary_sensor.*_battery_low` is on, bad,
    major;
  - `water_leak` "Water is leaking": `binary_sensor.*leak*` is on, bad, critical;
  - `smoke_alarm` "A smoke or CO alarm is on": `binary_sensor.*smoke*` and
    `binary_sensor.*carbon_monoxide*` are on, match any, bad, critical;
  - `update` "An update is available": `update.*` is on, bad, minor.

  A numeric op over a pattern must ignore non-numeric and unavailable states. Check
  `signals.py` and add a test.
- **Motion:** `motion_sensors` is empty. The `notice`, `idle_fidgets`, `idle_interval` and
  `motion_debounce` defaults stay.
- **Modes:** Night has `condition: null` (picked by hand) and `alfie: asleep`. Away stays on
  `zone.home` below 1, with `alfie: quiet`.
- **Stories and triggers:** as now, in the new keys. No reference to Lukas's entities or the
  `plants` screen.
- **Lukas's house:** `devenv/house.json` is a complete v4 config: his signals, motion map, Night
  on `switch.global_sleep_switches`, guests good signal and so on, as `defaults.py` had them,
  plus the dev store's screens and rotations if you can read them via WS (otherwise none).
  `./dev house` loads it via `alfie/config/set` (devtool.py `house`).
- **`migrate_options`** (M1's options flow) still applies on the first load.

## New WS command: `alfie/suggest` (admin)

It makes one pass over `hass.states` when called, and nothing is cached or kept running.

```json
{"signals": [{"name": "Monstera moisture is low", "entities": ["sensor.x_moisture"],
              "op": "below", "value": 20, "kind": "bad", "severity": "major", "why": "moisture sensor"}],
 "motion": [{"entity": "binary_sensor.hall_motion", "name": "Hall motion"}],
 "sleep": [{"entity": "input_boolean.sleep_mode", "name": "Sleep mode"}]}
```

- **signals:** one per entity, for:
  - moisture sensors (below 20 %);
  - door, window and garage-door binary sensors, with names like "The front door is open" (is
    on, minor);
  - `problem` binary sensors (is on, major);
  - batteries that the starter patterns would miss.

  Skip any entity a config signal already matches, and return at most 30.
- **motion:** `binary_sensor` entities with device_class motion, occupancy or presence that are
  not already in `motion_sensors`.
- **sleep:** `input_boolean` and `switch` entities whose id or name contains sleep, bed or night.

## Panel structure

The URL hash is `#<section>/<sub>`, for example `#mood/signals`. A missing or unknown hash means
Overview.

| Section id | Title | Sub-tabs (id: title) | Module | Reset covers |
|---|---|---|---|---|
| `overview` | Overview | none | `panel/overview.js` (B) | none |
| `mood` | Mood | `signals`: Signals, `levels`: Levels | `panel/mood.js` (C1) | signals → `signals`; levels → `mood` |
| `reactions` | Reactions | `triggers`: Triggers, `stories`: Stories, `motion`: Motion & idle | `panel/reactions.js` (C1) | `triggers`, `stories`, `behaviour` |
| `modes` | House modes | none | `panel/modes.js` (C2) | `modes` (and `behaviour.sleep_expression` lives here) |
| `screens` | Screens | `screens`: Screens, `rotations`: Rotations | `panel/screens.js` (C2) | `screens`, `rotations` (Rotations also holds `behaviour.appear_story_bad` / `_ok`) |
| `appearance` | Appearance | `look`: Look, `personality`: Personality, `playground`: Playground | `panel/appearance.js` (C2) | `look`, `personality` |

### A section module

Each module lives in `frontend/panel/`, is an ES module, and is loaded by the shell with the
panel's `?v=` query. It exports:

```js
export const id = "mood";
export const title = "Mood";
export const subs = [["signals", "Signals"], ["levels", "Levels"]];   // [] for none
export const resets = { signals: ["signals"], levels: ["mood"] };     // sub (or "" when no subs) -> config sections
export function render(p, sub) { return "<html string>"; }            // the body below the sub-tabs
export function click(p, action, el) { return false; }                // true when it handled data-action=action
export function beforeInput(p, path, value, el) {}                    // optional: before the draft is written (id renames)
export function afterInput(p, path, value, el) {}                     // optional: after (live previews, header text)
export function mount(p, sub) {}                                      // optional: after render (faces, statuses)
export function scene(p, s) {}                                        // optional: on each scene update while shown
export function leave(p) {}                                           // optional: before switching away (end previews)
```

`p` is the panel. It is the only shared state, so modules keep their own state on `p` under a
key named after the module (for example `p.reactions = {...}`) or in a module-level variable.

**What the shell gives every section (`p`):**
- `p.draft`, `p.saved` and `p.defaults` (config objects), `p.choices`, `p.hass`, `p.scene` (the
  last scene), `p.preview` (the last `alfie/config/preview` result) and `p.tstatus`.
- `p.open`, a Set of open keys. Keys are a prefix and an id: `sig:`, `t:`, `st:`, `m:`, `s:`,
  `r:`, `more:`.
- `p.edited(rerender = false)`: call it after changing the draft. It schedules the preview and
  status, and re-renders when asked.
- `p.render()`, `p.flash(text)`, and `p.go(section, sub)` to navigate (also used by links).
- `p.fmt(n)` for number display, and `p.root` (the shadow root).
- `p.loadTriggerStatus()` (it fills `p.tstatus` and re-renders the badges), and
  `p.modeEntity()`.

The shell keeps the generic input handling (`data-path` + `data-kind`: bool, number with
`data-empty="null"`, optnum, optent, opttext, value, text). It calls the section's `beforeInput`
before writing and `afterInput` after. A `data-rerender` attribute re-renders on change. Enter in
an entity box clicks the row's `[data-add]` button.

### `panel/ui.js`: pure HTML builders (B owns, everyone uses)

There is no DOM access here, so node can test it. Every builder escapes its text.

```js
esc(v)
human(id)                          // "glance_left" -> "Glance left", "@mood" stays "@mood"
opt(value, text)                   // -> [value, text]
select(path, value, options, { rerender, attrs })          // options: [[v, text]] or [v]
num(path, value, { min, max, step, empty, unit, placeholder })   // unit suffix inside the field ("s", "min", "h", "%")
text(path, value, { placeholder, kind, attrs, list })      // list: datalist id
toggle(path, on, { title, action, i })                     // switch; path -> data-kind=bool, or action -> data-action
field(label, control, hint)        // one labelled control in a grid cell
wide(label, control, hint)         // same, spanning the grid
check(path, on, label, hint)       // a switch with its label on one line
group(title, inner)                // a titled block of fields: <section class="group"><h4>…</h4><div class="grid">…</div></section>
more(p, key, inner, summary = "More options")   // <details class="more" data-more="key">; open state kept in p.open as more:key
item({ key, i, n, open, cls, enabledPath, enabled, chips, name, summary, badge,
       actions: { toggle, up, down, dup, del }, body })
                                   // the uniform list item: header [switch][chips][name][summary][badge][▲▼▸],
                                   // and when open: body, then a footer with Duplicate / Delete
picks(action, i, key, all, chosen, textOf)    // toggle chips: data-action, data-i, data-key, data-name
entities({ items, i, add, rm, placeholder, list = "entities" })   // entity chips + input + Add (the add button gets data-add)
intro(text, more)                  // one-sentence intro; `more` (html) goes in a "Learn more" fold
empty(text)                        // the empty state of a list
addButton(action, text, attrs)     // "+ Add signal" full-width dashed button
addRow(controlHtml, action, text)  // a select + add button
seg(action, current, options)      // a segmented control (e.g. a story's form: Simple | Steps)
```

`p.screenSelect(path, value, extra, attrs)` and `p.storyOptions(extra)` (story id/name pairs,
with missing ids kept visible) stay on the panel, because they read the draft.

### Words (from design.md, applied by every section)

- Option text is in Sentence case. A hint goes after a colon: "Asleep: only bad enough news
  wakes him".
- **Defaults** read "Default (from …)". Examples: "Default (the card's)", "Default (Alfie's
  personality)", "Default (as the signals say)".
- **Names:** every item has a **Name** field, first. The **ID** is inside More options; a new
  item's ID follows its name until the ID is edited by hand.
- **Units** go in the field suffix, never in the label: write "Cooldown" with the unit `s`, not
  "Cooldown (seconds)".
- **Buttons:**
  - "+ Add signal", "+ Add trigger", "+ Add story", "+ Add house mode", "+ Add screen",
    "+ Add rotation", "+ Add step", "+ Add Alfie step", "+ Add motion sensor";
  - "Duplicate" and "Delete" (no noun);
  - "Play on every display".
- **Empty states:** "No signals yet.", "No triggers yet." and so on.
- **Reset:** a "Reset this section" button. Its confirm reads: "Put <Sub-tab title> back to
  Alfie's defaults? You can still revert before saving."
- **Presenting:** "Hand over: Alfie steps aside" and "Corner: Alfie shrinks into a corner". In
  a story the default is "Default (the card's)".
- **Transition:** options are the human names plus "Random: a different one each time". The
  default is "Default (the card's)", or for a rotation "Fade".
- **A house mode's `alfie`:**
  - "Awake";
  - "Asleep: only bad enough news wakes him";
  - "Quiet: no fidgets or glances";
  - "Hidden: cards draw nothing".
- **Signal fields:**
  - "Good or bad" (Bad: something is wrong / Good: something is right);
  - "How bad" (severity: Minor / Major / Critical);
  - "Watches" (entities);
  - "Is" (op: Above / Below / Is / Is not), then "Value";
  - in More options: "With several entities", "Weight", "Screen that explains it", "Repeat
    while it's bad".
- **Trigger fields:**
  - "Fires when" (the kind: An entity changes / Motion / The mood changes / A signal goes bad or
    recovers / Alfie wakes or sleeps / A house mode starts or ends);
  - "Plays" (story);
  - in More options: "Priority", "If a story is already playing" (busy), "Cooldown", "Even
    while he sleeps", "Only while the mood is".
- **Personality sliders and house mode overrides share labels:** "Exaggeration", "Speed",
  "Bounce", "Fidgeting", "Energy", "Blinking".
- **Colours:**
  - "Ring colour";
  - "Eye colour";
  - "Background";
  - "Screen text colour";
  - "Screen accent colour".

## The Overview (B)

- **Top:** a live face (`<alfie-card>` with `card: false`) beside a "Now" block. It shows the
  mood level and reason, the house mode (and "picked by hand"), the story playing, and a list of
  the active signals with links to them (`p.go("mood", "signals")` with the signal open).
- **Get started:** shown while `overview.dismissed` is false. These are the steps, each with a
  tick when done, a link to its section, and "Mark done" / "Skip", which writes `overview.done`
  and goes through Save like everything else:
  1. `signals`: "Choose what Alfie watches".
     - Done when an enabled signal matches at least one entity (from `p.preview`).
     - Lists the `alfie/suggest` signals, each with "+ Add". Adding one appends a signal to the
       draft (with `default_repeat` from `p.defaults.signals[0].repeat`, or the M4 fallback).
  2. `motion`: "Tell Alfie about motion sensors".
     - Done when `behaviour.motion_sensors` isn't empty.
     - Lists suggestions with "+ Add", which adds `{entity, action: "notice"}`, and "Add all".
  3. `sleep`: "When is it night?"
     - Done when the Night mode has a condition.
     - Lists the sleep suggestions and an entity box. Picking one sets Night's condition to
       `{entities: [e], match: "any", op: "is", value: "on"}`.
  4. `dashboard`: "Put Alfie on a dashboard". Shows `type: custom:alfie-card` in a code box with
     Copy, and a note about the visual editor and Display → Rotation. Marked done by hand only.
  5. `screens`: "Optional: build a screen". Done when `screens` isn't empty. Links to Screens.

  "Hide Get started" sets `dismissed`. "Show Get started" in More options brings it back.
- **More options:**
  - **Export:** downloads `alfie-config.json` from `p.saved`.
  - **Import:** reads a file, then `migrate`s it on the server by sending it through
    `alfie/config/preview`. Any errors are shown, and the file replaces the draft so the user can
    Save or Revert. The config must be v4 or carry a `version` the server migrates. A raw import
    goes through the preview's validation, so A makes `alfie/config/preview` and
    `alfie/config/set` accept an older `version` and migrate it first.
