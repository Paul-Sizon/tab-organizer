import { test, expect } from "./fixtures";
import { startTestServer } from "./testServer";

const FAKE_WORKER_URL = "https://fake-worker.test";

test("second run skips already-sorted tabs; a new tab joins the existing group", async ({
  context,
  extensionId,
}) => {
  const server = await startTestServer();
  const initialUrls = server.urls; // react-docs, amazon-cart, bbc-news

  const groupCalls: { title: string; url: string }[][] = [];
  await context.route(`${FAKE_WORKER_URL}/group`, async (route) => {
    const body = route.request().postDataJSON() as {
      tabs: { id: number; title: string; url: string }[];
    };
    groupCalls.push(body.tabs.map((t) => ({ title: t.title, url: t.url })));

    // First 3 known tabs -> dev/shopping/news. Anything else (the later new
    // tab) also classifies as "dev", to prove it joins the existing group.
    const assignments = body.tabs.map((t) => {
      if (t.url.includes("react-docs")) return { id: t.id, category: "dev", confidence: 1 };
      if (t.url.includes("amazon-cart")) return { id: t.id, category: "shopping", confidence: 1 };
      if (t.url.includes("bbc-news")) return { id: t.id, category: "news", confidence: 1 };
      return { id: t.id, category: "dev", confidence: 1 };
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assignments }),
    });
  });

  for (const url of initialUrls) {
    const page = await context.newPage();
    await page.goto(url);
  }

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate(
    (url) => chrome.storage.sync.set({ workerUrl: url, duplicateCleanupEnabled: false, minTabsToOrganize: 1 }),
    FAKE_WORKER_URL
  );

  // --- Run 1: everything is new, should classify all 3 ---
  await popup.click("#organize-btn");
  await expect(popup.locator("#status")).toContainText("Grouped 3 tabs into 3 groups", {
    timeout: 10_000,
  });
  expect(groupCalls).toHaveLength(1);
  expect(groupCalls[0]).toHaveLength(3);

  const groupsAfterRun1 = await popup.evaluate(() => chrome.tabGroups.query({}));
  expect(groupsAfterRun1).toHaveLength(3);
  const devGroupId = groupsAfterRun1.find((g) => g.title === "Dev")!.id;

  // --- Run 2: nothing changed, must NOT call the worker again ---
  await popup.click("#organize-btn");
  await expect(popup.locator("#status")).toContainText("Nothing new to organize", {
    timeout: 10_000,
  });
  expect(groupCalls).toHaveLength(1); // still just the one call from run 1

  const groupsAfterRun2 = await popup.evaluate(() => chrome.tabGroups.query({}));
  expect(groupsAfterRun2).toHaveLength(3); // no duplicate groups either

  // --- Run 3: a genuinely new tab appears, should be the ONLY one sent,
  // and should join the existing Dev group rather than spawning a new one ---
  const newPage = await context.newPage();
  await newPage.goto(`${server.baseUrl}/react-docs`);

  await popup.click("#organize-btn");
  await expect(popup.locator("#status")).toContainText("Grouped 1 tabs into 1 groups", {
    timeout: 10_000,
  });
  expect(groupCalls).toHaveLength(2);
  expect(groupCalls[1]).toHaveLength(1); // only the new tab was sent

  const groupsAfterRun3 = await popup.evaluate(() => chrome.tabGroups.query({}));
  expect(groupsAfterRun3).toHaveLength(3); // still 3 groups, not 4

  const devTabsAfterRun3 = await popup.evaluate(
    (groupId) => chrome.tabs.query({ groupId }),
    devGroupId
  );
  expect(devTabsAfterRun3).toHaveLength(2); // the new tab joined the existing Dev group

  await server.close();
});
