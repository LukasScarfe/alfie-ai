// The panel's icon suggestions (panel/icon-picker.js): ranking and word replacement.
// Run by ./dev test under node; no packages needed.
import * as P from "../custom_components/alfie/frontend/panel/icon-picker.js";

let failures = 0, checks = 0;
function eq(a, b, what) {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) { failures++; console.error(`FAIL ${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
}

const LIST = [
  { name: "account-group", keywords: ["people"] },
  { name: "account", keywords: ["person", "user"] },
  { name: "plex", keywords: ["media"] },
  { name: "lightbulb-on", keywords: ["light", "idea"] },
  { name: "ceiling-light", keywords: ["lamp"] },
  { name: "leaf", keywords: ["plant", "nature"] },
];

// Names starting with it (shortest first), then containing it, then keywords.
eq(P.matchIcons(LIST, "acc"), ["mdi:account", "mdi:account-group"], "prefix, shortest first");
eq(P.matchIcons(LIST, "light"), ["mdi:lightbulb-on", "mdi:ceiling-light"], "prefix before contains");
eq(P.matchIcons(LIST, "plant"), ["mdi:leaf"], "keyword match");
eq(P.matchIcons(LIST, "people"), ["mdi:account-group"], "keyword only when the name misses");
eq(P.matchIcons(LIST, "mdi:ple"), ["mdi:plex", "mdi:account-group"], "mdi: prefix is ignored");
eq(P.matchIcons(LIST, "MDI:Leaf"), ["mdi:leaf"], "any case");
eq(P.matchIcons(LIST, "ceiling light"), ["mdi:ceiling-light"], "spaces read as hyphens");
eq(P.matchIcons(LIST, "hass:acc"), [], "another icon set: no suggestions");
eq(P.matchIcons(LIST, "  "), [], "nothing typed");
eq(P.matchIcons(LIST, "a", 2).length, 2, "capped at n");

// Words end at spaces, commas and |; only the word at the caret changes.
eq(P.wordAt("ring, mdi:acc", 13), { start: 6, end: 13, word: "mdi:acc" }, "word after a comma");
eq(P.wordAt("mdi:pl Viewers", 3), { start: 0, end: 6, word: "mdi:pl" }, "caret mid-word");
eq(P.replaceWord("ring, mdi:acc", 13, "mdi:account"), { text: "ring, mdi:account", caret: 17 }, "marker list");
eq(P.replaceWord("mdi:pl Viewers", 6, "mdi:plex"), { text: "mdi:plex Viewers", caret: 8 }, "text keeps the rest");
eq(P.replaceWord("a|mdi:le|b", 8, "mdi:leaf"), { text: "a|mdi:leaf|b", caret: 10 }, "fixed texts split by |");

console.log(`iconpick: ${checks - failures}/${checks} ok`);
if (failures) process.exit(1);
