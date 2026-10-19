// The text screen: matching, its say in a rotation, and cycling from when it came in.
import fs from "node:fs";
import * as S from "../../custom_components/alfie/frontend/alfie-screens.js";
import T, { titles } from "../../custom_components/alfie/frontend/screens/text.js";

let failures = 0, checks = 0;
function check(ok, what) {
  checks++;
  if (!ok) { failures++; console.error(`FAIL ${what}`); }
}
S.setFont(JSON.parse(fs.readFileSync(new URL("../../custom_components/alfie/frontend/alfie-font.json", import.meta.url))));

const o = { source: "calendar", days: 1, events: "all", template: "{name}", seconds: 6, max_lines: 4, size: 0.3, empty: "--",
  match: "", skip_empty: false, extend: true };
const data = { events: [{ t: "Mum's Birthday", a: true, d: 0 }, { t: "Bin day", a: true, d: 0 }, { t: "Tom birthday", a: true, d: 0 }] };

check(titles(o, data, {}).length === 3, "no match: every title");
check(JSON.stringify(titles({ ...o, match: "BIRTHDAY" }, data, {})) === JSON.stringify(["Mum's Birthday", "Tom birthday"]), "match is any case");
check(titles({ ...o, match: "bin, tom" }, data, {}).length === 2, "match takes several words");
check(titles({ ...o, source: "fixed", fixed: "a|birthday b", match: "birthday" }, null, {}).length === 1, "match on fixed text too");

const say = (opts, d = data) => T.rotation({ data: d, options: opts, states: {}, S });
check(JSON.stringify(say({ ...o, match: "birthday" })) === JSON.stringify({ skip: false, seconds: 12 }), "two birthdays at 6 s: a 12 s turn");
check(say({ ...o, extend: false }).seconds === 0, "extend off: the step's own seconds");
check(say({ ...o, match: "party", skip_empty: true }).skip === true, "nothing matching: skipped");
check(say({ ...o, match: "party" }).skip === false, "skip_empty off: shown with its empty text");

const shownAt = (since) => {
  const memo = {};
  const st = T.draw({ w: 1.6, h: 1, t: 1000.5, shown: since, data, options: { ...o, match: "birthday" }, states: {}, memo, S });
  return JSON.stringify(st);
};
check(shownAt(0) === shownAt(5.9) && shownAt(0) !== shownAt(6), "cycles from when it came in, not the clock");
check(shownAt(0) === shownAt(12), "and round again");

console.log(`text: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
