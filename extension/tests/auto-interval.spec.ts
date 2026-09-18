import { test, expect } from "./fixtures";

test("selecting an auto-organize interval creates/clears the chrome.alarms entry", async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await popup.selectOption("#auto-interval", "5");
  // The change handler messages the background service worker, which sets
  // the alarm asynchronously — give it a moment.
  await popup.waitForTimeout(300);

  let alarms = await popup.evaluate(() => chrome.alarms.getAll());
  expect(alarms).toHaveLength(1);
  expect(alarms[0]).toMatchObject({ name: "tab-organizer-auto", periodInMinutes: 5 });

  await popup.selectOption("#auto-interval", "0");
  await popup.waitForTimeout(300);

  alarms = await popup.evaluate(() => chrome.alarms.getAll());
  expect(alarms).toHaveLength(0);
});
