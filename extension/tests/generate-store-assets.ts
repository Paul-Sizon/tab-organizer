import { chromium } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { startTestServer } from "./testServer";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(dirname, "..");
const outputPath = path.join(dirname, "..", "..", "store-assets", "popup-ui.png");
const workerUrl = "https://fake-worker.test";

const context = await chromium.launchPersistentContext("", {
  headless: false,
  args: [
    "--headless=new",
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = worker.url().split("/")[2];

  const server = await startTestServer();
  try {
    for (const url of server.urls) {
      const page = await context.newPage();
      await page.goto(url);
    }

    await context.route(`${workerUrl}/suggest-categories`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          categories: [
            { key: "dev", label: "Dev", description: "Code, documentation, and developer tools" },
            { key: "research", label: "Research", description: "Articles, reports, and reference material" },
            { key: "shopping", label: "Shopping", description: "Products, stores, and purchase research" },
            { key: "other", label: "Other", description: "Everything else" },
          ],
        }),
      })
    );

    await context.route(`${workerUrl}/group`, async (route) => {
      const body = route.request().postDataJSON() as { tabs: { id: number }[] };
      const categories = ["dev", "shopping", "research"];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          assignments: body.tabs.map((tab, index) => ({
            id: tab.id,
            category: categories[index % categories.length],
            confidence: 0.97,
          })),
        }),
      });
    });

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 344, height: 620 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.evaluate((url) => chrome.storage.sync.set({ workerUrl: url }), workerUrl);
    await popup.click("#ai-organize-btn");
    await popup.locator("#status").waitFor({ state: "visible" });
    await popup.screenshot({ path: outputPath, fullPage: true });
  } finally {
    await server.close();
  }
} finally {
  await context.close();
}
