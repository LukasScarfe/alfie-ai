# Alfie: handoff

**Milestone 0 done, milestone 1 claimed** (2026-10-18).

- design.md now has the scene-state format and the exact defaults ported from production HA.
- The dev loop works: `./dev up`, onboard, seed, test, shot and sheet. The dev HA at :8125 is
  onboarded and has no Alfie config entry yet.
- `custom_components/alfie/` is still empty.

Next: the M1 steps in plan.md, starting with the integration skeleton.

Gotchas:
- The dev directory is `devenv/`, not `dev/`, because `./dev` is the wrapper script.
- Fake entities made with `./dev seed` or `./dev state` vanish on an HA restart. Re-seed after
  `./dev restart`.
- A first `./dev shot` after HA starts can catch the "Loading…" splash. Pass `--wait 8000`.
- The headless Chrome is 124 (2024), and the HA 2026.10 frontend renders fine in it.
