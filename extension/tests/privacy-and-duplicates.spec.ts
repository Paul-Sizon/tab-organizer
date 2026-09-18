import { test, expect } from "./fixtures";
import { startTestServer } from "./testServer";

const FAKE_WORKER_URL = "https://fake-worker.test";

test("strips query parameters and fragments before sending tabs to AI", async ({
  context,
  extensionId,
}) => {
  const server = await startTestServer();
  const page = await context.newPage();
  await page.goto(`${server.baseUrl}/react-docs?token=secret&email=user@example.com#private`);

  let sentUrl = "";
  await context.route(`${FAKE_WORKER_URL}/group`, async (route) => {
    const body = route.request().postDataJSON() as {
      tabs: { id: number; title: string; url: string }[];
    };
    sentUrl = body.tabs[0].url;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assignments: [{ id: body.tabs[0].id, category: "dev", confidence: 0.99 }],
      }),
    });
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate((url) => chrome.storage.sync.set({ workerUrl: url, minTabsToOrganize: 1 }), FAKE_WORKER_URL);
  await popup.click("#organize-btn");

  await expect(popup.locator("#status")).toContainText("Grouped 1 tabs", { timeout: 10_000 });
  expect(sentUrl).toBe(`${server.baseUrl}/react-docs`);
  expect(sentUrl).not.toContain("secret");
  expect(sentUrl).not.toContain("user@example.com");

  await server.close();
});

test("duplicate cleanup is on by default and keeps query-distinct tabs", async ({
  context,
  extensionId,
}) => {
  const server = await startTestServer();
  for (const url of [
    `${server.baseUrl}/react-docs?view=one#top`,
    `${server.baseUrl}/react-docs?view=one#details`,
    `${server.baseUrl}/react-docs?view=two#top`,
  ]) {
    const page = await context.newPage();
    await page.goto(url);
  }

  await context.route(`${FAKE_WORKER_URL}/group`, async (route) => {
    const body = route.request().postDataJSON() as {
      tabs: { id: number; title: string; url: string }[];
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assignments: body.tabs.map((tab) => ({ id: tab.id, category: "dev", confidence: 0.99 })),
      }),
    });
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate((url) => chrome.storage.sync.set({ workerUrl: url, minTabsToOrganize: 1 }), FAKE_WORKER_URL);

  await expect(popup.locator("#duplicate-cleanup")).toBeChecked();
  await popup.click("#organize-btn");
  await expect(popup.locator("#status")).toContainText("Removed 1 duplicate", { timeout: 10_000 });

  const remaining = await popup.evaluate(async (baseUrl) => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.filter((tab) => tab.url?.startsWith(`${baseUrl}/react-docs?view=`)).map((tab) => tab.url);
  }, server.baseUrl);
  expect(remaining).toHaveLength(2);
  expect(remaining.some((url) => url?.includes("view=one"))).toBe(true);
  expect(remaining.some((url) => url?.includes("view=two"))).toBe(true);

  await server.close();
});

