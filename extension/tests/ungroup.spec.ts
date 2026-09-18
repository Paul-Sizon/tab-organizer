import { test, expect } from "./fixtures";
import { startTestServer } from "./testServer";

const FAKE_WORKER_URL = "https://fake-worker.test";

test("Remove Groups ungroups tabs previously grouped by Organize", async ({
  context,
  extensionId,
}) => {
  const server = await startTestServer();
  for (const url of server.urls) {
    const page = await context.newPage();
    await page.goto(url);
  }

  await context.route(`${FAKE_WORKER_URL}/group`, async (route) => {
    const body = route.request().postDataJSON() as {
      tabs: { id: number; title: string; url: string }[];
    };
    const [t0, t1, t2] = body.tabs;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assignments: [
          { id: t0.id, category: "dev", confidence: 0.95 },
          { id: t1.id, category: "shopping", confidence: 0.9 },
          { id: t2.id, category: "news", confidence: 0.92 },
        ],
      }),
    });
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate((url) => chrome.storage.sync.set({ workerUrl: url }), FAKE_WORKER_URL);
  await popup.click("#organize-btn");

  await expect(popup.locator("#status")).toContainText("Grouped 3 tabs into 3 groups", {
    timeout: 10_000,
  });
  await expect
    .poll(() => popup.evaluate(() => chrome.tabGroups.query({})))
    .toHaveLength(3);

  await popup.click("#ungroup-btn");
  await expect(popup.locator("#status")).toContainText("Ungrouped 3 tabs", { timeout: 10_000 });

  const groups = await popup.evaluate(() => chrome.tabGroups.query({}));
  expect(groups).toHaveLength(0);

  await server.close();
});
