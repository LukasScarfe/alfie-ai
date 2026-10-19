// Build time: every mdi icon name to its SVG path (mdi.json), for the card's
// ALFIE_ICONS hook, since a headless page has no HA <ha-icon> to ask.
const fs = require("fs");
const dir = require("path").dirname(require.resolve("@mdi/svg/meta.json"));
const out = {};
for (const { name, aliases = [] } of require("@mdi/svg/meta.json")) {
  const svg = fs.readFileSync(`${dir}/svg/${name}.svg`, "utf8");
  const d = /\sd="([^"]+)"/.exec(svg)?.[1];
  if (!d) continue;
  for (const n of [name, ...aliases]) out[`mdi:${n}`] = d;
}
fs.writeFileSync("mdi.json", JSON.stringify(out));
console.log(`mdi.json: ${Object.keys(out).length} names`);
