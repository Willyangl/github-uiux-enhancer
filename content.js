/**
 * GitHub Enhancer - Content Script
 *
 * Feature 1: Widen branch dropdowns (configurable by character count)
 * Feature 2: Show full branch names in GitHub Actions workflow list
 * Feature 3: Copy button next to branch names in workflow list
 * Feature 4: Notify button to receive browser notification on workflow completion
 */

'use strict';

// ─── Constants & State ────────────────────────────────────────────────────────

const PROCESSED_ATTR = 'data-gh-enhancer';

// Default settings — overridden by chrome.storage values
let featureToggles = {
  widenDropdown: true,
  fullBranchName: true,
  copyButton: true,
  notifications: true,
};
let dropdownCharCount = 50; // characters visible in dropdown

// Selectors for branch name elements in Actions workflow run rows.
const BRANCH_LINK_SELECTORS = [
  'a.branch-name',
  'span.branch-name',
  '[data-component="branch-name"]',
  '.WorkflowRunBranch a',
  '.workflow-run__branch a',
  'svg.octicon-git-branch ~ a',
  'svg.octicon-git-branch + span a',
  'td .branch-name',
  '[data-testid="workflow-run-branch"] a',
  '[data-testid="workflow-run-branch"] span',
];

// Selectors to identify running workflow rows
const RUNNING_ROW_SELECTORS = [
  '[aria-label="In progress"]',
  '[aria-label="Queued"]',
  'svg.octicon-dot-fill',
  '.workflow-run-status--in_progress',
  '[data-testid="workflow-run-status-in-progress"]',
];

// ─── Settings loader ──────────────────────────────────────────────────────────

function loadSettings(callback) {
  chrome.storage.local.get(['featureToggles', 'dropdownCharCount'], (data) => {
    if (data.featureToggles) {
      featureToggles = { ...featureToggles, ...data.featureToggles };
    }
    if (data.dropdownCharCount != null) {
      dropdownCharCount = data.dropdownCharCount;
    }
    if (callback) callback();
  });
}

// React to settings changes from popup in real-time
chrome.storage.onChanged.addListener((changes) => {
  let needsRerun = false;

  if (changes.featureToggles) {
    featureToggles = { ...featureToggles, ...changes.featureToggles.newValue };
    needsRerun = true;
  }
  if (changes.dropdownCharCount) {
    dropdownCharCount = changes.dropdownCharCount.newValue;
    needsRerun = true;
  }

  if (needsRerun) {
    // Re-apply dropdown widths if char count changed
    reapplyDropdownWidths();
    runAllEnhancements();
  }
});

// ─── Feature 1: Widen branch dropdowns ────────────────────────────────────────

/**
 * Calculates the dropdown width in px from the character count.
 * Uses approximately 7.5px per character (GitHub's monospace-ish font).
 * Adds padding for the dropdown chrome (icon + padding ~40px).
 */
function calcDropdownWidth() {
  return Math.round(dropdownCharCount * 7.5) + 40;
}

/**
 * Finds branch selector dropdowns and widens them based on the configured
 * character count. Supports both legacy SelectMenu and modern Primer
 * SelectPanel/Overlay (portal-rendered).
 */
function widenBranchDropdowns() {
  if (!featureToggles.widenDropdown) return;

  const width = calcDropdownWidth();

  // --- Legacy selectors (older GitHub UI) ---
  const legacySelectors = [
    '.branch-select-menu .SelectMenu-modal',
    '.js-branch-select-menu .SelectMenu-modal',
    '[data-target="branch-filter.repositoryBranchSelectMenu"] .SelectMenu-modal',
    'details[open] .SelectMenu-modal',
  ];

  legacySelectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(modal => {
      applyWidth(modal, width);
    });
  });

  // --- Modern Primer SelectPanel / Overlay (portal-rendered) ---
  // GitHub's branch picker now uses React portals: the overlay is rendered
  // at the top level of the DOM, not inside the branch button.
  // We detect it by looking for overlays that contain branch-related content.
  findBranchOverlays().forEach(overlay => {
    applyWidth(overlay, width);
  });

  // Also widen filter inputs inside dropdowns
  document.querySelectorAll('.SelectMenu-filter input').forEach(input => {
    input.style.setProperty('width', '100%', 'important');
  });
}

/**
 * Applies width to a modal/overlay element if not already processed.
 */
function applyWidth(el, width) {
  if (el.getAttribute(PROCESSED_ATTR) === 'widened') return;
  el.style.setProperty('width', `${width}px`, 'important');
  el.style.setProperty('max-width', '900px', 'important');
  el.setAttribute(PROCESSED_ATTR, 'widened');
}

/**
 * Finds modern Primer-based branch picker overlays.
 * These are rendered via React portals and can be detected by:
 *   - Containing "Switch branches/tags" or branch filter text
 *   - Having [data-target="ref-selector"] or similar data attributes
 *   - Being an Overlay/dialog near an anchored trigger
 */
function findBranchOverlays() {
  const overlays = [];

  // Strategy 1: Find overlays/dialogs containing branch-related headings
  const branchKeywords = ['switch branches', 'switch branches/tags', 'choose a branch'];
  document.querySelectorAll(
    '[role="dialog"], .Overlay, .Overlay-body, .SelectPanel, ' +
    '[data-testid="SelectPanel"], [class*="Overlay"]'
  ).forEach(el => {
    const text = (el.textContent || '').toLowerCase();
    if (branchKeywords.some(kw => text.includes(kw))) {
      // Find the outermost overlay container with a constrained width
      const container = el.closest('[class*="Overlay"]') || el;
      overlays.push(container);
    }
  });

  // Strategy 2: Find the ref-selector component overlays
  document.querySelectorAll(
    'ref-selector, [data-target*="ref-selector"], [data-action*="ref-selector"]'
  ).forEach(el => {
    const overlay = el.closest('[class*="Overlay"]') ||
                    el.closest('[role="dialog"]') ||
                    el.closest('.SelectMenu-modal') ||
                    el;
    overlays.push(overlay);
  });

  // Strategy 3: Direct class patterns from Primer Overlay
  document.querySelectorAll(
    '.Overlay--size-small-portrait, .Overlay--size-medium, ' +
    '.Overlay--size-auto, [class*="Box--overlay"]'
  ).forEach(el => {
    const text = (el.textContent || '').toLowerCase();
    if (text.includes('branch') || text.includes('tag') || text.includes('find or create')) {
      overlays.push(el);
    }
  });

  return [...new Set(overlays)];
}

/**
 * Re-applies dropdown width to already-processed modals when the
 * character count setting changes.
 */
function reapplyDropdownWidths() {
  if (!featureToggles.widenDropdown) return;

  const width = calcDropdownWidth();
  document.querySelectorAll(`[${PROCESSED_ATTR}="widened"]`).forEach(modal => {
    modal.style.setProperty('width', `${width}px`, 'important');
  });
}

// Watch for dropdowns being opened (details element toggles)
document.addEventListener('toggle', (e) => {
  if (e.target && e.target.tagName === 'DETAILS') {
    setTimeout(widenBranchDropdowns, 50);
  }
}, true);

// Watch click events on branch selector buttons (both legacy and modern Primer UI).
// Modern GitHub uses <button> with branch icon or branch name text for the trigger.
document.addEventListener('click', (e) => {
  const btn = e.target.closest(
    // Legacy selectors
    'summary[aria-label*="ranch"], .branch-select-menu summary, button[aria-label*="ranch"], ' +
    // Modern Primer branch picker trigger button
    '[data-hotkey="w"], #branch-picker-repos-header-ref-selector, ' +
    'button[id*="branch"], button[id*="ref-selector"], ' +
    '[class*="BranchName"], [class*="branch-name"]'
  );
  if (btn) {
    // The Primer overlay renders asynchronously via React portal,
    // so we retry a few times with increasing delays.
    setTimeout(widenBranchDropdowns, 100);
    setTimeout(widenBranchDropdowns, 300);
    setTimeout(widenBranchDropdowns, 600);
  }
}, true);

// ─── Feature 2 & 3: Full branch names + copy buttons ─────────────────────────

/**
 * Returns true if the current page is a GitHub Actions runs list page.
 */
function isActionsPage() {
  return /\/actions(\/workflows\/[^/]+)?(\?|$)/.test(location.pathname) ||
         location.pathname.includes('/actions');
}

/**
 * Extracts the branch name text from an element, stripping leading/trailing whitespace.
 */
function getBranchText(el) {
  return (el.textContent || el.innerText || '').trim();
}

/**
 * Shows a tooltip bubble above the target element, then fades out.
 */
function showCopyTooltip(target, text) {
  // Remove any existing tooltip
  const prev = document.querySelector('.gh-enhancer-tooltip');
  if (prev) prev.remove();

  const tip = document.createElement('div');
  tip.className = 'gh-enhancer-tooltip';
  tip.textContent = text;
  document.body.appendChild(tip);

  // Position above the target button
  const rect = target.getBoundingClientRect();
  tip.style.top = `${window.scrollY + rect.top - tip.offsetHeight - 6}px`;
  tip.style.left = `${window.scrollX + rect.left + rect.width / 2 - tip.offsetWidth / 2}px`;

  // Fade out and remove after delay
  setTimeout(() => {
    tip.classList.add('gh-enhancer-tooltip-hide');
    tip.addEventListener('transitionend', () => tip.remove());
  }, 1500);
}

/**
 * Creates a copy button for a given branch name.
 */
function createCopyButton(branchName) {
  const btn = document.createElement('button');
  btn.className = 'gh-enhancer-copy-btn';
  btn.title = `Copy branch name: ${branchName}`;
  btn.setAttribute('aria-label', `Copy branch name ${branchName}`);
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
    <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
  </svg>`;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    let success = false;
    try {
      await navigator.clipboard.writeText(branchName);
      success = true;
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = branchName;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      success = document.execCommand('copy');
      document.body.removeChild(ta);
    }

    // Show checkmark icon + "Copied!" tooltip
    btn.classList.add('copied');
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
    </svg>`;
    showCopyTooltip(btn, success ? 'Copied!' : 'Failed to copy');

    setTimeout(() => {
      btn.classList.remove('copied');
      btn.title = `Copy branch name: ${branchName}`;
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
        <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
      </svg>`;
    }, 2000);
  });

  return btn;
}

/**
 * Finds branch name elements in the Actions workflow runs list,
 * removes truncation CSS, and adds a copy button.
 */
function enhanceBranchNames() {
  if (!isActionsPage()) return;

  const found = new Set();
  BRANCH_LINK_SELECTORS.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => found.add(el));
  });

  // Fallback: find all elements adjacent to git-branch octicon SVGs
  document.querySelectorAll('svg.octicon-git-branch').forEach(svg => {
    let sibling = svg.nextElementSibling;
    while (sibling) {
      const a = sibling.tagName === 'A' ? sibling : sibling.querySelector('a');
      if (a) { found.add(a); break; }
      sibling = sibling.nextElementSibling;
    }
    const parent = svg.parentElement;
    if (parent) {
      parent.querySelectorAll('a, span').forEach(el => {
        if (el.textContent.trim().length > 0 && !el.querySelector('svg')) {
          found.add(el);
        }
      });
    }
  });

  found.forEach(el => {
    if (el.getAttribute(PROCESSED_ATTR)) return;
    el.setAttribute(PROCESSED_ATTR, 'branch-enhanced');

    const branchName = getBranchText(el);
    if (!branchName) return;

    // Feature 2: Show full branch name (auto-wrap within default width)
    if (featureToggles.fullBranchName) {
      el.classList.add('gh-enhancer-branch-name');
    }

    // Feature 3: Add copy button after the element
    if (featureToggles.copyButton) {
      const copyBtn = createCopyButton(branchName);
      if (el.parentElement && !el.parentElement.querySelector('.gh-enhancer-copy-btn')) {
        el.insertAdjacentElement('afterend', copyBtn);
      }
    }
  });
}

// ─── Feature 4: Workflow completion notifications ─────────────────────────────

/**
 * Parses the current GitHub page URL to extract owner, repo, and run ID.
 * Returns null if not on a valid Actions run page.
 */
function parseWorkflowRunUrl(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], runId: m[3] };
}

/**
 * Creates a "Notify me" button for a running workflow row.
 */
function createNotifyButton(runId, runUrl) {
  const btn = document.createElement('button');
  btn.className = 'gh-enhancer-notify-btn';
  btn.dataset.runId = runId;
  btn.title = 'Notify me when this workflow completes';

  const bellIcon = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="margin-right:3px">
    <path d="M8 16a2 2 0 0 0 1.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 0 0 8 16ZM3 5a5 5 0 0 1 10 0v2.947c0 .05.015.098.042.139l1.703 2.555A1.519 1.519 0 0 1 13.482 13H2.518a1.516 1.516 0 0 1-1.263-2.36l1.703-2.554A.255.255 0 0 0 3 7.947Zm5-3.5A3.5 3.5 0 0 0 4.5 5v2.947c0 .346-.102.683-.294.97l-1.703 2.556a.017.017 0 0 0-.003.01l.001.006c0 .002.002.004.004.006l.006.004.007.001h10.964l.007-.001.006-.004.004-.006.001-.007a.017.017 0 0 0-.003-.01l-1.703-2.554a1.745 1.745 0 0 1-.294-.97V5A3.5 3.5 0 0 0 8 1.5Z"/>
  </svg>`;

  btn.innerHTML = `${bellIcon}通知`;

  // Check if already watching this run
  chrome.storage.local.get('watchedRuns', (data) => {
    const watched = data.watchedRuns || {};
    if (watched[runId]) {
      btn.classList.add('active');
      btn.title = 'Watching — will notify when complete (click to cancel)';
      btn.innerHTML = `${bellIcon}通知中`;
    }
  });

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const data = await new Promise(resolve => chrome.storage.local.get('watchedRuns', resolve));
    const watched = data.watchedRuns || {};

    if (watched[runId]) {
      // Cancel notification
      delete watched[runId];
      await new Promise(resolve => chrome.storage.local.set({ watchedRuns: watched }, resolve));
      btn.classList.remove('active');
      btn.title = 'Notify me when this workflow completes';
      btn.innerHTML = `${bellIcon}通知`;
    } else {
      // Check for token
      const tokenData = await new Promise(resolve => chrome.storage.local.get('githubToken', resolve));
      if (!tokenData.githubToken) {
        alert('GitHub Enhancer: GitHub Personal Access Tokenを設定してください。\n拡張機能アイコンをクリックして設定画面を開いてください。');
        return;
      }

      const parsed = parseWorkflowRunUrl(runUrl);
      if (!parsed) {
        alert('GitHub Enhancer: このページのワークフロー情報を取得できませんでした。');
        return;
      }

      watched[runId] = {
        owner: parsed.owner,
        repo: parsed.repo,
        runId,
        runUrl,
        addedAt: Date.now(),
      };
      await new Promise(resolve => chrome.storage.local.set({ watchedRuns: watched }, resolve));

      // Tell background to start polling
      chrome.runtime.sendMessage({ type: 'START_POLLING' });

      btn.classList.add('active');
      btn.title = 'Watching — will notify when complete (click to cancel)';
      btn.innerHTML = `${bellIcon}通知中`;
    }
  });

  return btn;
}

/**
 * Finds workflow rows and injects "Notify me" buttons.
 *
 * Two modes:
 *   1. Running rows (detected by status indicators) — show "通知" button
 *   2. Rows whose run ID is in watchedRuns storage — show "通知中" button
 *      (persists across page reloads until the workflow completes)
 */
function enhanceWorkflowNotifications() {
  if (!isActionsPage()) return;
  if (!featureToggles.notifications) return;

  // Gather all rows that have workflow run links
  const allRunRows = new Map(); // runId → row element
  document.querySelectorAll('a[href*="/actions/runs/"]').forEach(link => {
    const parsed = parseWorkflowRunUrl(link.href);
    if (!parsed) return;
    const row = link.closest('[data-run-id], li, tr, .Box-row, article');
    if (row && !allRunRows.has(parsed.runId)) {
      allRunRows.set(parsed.runId, { row, runUrl: link.href, parsed });
    }
  });

  // Check storage for watched runs, then inject buttons
  chrome.storage.local.get('watchedRuns', (data) => {
    const watched = data.watchedRuns || {};

    allRunRows.forEach(({ row, runUrl, parsed }, runId) => {
      if (row.getAttribute(PROCESSED_ATTR + '-notify')) return;

      // Determine if this row should get a notify button:
      // - It is currently running (status indicator present), OR
      // - Its run ID is in the watched list (user previously clicked "通知")
      const isRunning = !!row.querySelector(RUNNING_ROW_SELECTORS.join(','));
      const isWatched = !!watched[runId];

      if (!isRunning && !isWatched) return;

      row.setAttribute(PROCESSED_ATTR + '-notify', 'true');

      const notifyBtn = createNotifyButton(parsed.runId, runUrl);

      // Insert button — try after status indicator, then after run link
      const statusIndicator = row.querySelector(RUNNING_ROW_SELECTORS.join(','));
      const runLink = row.querySelector('a[href*="/actions/runs/"]');
      if (statusIndicator) {
        statusIndicator.closest('span, div, td')?.insertAdjacentElement('afterend', notifyBtn)
          ?? statusIndicator.insertAdjacentElement('afterend', notifyBtn);
      } else if (runLink) {
        runLink.insertAdjacentElement('afterend', notifyBtn);
      }
    });
  });
}

// ─── Completion toast notification (received from background.js) ────────────

/**
 * Listens for WORKFLOW_COMPLETED messages from the background script
 * and shows an in-page toast notification.
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'WORKFLOW_COMPLETED') {
    showCompletionToast(message.data);
  }
});

/**
 * Shows a toast notification in the bottom-right corner of the page
 * when a watched workflow completes.
 */
function showCompletionToast(data) {
  const { workflowName, branchName, conclusion, runUrl, owner, repo } = data;

  // Ensure toast container exists
  let container = document.getElementById('gh-enhancer-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'gh-enhancer-toast-container';
    document.body.appendChild(container);
  }

  const isSuccess = conclusion === 'success';
  const isCancelled = conclusion === 'cancelled';
  const icon = isSuccess ? '✅' : isCancelled ? '⚠️' : '❌';
  const conclusionLabel = {
    success: '成功', failure: '失敗', cancelled: 'キャンセル',
    timed_out: 'タイムアウト', skipped: 'スキップ',
  }[conclusion] ?? conclusion;

  const statusClass = isSuccess ? 'success' : isCancelled ? 'warning' : 'error';

  const toast = document.createElement('div');
  toast.className = `gh-enhancer-toast gh-enhancer-toast-${statusClass}`;
  toast.innerHTML = `
    <div class="gh-enhancer-toast-header">
      <span class="gh-enhancer-toast-icon">${icon}</span>
      <strong class="gh-enhancer-toast-title">ワークフロー完了</strong>
      <button class="gh-enhancer-toast-close" aria-label="Close">&times;</button>
    </div>
    <div class="gh-enhancer-toast-body">
      <div class="gh-enhancer-toast-workflow">${workflowName ?? 'Workflow'}</div>
      ${branchName ? `<div class="gh-enhancer-toast-branch">ブランチ: ${branchName}</div>` : ''}
      <div class="gh-enhancer-toast-result">結果: ${conclusionLabel}</div>
      <div class="gh-enhancer-toast-repo">${owner}/${repo}</div>
    </div>
    <a class="gh-enhancer-toast-link" href="${runUrl}" target="_blank">詳細を見る →</a>
  `;

  // Close button
  toast.querySelector('.gh-enhancer-toast-close').addEventListener('click', () => {
    toast.classList.add('gh-enhancer-toast-hide');
    toast.addEventListener('transitionend', () => toast.remove());
  });

  container.appendChild(toast);

  // Auto-dismiss after 15 seconds
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('gh-enhancer-toast-hide');
      toast.addEventListener('transitionend', () => toast.remove());
    }
  }, 15000);
}

// ─── MutationObserver: re-run on DOM changes (GitHub SPA) ────────────────────

function runAllEnhancements() {
  enhanceBranchNames();
  enhanceWorkflowNotifications();
}

const observer = new MutationObserver(() => {
  runAllEnhancements();
  // Also check for branch dropdowns — Primer overlays are rendered via portals
  // and appear as new DOM nodes, so MutationObserver is the right place to catch them.
  widenBranchDropdowns();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// GitHub uses Turbo navigation (SPA); re-run on page changes
document.addEventListener('turbo:load', runAllEnhancements);
document.addEventListener('turbo:render', runAllEnhancements);
document.addEventListener('pjax:end', runAllEnhancements);

// Load settings first, then run enhancements
loadSettings(() => {
  runAllEnhancements();
  widenBranchDropdowns();
});
