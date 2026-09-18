export interface Env {
  TYPESAFE_API_KEY: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
  EXTENSION_SHARED_SECRET?: string;
}

interface TabInput {
  id?: number;
  title: string;
  url: string;
}

interface CategoryInput {
  key: string;
  label: string;
  description: string;
}

interface SuggestedCategory extends CategoryInput {
  tab_count?: number;
}

const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TYPESAFE_MODEL = "jev-latest";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";

// Category-count balance: keep the number of AI-suggested groups sensible
// relative to how many tabs there are, so you never end up with more groups
// than tabs. Tuned for "a handful of clear buckets", not one per tab.
const MIN_SUGGESTED_CATEGORIES = 3;
const MAX_SUGGESTED_CATEGORIES = 8;
const TARGET_TABS_PER_CATEGORY = 3;

const OTHER_CATEGORY: CategoryInput = {
  key: "other",
  label: "Other",
  description: "Anything that does not clearly fit another category",
};

// Hard caps so a single request can't multiply upstream (TypeSafe/OpenRouter)
// cost or worker CPU arbitrarily — these are cost/abuse limits, not UX limits.
const MAX_TABS = 200;
const MAX_CATEGORIES = 30;
const MAX_TITLE_LEN = 300;
const MAX_URL_LEN = 2000;
const MAX_DESCRIPTION_LEN = 500;

function maxCategoriesFor(tabCount: number): number {
  const suggested = Math.round(tabCount / TARGET_TABS_PER_CATEGORY);
  return Math.min(MAX_SUGGESTED_CATEGORIES, Math.max(MIN_SUGGESTED_CATEGORIES, suggested));
}

// Only a browser can be forced to send an Origin header by a page it didn't
// choose to load; a chrome-extension:// origin is us, anything else (a
// random website's script) gets no CORS grant. This does nothing against a
// direct script/curl call, which is what EXTENSION_SHARED_SECRET is for.
function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Extension-Secret",
    Vary: "Origin",
  };
  if (origin.startsWith("chrome-extension://")) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(body: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

function checkAuth(request: Request, env: Env): Response | null {
  if (!env.EXTENSION_SHARED_SECRET) return null;
  const provided = request.headers.get("X-Extension-Secret");
  if (provided !== env.EXTENSION_SHARED_SECRET) {
    return jsonResponse({ error: "unauthorized" }, 401, request);
  }
  return null;
}

async function handleGroup(request: Request, env: Env): Promise<Response> {
  const authError = checkAuth(request, env);
  if (authError) return authError;

  let body: { tabs: TabInput[]; categories: CategoryInput[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400, request);
  }

  const { tabs, categories } = body;
  if (!Array.isArray(tabs) || !tabs.length) {
    return jsonResponse({ error: "tabs must be a non-empty array" }, 400, request);
  }
  if (!Array.isArray(categories) || !categories.length) {
    return jsonResponse({ error: "categories must be a non-empty array" }, 400, request);
  }
  if (tabs.length > MAX_TABS) {
    return jsonResponse({ error: `tabs must not exceed ${MAX_TABS}` }, 400, request);
  }
  if (categories.length > MAX_CATEGORIES) {
    return jsonResponse({ error: `categories must not exceed ${MAX_CATEGORIES}` }, 400, request);
  }
  if (tabs.some((t) => (t.title || "").length > MAX_TITLE_LEN || (t.url || "").length > MAX_URL_LEN)) {
    return jsonResponse({ error: "tab title/url too long" }, 400, request);
  }
  if (categories.some((c) => (c.description || "").length > MAX_DESCRIPTION_LEN)) {
    return jsonResponse({ error: "category description too long" }, 400, request);
  }

  const criteria = Object.fromEntries(categories.map((c) => [c.key, c.description]));

  const questions: Record<string, unknown> = {};
  tabs.forEach((_tab, i) => {
    questions[`tab_${i}`] = {
      type: "choice",
      instructions: `What category best fits the browser tab described by \`tabs[${i}]\` (its title and URL)? Pick the single best match.`,
      criteria,
    };
  });

  const state = { tabs: tabs.map((t) => ({ title: t.title, url: t.url })) };

  let apiRes: Response;
  try {
    apiRes = await fetch(TYPESAFE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state, model: TYPESAFE_MODEL, questions }),
    });
  } catch (err) {
    return jsonResponse({ error: `TypeSafe request failed: ${(err as Error).message}` }, 502, request);
  }

  if (!apiRes.ok) {
    return jsonResponse({ error: `TypeSafe API error ${apiRes.status}` }, 502, request);
  }

  const data = await apiRes.json<{ answers: Record<string, { choice: string; confidence: number }> }>();

  const assignments = tabs.map((tab, i) => {
    const answer = data.answers[`tab_${i}`];
    return {
      id: tab.id,
      category: answer ? answer.choice : "other",
      confidence: answer ? answer.confidence : 0,
    };
  });

  return jsonResponse({ assignments }, 200, request);
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : content;
  return JSON.parse(raw.trim());
}

async function handleSuggestCategories(request: Request, env: Env): Promise<Response> {
  const authError = checkAuth(request, env);
  if (authError) return authError;

  if (!env.OPENROUTER_API_KEY) {
    return jsonResponse({ error: "OPENROUTER_API_KEY is not configured" }, 500, request);
  }

  let body: { tabs: TabInput[]; existingGroupTitles?: string[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400, request);
  }

  const { tabs, existingGroupTitles } = body;
  if (!Array.isArray(tabs) || !tabs.length) {
    return jsonResponse({ error: "tabs must be a non-empty array" }, 400, request);
  }
  if (tabs.length > MAX_TABS) {
    return jsonResponse({ error: `tabs must not exceed ${MAX_TABS}` }, 400, request);
  }
  if (tabs.some((t) => (t.title || "").length > MAX_TITLE_LEN || (t.url || "").length > MAX_URL_LEN)) {
    return jsonResponse({ error: "tab title/url too long" }, 400, request);
  }

  const maxCategories = maxCategoriesFor(tabs.length);
  const tabList = tabs.map((t) => `- ${t.title} (${t.url})`).join("\n");
  const existingTitles = (existingGroupTitles || []).filter((t) => t && t !== "Other");
  const existingSection = existingTitles.length
    ? `\n\nThese tab groups already exist: ${existingTitles.join(", ")}. Strongly prefer reusing one of these exact names over inventing a new, similarly-themed category — only propose something new if none of them genuinely fit a tab. Group counts only grow over time; naming a near-duplicate ("Development" when "Dev Docs" already exists) wastes a slot.`
    : "";

  const prompt = `You are identifying the natural categories among a user's open browser tabs.

Look at the tabs below and identify every genuinely distinct, single-concept theme you see. Do not force two different purposes into one category just to keep the count low — that is not your job. List every real theme even if that's more than ${maxCategories}; code on our side will trim it down using the tab_count you provide. As a sanity ceiling only, list at most 12 categories total. Do not include a catch-all "other" category; one will be added automatically.${existingSection}

Each category must represent exactly ONE concept. Never join two different concepts into one label with "and" / "&". These are WRONG, each crams two ideas into one category:
- "Email and Calendar" — should be "Email" and "Calendar", separately
- "AI and Developer Tools" — should be "Dev Tools" (or split further if genuinely distinct)
- "Career and Networking" — should be "Career" and "Networking", separately, or just the one that actually fits

Label style: short, familiar, everyday names a person would recognize at a glance — for example "Work", "Shopping", "News", "Entertainment", "Dev Docs", "Social". Use however many words actually reads naturally for that category (often just one) — do not pad every label to the same length. Name the category by its everyday purpose, not by describing what kind of site it is: write "Entertainment" or "Video", not "Video Platform"; "Social", not "Social Media Platform".

For each category, also give "tab_count": your best estimate of how many of the listed tabs belong to it (each tab counts toward its single best-fit category).

Respond with strict JSON only, no markdown, in this exact shape:
{"categories":[{"key":"snake_case_id","label":"<category name>","description":"One sentence describing what belongs here, written for a classifier","tab_count":<integer>}]}

Tabs:
${tabList}`;

  let apiRes: Response;
  try {
    apiRes = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
  } catch (err) {
    return jsonResponse({ error: `OpenRouter request failed: ${(err as Error).message}` }, 502, request);
  }

  if (!apiRes.ok) {
    return jsonResponse({ error: `OpenRouter API error ${apiRes.status}` }, 502, request);
  }

  const data = await apiRes.json<{ choices: { message: { content: string } }[] }>();
  const content = data.choices?.[0]?.message?.content ?? "";

  let parsed: { categories?: SuggestedCategory[] };
  try {
    parsed = extractJson(content) as { categories?: SuggestedCategory[] };
  } catch {
    return jsonResponse({ error: "Could not parse categories from model response" }, 502, request);
  }

  const suggested = Array.isArray(parsed.categories) ? parsed.categories : [];
  const valid = suggested.filter((c) => c && c.key && c.label && c.description && c.key !== OTHER_CATEGORY.key);

  // Dedupe by key, then let the actual tab_count decide what survives the
  // cap — the model's job is spotting distinct themes, not squeezing them
  // into a budget (that's what produced joined labels like "Email and
  // Calendar" when it was told to hit a low count directly).
  const byKey = new Map<string, SuggestedCategory>();
  for (const c of valid) {
    if (!byKey.has(c.key)) byKey.set(c.key, c);
  }
  const ranked = Array.from(byKey.values()).sort((a, b) => (b.tab_count ?? 0) - (a.tab_count ?? 0));
  const trimmed: CategoryInput[] = ranked
    .slice(0, maxCategories)
    .map(({ key, label, description }) => ({ key, label, description }));

  if (!trimmed.length) {
    return jsonResponse({ error: "Model returned no usable categories" }, 502, request);
  }

  return jsonResponse({ categories: [...trimmed, OTHER_CATEGORY] }, 200, request);
}

function privacyPolicyResponse(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tab Organizer (AI) — Privacy Policy</title>
  <style>
    :root{color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    body{max-width:760px;margin:0 auto;padding:40px 22px 72px;line-height:1.65}
    h1{line-height:1.2}h2{margin-top:30px}.summary{padding:16px 18px;border:1px solid #818cf8;border-radius:12px}a{color:#818cf8}
  </style>
</head>
<body>
  <h1>Tab Organizer (AI) Privacy Policy</h1>
  <p><strong>Effective date:</strong> September 18, 2026</p>
  <p class="summary">Tab Organizer uses tab titles and privacy-safe URLs only to organize open tabs. It does not read page content, sell personal data, serve ads, or use browsing data for advertising.</p>

  <h2>Information the extension handles</h2>
  <p>When a user chooses to organize tabs, the extension reads the title and URL of unpinned HTTP and HTTPS tabs in the current browser window. Before any URL leaves the browser, the extension removes query parameters, fragments, and embedded credentials. For example, <code>https://example.com/page?token=secret#section</code> is reduced to <code>https://example.com/page</code>.</p>
  <p>The extension does not send page contents, cookies, form entries, passwords, browsing history outside the current set of tabs, pinned tabs, or internal browser pages.</p>

  <h2>How information is used</h2>
  <p>Tab titles and sanitized URLs are sent over HTTPS to the Tab Organizer Cloudflare Worker and used only to classify tabs into categories. Classification requests are processed by TypeSafe AI. When “Organize with AI” is used, the same limited data and the names of existing tab groups are also processed through OpenRouter and its selected model provider to suggest useful categories.</p>
  <p>The developer does not intentionally store tab titles or URLs on the Tab Organizer server. Infrastructure and AI providers may process technical logs and request data according to their own policies.</p>

  <h2>Information stored in Chrome</h2>
  <p>Categories, scheduling preferences, and duplicate-cleanup preferences are stored with Chrome sync storage. Organization state, onboarding state, and the most recent run status are stored locally in Chrome.</p>

  <h2>Sharing and advertising</h2>
  <p>Information is transferred only to service providers needed for tab organization: Cloudflare, TypeSafe AI, OpenRouter, and OpenRouter's selected inference provider. The developer does not sell user data, use it for personalized advertising, use it to determine creditworthiness, or permit humans to read it except for user-requested support, security, or legal compliance.</p>

  <h2>User choices and deletion</h2>
  <p>AI processing occurs when a user clicks an organize button or when a timer the user explicitly enabled runs. Scheduled organization and duplicate cleanup can be disabled in the extension popup. Removing the extension deletes its local data from that Chrome profile. Synced settings can also be managed through Chrome or the user's Google account.</p>

  <h2>Security</h2>
  <p>All remote requests use HTTPS. The extension removes query parameters and fragments before transmission and limits server access to the single production backend declared in its manifest.</p>

  <h2>Chrome Web Store Limited Use</h2>
  <p>The use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide and improve the extension's user-facing tab-management features.</p>

  <h2>Service providers</h2>
  <ul>
    <li><a href="https://www.cloudflare.com/privacypolicy/">Cloudflare Privacy Policy</a></li>
    <li><a href="https://typesafe.ai/legal/privacy-policy">TypeSafe AI Privacy Policy</a></li>
    <li><a href="https://openrouter.ai/privacy">OpenRouter Privacy Policy</a></li>
  </ul>

  <h2>Contact</h2>
  <p>For privacy questions or deletion requests, open an issue at <a href="https://github.com/Paul-Sizon/tab-organizer/issues">github.com/Paul-Sizon/tab-organizer/issues</a>.</p>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/privacy") {
      const response = privacyPolicyResponse();
      return request.method === "HEAD" ? new Response(null, { headers: response.headers }) : response;
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "not found" }, 404, request);
    }

    if (url.pathname === "/group") return handleGroup(request, env);
    if (url.pathname === "/suggest-categories") return handleSuggestCategories(request, env);

    return jsonResponse({ error: "not found" }, 404, request);
  },
};
