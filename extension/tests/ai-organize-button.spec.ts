import { test, expect } from "./fixtures";
import { startTestServer } from "./testServer";

const FAKE_WORKER_URL = "https://fake-worker.test";

test("AI Categories button runs suggest-categories immediately, no timer needed", async ({
  context,
  extensionId,
}) => {
  const server = await startTestServer();
  for (const url of server.urls) {
    const page = await context.newPage();
    await page.goto(url);
  }

  let suggestCalls = 0;
  await context.route(`${FAKE_WORKER_URL}/suggest-categories`, async (route) => {
    suggestCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [
          { key: "dev", label: "Dev", description: "dev stuff" },
          { key: "other", label: "Other", description: "everything else" },
        ],
      }),
    });
  });

  await context.route(`${FAKE_WORKER_URL}/group`, async (route) => {
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
  await popup.evaluate((url) => chrome.storage.sync.set({ workerUrl: url }), FAKE_WORKER_URL);

  // No auto-organize interval set — this button must work standalone.
  await popup.click("#ai-organize-btn");

  await expect(popup.locator("#status")).toContainText("Grouped 3 tabs into 1 groups", {
    timeout: 10_000,
  });
  expect(suggestCalls).toBe(1);

  await server.close();
});
