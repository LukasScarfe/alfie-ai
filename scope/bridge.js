// alfie-scope: Alfie's card in headless Chromium, its strokes to xy-bench.
//
// The page (page.html) runs the real card from Home Assistant with
// vector_out on and painting off. Each frame's strokes come back here and go
// to xy-bench's PUT /api/strokes, which draws them on the oscilloscope. The
// latest frame wins: one request in flight, and frames that arrive meanwhile
// replace each other, so a slow consumer drops frames instead of lagging.
//
// Settings are environment variables; see .env.example.
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const puppeteer = require("puppeteer");

const env = (k, d) => (process.env[k] ?? "").trim() || d;
const HA_URL = env("HA_URL", "").replace(/\/+$/, "");
const HA_TOKEN = env("HA_TOKEN", "");
const XYBENCH_URL = env("XYBENCH_URL", "").replace(/\/+$/, "");
const XYBENCH_TOKEN = env("XYBENCH_TOKEN", "");
const FPS = Number(env("FPS", "50"));   // xy-bench plays Alfie at 50
const ASPECT = Number(env("ASPECT", "1"));
const ORDERED = env("ORDERED", "true") !== "false";
const CARD = JSON.parse(env("ALFIE_CARD", "{}"));
const DUMP = env("DUMP", "");   // a file to write the newest frame to on each status line (debugging)
const STATS = Number(env("STATS", "60"));   // seconds between status lines
const WIDTH = 640;   // canvas pixels; strokes leave in [-1, 1], so only rounding sees this

if (!HA_URL || !HA_TOKEN) {
  console.error("alfie-scope: HA_URL and HA_TOKEN are required");
  process.exit(2);
}

const HERE = __dirname;
const MOD = path.join(HERE, "node_modules");
// Served at HA's origin by request interception, so nothing is cross-origin.
const FILES = {
  "/__alfie_scope__/page.html": [path.join(HERE, "page.html"), "text/html"],
  "/__alfie_scope__/haws.js": [path.join(MOD, "home-assistant-js-websocket/dist/haws.umd.js"), "text/javascript"],
  "/__alfie_scope__/mdi.json": [path.join(HERE, "mdi.json"), "application/json"],
};

// ---------------------------------------------------------------- xy-bench

let latest = null, inflight = false, sent = 0, dropped = 0, failed = 0, lastError = "";
const agent = XYBENCH_URL.startsWith("https") ? new https.Agent({ keepAlive: true })
  : new http.Agent({ keepAlive: true, maxSockets: 1 });

function offer(frame) {
  if (latest) dropped++;
  latest = frame;
  if (!inflight) send();
}

function send() {
  if (!latest) return;
  const frame = latest;
  latest = null;
  if (!XYBENCH_URL) { sent++; return; }   // dry run: count frames only
  inflight = true;
  const body = JSON.stringify({ strokes: frame.strokes, ordered: ORDERED, aspect: frame.aspect, t: frame.t });
  const u = new URL(XYBENCH_URL + "/api/strokes");
  const req = (u.protocol === "https:" ? https : http).request(u, {
    method: "PUT", agent, timeout: 2000,
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
               ...(XYBENCH_TOKEN ? { Authorization: `Bearer ${XYBENCH_TOKEN}` } : {}) },
  }, (res) => {
    let reply = "";
    res.on("data", (b) => { if (reply.length < 300) reply += b; });
    res.on("end", () => {
      // xy-bench says why it refused a frame ({"error": ...}); the status line shows the last one.
      if (res.statusCode >= 300) { failed++; lastError = `HTTP ${res.statusCode} ${reply.trim()}`.trim(); } else sent++;
      inflight = false;
      send();
    });
  });
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", (e) => {
    failed++; lastError = e.message; inflight = false;
    // xy-bench down or restarting: try the next frame after a breath.
    setTimeout(send, 1000);
  });
  req.end(body);
}

// ---------------------------------------------------------------- the page

let browser = null, page = null, frames = 0, strokes = 0, newest = null;
// Frame pacing over each status window: the longest gap between two frames and
// how many came over 1.5 frames late (a stall the eye sees as a judder).
let lastAt = 0, worstGap = 0, late = 0;

async function open() {
  if (page) await page.close().catch(() => {});
  page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: Math.max(1, Math.round(WIDTH / ASPECT)), deviceScaleFactor: 1 });
  page.on("console", (m) => console.log(`[page ${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => console.error(`[page error] ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400) console.error(`[page] HTTP ${r.status()} ${r.url()}`); });
  page.on("error", (e) => { console.error(`[page crashed] ${e.message}`); reopen(); });
  await page.exposeFunction("scopeFrame", (f) => {
    const now = performance.now();
    if (lastAt) {
      const gap = now - lastAt;
      worstGap = Math.max(worstGap, gap);
      if (gap > 1500 / FPS) late++;
    }
    lastAt = now;
    frames++; strokes = f.strokes.length; newest = f;
    offer(f);
  });
  await page.evaluateOnNewDocument((s) => { window.SCOPE = s; },
    { token: HA_TOKEN, aspect: ASPECT, fps: FPS, card: CARD });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = new URL(r.url());
    const f = u.origin === new URL(HA_URL).origin && FILES[u.pathname];
    if (!f) return r.continue();
    fs.readFile(f[0], (err, data) => err
      ? r.respond({ status: 404, body: String(err) })
      : r.respond({ status: 200, contentType: f[1], body: data }));
  });
  await page.goto(HA_URL + "/__alfie_scope__/page.html", { waitUntil: "domcontentloaded" });
}

let reopening = false;
async function reopen() {
  if (reopening) return;
  reopening = true;
  try { await open(); } catch (e) { console.error(`alfie-scope: page failed: ${e.message}`); }
  finally { reopening = false; }
}

(async () => {
  browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    userDataDir: "/tmp/alfie-scope-profile",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--mute-audio",
           // Headless still counts as a window: keep its frames coming at full rate.
           "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
           "--disable-backgrounding-occluded-windows"],
  });
  browser.on("disconnected", () => { console.error("alfie-scope: Chromium exited"); process.exit(1); });
  await open();
  console.log(`alfie-scope: ${HA_URL} -> ${XYBENCH_URL || "(dry run)"}, aspect ${ASPECT}, ${FPS} fps`);

  // A status line every STATS seconds. Frames stop on their own while a
  // house mode hides Alfie; a page that stops answering is opened afresh.
  let was = 0;
  setInterval(async () => {
    const n = frames - was; was = frames;
    if (DUMP && newest) fs.writeFile(DUMP, JSON.stringify(newest), () => {});
    console.log(`alfie-scope: ${(n / STATS).toFixed(1)} fps from the card, ${strokes} strokes, ` +
      `${sent} sent, ${dropped} dropped, ${failed} failed${failed ? ` (${lastError})` : ""}, ` +
      `${late} late, longest gap ${Math.round(worstGap)} ms`);
    late = 0; worstGap = 0;
    const alive = await Promise.race([page.evaluate(() => 1).catch(() => 0),
      new Promise((r) => setTimeout(() => r(0), 10000))]);
    if (!alive) { console.error("alfie-scope: page not answering, reopening"); reopen(); }
  }, STATS * 1000);
})().catch((e) => { console.error(e); process.exit(1); });
