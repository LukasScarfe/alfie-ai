// The card's look precedence as one pure function (see docs/screens-contract.md).
// A key in the card's own config wins, then the scene's `look` (empty or null
// values skipped), then the card's DEFAULTS.

export const LOOK_KEYS = ["style", "ring_color", "eye_color", "background", "text_color", "accent_color",
  "line_color", "line_width", "screen_line_width", "glow", "eye_fill", "padding", "aspect", "shapes"];

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

// Render styles by name, as the panel and the card editor list them.
export const STYLE_TEXT = { neon: "Neon", flat: "Flat", crt: "CRT", theme: "Theme colours", blueprint: "Blueprint",
  chalk: "Chalk", ink: "Ink on paper", pastel: "Pastel" };

// Themes: a style and its colours in one go (design.md "Card"). Picking one
// fills these keys; any of them can still be changed after. "" is the style's own.
export const THEME_KEYS = ["style", "ring_color", "eye_color", "background", "text_color", "accent_color", "line_color"];
const own = (style) => ({ style, ring_color: "", eye_color: "", background: "", text_color: "", accent_color: "", line_color: "" });
export const THEMES = {
  classic: { text: "Classic", ...own("neon") },
  amber: { text: "Amber CRT", style: "crt", ring_color: "#ffb000", eye_color: "#ffcc4d", background: "#140b00",
    text_color: "#ffd27a", accent_color: "#ff7a00", line_color: "#ffb000" },
  ocean: { text: "Ocean", style: "neon", ring_color: "#4fc3f7", eye_color: "#e1f5fe", background: "#071a26",
    text_color: "#b3e5fc", accent_color: "#ffca28", line_color: "#4fc3f7" },
  sunset: { text: "Sunset", style: "neon", ring_color: "#ff7e5f", eye_color: "#ffd3a5", background: "#24142b",
    text_color: "#ffe8d6", accent_color: "#ffd166", line_color: "#ff9f80" },
  mono: { text: "Mono", style: "flat", ring_color: "#ffffff", eye_color: "#ffffff", background: "#000000",
    text_color: "#ffffff", accent_color: "#9e9e9e", line_color: "#ffffff" },
  blueprint: { text: "Blueprint", ...own("blueprint") },
  chalkboard: { text: "Chalkboard", ...own("chalk") },
  paper: { text: "Paper", ...own("ink") },
  candy: { text: "Candy", ...own("pastel") },
};

// The theme a look is wearing now, or "" when its colours are its own.
export function themeOf(look) {
  const val = (k) => (k === "background" && look?.[k] === "none" ? "" : look?.[k] ?? "");
  return Object.keys(THEMES).find((t) => THEME_KEYS.every((k) => (THEMES[t][k] ?? "") === val(k))) || "";
}
