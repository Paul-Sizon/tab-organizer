import {
  DEFAULT_CATEGORIES,
  DEFAULT_WORKER_URL,
  MAX_STORED_CATEGORIES,
  getGroupableTabs,
  cleanupDuplicateTabs,
  classifyAndGroup,
  suggestCategories,
} from "./shared.js";

const ALARM_NAME = "tab-organizer-auto";
const TRACKED_KEY = "organizedTabs";

// { [tabId]: { url, category } } — tabs we've already classified and
// placed. A tab is only re-processed if it's not in here, or its URL
// changed since we last looked at it (i.e. the user navigated it
// somewhere else). This is what stops every run from reshuffling tabs
// that are already correctly sorted.
async function getTrackedMap() {
  const stored = await chrome.storage.local.get(TRACKED_KEY);
  return stored[TRACKED_KEY] || {};
}

async function setTrackedMap(map) {
  await chrome.storage.local.set({ [TRACKED_KEY]: map });
}

function pruneAndSplit(tabs, tracked) {
  const openIds = new Set(tabs.map((t) => t.id));
  const prunedTracked = {};
  for (const [id, entry] of Object.entries(tracked)) {
    if (openIds.has(Number(id))) prunedTracked[id] = entry;
  }
  const newOrChangedTabs = tabs.filter((t) => {
    const entry = prunedTracked[t.id];
    return !entry || entry.url !== t.url;
  });
  return { prunedTracked, newOrChangedTabs };
}

function recordAssignments(trackedMap, tabs, assignments) {
  const urlById = new Map(tabs.map((t) => [t.id, t.url]));
  for (const a of assignments) {
    trackedMap[a.id] = { url: urlById.get(a.id), category: a.category };
  }
}

async function mergeCategoriesIntoStorage(newCats) {
  const { categories } = await chrome.storage.sync.get("categories");
  const existing = categories?.length ? categories : DEFAULT_CATEGORIES;
  const byKey = new Map(existing.map((c) => [c.key, c]));
  let added = false;
  for (const c of newCats) {
    if (byKey.has(c.key)) continue;
    if (byKey.size >= MAX_STORED_CATEGORIES) break; // pool's full — stop accumulating
    byKey.set(c.key, c);
    added = true;
  }
  if (added) await chrome.storage.sync.set({ categories: Array.from(byKey.values()) });
}

async function resetCategories() {
  await chrome.storage.sync.set({ categories: DEFAULT_CATEGORIES });
  return { categories: DEFAULT_CATEGORIES };
}

async function getTabsForOrganize() {
  const allTabs = await getGroupableTabs();
  const { duplicateCleanupEnabled } = await chrome.storage.sync.get("duplicateCleanupEnabled");
  if (duplicateCleanupEnabled === false) return { tabs: allTabs, duplicatesRemoved: 0 };
  return cleanupDuplicateTabs(allTabs);
}

async function runManual() {
  const { workerUrl, categories } = await chrome.storage.sync.get(["workerUrl", "categories"]);
  const url = workerUrl || DEFAULT_WORKER_URL;
  const cats = categories?.length ? categories : DEFAULT_CATEGORIES;

  const { tabs: allTabs, duplicatesRemoved } = await getTabsForOrganize();
  if (!allTabs.length) return { tabsGrouped: 0, groupCount: 0, duplicatesRemoved };

  const tracked = await getTrackedMap();
  const { prunedTracked, newOrChangedTabs } = pruneAndSplit(allTabs, tracked);
  if (!newOrChangedTabs.length) {
    await setTrackedMap(prunedTracked);
    return { tabsGrouped: 0, groupCount: 0, duplicatesRemoved, skipped: true };
  }

  const windowId = newOrChangedTabs[0].windowId;
  const result = await classifyAndGroup(url, newOrChangedTabs, cats, windowId);
  recordAssignments(prunedTracked, newOrChangedTabs, result.assignments);
  await setTrackedMap(prunedTracked);

  return { tabsGrouped: result.tabsGrouped, groupCount: result.groupCount, duplicatesRemoved };
}

async function runAuto() {
  const { workerUrl, categories } = await chrome.storage.sync.get(["workerUrl", "categories"]);
  const url = workerUrl || DEFAULT_WORKER_URL;

  const { tabs: allTabs, duplicatesRemoved } = await getTabsForOrganize();
  if (!allTabs.length) return { tabsGrouped: 0, groupCount: 0, categoriesUsed: [], duplicatesRemoved };

  const tracked = await getTrackedMap();
  const { prunedTracked, newOrChangedTabs } = pruneAndSplit(allTabs, tracked);
  if (!newOrChangedTabs.length) {
    await setTrackedMap(prunedTracked);
    return { tabsGrouped: 0, groupCount: 0, categoriesUsed: [], duplicatesRemoved, skipped: true };
  }

  // The user is away (timer-triggered), so it's worth spending the extra
  // round trip letting a generative model pick categories that fit the
  // *current* set of tabs, rather than a fixed list. It sees the full tab
  // set for context even though only the new/changed ones get moved.
  const windowId = newOrChangedTabs[0].windowId;
  const existingGroups = await chrome.tabGroups.query({ windowId });
  const existingGroupTitles = existingGroups.map((g) => g.title).filter(Boolean);

  let cats;
  try {
    cats = await suggestCategories(url, allTabs, existingGroupTitles);
    await mergeCategoriesIntoStorage(cats);
  } catch (err) {
    console.warn("suggest-categories failed, falling back to stored categories:", err.message);
    cats = categories?.length ? categories : DEFAULT_CATEGORIES;
  }

  const result = await classifyAndGroup(url, newOrChangedTabs, cats, windowId);
  recordAssignments(prunedTracked, newOrChangedTabs, result.assignments);
  await setTrackedMap(prunedTracked);

  return {
    tabsGrouped: result.tabsGrouped,
    groupCount: result.groupCount,
    categoriesUsed: cats.map((c) => c.label),
    duplicatesRemoved,
  };
}

async function runOrganize(mode) {
  try {
    const result = await (mode === "auto" ? runAuto() : runManual());
    const record = { mode, at: Date.now(), ...result };
    await chrome.storage.local.set({ lastRun: record });
    return record;
  } catch (err) {
    const record = { mode, at: Date.now(), error: err.message };
    await chrome.storage.local.set({ lastRun: record });
    return record;
  }
}

async function ungroupAll() {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const groupedIds = allTabs
    .filter((t) => t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
    .map((t) => t.id);
  if (groupedIds.length) await chrome.tabs.ungroup(groupedIds);
  // Explicit reset signal: next organize run should treat everything as new.
  await setTrackedMap({});
  return { tabsUngrouped: groupedIds.length };
}

async function setAutoOrganizeAlarm(minutes) {
  await chrome.alarms.clear(ALARM_NAME);
  if (minutes > 0) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes });
  }
}

async function restoreAlarmFromStorage() {
  const { autoOrganizeMinutes } = await chrome.storage.sync.get("autoOrganizeMinutes");
  if (autoOrganizeMinutes > 0) await setAutoOrganizeAlarm(autoOrganizeMinutes);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runOrganize("auto");
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "organize-now") {
    runOrganize(msg.mode === "auto" ? "auto" : "manual").then(sendResponse);
    return true;
  }
  if (msg?.type === "set-auto-interval") {
    setAutoOrganizeAlarm(msg.minutes).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "ungroup-all") {
    ungroupAll().then(sendResponse);
    return true;
  }
  if (msg?.type === "reset-categories") {
    resetCategories().then(sendResponse);
    return true;
  }
});

chrome.runtime.onStartup.addListener(restoreAlarmFromStorage);
chrome.runtime.onInstalled.addListener(restoreAlarmFromStorage);
