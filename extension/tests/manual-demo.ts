// Manual visual demo: opens a real, visible Chromium window with the
// extension loaded, populates it with tabs across several categories, and
// triggers Organize — so you can eyeball the resulting tab groups yourself.
//
// Requires the local worker running (`cd worker && pnpm run dev`).
// Run with: pnpm run demo

import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.join(__dirname, "..");
const WORKER_URL = process.env.WORKER_URL ?? "http://127.0.0.1:8787";

const DEMO_TABS = [
  "https://react.dev/learn",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
  "https://www.amazon.com/",
  "https://www.ebay.com/",
  "https://www.bbc.com/news",
  "https://www.reuters.com/",
  "https://www.reddit.com/",
  "https://www.youtube.com/",
];

async function main() {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = worker.url().split("/")[2];

  // Close the default blank tab Chromium opens.
  const initialPages = context.pages();

  for (const url of DEMO_TABS) {
    const page = await context.newPage();
    await page.goto(url, { timeout: 15000, waitUntil: "domcontentloaded" }).catch((err) => {
      console.log(`  (couldn't load ${url}: ${err.message})`);
    });
  }
  for (const page of initialPages) await page.close().catch(() => {});

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate((url) => chrome.storage.sync.set({ workerUrl: url }), WORKER_URL);

  console.log(`Loaded ${DEMO_TABS.length} demo tabs. Worker: ${WORKER_URL}`);
  console.log("Click 'Organize Tabs' in the popup tab, or it'll auto-click in 2s...");
  await popup.waitForTimeout(2000);
  await popup.click("#organize-btn");

  await popup
    .locator("#status")
    .filter({ hasText: /Grouped|Error/ })
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  console.log("Status:", await popup.locator("#status").textContent());

  // Bring a normal tab to the front so the grouped tab strip is what's visible.
  const pages = context.pages().filter((p) => !p.url().startsWith("chrome-extension://"));
  if (pages[0]) await pages[0].bringToFront();

  console.log("\nWindow left open — inspect the tab groups yourself.");
  console.log("Close the Chromium window (or Ctrl+C this process) when done.");

  // Keep the process alive so the window stays open.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
