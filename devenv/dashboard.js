// Run in a logged-in dev HA page by ./dev dashboard: (re)creates the
// "alfie-dev" dashboard with Alfie cards in a few styles.
(async () => {
  let hass;
  for (let i = 0; i < 60 && !(hass = document.querySelector("home-assistant")?.hass); i++) await new Promise((r) => setTimeout(r, 500));
  const list = await hass.callWS({ type: "lovelace/dashboards/list" });
  if (!list.some((d) => d.url_path === "alfie-dev")) {
    await hass.callWS({ type: "lovelace/dashboards/create", url_path: "alfie-dev",
      title: "Alfie dev", icon: "mdi:robot-happy-outline", show_in_sidebar: true, require_admin: false, mode: "storage" });
  }
  await hass.callWS({ type: "lovelace/config/save", url_path: "alfie-dev", config: { views: [{
    title: "Alfie", path: "alfie", type: "sections", max_columns: 3, sections: [
      { type: "grid", cards: [{ type: "custom:alfie-card", style: "neon" }] },
      { type: "grid", cards: [{ type: "custom:alfie-card", style: "flat" },
                              { type: "entities", entities: ["sensor.alfie_mood", "select.alfie_mode"] }] },
      { type: "grid", cards: [{ type: "custom:alfie-card", style: "theme", eye_fill: true }] },
      { type: "grid", cards: [{ type: "custom:alfie-card", style: "neon", display: "rotation", rotation: "demo", present: "handover", aspect: 1.6 },
                              { type: "custom:alfie-card", style: "neon", display: "rotation", rotation: "demo", present: "corner", aspect: 1.6 }] },
      { type: "grid", cards: [{ type: "custom:alfie-card", style: "crt",
        shapes: { head: { type: "polygon", sides: 4, roundness: 0.12 }, eye: { type: "star", points: 5, inner: 0.5 } } }] },
    ] },
    // A short rotation (3 s steps, one Alfie step) for timing traces: devenv/out/m4g-trace.js.
    { title: "Rotation", path: "rotation", type: "sections", max_columns: 2, sections: [
      { type: "grid", cards: [{ type: "custom:alfie-card", style: "neon", display: "rotation", rotation: "g_test", present: "handover", aspect: 1.6 }] },
      { type: "grid", cards: [{ type: "custom:alfie-card", style: "neon", display: "rotation", rotation: "g_test", present: "corner", aspect: 1.6 }] },
    ] },
    // One card per screen, each held on its own one-step rotation (see ./dev js devenv/out/allscreens.js).
    { title: "Screens", path: "screens", type: "sections", max_columns: 4, sections:
      ["plants", "weather", "weather_days", "clock", "monstera", "soil", "sky", "stars", "map", "birthdays"].map((id) => (
        { type: "grid", cards: [{ type: "custom:alfie-card", style: "neon", display: "rotation", rotation: `only_${id}`,
                                  present: id === "clock" || id === "monstera" ? "corner" : "handover", aspect: 1.6 }] })) },
    ] } });
  console.log("alfie-dev dashboard saved");
})();
