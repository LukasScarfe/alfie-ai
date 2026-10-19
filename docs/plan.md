# Alfie: plan

Milestones in order. `[ ]` todo, `[~]` in progress (claimed), `[x]` done. Each milestone is broken
into smaller steps by the agent that claims it (in plan mode, with Lukas's OK) and recorded here.

- [ ] **0. Ground truth.** Read xy-bench (face, moods, animations, screens, intros) and the current
      HA mood/automation YAML. Settle the scene-state format (open question 1) and the dev loop: a
      dev HA container on raccoon in the ha-sun-beams style, the test command, and how to screenshot
      the card. Update design.md and CLAUDE.md "Finishing a change".
- [ ] **1. Living face (first win, on the tablet).** Integration skeleton, the card auto-registers,
      the face renders with all 12 expressions and 20 animations, mood comes from a hard-coded set
      of good/bad signals, motion gaze works. Shown on the real tablet.
- [ ] **2. Signals and personality.** Panel page for signals (entity / operator / value, severity,
      linked screen), the combine-mode options, mood levels, personality presets.
- [ ] **3. Screens.** Port the templates to JS (plot, bars/value, weather, home clock, sky, stars,
      map, text) with entity pickers, add the rotation display mode and transitions.
- [ ] **4. Triggers and stories.** Trigger config (any entity, per-motion-sensor actions, mood
      changes, signal crossings), the fill-in story template and the advanced sequence builder, the
      default mood-change, bad-news and celebrate stories. Presenting choreography agreed with
      Lukas first.
- [ ] **5. House modes.** Night, away, guests and user-defined modes with overrides.
- [ ] **6. Voice.** React to all `assist_satellite` states, the what's-wrong LLM tool and intent,
      optional persona, mood-aware replies, TTS announcement step.
- [ ] **7. Editors and polish.** Shape, expression and animation editors; card render styles and
      themes; the why panel; standard tap actions.
- [ ] **8. Release.** HACS packaging and README, install on production HA (with Lukas), put it on
      `tablet-dash`. Retire the old Superintendent HA automations only with Lukas's OK.

## How an agent continues development

1. Read `docs/handoff.md`, then the relevant parts of `docs/design.md`.
2. Resume the `[~]` milestone, or claim the first `[ ]` one (mark it `[~]`, commit).
3. For a new milestone, plan it in plan mode and get Lukas's OK, then add its steps here as a nested
   checklist.
4. Implement against the dev HA. Keep tests green. Show Lukas visual results as images.
5. Tick what's done, rewrite `docs/handoff.md` (state, next step, gotchas), and commit as Lukas
   Scarfe with no Claude attribution. Push.
