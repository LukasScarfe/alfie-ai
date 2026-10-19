// Screenshot a page in headless Chrome. Runs inside the
// zenika/alpine-chrome:124-with-puppeteer image (see ./dev), never on the host.
//
//   node shot.js URL OUT.png [--auth tokens.json] [--size WxH] [--wait ms]
//                            [--selector css] [--eval js]
//
// --auth logs into HA by planting the frontend's own saved-token entry
// (localStorage.hassTokens) before the page loads, so no login form is driven.
// --selector waits for that element (piercing shadow roots with >>>) and
// shoots just it. --eval runs a script in the page once it has loaded.
const fs = require("fs");
const puppeteer = require("puppeteer");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
}

(async () => {
  const [url, out] = process.argv.slice(2, 4);
  const [w, h] = arg("--size", "1000x700").split("x").map(Number);
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: ["--no-sandbox", "--allow-file-access-from-files", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (process.env.SHOT_VERBOSE || m.type() === "error" || m.type() === "warn") console.error(`[page ${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.error(`[page error] ${e.message}`));

  const auth = arg("--auth");
  if (auth) {
    const t = JSON.parse(fs.readFileSync(auth, "utf8"));
    const tokens = JSON.stringify({
      access_token: t.access_token, refresh_token: t.refresh_token, token_type: "Bearer",
      expires_in: 1800, expires: Date.now() + 1800 * 1000,
      hassUrl: t.url, clientId: t.client_id,
    });
    await page.evaluateOnNewDocument((v) => {
      localStorage.setItem("hassTokens", v);
      localStorage.setItem("selectedTheme", JSON.stringify({ dark: true }));
    }, tokens);
  }

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  const js = arg("--eval");
  if (js) await page.evaluate(js);
  await new Promise((r) => setTimeout(r, Number(arg("--wait", "1500"))));

  const sel = arg("--selector");
  if (sel) {
    const el = await page.waitForSelector(`pierce/${sel}`, { timeout: 30000 });
    await el.screenshot({ path: out });
  } else {
    await page.screenshot({ path: out });
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
