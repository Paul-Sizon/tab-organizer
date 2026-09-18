import { test, expect } from "./fixtures";
import { startTestServer } from "./testServer";

const FAKE_WORKER_URL = "https://fake-worker.test";

test("groups tabs into native tab groups from the worker response", async ({
  context,
  extensionId,
}) => {
  // Local static pages so the test has no external network dependency.
  // Content is irrelevant since the worker call is mocked below — only
  // real http(s) tab URLs matter, since the extension filters on that.
  const server = await startTestServer();
  for (const url of server.urls) {
    const page = await context.newPage();
    await page.goto(url);
  }

  // Mock the worker's classification response deterministically.
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

  await popup.evaluate((url) => chrome.storage.sync.set({ workerUrl: url, minTabsToOrganize: 1 }), FAKE_WORKER_URL);

  await popup.click("#organize-btn");

  await expect(popup.locator("#status")).toContainText("Grouped 3 tabs into 3 groups", {
    timeout: 10_000,
  });

  const groups = await popup.evaluate(() => chrome.tabGroups.query({}));
  const titles = groups.map((g) => g.title).sort();
  expect(titles).toEqual(["Dev", "News", "Shopping"]);

  await server.close();
});
