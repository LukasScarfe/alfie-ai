// The panel's HTML builders (frontend/panel/ui.js): escaping, words, the uniform item.
import * as U from "../../custom_components/alfie/frontend/panel/ui.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };

check(U.human("glance_left") === "Glance left" && U.human("@mood") === "@mood" && U.human("") === "", "human");
check(U.esc('<a href="x">') === "&#60;a href=&#34;x&#34;&#62;", "esc");
check(U.slugId([{ id: "dry_plant" }], "Dry plant!", "signal") === "dry_plant_2", "slugId unique");
check(U.slugId([{ id: "x" }], "", "signal") === "signal", "slugId fallback");
check(U.slugId([{ id: "a" }], "A", "s", 0) === "a", "slugId may keep its own id");
check(U.same({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }), "same ignores key order");

const sel = U.select("x.y", "b", [["a", "A"], ["b", "<B>"]], { rerender: true });
check(sel.includes('data-path="x.y"') && sel.includes("data-rerender") && /value="b" selected/.test(sel) && sel.includes("&#60;B&#62;"), "select");
check(U.select("p", "glance_left", ["glance_left"]).includes(">Glance left<"), "plain options are humanised");
check(U.num("p", 5, { unit: "s" }).includes('<span class="unit">') && U.num("p", null, { empty: "null" }).includes('placeholder="Default"'), "num unit and default");

const p = { open: new Set(["more:k"]) };
check(U.more(p, "k", "x").includes(" open") && !U.more(p, "j", "x").includes(" open"), "more remembers open");

const closed = U.item({ key: "sig:a", i: 0, n: 2, open: false, name: "Dry", actions: { toggle: "t", up: "u", down: "d", dup: "c", del: "x" } });
check(closed.includes('data-action="t"') && !closed.includes("Duplicate") && /data-action="u"[^>]*disabled/.test(closed), "closed item");
const open = U.item({ key: "sig:a", i: 1, n: 2, open: true, name: "<Dry>", enabledPath: "signals.1.enabled", enabled: true,
  actions: { toggle: "t", up: "u", down: "d", dup: "c", del: "x" }, body: "BODY" });
check(open.includes("BODY") && open.includes("Duplicate") && open.includes("Delete") && open.includes("&#60;Dry&#62;")
  && open.includes('data-path="signals.1.enabled"') && /data-action="d"[^>]*disabled/.test(open), "open item");

const ents = U.entities({ items: ["sensor.a"], i: 3, add: "add", rm: "rm" });
check(ents.includes("data-add") && ents.includes('data-j="0"') && ents.includes('data-i="3"'), "entities");
check(U.picks("pk", 0, "moods", ["sad", "bubbly"], ["sad"]).match(/chip pick on/g).length === 1, "picks");
check(U.seg("f", "steps", [["simple", "Simple"], ["steps", "Steps"]], 2).includes('class="on" data-action="f" data-i="2" data-name="steps"'), "seg");

if (failures) process.exit(1);
console.log("panel ui ok");
