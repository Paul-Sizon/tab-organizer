# Tab Organizer (AI)

<video src="docs/media/demo.mp4" controls width="600">
  Your browser can't play this inline — watch it at <a href="docs/media/demo.mp4">docs/media/demo.mp4</a>.
</video>

A Chrome extension that tidies your tab chaos into named groups automatically.
Click a button (or set a timer) and it reads your open tabs, figures out what
they're about, and groups them for you using AI.

Under the hood it's two AI calls talking to two different providers, both
proxied through a small Cloudflare Worker so your API keys never touch the
browser:

- **TypeSafe AI's Choice primitive** (`jev-latest`) does the actual
  classification — sorting each tab into one of your categories.
- **DeepSeek** (via OpenRouter) is optional and only kicks in for
  auto-organize: it looks at your current tabs and proposes fresh category
  names, so groups stay relevant as your browsing shifts instead of you
  hand-editing a category list forever.

## How it's built

- `extension/` — Manifest V3 extension.
  - `background.js` (service worker) does the actual work: reads settings
    from `chrome.storage`, calls the worker, and builds native tab groups via
    `chrome.tabs.group` / `chrome.tabGroups.update`. Runs on a
    `chrome.alarms` timer when auto-organize is on, or on demand via a
    message from the popup.
  - `shared.js` — the tab-collection/classify/group logic, imported by both
    `background.js` and (for the category list default) `popup.js`.
  - `popup.js` — settings UI (worker URL, categories, auto-organize
    interval) and the manual "Organize Tabs Now" button. Sends the actual
    work to `background.js` via `chrome.runtime.sendMessage` so it works the
    same whether triggered by hand or by the timer.
- `worker/` — Cloudflare Worker with two routes:
  - `POST /group` — `{tabs, categories}` → one TypeSafe `systemOne` request
    (Choice question per tab) → `{assignments: [{id, category, confidence}]}`.
  - `POST /suggest-categories` — `{tabs}` → one OpenRouter chat request to
    DeepSeek (`deepseek/deepseek-v4-flash` by default) asking it to propose
    categories that fit the *current* tabs → `{categories: [...]}`, with a
    fixed "Other" category always appended in code (not left to the model).

### Why two AI providers instead of one

TypeSafe's Choice primitive is great at sorting things into a list you give
it, but it can't invent new category names on its own — that needs a
generative model. So each flow uses only what it needs:

- **Manual click ("Organize Tabs Now")** — just classification, against
  whatever categories you already have. One API call, no extra latency.
- **Timer-triggered auto-organize** — since you're not watching, it's worth
  the extra round trip: DeepSeek looks at your current tabs and proposes
  fresh categories first, then TypeSafe sorts tabs into them. Keeps groups
  relevant without you babysitting the category list.

### Keeping the category count sane

DeepSeek's category suggestions are capped so you don't end up with more
groups than tabs: `min(8, max(3, round(tabCount / 3)))`. Tunable via the
constants at the top of `worker/src/index.ts`
(`MIN_SUGGESTED_CATEGORIES`, `MAX_SUGGESTED_CATEGORIES`,
`TARGET_TABS_PER_CATEGORY`). An "Other" category is always added on top,
outside that cap.

## Setup

### 1. Deploy the worker

```bash
cd worker
pnpm install
pnpm exec wrangler secret put TYPESAFE_API_KEY         # paste your TypeSafe API key
pnpm exec wrangler secret put OPENROUTER_API_KEY       # paste your OpenRouter API key
pnpm exec wrangler secret put EXTENSION_SHARED_SECRET  # paste a random string, e.g. `openssl rand -hex 32`
pnpm run deploy
```

`OPENROUTER_MODEL` is a plain (non-secret) var in `worker/wrangler.toml` —
edit it there and redeploy if OpenRouter renames/retires the model slug.

Note the deployed URL (e.g. `https://tab-organizer-worker.<you>.workers.dev`).

`EXTENSION_SHARED_SECRET` is what keeps random strangers from calling your
worker directly and burning your TypeSafe/OpenRouter quota — the worker
rejects any request whose `X-Extension-Secret` header doesn't match it (skip
this secret and it stays open to anyone who has the URL). Put the same value
in `extension/shared.js`'s `EXTENSION_SHARED_SECRET` constant before loading
the extension. Since that file ships with the extension, this isn't a real
secret against a determined attacker who unpacks it — it only stops casual
copy-paste abuse. Don't commit your real value if you fork this publicly;
leave it as `""` in git and set it locally/in your build only.

For local development instead of deploying: put both keys in
`worker/.dev.vars` (gitignored) as `TYPESAFE_API_KEY=...` and
`OPENROUTER_API_KEY=...`, then `pnpm run dev`; it serves on
`http://localhost:8787`. Temporarily add `http://localhost:8787/*` to the
extension manifest's `host_permissions`. The production manifest intentionally
allow-lists only the deployed Worker, as required by Chrome Web Store's
minimum-permission policy.

### 2. Load the extension

1. Open `chrome://extensions` (works in Brave too, or `brave://extensions`),
   enable Developer mode.
2. "Load unpacked" → select the `extension/` folder.
3. Click the extension icon and add/remove categories as needed.
4. Click **Organize Tabs Now** for an immediate one-off, or pick an
   **Auto-organize** interval to have it run on a timer (using
   AI-suggested categories each time).

## Testing

- `extension/tests/` — Playwright e2e (`pnpm run test:e2e` from `extension/`):
  loads the unpacked extension in a real Chromium, mocks the worker's
  `/group` response for determinism, drives the popup, and asserts the
  resulting native `chrome.tabGroups`. A second spec checks that picking an
  auto-organize interval creates/clears the `chrome.alarms` entry.
- `extension/tests/manual-demo.ts` (`pnpm run demo`) — opens a real, visible
  Chromium window with the extension loaded and several real tabs, for
  eyeballing the result yourself. Needs the worker running locally first.

## Notes

- Only `http(s)` tabs are sent for classification; pinned tabs and internal
  pages (`chrome://`, etc.) are left alone.
- `host_permissions` is scoped to `*.workers.dev` plus `localhost:8787` /
  `127.0.0.1:8787` for local dev. If you deploy the worker on a custom
  domain, update `extension/manifest.json` accordingly.
- Categories (label + description) are stored in `chrome.storage.sync` and
  sent as the Choice `criteria` on every manual request, so editing them in
  the popup changes classification immediately — no worker redeploy needed.
- The last run's result (mode, tab/group counts, or error) is stored in
  `chrome.storage.local` and shown in the popup, so you can check what an
  unattended timer run actually did.
