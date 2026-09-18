import { test, expect } from "./fixtures";
import { startTestServer } from "./testServer";

const FAKE_WORKER_URL = "https://fake-worker.test";

test("suggested categories stop accumulating once the pool cap is hit", async ({
  context,
  extensionId,
}) => {
  const server = await startTestServer();
  for (const url of server.urls) {
    const page = await context.newPage();
    await page.goto(url);
  }

  await context.route(`${FAKE_WORKER_URL}/group`, async (route) => {
    const body = route.request().postDataJSON() as { tabs: { id: number }[] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assignments: body.tabs.map((t) => ({ id: t.id, category: "other", confidence: 1 })),
      }),
    });
  });

  // Every call returns a BRAND NEW never-seen-before category, simulating
  // a model that keeps drifting to new names run after run.
  let call = 0;
  await context.route(`${FAKE_WORKER_URL}/suggest-categories`, async (route) => {
    call += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [
          { key: `novel_${call}`, label: `Novel ${call}`, description: "a fresh one-off category" },
          { key: "other", label: "Other", description: "everything else" },
        ],
      }),
    });
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate((url) => chrome.storage.sync.set({ workerUrl: url }), FAKE_WORKER_URL);

  // 7 default categories already fill most of the MAX_STORED_CATEGORIES=10
  // pool. Each AI run tries to add one brand-new "novel_N" category; after
  // a few runs the pool should be full and stop growing.
  for (let i = 0; i < 6; i++) {
    await popup.click("#ai-organize-btn");
    await expect(popup.locator("#status")).toContainText(/Grouped|Nothing/, { timeout: 10_000 });
  }

  const stored = await popup.evaluate(() => chrome.storage.sync.get("categories"));
  expect(stored.categories.length).toBeLessThanOrEqual(10);

  await server.close();
});

test("Reset to defaults restores the default category list", async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // Pollute the stored categories first.
  await popup.evaluate(() =>
    chrome.storage.sync.set({
      categories: [
        { key: "junk_a", label: "Junk A", description: "x" },
        { key: "junk_b", label: "Junk B", description: "x" },
      ],
    })
  );
  await popup.reload();

  await expect(popup.locator("#category-list")).toContainText("Junk A");

  await popup.click("#reset-categories-btn");
  await expect(popup.locator("#status")).toContainText("Categories reset to defaults");
  await expect(popup.locator("#category-list")).not.toContainText("Junk A");
  await expect(popup.locator("#category-list")).toContainText("Work");

  const stored = await popup.evaluate(() => chrome.storage.sync.get("categories"));
  expect(stored.categories.map((c: { key: string }) => c.key)).toContain("work");
});
