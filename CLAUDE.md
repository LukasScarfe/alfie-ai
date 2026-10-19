# CLAUDE.md: Alfie

Alfie is a public Home Assistant app: a small, lively vector face (a ring and two eyes) that is the
visible soul of the smart home. He reacts to motion, house events and voice conversations, his mood
follows good and bad signals the user picks, and he presents data screens (plots, weather, sky,
map) on a dashboard card. One HACS integration holds the engine, an admin editor panel and a
bundled card. It grew out of the "Superintendent" face on Lukas's oscilloscope display (xy-bench).

- **What to build:** [docs/design.md](docs/design.md), which holds everything agreed with Lukas.
- **How and in what order:** [docs/plan.md](docs/plan.md), a checklist of milestones.
- **Where the last agent left off:** [docs/handoff.md](docs/handoff.md).

## "Continue development"

When asked to continue, or to work on this project without a specific task, follow **"How an agent
continues development"** at the end of [docs/plan.md](docs/plan.md):

1. Read handoff.md.
2. Resume the `[~]` step, or pick the first `[ ]` step whose requirements are met.
3. Claim it, implement it, and get the tests green.
4. Tick it, rewrite handoff.md, commit and push.

Only one agent works on this repo at a time.

## Hard rules

- **Lots of options.** Lukas wants a large, option-rich app. Where a reasonable choice exists, make
  it a user setting with a good default, not hard-coded behaviour.
- **Never block HA's event loop.** All engine code is async; anything heavy goes to an executor.
- **Light enough for a Raspberry Pi.** Alfie must never bog down a small HA server. No polling
  loops, and no per-change scans of every state: listen with filtered events and resolve what you
  watch once. Entities write state (each write is a recorder row) only when something real
  changes, never for an animation, and bulky attributes stay `_unrecorded_attributes`. Cache any
  network fetch (Overpass, history). The card renders in the browser and also stays frugal: a
  frame-rate cap, and no drawing while hidden or off screen. See design.md "Resource budget".
- **Develop against a throwaway dev HA on raccoon**, not production HA (`192.168.1.217`). Reading
  production state is fine. Changing production (installing, editing automations, dashboards,
  voice pipelines) needs Lukas's OK first.
- Tooling runs in containers or a `./dev` wrapper. Don't install packages on the raccoon host.
- Commits are authored as Lukas Scarfe <lukas.scarfe@gmail.com>, with **no Claude attribution**
  (no Co-Authored-By trailer, no session link, no "Generated with" footer), in commits, PRs and
  releases. The repo is public.
- Discuss with Lukas before building how Alfie presents a screen (choreography, sizing). It's
  deliberately left open.
- Show visual results: render the card or face to a PNG and send it rather than describing it.
- Keep design.md current. When a decision is made, edit it in place.

## Dev loop

A throwaway HA 2026.10 runs on raccoon as container `alfie-dev-ha`, at
`http://192.168.1.241:8125` (user `dev` / `devpass1234`). `custom_components/alfie` is
bind-mounted read only. Everything goes through `./dev`; run it with no arguments for the list.

```bash
./dev up && ./dev wait     # start; first time also: ./dev onboard && ./dev add
./dev seed                 # fake Lukas's house entities (they vanish on restart)
./dev state sensor.fineoffset_wh51_0ee63f_moisture 12   # poke a signal
./dev restart && ./dev wait && ./dev seed               # after Python edits
./dev errors               # alfie/error lines from the HA log
./dev test                 # pytest + the node face check, in containers
./dev face [query] [out]   # the card alone (devenv/harness.html) to PNG, no HA needed
./dev shot [path] [out]    # a dev HA page to PNG, logged in, via headless Chrome
```

Card JS edits only need a page reload (the static path is uncached). Python edits need
`./dev restart`. PNGs land in `devenv/out/` (gitignored). The xy-bench reference renders of the
12 moods are in `docs/reference/`.

## Finishing a change

1. `./dev test` is green, and `./dev errors` is clean after a restart.
2. For anything visual, render it with `./dev face` or `./dev shot` and send Lukas the PNG.
3. Tick plan.md, rewrite handoff.md, then commit (as Lukas, no attribution) and push.

Releases are HACS versions: bump `manifest.json` `version`. The card URL's `?v=` comes from it
automatically.
