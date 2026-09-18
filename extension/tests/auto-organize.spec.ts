import { test, expect } from "./fixtures";
import { startTestServer } from "./testServer";

const FAKE_WORKER_URL = "https://fake-worker.test";
const ALARM_NAME = "tab-organizer-auto";

test("auto-organize alarm suggests categories then groups tabs", async ({
  context,
  extensionId,
}) => {
  const server = await startTestServer();
  for (const url of server.urls) {
    const page = await context.newPage();
    await page.goto(url);
  }

  await context.route(`${FAKE_WORKER_URL}/suggest-categories`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        categories: [
          { key: "dev", label: "Dev", description: "dev stuff" },
          { key: "shopping", label: "Shopping", description: "shopping stuff" },
          { key: "news", label: "News", description: "news stuff" },
          { key: "other", label: "Other", description: "everything else" },
        ],
      }),
    });
  });

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

  // Fire the auto-organize alarm almost immediately rather than waiting for
  // a real interval — same code path chrome.alarms.onAlarm invokes.
  await popup.evaluate(
    ({ name }) => chrome.alarms.create(name, { when: Date.now() + 100 }),
    { name: ALARM_NAME }
  );

  await expect
    .poll(
      async () => {
        const { lastRun } = await popup.evaluate(() => chrome.storage.local.get("lastRun"));
        return lastRun;
      },
      { timeout: 10_000 }
    )
    .toMatchObject({
      mode: "auto",
      tabsGrouped: 3,
      groupCount: 3,
      categoriesUsed: ["Dev", "Shopping", "News", "Other"],
    });

  const groups = await popup.evaluate(() => chrome.tabGroups.query({}));
  expect(groups.map((g) => g.title).sort()).toEqual(["Dev", "News", "Shopping"]);

  await server.close();
});
