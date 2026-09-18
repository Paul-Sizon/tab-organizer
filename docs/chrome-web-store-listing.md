# Chrome Web Store submission copy

## Product details

**Name:** Tab Organizer (AI)

**Summary:** Organize open tabs into smart Chrome groups with AI, automatic duplicate cleanup, and optional scheduled sorting.

**Category:** Workflow & Planning

**Language:** English

## Detailed description

Turn a crowded Chrome window into clear, useful tab groups in one click.

Tab Organizer (AI) uses your tab titles and privacy-safe URLs to sort open tabs into native Chrome Tab Groups. Choose your own categories, let AI suggest categories that match your current work, or enable scheduled organization to keep new tabs tidy automatically.

Features:

- One-click AI tab organization
- Native, color-coded Chrome Tab Groups
- Custom categories and descriptions
- AI-generated categories based on the tabs you have open
- Optional automatic organization on a timer
- Duplicate-tab cleanup, enabled by default
- Existing groups are reused instead of recreated
- Pinned tabs and Chrome internal pages are left untouched
- URL query parameters and fragments are removed before AI processing
- No page-content reading, ads, or sale of browsing data

Privacy by design:

The extension sends only the title and sanitized origin/path of unpinned HTTP(S) tabs needed for organization. It does not send page contents, query parameters, URL fragments, cookies, form data, or passwords. See the privacy policy for complete details.

## Single purpose

Tab Organizer (AI) organizes and manages open browser tabs by classifying them into native Chrome Tab Groups, removing duplicate tabs when enabled, and optionally repeating organization on a user-selected schedule.

## Permission justifications

**tabs:** Read titles and URLs of open tabs in the current window, close duplicate tabs when enabled, and move tabs into groups. The extension ignores pinned tabs and non-HTTP(S) pages for AI processing.

**tabGroups:** Create, name, color, reuse, and remove native Chrome Tab Groups.

**storage:** Save categories, user preferences, organization state, onboarding state, and last-run status. Categories and preferences use Chrome sync; operational state stays local.

**alarms:** Run tab organization at the interval explicitly selected by the user. No alarm is created when scheduling is off.

**Host permission — tab-organizer-worker.paul-sizon.workers.dev:** Send tab titles and sanitized URLs over HTTPS to the production backend for AI category suggestion and classification. No other remote host is accessible to the extension.

## Privacy practices answers

Data handled:

- **Web history / browsing activity:** Yes — titles and sanitized URLs of the currently open, unpinned HTTP(S) tabs.
- **Website content:** Yes — tab titles may reflect webpage content. Full page content is never read.
- **Personally identifiable information:** Not intentionally collected. Query parameters, fragments, and embedded URL credentials are stripped before transmission.
- **Authentication information, financial information, health information, personal communications, location, user activity:** No.

Data use:

- Used only for the extension's tab organization functionality.
- Transferred only to Cloudflare, TypeSafe AI, OpenRouter, and OpenRouter's selected inference provider as necessary to provide that functionality.
- Not sold.
- Not used for personalized advertising.
- Not used for creditworthiness or lending.
- Not used for purposes unrelated to the extension's single purpose.
- Human access is prohibited except for user-requested support, security, or legal compliance.

Certify compliance with the Chrome Web Store User Data Policy, including Limited Use.

## URLs

**Homepage:** https://github.com/Paul-Sizon/tab-organizer

**Support:** https://github.com/Paul-Sizon/tab-organizer/issues

**Privacy policy:** https://tab-organizer-worker.paul-sizon.workers.dev/privacy

## Distribution

Recommended first submission: **Unlisted** while testing the production backend and installation flow. All visibility levels undergo the same policy review. Switch to **Public** when verification is complete.
