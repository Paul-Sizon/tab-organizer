import { test, expect } from "./fixtures";
import http from "http";
import type { AddressInfo } from "net";

const FAKE_WORKER_URL = "https://fake-worker.test";
const TAB_COUNT = 10;

async function startManyPagesServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><head><title>Tab ${req.url}</title></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    urls: Array.from({ length: TAB_COUNT }, (_, i) => `${baseUrl}/tab${i}`),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

test("never creates more than 8 tab groups, overflow folds into Other", async ({
  context,
  extensionId,
}) => {
  const server = await startManyPagesServer();
  for (const url of server.urls) {
    const page = await context.newPage();
    await page.goto(url);
  }

  // 10 distinct one-tab-each categories -- deliberately more than the
  // 8-group cap, to prove the cap actually holds regardless of what the
  // model (or, here, the mock) returns.
  await context.route(`${FAKE_WORKER_URL}/group`, async (route) => {
    const body = route.request().postDataJSON() as {
      tabs: { id: number; title: string; url: string }[];
    };
    const assignments = body.tabs.map((t, i) => ({
      id: t.id,
      category: `cat${i}`,
      confidence: 1,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assignments }),
    });
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate((url) => chrome.storage.sync.set({ workerUrl: url, minTabsToOrganize: 1 }), FAKE_WORKER_URL);

  // Popup only ships a handful of default categories, but classifyAndGroup
  // doesn't care what's declared -- it groups by whatever the /group
  // response's `category` says, falling back to the raw key as the label.
  await popup.click("#organize-btn");
  await expect(popup.locator("#status")).toContainText(`Grouped ${TAB_COUNT} tabs`, {
    timeout: 10_000,
  });

  const groups = await popup.evaluate(() => chrome.tabGroups.query({}));
  expect(groups.length).toBeLessThanOrEqual(8);

  const otherGroup = groups.find((g) => g.title === "Other");
  expect(otherGroup).toBeTruthy();
  const otherTabs = await popup.evaluate(
    (groupId) => chrome.tabs.query({ groupId }),
    otherGroup!.id
  );
  expect(otherTabs.length).toBeGreaterThan(0); // the overflow actually landed somewhere

  await server.close();
});
