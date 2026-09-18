import { DEFAULT_CATEGORIES, MAX_STORED_CATEGORIES } from "./shared.js";

const categoryListEl = document.getElementById("category-list");
const addCategoryBtn = document.getElementById("add-category-btn");
const addCategoryForm = document.getElementById("add-category-form");
const newLabelInput = document.getElementById("new-category-label");
const newDescInput = document.getElementById("new-category-desc");
const saveCategoryBtn = document.getElementById("save-category-btn");
const cancelCategoryBtn = document.getElementById("cancel-category-btn");
const organizeBtn = document.getElementById("organize-btn");
const aiOrganizeBtn = document.getElementById("ai-organize-btn");
const ungroupBtn = document.getElementById("ungroup-btn");
const resetCategoriesBtn = document.getElementById("reset-categories-btn");
const categoriesTitleEl = document.getElementById("categories-title");
const statusEl = document.getElementById("status");
const autoIntervalSelect = document.getElementById("auto-interval");
const duplicateCleanupCheckbox = document.getElementById("duplicate-cleanup");
const infoBtn = document.getElementById("info-btn");
const infoModal = document.getElementById("info-modal");
const closeInfoBtn = document.getElementById("close-info-btn");
const onboardingHint = document.getElementById("onboarding-hint");
const dismissHintBtn = document.getElementById("dismiss-hint-btn");

const DEFAULT_KEYS = new Set(DEFAULT_CATEGORIES.map((c) => c.key));

let categories = [];
let hasOrganizedOnce = false;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function withViewTransition(fn) {
  if (prefersReducedMotion() || !document.startViewTransition) {
    fn();
    return;
  }
  document.startViewTransition(fn);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(["categories", "autoOrganizeMinutes", "duplicateCleanupEnabled"]);
  categories = Array.isArray(stored.categories) && stored.categories.length
    ? stored.categories
    : DEFAULT_CATEGORIES;
  renderCategories();
  autoIntervalSelect.value = String(stored.autoOrganizeMinutes || 0);
  duplicateCleanupCheckbox.checked = stored.duplicateCleanupEnabled !== false;

  const local = await chrome.storage.local.get(["hasOrganizedOnce", "onboardingDismissed"]);
  hasOrganizedOnce = !!local.hasOrganizedOnce;
  applyButtonHierarchy();
  onboardingHint.classList.toggle("hidden", hasOrganizedOnce || !!local.onboardingDismissed);
}

function applyButtonHierarchy() {
  const primaryBtn = hasOrganizedOnce ? organizeBtn : aiOrganizeBtn;
  const secondaryBtn = hasOrganizedOnce ? aiOrganizeBtn : organizeBtn;
  primaryBtn.className = "slot-primary primary-btn";
  secondaryBtn.className = "slot-secondary secondary-btn";
  aiOrganizeBtn.textContent = hasOrganizedOnce ? "🔄 Regenerate Categories" : "✨ Organize with AI";
}

function renderCategories() {
  categoriesTitleEl.textContent = `Categories (${categories.length}/${MAX_STORED_CATEGORIES})`;
  categoryListEl.innerHTML = "";
  for (const cat of categories) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    const aiBadge = DEFAULT_KEYS.has(cat.key) ? "" : `<span class="ai-badge">AI</span>`;
    text.innerHTML = `<span class="cat-label">${escapeHtml(cat.label)}${aiBadge}</span><br><span class="cat-desc">${escapeHtml(cat.description)}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => removeCategory(cat.key));
    li.appendChild(text);
    li.appendChild(removeBtn);
    categoryListEl.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function persistCategories() {
  await chrome.storage.sync.set({ categories });
}

function removeCategory(key) {
  categories = categories.filter((c) => c.key !== key);
  persistCategories();
  withViewTransition(renderCategories);
}

addCategoryBtn.addEventListener("click", () => {
  addCategoryForm.classList.remove("hidden");
  newLabelInput.focus();
});

cancelCategoryBtn.addEventListener("click", () => {
  newLabelInput.value = "";
  newDescInput.value = "";
  addCategoryForm.classList.add("hidden");
});

saveCategoryBtn.addEventListener("click", () => {
  const label = newLabelInput.value.trim();
  if (!label) return;
  const description = newDescInput.value.trim() || `Tabs related to ${label}`;
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `cat_${Date.now()}`;
  categories = categories.filter((c) => c.key !== key);
  categories.push({ key, label, description });
  persistCategories();
  withViewTransition(renderCategories);
  newLabelInput.value = "";
  newDescInput.value = "";
  addCategoryForm.classList.add("hidden");
});

function setStatus(msg) {
  statusEl.textContent = msg;
}

function renderResult(record) {
  const cleanup = record.duplicatesRemoved
    ? `Removed ${record.duplicatesRemoved} duplicate${record.duplicatesRemoved === 1 ? "" : "s"}. `
    : "";
  if (record.error) {
    setStatus(`Error: ${record.error}`);
  } else if (record.skipped) {
    setStatus(`${cleanup}Nothing new to organize — already sorted.`);
  } else {
    setStatus(`${cleanup}Grouped ${record.tabsGrouped} tabs into ${record.groupCount} groups.`);
  }
}

function setActionButtonsDisabled(disabled) {
  organizeBtn.disabled = disabled;
  aiOrganizeBtn.disabled = disabled;
  ungroupBtn.disabled = disabled;
}

async function runOrganizeNow(mode) {
  if (!categories.length) {
    setStatus("Add at least one category.");
    return;
  }

  await chrome.storage.sync.set({ categories });

  setActionButtonsDisabled(true);
  setStatus(mode === "auto" ? "Asking AI for categories…" : "Organizing…");

  const record = await chrome.runtime.sendMessage({ type: "organize-now", mode });
  setActionButtonsDisabled(false);
  renderResult(record);

  if (!record.error) {
    hasOrganizedOnce = true;
    await chrome.storage.local.set({ hasOrganizedOnce: true });
    withViewTransition(applyButtonHierarchy);
    onboardingHint.classList.add("hidden");
  }
}

organizeBtn.addEventListener("click", () => runOrganizeNow("manual"));
aiOrganizeBtn.addEventListener("click", () => runOrganizeNow("auto"));

ungroupBtn.addEventListener("click", async () => {
  setActionButtonsDisabled(true);
  setStatus("Removing groups…");
  const result = await chrome.runtime.sendMessage({ type: "ungroup-all" });
  setActionButtonsDisabled(false);
  setStatus(`Ungrouped ${result.tabsUngrouped} tabs.`);
});

resetCategoriesBtn.addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "reset-categories" });
  categories = result.categories;
  withViewTransition(renderCategories);
  setStatus("Categories reset to defaults.");
});

autoIntervalSelect.addEventListener("change", async () => {
  const minutes = parseInt(autoIntervalSelect.value, 10) || 0;
  await chrome.storage.sync.set({ autoOrganizeMinutes: minutes });
  await chrome.runtime.sendMessage({ type: "set-auto-interval", minutes });
});

duplicateCleanupCheckbox.addEventListener("change", async () => {
  await chrome.storage.sync.set({ duplicateCleanupEnabled: duplicateCleanupCheckbox.checked });
});

function openInfoModal() {
  withViewTransition(() => infoModal.classList.remove("hidden"));
}

function closeInfoModal() {
  withViewTransition(() => infoModal.classList.add("hidden"));
}

infoBtn.addEventListener("click", openInfoModal);
closeInfoBtn.addEventListener("click", closeInfoModal);
infoModal.addEventListener("click", (e) => {
  if (e.target === infoModal) closeInfoModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !infoModal.classList.contains("hidden")) closeInfoModal();
});

dismissHintBtn.addEventListener("click", async () => {
  onboardingHint.classList.add("hidden");
  await chrome.storage.local.set({ onboardingDismissed: true });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.categories) {
    categories = changes.categories.newValue?.length ? changes.categories.newValue : DEFAULT_CATEGORIES;
    withViewTransition(renderCategories);
  }
});

loadSettings();
