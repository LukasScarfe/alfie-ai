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
    ] }] } });
  console.log("alfie-dev dashboard saved");
})();
