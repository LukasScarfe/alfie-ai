// The panel's entity picker (frontend/panel/entity-picker.js): matching and patterns.
import { matchEntities, patternCount, iconOf } from "../custom_components/alfie/frontend/panel/entity-picker.js";

let failures = 0;
const check = (ok, what) => { if (!ok) { failures++; console.error(`FAIL ${what}`); } };

const list = [
  { id: "sensor.ficus_moisture", name: "Ficus moisture" },
  { id: "sensor.monstera_moisture", name: "Monstera moisture" },
  { id: "binary_sensor.hall_motion", name: "Hallway motion" },
  { id: "light.hall", name: "Hall light" },
];
const ids = (r) => r.map((e) => e.id).join(",");
check(ids(matchEntities(list, "moisture")) === "sensor.ficus_moisture,sensor.monstera_moisture", "by id word");
check(ids(matchEntities(list, "hall")) === "binary_sensor.hall_motion,light.hall", "object id and name both start");
check(ids(matchEntities(list, "hallway mot")) === "binary_sensor.hall_motion", "every word must match, names too");

check(matchEntities(list, "light")[0].id === "light.hall", "a domain prefix ranks first");
check(matchEntities(list, "").length === 4 && matchEntities(list, "", 2).length === 2, "empty shows the first n");
check(patternCount(list.map((e) => e.id), "sensor.*_moisture") === 2, "pattern");
check(patternCount(list.map((e) => e.id), "*.hall*") === 2, "pattern across domains");
check(iconOf("light.x") === "mdi:lightbulb" && iconOf("foo.x") === "mdi:shape-outline"
  && iconOf("sensor.x", { attributes: { icon: "mdi:leaf" } }) === "mdi:leaf", "icons");

if (failures) process.exit(1);
console.log("entity picker ok");
