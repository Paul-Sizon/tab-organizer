import { test, expect } from "./fixtures";
import { startTestServer } from "./testServer";

const FAKE_WORKER_URL = "https://fake-worker.test";

test("organizing is skipped below the minimum tab count, and proceeds once the threshold is met", async ({
  context,
  extensionId,
}) => {
  const server = await startTestServer();
  for (const url of server.urls) {
    const page = await context.newPage();
    await page.goto(url);
  }

  let groupCalls = 0;
  await context.route(`${FAKE_WORKER_URL}/group`, async (route) => {
    groupCalls += 1;
    const body = route.request().postDataJSON() as {
      tabs: { id: number; title: string; url: string }[];
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assignments: body.tabs.map((t) => ({ id: t.id, category: "dev", confidence: 0.9 })),
      }),
    });
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  // Default threshold (10) with only 3 tabs open: organize should no-op.
  await popup.evaluate((url) => chrome.storage.sync.set({ workerUrl: url }), FAKE_WORKER_URL);

  await popup.click("#organize-btn");
  await expect(popup.locator("#status")).toContainText("Need at least 10 tabs open", {
    timeout: 10_000,
  });
  expect(groupCalls).toBe(0);

  let groups = await popup.evaluate(() => chrome.tabGroups.query({}));
  expect(groups).toHaveLength(0);

  // Lower the threshold below the open tab count: organize should now run.
  await popup.evaluate(() => chrome.storage.sync.set({ minTabsToOrganize: 2 }));
  await popup.click("#organize-btn");
  await expect(popup.locator("#status")).toContainText("Grouped 3 tabs into 1 group", {
    timeout: 10_000,
  });
  expect(groupCalls).toBe(1);

  groups = await popup.evaluate(() => chrome.tabGroups.query({}));
  expect(groups.map((g) => g.title)).toEqual(["Dev"]);

  await server.close();
});
