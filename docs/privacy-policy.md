# Tab Organizer (AI) Privacy Policy

**Effective date:** September 18, 2026

Tab Organizer uses tab titles and privacy-safe URLs only to organize your open tabs. It does not read page content, sell personal data, serve ads, or use browsing data for advertising.

## Information the extension handles

When you choose to organize tabs, the extension reads the title and URL of unpinned HTTP and HTTPS tabs in the current browser window. Before any URL leaves the browser, the extension removes its query parameters, fragment, and embedded credentials. For example, `https://example.com/page?token=secret#section` is reduced to `https://example.com/page`.

The extension does not send page contents, cookies, form entries, passwords, browsing history outside the current set of tabs, pinned tabs, or internal browser pages.

## How information is used

Tab titles and sanitized URLs are sent over HTTPS to the Tab Organizer Cloudflare Worker and used only to classify tabs into categories. Classification requests are processed by [TypeSafe AI](https://typesafe.ai/legal/privacy-policy). When you use “Organize with AI,” the same limited data and the names of existing tab groups are also processed through [OpenRouter](https://openrouter.ai/privacy) and its selected model provider to suggest useful categories.

The developer does not intentionally store tab titles or URLs on the Tab Organizer server. Infrastructure and AI providers may process technical logs and request data according to their own policies.

## Information stored in Chrome

Categories, scheduling preferences, and duplicate-cleanup preferences are stored with `chrome.storage.sync`. Organization state, onboarding state, and the most recent run status are stored with `chrome.storage.local`. Chrome may sync compatible settings through your Google account according to Google's policies.

## Sharing, advertising, and human access

Information is transferred only to service providers needed to provide tab organization: Cloudflare, TypeSafe AI, OpenRouter, and OpenRouter's selected inference provider. The developer does not sell user data, use it for personalized advertising, use it to determine creditworthiness, or permit humans to read it except when required for security, legal compliance, or support specifically requested by the user.

## Your choices and deletion

AI processing occurs when you click an organize button or when a timer you explicitly enabled runs. You can disable scheduled organization and duplicate cleanup in the extension popup. Removing the extension deletes its local data from that Chrome profile. Synced settings can also be cleared through Chrome or your Google account.

## Security

All remote requests use HTTPS. The extension removes query parameters and fragments before transmission and limits server access to the single production backend declared in its manifest.

## Chrome Web Store Limited Use

The use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide and improve the extension's user-facing tab-management features.

## Contact

For privacy questions or deletion requests, open an issue at [github.com/Paul-Sizon/tab-organizer/issues](https://github.com/Paul-Sizon/tab-organizer/issues).
