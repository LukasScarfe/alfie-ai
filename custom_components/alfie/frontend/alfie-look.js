// The card's look precedence as one pure function (see docs/screens-contract.md).
// A key in the card's own config wins, then the scene's `look` (empty or null
// values skipped), then the card's DEFAULTS.

export const LOOK_KEYS = ["style", "ring_color", "eye_color", "background", "text_color", "accent_color",
  "line_width", "screen_line_width", "glow", "eye_fill", "padding", "shapes"];

const empty = (v) => v === undefined || v === null || v === "";

export function effectiveConfig(defaults, look, user) {
  const out = { ...defaults };
  if (look && typeof look === "object") {
    for (const [k, v] of Object.entries(look)) {
      if (empty(v) || !LOOK_KEYS.includes(k)) continue;
      out[k] = v;
    }
  }
  if (user) for (const [k, v] of Object.entries(user)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

// Card YAML from before config v4 (design.md "Words"): `mode` is now
// `display`, `face_color` is `ring_color`. The new key wins when both are set.
const OLD_KEYS = { mode: "display", face_color: "ring_color" };

export function renameOld(config) {
  const out = { ...config };
  for (const [old, now] of Object.entries(OLD_KEYS)) {
    if (!(old in out)) continue;
    if (out[now] === undefined) out[now] = out[old];
    delete out[old];
  }
  return out;
}

// A cheap change key for a look: scenes arrive often, a look rarely changes.
export const lookKey = (look) => (look ? JSON.stringify(look) : "");
