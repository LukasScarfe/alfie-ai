# Spec: who's talking, private profiles, "not for me" (from the raccoon session, 2026-11-04)

Lukas approved this plan in the raccoon session; the raccoon / Hermes / HA side is built and
live. This is the Alfie-integration part, handed to this repo's session. Build every behaviour
below as an option in Alfie's panel (Voice → Brain → Agent server), off or "house only" by default,
so a setup without these pieces works as today.

## What already exists (don't rebuild)

- **Hermes profiles**, one gateway on raccoon `:8642`:
  - house (default): `http://192.168.1.241:8642/v1/chat/completions`, current key. Unknown voices.
  - Lukas: `http://192.168.1.241:8642/p/lukas/v1/chat/completions`, own key
  - Michelle: `http://192.168.1.241:8642/p/michelle/v1/chat/completions`, own key
  Each key works only for its own path (401 otherwise). Keys are in
  `~/Documents/hermes-home/hermes/profiles/<name>/.env` (`API_SERVER_KEY`) and, as
  `"Bearer …"`, in HA `secrets.yaml` (`alfie_hermes_key_<name>`). Never print them.
  Each profile has its own memory; AGENTS.md (shared) tells private profiles not to repeat
  anything to others, and to answer health/money/other-person topics by `notify` when spoken.
- **alfie-ears** on raccoon: a Wyoming proxy in front of Whisper (HA's STT is unchanged). For
  each voice request it saves a verdict *before* HA receives the transcript:
  `GET http://192.168.1.241:8794/api/last` →
  `{speaker: lukas|michelle|tv|unknown, profile: "lukas"|"michelle"|"", confidence, scores,
  addressed (0-1, "meant for Alfie"), drop (bool), watch_only (bool), clip_id, text,
  heard_at (ISO), heard_ts (epoch s)}`.
  `profile` is only set when ears' own threshold and margin are met (tunable on its page,
  `:8794`). `drop` is only ever true once Lukas turns enforcement on there (watch-only now).
  No auth; LAN only.
- **Phone replies** are HA-side (automation `alfie_notification_reply`), not this integration.

## What to build

1. **Profiles option.** A list of people: HA user id, display name, agent URL (or path), API key.
   Today's values: Lukas `5bf5249eea894ea79000729a42183968` → `/p/lukas/`; Michelle
   `d34ca71d51f54c46af594be22f56e6a6` → `/p/michelle/`. The existing agent URL/key stay the house
   profile.
2. **Typed chat → the typing person's profile.** `user_input.context.user_id` → that person's
   endpoint and key. Memory scope header `X-Hermes-Session-Key: alfie:user:<name>`. No match →
   house, as now.
3. **Voice → recognised person's profile.** On a voice turn (`satellite_id`/`device_id` set),
   GET ears `/api/last` (timeout ~0.5 s; any failure → house). Use it only if `heard_ts` is within
   a freshness window (option, default 15 s) and its `text` matches `user_input.text` after
   normalising. Route to `profile` when it is set, the "use voice identity" option is on, and
   `input_boolean.guest_mode` is off (option: "Guest Mode = house only", default on). Add one line
   to the turn's system note: "You are speaking with <Name>, recognised by voice, in a shared room."
   Memory scope `alfie:voice:<name>`. Keep `where` and time in the note as now.
4. **"Not for me."** If the verdict is fresh and `drop` is true, and the option "drop turns not
   meant for Alfie" is on, end the turn with no agent call and no speech (empty response). Show it
   on the face if there's a fitting reaction (option). Log it so it's visible in the turn history.
5. **Fallback.** A private profile that fails or times out falls back exactly like the house agent
   does today (the delegate). Never fall back from a private profile to the house profile with the
   private context.
6. **Expose for dashboards (nice to have):** the last turn's routed profile and ears verdict as
   attributes on an existing Alfie sensor.

## Tests (no notifications to Michelle; read-only phrases only)

- Typed chat as Lukas reaches `/p/lukas/` (check Hermes: `docker exec hermes hermes profile list`
  / its sessions), as an unmapped user reaches house.
- Voice with a stale or mismatched `/api/last` → house. With ears down → house, no delay beyond
  the timeout.
- With `drop: true` faked (enforce on and threshold 1.0 on the ears page, then reset), the turn is
  silent.
