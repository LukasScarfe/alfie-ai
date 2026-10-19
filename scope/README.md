# alfie-scope

Alfie on an X-Y oscilloscope. This container runs Alfie's own card in headless Chromium with
`vector_out` on and painting off, and sends each frame's strokes to
xy-bench, which turns them into the audio that drives the
scope. xy-bench shows them as its `alfie` screen.

## Setup (on the box that runs xy-bench)

1. In Home Assistant, make a non-admin user for the scope and a long-lived token for it.
2. `cp .env.example .env` and fill in:
   - `HA_URL` and `HA_TOKEN`;
   - `XYBENCH_TOKEN` (xy-bench's push token);
   - `ASPECT`, to match xy-bench's aspect setting;
   - `SETTINGS_PASSWORD`, for the settings page (below). Left empty, anyone on the network can
     change the card;
   - optionally `ALFIE_CARD`, the card options to start with, as JSON, until the settings page
     saves some. For example `{"display": "rotation", "rotation": "default"}` runs the rotation
     whose **id** is `default`.
3. Start it with `docker compose up -d --build`. It joins xy-bench's compose network
   (`xy-bench_default`) and opens one port, 8642, for the settings page.
4. Pick the `alfie` screen in xy-bench, from its web page or `PUT /api/screen {"screen": "alfie"}`.

`docker compose logs -f` shows a status line every minute: card fps, strokes, frames sent,
dropped and failed. After an Alfie update it reloads by itself, because HA restarting drops the
WebSocket.

## Settings page

Open `http://<this box>:8642/` and log in with any user name and `SETTINGS_PASSWORD`. It has
Alfie's own card editor (every option of the dashboard card: display, rotation, presenting,
transitions, look, personality), plus the scope's own beam order and condense, and a live view
of the frame on the tube. Changes save as you make them and the scope takes them at once.
They're kept in the `data` volume, so they survive a rebuild. Aspect and fps stay in `.env`,
because they must match xy-bench.

## Develop

`./dev scope [card-json] [seconds]`, from the repo root, runs it against the dev HA as a dry
run, with no xy-bench. It plots the newest frame to `devenv/out/scope.png`.
