export const DEFAULT_CATEGORIES = [
  { key: "work", label: "Work", description: "Work tools, email, docs, project management, corporate sites" },
  { key: "dev", label: "Dev", description: "Software development: code repos, documentation, localhost, dev tools" },
  { key: "shopping", label: "Shopping", description: "Online shopping, product pages, marketplaces, carts" },
  { key: "social", label: "Social", description: "Social media, messaging, forums" },
  { key: "news", label: "News", description: "News articles, blogs, magazines" },
  { key: "entertainment", label: "Entertainment", description: "Video, music, streaming, games" },
  { key: "other", label: "Other", description: "Anything that does not clearly fit another category" },
];

// The project's own deployed worker. Used as the default so nobody has to
// type it in by hand — the URL field in the popup is only for pointing at
// a local `wrangler dev` instance during development.
export const DEFAULT_WORKER_URL = "https://tab-organizer-worker.paul-sizon.workers.dev";

// Sent as X-Extension-Secret on every worker request. This is source-visible
// in a public repo, so it is NOT a real secret — it only stops casual/opportunistic
// abuse of the deployed worker (copy-pasting the URL into a script), not a
// determined attacker who reads this file. If you deploy your own worker,
// generate your own value (e.g. `openssl rand -hex 32`), set it as the
// worker's EXTENSION_SHARED_SECRET, and put the same value here.
export const EXTENSION_SHARED_SECRET = "7219b83f1154539888e45aa8ddd132e83f198b36c8591497cf2fc304288f1a82";

const GROUP_COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey"];

// Hard ceiling on distinct tab groups in a window, enforced here in code —
// not something the model's per-run category count can ever exceed, no
// matter how many auto-organize runs have happened. Without this, naming
// drift across runs (DeepSeek calling similar themes slightly different
// things each time) could pile up new groups indefinitely.
export const MAX_TOTAL_GROUPS = 8;

// Separate cap on the category POOL itself (chrome.storage.sync's
// `categories`, shown in the popup, fed as classification candidates).
// Without this, every auto-organize run that discovers a "new" category
// (even a near-duplicate of an existing one, if the model's naming drifts)
// gets merged in permanently and the list grows forever.
export const MAX_STORED_CATEGORIES = 10;

// Below this many open tabs, organizing isn't worth it — nothing to sort.
// User-adjustable via the popup's settings (stored as `minTabsToOrganize`).
export const DEFAULT_MIN_TABS_TO_ORGANIZE = 10;

export async function getGroupableTabs() {
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  return allTabs
    .filter((t) => t.url && /^https?:\/\//.test(t.url) && !t.pinned)
    .map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      windowId: t.windowId,
      active: t.active,
      index: t.index,
    }));
}

// Keep enough URL context for classification while ensuring query values,
// fragments, auth details, and other potentially sensitive data never leave
// the browser. Invalid URLs are reduced to an empty string rather than sent
// through unchanged.
export function sanitizeUrlForAI(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function duplicateKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

// Close duplicate HTTP(S) tabs in the current window. Query parameters remain
// part of the identity because they can represent a different search, document,
// or application state; fragments are ignored. Prefer the active tab when a
// duplicate set contains it, otherwise keep the left-most tab.
export async function cleanupDuplicateTabs(tabs) {
  const byUrl = new Map();
  for (const tab of tabs) {
    const key = duplicateKey(tab.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(tab);
  }

  const duplicateIds = [];
  const keptTabs = [];
  for (const matches of byUrl.values()) {
    const keeper = matches.find((tab) => tab.active)
      || matches.reduce((left, tab) => (tab.index < left.index ? tab : left));
    keptTabs.push(keeper);
    duplicateIds.push(...matches.filter((tab) => tab.id !== keeper.id).map((tab) => tab.id));
  }

  if (duplicateIds.length) await chrome.tabs.remove(duplicateIds);
  return { tabs: keptTabs.sort((a, b) => a.index - b.index), duplicatesRemoved: duplicateIds.length };
}

// Groups `tabs` by the worker's classification, reusing an existing tab
// group with a matching title when one exists instead of always creating a
// fresh one — otherwise every run reshuffles colors/positions even for
// categories that already have a stable group.
export async function classifyAndGroup(workerUrl, tabs, categories, windowId) {
  if (!tabs.length) return { tabsGrouped: 0, groupCount: 0, assignments: [] };

  const res = await fetch(`${workerUrl.replace(/\/$/, "")}/group`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Extension-Secret": EXTENSION_SHARED_SECRET },
    body: JSON.stringify({
      tabs: tabs.map(({ id, title, url }) => ({ id, title, url: sanitizeUrlForAI(url) })),
      categories: categories.map(({ key, label, description }) => ({ key, label, description })),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const assignments = data.assignments || [];

  const byCategory = new Map();
  for (const a of assignments) {
    if (!byCategory.has(a.category)) byCategory.set(a.category, []);
    byCategory.get(a.category).push(a.id);
  }

  const existingGroups = await chrome.tabGroups.query(windowId != null ? { windowId } : {});
  const groupIdByTitle = new Map(existingGroups.map((g) => [g.title, g.id]));
  const OTHER_LABEL = "Other";

  async function getOrCreateOtherGroup(tabIds, colorIdx) {
    const existingOtherId = groupIdByTitle.get(OTHER_LABEL);
    if (existingOtherId != null) {
      await chrome.tabs.group({ tabIds, groupId: existingOtherId });
      return existingOtherId;
    }
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title: OTHER_LABEL, color: GROUP_COLORS[colorIdx % GROUP_COLORS.length] });
    groupIdByTitle.set(OTHER_LABEL, groupId);
    return groupId;
  }

  // Process "other" last so real categories get first claim on the group
  // budget — only genuine overflow gets dumped into Other.
  const entries = Array.from(byCategory.entries()).sort((a, b) =>
    a[0] === "other" ? 1 : b[0] === "other" ? -1 : 0
  );

  // If Other doesn't exist yet, reserve one slot for it so the total group
  // count (real categories + Other) can never exceed MAX_TOTAL_GROUPS.
  const newGroupCeiling = groupIdByTitle.has(OTHER_LABEL) ? MAX_TOTAL_GROUPS : MAX_TOTAL_GROUPS - 1;

  let groupCount = 0;
  let colorIdx = existingGroups.length;
  let totalGroups = existingGroups.length;
  for (const [categoryKey, tabIds] of entries) {
    if (!tabIds.length) continue;
    const cat = categories.find((c) => c.key === categoryKey);
    const label = cat ? cat.label : categoryKey;

    const existingId = groupIdByTitle.get(label);
    if (existingId != null) {
      await chrome.tabs.group({ tabIds, groupId: existingId });
    } else if (totalGroups < newGroupCeiling) {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: label,
        color: GROUP_COLORS[colorIdx % GROUP_COLORS.length],
      });
      groupIdByTitle.set(label, groupId);
      colorIdx += 1;
      totalGroups += 1;
    } else {
      // At the cap: fold into Other instead of spawning group #9+.
      await getOrCreateOtherGroup(tabIds, colorIdx);
    }
    groupCount += 1;
  }

  return { tabsGrouped: assignments.length, groupCount, assignments };
}

export async function suggestCategories(workerUrl, tabs, existingGroupTitles = []) {
  const res = await fetch(`${workerUrl.replace(/\/$/, "")}/suggest-categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Extension-Secret": EXTENSION_SHARED_SECRET },
    body: JSON.stringify({
      tabs: tabs.map(({ id, title, url }) => ({ id, title, url: sanitizeUrlForAI(url) })),
      existingGroupTitles,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Suggest-categories error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!Array.isArray(data.categories) || !data.categories.length) {
    throw new Error("Worker returned no categories");
  }
  return data.categories;
}
