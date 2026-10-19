# Milestone 3 port inventory: xy-bench screens to Alfie

Source: `ssh lukas@192.168.1.112:~/xy-bench` (read only). Paths below are `xy/<file>.py:line`.
Data feeder that already maps HA to inputs: `~/scope-display-integration/custom_components/xy_scope/feeder.py` (436 lines). It is the best spec for the Alfie data layer.

## 0. Key architectural finding: what NOT to port

xy-bench screens are `build(phase, inputs) -> Drawing` (list of `Stroke(points, closed, weight, dwell)`, canonical coords in [-1,1]). Everything about *beam budget* exists only because the scope has no Z axis and 800 samples/frame:

- `xy/planner.py` (616 lines: tour ordering, sample allocation, resampling, pack): **do not port.** A canvas draws polylines directly. Only `reveal()` (planner.py:442, ~50 lines) is wanted, for the "draw" intro (partial stroke by arc length).
- Budget logic in screens (`frame_budget`, `samples_needed`, `_STREET_SHARE`, `_STARS_SHARE`, `_RAIN_WEIGHT` scaling, `_MAP_MIN_DIM`, "smoke only if it fits" in `_home`): drop. `weight` becomes line alpha/width (dotted = `DOTTED=0.15` weight -> dashed/low alpha in canvas).
- `figures.py` is 2580 lines but ~1200 are 3D solids, the Superintendent face (already ported in M1), welcome/shadow/flowers/music: out of scope.
- `geometry.py` (147): only `Stroke`/`Drawing` idea; a screen in JS is `[{pts:[[x,y]...], closed, w}]`. Orientation affine not needed.

Port target: pure-function JS module(s) returning stroke lists, drawn by the existing card renderer (render styles: flat/neon/CRT already planned). Suggested files: `frontend/alfie-screens.js` (templates), `alfie-font.json`, `alfie-intros.js`, constellation data JSON.

## 1. Shared building blocks (needed by every screen)

| Piece | Where | Lines | Notes |
|---|---|---|---|
| `views.py` helpers: `number`, `fmt`, `series` (bucket-average), `span`, `readout`, `curve`, `baseline`, `nice_ticks`, `axis`, `marker` (ring/diamond/square/house/sun), `chart2`, `bars` | views.py:22-285 | ~260 | Pure math, trivial JS. |
| Icons: `house` (285, with smoke), `leaf` (313), `drop` (342), cloud (365-425), `_sun_icon` (426), `weather_icon` (440-538, ~100 lines, conditions: sunny, clear-night, partlycloudy, cloudy, rainy, pouring, snowy, fog, lightning...), `car` (539) | views.py:285-559 | ~270 | Pure geometry; port verbatim. |
| Font | font.py (311) | see section 2 | |

Total views.py = 559 lines -> roughly 350-400 lines JS.

## 2. The vector font (xy/font.py, 311 lines)

- Glyph space: baseline y=0, cap height y=1, x from 0..width. `DIGIT_W=0.56`, `TRACKING=0.2`, `X_HEIGHT=0.62`, `DESCENDER=0.3`.
- Glyphs are *authored procedurally*: `_glyphs()` (87) digits and marks, `_letters()` (136) uppercase, `_lower()` (214) lowercase, built from `_arc`, `_bez`, `_join`, `_dot`, `_rot180` helpers, then flattened to polylines at import (`GLYPHS = _glyphs()`, line 285: dict ch -> (advance, [Stroke])). 70 glyphs: `0-9 : . - ° % ' !`, space, A-Z, a-z.
- `text(s, height, cx, cy)` (294) lays out and centres; `width(s)` (288). `_title` in figures.py:1521 sanitises (NFKD, drop accents/emoji).
- **Portable as data: yes.** I flattened the real GLYPHS locally: 4020 points, 55 KB JSON at 3 decimals; with Douglas-Peucker at tol 0.002 it is 1537 points, **~21 KB** (about 8 KB gzipped). Recommend a generated `alfie-font.json` `{ch: [advance, [[ [x,y],... ], closed?]]}` plus ~25 lines of JS layout (`text`, `width`). Smoother option: keep arcs/beziers as parametric commands (~15 KB, needs ~60 lines of JS to flatten); not worth it, canvas can draw 21 KB of polyline fine, and the polyline can be drawn as quadratic-smoothed path if corners show. Dots are tiny closed loops with `_DOT_WEIGHT=2`: in canvas draw as filled dots.
- Closed-vs-open flag must be kept per stroke (digit 0, dots).
- Generation script: run xy/font.py locally once (stdlib only) to dump JSON; commit script under `tools/`.

## 3. Screens

Inputs in xy-bench are pushed by HA by name; the feeder (xy_scope/feeder.py) shows the HA source. Alfie entity pickers replace the names.

### 3a. Plot (xy `plants` figures.py:973, `temp_week` 999, shared `_two_lines` 921-970)
- Functions: `_two_lines`, `_labels` (909, label de-overlap), views `curve/axis/chart2/marker/nice_ticks/span/series`.
- Inputs: 1..N numeric series evenly spaced oldest-first (null = gap), span (xy: plants 14 d bucketed to 56 pts; temps 3 d of 7 d at 36 pts), fixed `top`, unit, decimals, marker per series, solid or dotted.
- Alfie source: **recorder history over HA WebSocket** `history/history_during_period` (minimal_response, no_attributes, `significant_changes_only: false` for sensors) from the card/panel using the user's own auth; or `recorder/statistics_during_period` (hourly mean, cheaper, for long spans). xy feeder uses `recorder.history.state_changes_during_period` server-side in an executor (feeder.py:332-360), refreshed hourly (`HISTORY_INTERVAL`).
- Light-for-a-Pi: do the history read **server-side in the integration at low rate** (hourly, executor, bucket-average to <=60 points per series, cache), and push only the small bucketed arrays in the scene state (a few hundred bytes/series). Do not let each card open fetch full history. WS statistics API (hourly) is the fallback if the recorder is excluded.
- Port: `_two_lines` + helpers ~80 lines JS on top of views. Generalise from 2 series to N (colour/marker per series; customised range/span/ticks/min_span/pad are options). Easiest and highest value.

### 3b. Bars and single value (xy `_plants` is lines; `views.bars` views.py:257; readout views.py:85)
- No dedicated xy bars screen: `bars()` is used inside weather (rain). Single value = `readout(value,h,cx,cy,unit)` + icon (leaf, drop, house). New in Alfie: compose a "value" template (big readout + icon) and a "bars" template (N entities, e.g. soil moisture).
- Source: current entity states (the engine already listens to `state_changed` for signals; add screen entities to the filtered watch list). Zero extra load.
- Port: ~40 lines on top of views.

### 3c. Weather (figures.py:808-906 `_weather`, `_pairs_max` 818, `_smooth` 828; icon views.py:440)
- Inputs: outside temp now, `weather_now.condition` (HA condition string), `forecast_temp` (24 hourly), `forecast_rain` (24 hourly precipitation_probability), sun elevation (night icon).
- Alfie source: `weather.*` entity state (condition, temperature attribute) for now; forecast via the **`weather.get_forecasts` service** (type hourly, `return_response`), as the feeder does (feeder.py:307-330), throttled (`FORECAST_MIN_INTERVAL`, refetch on weather entity update, force hourly). Note: met.no hourly has no precipitation_probability, fall back to `precipitation` amount bars. Server-side, cached. Sun night: `sun.sun` elevation attribute.
- Port: ~120 lines + icons. Medium.

### 3d. Home clock (figures.py:656 `_digits`? no: `_small_clock` 694-788, `_daylight` 678, `_home` 789-806)
- Analogue clock: rim with quarter ticks, hour/minute hands, solar rim (bright arc when sun is up over the next 12 h, `_RIM_DAY/NIGHT_WEIGHT`), seconds bead; plus inside and outside temp readouts and house icon with smoke.
- Inputs: `inside_temp`, `outside_temp` (entity states), sun rise/set as local hours (feeder.py:130 from `sun.sun` attrs `next_rising`/`next_setting`, with care that after sunrise "next" is tomorrow), local time (browser clock).
- Clock hands/bead are animated per frame in the browser (free, no HA traffic). Solar rim recomputed per minute.
- Port: ~120 lines. Easy; the bead and smoke are canvas-friendly (the "hold still because of the planner" rules do not apply, so the weather icon can animate too).

### 3e. Sky (figures.py:1014-1190: `moon_phase` 1014, `_moon` 1019, `_sun_mark` 1033, `_clock_text` 1047, `_sky_xy` 1063, `_moon_pass` 1073, `_sky` 1104)
- Draws a top-down sky disc: horizon + compass ticks, 30/60 degree rings, sun (ring with rays) and moon (phase) at alt/az, dotted sun path today, dotted moon pass, rise/set times as text.
- Needs: lat/lon (HA `hass.config` / `zone.home`, or `device_tracker`), sun and moon alt/az over time, moon phase, sunrise/sunset times.
- Source options: (a) `sun.sun` entity gives elevation/azimuth/next rise/set but not the day path and nothing for the moon; (b) HA `moon` integration gives phase only; (c) **compute ephemeris in the card in JS** from `xy/sky.py`: it is stdlib-only Schlyter low-precision formulas (357 lines incl. 94-line constellation table, so ~260 lines of maths), accurate to a fraction of a degree, and trivially portable to JS (pure floats, no numpy/ephem/skyfield). Cost per evaluation is microseconds; the day path (~48 samples) and moon pass (`_moon_pass` steps 600 s) are computed once per minute/hour, not per frame. This needs no HA traffic and no server state. Recommended.
- Port: sky maths ~220 lines + screen ~150 lines JS. Medium.

### 3f. Stars / constellations (figures.py:1191-1400: `_stars_xy` 1209, `_star_r` 1225, `_figure` 1229, `_planet_mark` 1256, `_horizon` 1303, `_best_facing` 1310, `_stars` 1326, `_stars_drawing` 1349)
- Window view: stick-figure constellations, five planets with distinct marks, moon in phase, over a horizon; facing south, or "turning" to whichever bearing has most in view (scored every `_STARS_SLOT=900` s, step 15 degrees). Projection: 60 degree FOV, `_stars_xy`.
- Needs: lat/lon, time, planets/moon/stars alt-az (sky.py `stars`, `planet`, `moon`, `_precessed`), constellation data.
- Data: **no external catalogue, no skyfield/ephem/numpy.** `CONSTELLATIONS` is an inline table in sky.py:264-357: 23 constellations, 286 vertices (J2000 ra, dec, mag), 6.5 KB JSON, from d3-celestial (BSD) with faint stars trimmed. Ship as `alfie-constellations.json` or inline JS; **attribute d3-celestial BSD** in the repo (public repo). Planet orbital elements `_ELEMENTS` (sky.py:157) are a small inline dict.
- The xy "budget" loop that drops constellations once the beam is full (`used + cost <= budget`) is irrelevant on canvas; instead make "number of constellations" an option (list is already ordered by prominence). Could add star dots (magnitude -> radius via `_star_r`) cheaply since the table has mags.
- Pi-lightness: all in browser, recomputed once per minute (`int(t//60)` cache key as xy does), the turning-facing search once per 15 min. ~300 stars worth of trig: negligible.
- Port: ~200 lines JS + 6.5 KB data. Medium. Reuses 3e maths.

### 3g. Map / streets (figures.py:1400-1515 `_car_map`; xy/streets.py 323 lines)
- Streets around device trackers, markers (diamond/ring, with an initial letter via the font), house at home location, second tracker pinned to the edge if far; auto-picks the largest radius that fits (`_MAP_RADII`) — in Alfie replace by a fixed/option radius (or auto by street count).
- streets.py: `StreetCache` (55-134: memory, disk JSON per ~100 m cell at `data/streets/v2_<lat>_<lon>.json`, background fetch thread, 10 min retry after failure), `_overpass` (135-158, one query: highway classes + alleys, `out geom`, radius `FETCH_RADIUS=520` m, polite User-Agent), `_project` (159), `_clip_segment/_clip` (168-210), `_simplify` (212, Douglas-Peucker), `trails` (235-290, **joins segments into few long strokes: a beam-tour optimisation, drop it**), `street_cost` (drop), `drawing` (301), `metres` (320). `_WEIGHTS` (36) maps road class -> weight (-> line width/alpha).
- Source: coordinates from `device_tracker.*` (`latitude`/`longitude` attrs) and `zone.home`; streets from Overpass.
- Where it runs: **server-side in the integration, never in the browser** (one fetch per cell, `aiohttp` via HA's shared session instead of urllib/threads, persisted via HA `Store` or a JSON file in the config `.storage`/ custom dir, in-memory dict, retry backoff, rate limit and User-Agent per Overpass policy). Send the card the already-clipped, simplified polylines (a few KB per cell, RDP tol ~0.008 canonical), not raw geometry. Projection (`_project`) and clip can also be left to the card if the raw cell is sent once and cached in the card. Simplest: server returns simplified lat/lon ways per cell via WS command `alfie/streets {lat, lon}`; card projects/clips (cheap).
- Port: ~120 lines Python (aiohttp fetch + cache + simplify) + ~100 lines JS (project/clip/place/markers). Medium-hard (network, cache, error states).
- Privacy note: device_tracker coordinates go to Overpass only as a ~100 m rounded cell centre (xy `_CELL=3` decimals). Keep that; document it and make it an option.

### 3h. Text / names (figures.py:1517-1580: `_title`, `_wrap`, `_set_title`, `_birthday`)
- Word-wrap and shrink-to-fit of a title in the vector font (`_BDAY_MAX_H=0.2`, pitch 1.6, max 0.85 half height), one screen per title.
- Source: **calendar entities**: xy push is `birthdays` list from calendar events today. In Alfie: server-side `calendar.get_events` service (return_response) for chosen calendars, or calendar entity's current `message` attribute (zero cost, only the active/next event). Refresh at midnight and on calendar `state_changed`. Output: list of titles for today.
- Also usable for any entity text state. Letters exist only in the font (A-Za-z `'` `!` and digits); `_title` drops everything else (emoji, accents -> NFKD, JS `String.normalize('NFKD')`).
- Port: ~50 lines JS. Easy (once the font is in).

## 4. Intros and transitions (xy/intros.py, 388 lines)

Model: `effect(style, t, leaving)` -> `Effect(style, presence 0..1 (can overshoot >1 via `_back` ease), leaving)`; an exit is the intro with presence reversed; slide/wipe/flip keep direction when leaving. Durations in `SECONDS` (0.9-1.8 s; draw/stagger use per-screen `DRAW_IN`, figures.py:67; outro = `OUTRO_SHARE` 0.6 of intro). `pick()` (58) selects, `random` picks any; `ARRIVALS` forces `condense` for the face.

Drawing-level (operate on strokes; easy in JS, `shape()` intros.py:97-148, helpers `_map/_xrange/_centre/_clip_x/_insert`):
- `draw`: strokes written along their length (`planner.reveal`, frac).
- `stagger`: draw, strokes start one after another.
- `zoom`: scale about centre with overshoot (`_back`).
- `power_on`: bright horizontal line then opens vertically (CRT warm-up); reverse = squash to dot.
- `slide`: enters from the left, leaves to the right (x clipped to the screen).
- `flip`: card rotating about the vertical axis with perspective.
- `wipe`: bright vertical edge sweeps left to right, revealing (or hiding) the picture.
- `tune`: sinusoidal wobble that dies out (station tuning).

Sample-level (operate on the beam's planned samples; **need re-expression in canvas**), `finish()` intros.py:238:
- `fade`: dimmer (xy spends the frame off-tube) -> in canvas simply globalAlpha = presence (trivial).
- `materialise`: dots close up into lines (each run of k samples held on its first) -> in canvas: draw resampled points as dots with a dash/gap shrinking, or dash pattern animating from dots to solid. Needs a polyline resampler (~25 lines).
- `condense`: every sample drifts in from a fixed field of 4096 seeded dust points (`_DUST`, rng seed 1729), swirling, stragglers last (`_condense`, 323-346) -> in canvas: resample strokes to ~N points and interpolate from the seeded dust field. Needed for the face arrival, so likely the face already approximates it; reuse.
- `morph`: blend two frames sample by sample after `align()` (348-366, cyclic shift + direction by coarse-cost search); needs the strokes resampled to equal point counts (concatenate strokes by length, resample to K points, lerp). ~50 lines JS. Hardest transition; also the nicest for the "Alfie presents a screen" choreography.
- Port size: shape() ~60 lines, sampled ones ~120 lines JS including a resampler/`reveal` (~50). Total ~230 lines.

Shared with the "rotation display mode": figures.py `intro_seconds` (83), `DRAW_IN` table, `IN_ORDER`.

## 5. Sizes and dependencies summary

| Item | xy lines | JS estimate | Dependencies | Where |
|---|---|---|---|---|
| views + icons | 559 | ~380 | none | card JS |
| font | 311 | ~40 + 21 KB JSON | none (generate data once) | card JS + JSON |
| plot/value/bars | ~100 | ~120 | history from HA | card + server history task |
| weather | ~165 | ~130 | `weather.get_forecasts` | server fetch, card draws |
| home clock | ~180 | ~130 | sun.sun, temp entities | card |
| sky maths | 357 (263 w/o table) | ~230 | none (stdlib math only) | card |
| sky screen | ~180 | ~160 | sky maths, lat/lon | card |
| stars screen | ~210 | ~200 + 6.5 KB JSON | sky maths, table | card |
| map | 115 + 323 | ~100 JS + ~130 Py | Overpass, device_tracker | server fetch/cache, card draws |
| text | ~65 | ~60 | font, calendar | server (calendar.get_events), card |
| intros | 388 + reveal 50 | ~230 | none | card |
| **Total** | ~3000 | **~1800 JS + ~150 Py** | **No numpy, skyfield, ephem, or star catalogue needed** | |

No build step needed: all of it is plain ES module math; data as JSON files served from the integration's static path (card JS edits are uncached in the dev loop; bump `?v=` for release). Constellation JSON could instead be inlined into a JS module to save a request.

## 6. Which parts must be computed server-side (Pi rule)

- Recorder history (executor, hourly, bucketed, cached): plots.
- Forecast service call (throttled, on weather update + hourly): weather.
- Overpass fetch + disk/Store cache + simplify: map.
- Calendar events for today: text.
- Everything else (clock, sun/moon/planets/stars, all drawing, all transitions) in the browser, with the existing fps cap and pause when hidden/off screen. Cards for screens that are not showing should cost nothing (no per-frame ephemeris; recompute per minute).
- Scene state stays small: send each screen's compact data (a few hundred bytes to a few KB) only when it changes, never per frame; keep bulky arrays in `_unrecorded_attributes` or only over WS, as done for the face.

## 7. Suggested port order

1. Shared base: Stroke list conventions, font JSON + `text/width`, views helpers/markers/axis/curve (needed by all).
2. Home clock + single value + bars (entity states only, no new data plumbing, immediate visual win, validates font/icons on canvas).
3. Draw/zoom/slide/fade/power_on/wipe/tune/flip intros and the screen rotation mode (cheap, high visible payoff; do `reveal` here).
4. Plot (history plumbing server-side, N series; uses 1-2).
5. Weather (forecast service plumbing + icons).
6. Text/names (calendar plumbing).
7. Sky maths + Sky screen, then Stars (pure browser; table + attribution).
8. Map (Overpass server cache; most plumbing and failure modes).
9. Resample-based intros: materialise, condense, morph (need the resampler; morph is the one needed for presenting choreography, which needs Lukas's input first).

## 8. Risks

- **Planner assumptions leaking into layouts**: xy layouts were tuned to a stroke budget (labels, tick counts, readouts as bare numbers, weather icons held still because of tour shimmy). In canvas these constraints vanish; keep proportions but allow richer options (animated icons) deliberately, and decide whether to keep the "no rest of unit labels" rule.
- **Dimensions**: xy screens use a [-1,1] canvas with `half_w` (aspect) 0.81-0.9 for the tube. Alfie cards are arbitrary aspect and Alfie "presents beside" the face: layouts need a `half_w`/`half_h` parameter and probably a text-size floor. Presenting choreography is deliberately open (discuss with Lukas).
- **Font fidelity**: RDP-simplifying glyphs at 0.002 may show corners at large size; check at 200 px caps. Fallback is the 55 KB unsimplified data (or resample the original arcs).
- **Overpass**: rate limits, timeouts (query timeout 30 s, request 60 s), outages; need a visible "no streets yet" state (xy shows markers only), retry backoff (xy 600 s), a configurable endpoint, and a clear note that rounded coordinates leave the house. Privacy of device_tracker position.
- **History**: recorder may exclude entities or be large; sensors with unavailable/unknown gaps (xy treats as None bridged); statistics vs state-history difference for non-measurement sensors.
- **Forecast**: provider differences (met.no has no rain chance; legacy `forecast` attribute removed, `get_forecasts` needs `supported_features`), some providers don't support hourly.
- **Sun path/day rim edge cases**: `next_rising`/`next_setting` after sunrise point to tomorrow (feeder.py:130 has the workaround); polar day/night; hemisphere/timezone: use HA's `time_zone` in config, not the browser's, when they differ.
- **Ephemeris accuracy**: low-precision formulas are good to a fraction of a degree, fine for drawing; moon pass uses 10 min steps. Test JS against xy `sky.py` outputs (golden values) in `tests/`.
- **Constellation attribution** (d3-celestial BSD) in a public repo.
- **Morph/materialise/condense are look-dependent**: these were tuned on a scope; they may need re-tuning for canvas and for each render style (CRT, neon).
- **Perf on tablets/Companion app**: stroke counts are small, but glow/phosphor render styles multiply cost; the fps cap and pause-when-hidden rules must apply to screen animations too (clock bead, smoke, intros).
- **Test scale**: add node tests like `tests/face.test.mjs` for the pure functions (font layout, sky maths vs golden, view helpers, intro endpoints: presence 1 equals the finished drawing, presence 0 stays non-empty).
