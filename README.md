# GitHub UI/UX Enhancer

[![Test](https://github.com/Willyangl/github-uiux-enhancer/actions/workflows/test.yml/badge.svg)](https://github.com/Willyangl/github-uiux-enhancer/actions/workflows/test.yml)

A browser extension for Microsoft Edge / Chrome that improves the usability of GitHub.

## Features

### 1. Widen Branch Selection Dropdown
Widens the branch selection dropdowns across GitHub, such as on the repository page and the "Run workflow" modal in GitHub Actions. The displayed character limit can be configured via the popup (20-120 characters, default is 50). Supports both the legacy SelectMenu and the latest Primer SelectPanel (React Portal).

| Before | After |
|--------|-------|
| ![Before](docs/dropdown-before.png) | ![After](docs/dropdown-after.png) |

### 2. Full Branch Name Display in Actions Workflow History + Copy Button
Resolves the issue where branch names are truncated in the GitHub Actions workflow list. Automatically wraps the text according to the column width and displays the full branch name. A one-click copy button is also added next to the branch name.

![Full branch name + Copy button](docs/branch-name-copy.png)

### 3. Workflow Completion Notification
- **List / Detail View**: Displays a "Notify" button on running workflow rows. Click to register for notifications.
- **Auto-Notification Registration**: When enabled from the popup, currently running workflows are automatically registered for notifications.
- **Completion Notification**: Two-step notification with an in-page toast notification (bottom right) + OS desktop notification.
- **Notification Click**: Clicking the OS notification opens the corresponding workflow page.
- **Completion Status**: Once completed, the button changes to "Notified" (disabled, green color).

![Workflow notification button](docs/notify-button.png)

![Completion toast notification](docs/notify-toast.png)

### 4. Multilingual Support
Supports Japanese, English, and Chinese. Can be switched instantly from the header of the popup. The initial language is automatically detected from the browser's language settings on first launch.

### 5. Enable/Disable Switches for Each Feature
Each feature can be toggled ON/OFF individually from the popup. Settings are applied immediately.

![Extension popup UI](docs/popup-settings.png)

## Installation

### Chrome Web Store
(Link will be posted after passing the review)

### Edge (Developer Mode)

1. Open `edge://extensions/`
2. Enable **"Developer mode"**
3. Click **"Load unpacked"**
4. Select the folder of this repository

### Chrome (Developer Mode)

1. Open `chrome://extensions/`
2. Enable **"Developer mode"**
3. Click **"Load unpacked"**
4. Select the folder of this repository

## Notification Setup

A **GitHub Personal Access Token** is required to use workflow completion notifications.

1. Click the extension icon to open the popup.
2. Create a token at the [GitHub Token Generation Page](https://github.com/settings/tokens/new?scopes=repo&description=GitHub+Enhancer) (requires the `repo` scope).
3. Paste the token into the input field in the popup and click "Save".

The token is saved in the browser's `chrome.storage.local` and is used to authenticate requests to the GitHub API. It is never sent externally.

## File Structure

```
github-enhancer/
├── manifest.json       # Extension manifest (Manifest V3)
├── package.json        # Node.js dependencies and scripts
├── package-lock.json   # Lockfile for npm dependencies
├── content.js          # Content script (DOM manipulation for features 1-3)
├── background.js       # Service worker (API polling, notifications)
├── popup.html          # Settings popup UI
├── popup.js            # Settings popup logic
├── styles.css          # CSS (dropdown width, branch name, buttons, toasts)
├── i18n.js             # Internationalization module (ja/en/zh)
├── generate-icons.js   # Script to generate extension icons
├── _locales/           # Chrome extension localization directories
│   ├── en/             # English locale
│   ├── ja/             # Japanese locale
│   └── zh_CN/          # Chinese locale
├── i18n/
│   ├── ja.json         # Japanese translation
│   ├── en.json         # English translation
│   └── zh.json         # Chinese translation
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── docs/               # Screenshots
├── test/               # Jest unit tests (106 test cases)
└── .github/workflows/
    ├── test.yml        # Test CI (push to main, PR)
    ├── release.yml     # Release CI (creates ZIP + GitHub Release on v* tag)
    └── dummy-long.yml  # Dummy workflow for test runs
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test
```

### Release

```bash
git tag v1.1.0
git push origin v1.1.0
# -> GitHub Actions: Test -> Create ZIP -> Create GitHub Release
```

## Privacy Policy

GitHub UI/UX Enhancer is committed to protecting your privacy. This policy explains what data the extension accesses and how it is used.

### Data Collected and Stored

| Data | Purpose | Storage |
|------|---------|---------|
| GitHub Personal Access Token | Authenticate with GitHub API to check workflow run status | `chrome.storage.local` (browser only) |
| User preferences (feature toggles, language, dropdown width) | Persist extension settings | `chrome.storage.local` (browser only) |
| Watched workflow run IDs and URLs | Track workflows registered for completion notifications | `chrome.storage.local` (browser only) |

### Data NOT Collected

- No personal information is collected or transmitted to any third party.
- No analytics, tracking, or telemetry data is gathered.
- No data is stored on external servers.

### External Requests

The extension communicates **only** with the following services:

- **github.com** — To inject UI enhancements into GitHub pages (content script).
- **api.github.com** — To check workflow run status using the user's own Personal Access Token. This token is stored locally and is never shared.

### User Control

- All stored data remains in your browser's local storage and can be cleared at any time via `chrome://extensions/` → Extension Details → Clear data.
- The GitHub Personal Access Token can be removed from the extension popup at any time.

### Changes to This Policy

If this policy changes, the updated version will be published in this repository.

### Contact

For questions or concerns, please open an issue at [GitHub Issues](https://github.com/Willyangl/github-uiux-enhancer/issues).

---

## Notes

- Since GitHub's UI changes from time to time, selectors may stop matching. In that case, please adjust the selectors in `content.js`.
- The GitHub Personal Access Token is saved in the browser's local storage. Please be careful when using a shared PC.
- The background worker polls the GitHub API every minute (stops automatically if there are no targets to monitor). Please be aware of the API Rate Limit (5,000 requests/hour).
