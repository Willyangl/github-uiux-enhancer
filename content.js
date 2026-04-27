/**
 * GitHub UI/UX Enhancer - Content Script
 *
 * Feature 1: Widen branch dropdowns (configurable by character count)
 * Feature 2: Show full branch names in GitHub Actions workflow list
 * Feature 3: Copy button next to branch names in workflow list
 * Feature 4: Notify button to receive browser notification on workflow completion
 */

'use strict';

// ─── Extension context guard ──────────────────────────────────────────────────

let contextValid = true;

function isContextValid() {
  try {
    void chrome.runtime.id;
    return true;
  } catch {
    contextValid = false;
    if (typeof observer !== 'undefined') observer.disconnect();
    cleanupListeners();
    return false;
  }
}

function safeStorageGet(keys, callback) {
  if (!isContextValid()) return;
  try { chrome.storage.local.get(keys, callback); }
  catch { contextValid = false; }
}

function safeStorageSet(items, callback) {
  if (!isContextValid()) return;
  try { chrome.storage.local.set(items, callback); }
  catch { contextValid = false; }
}

function safeSendMessage(msg) {
  if (!isContextValid()) return;
  try { chrome.runtime.sendMessage(msg); }
  catch { contextValid = false; }
}

// ─── Constants & State ────────────────────────────────────────────────────────

const PROCESSED_ATTR = 'data-gh-enhancer';
const DEBOUNCE_MS = 150;          // MutationObserver debounce delay
const DROPDOWN_RETRY_DELAYS = [100, 300, 600]; // Primer portal render retries

// SVG icon constants (avoid duplication and innerHTML XSS surface)
const ICON_COPY = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>`;
const ICON_CHECK = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`;
const ICON_BELL = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="margin-right:3px"><path d="M8 16a2 2 0 0 0 1.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 0 0 8 16ZM3 5a5 5 0 0 1 10 0v2.947c0 .05.015.098.042.139l1.703 2.555A1.519 1.519 0 0 1 13.482 13H2.518a1.516 1.516 0 0 1-1.263-2.36l1.703-2.554A.255.255 0 0 0 3 7.947Zm5-3.5A3.5 3.5 0 0 0 4.5 5v2.947c0 .346-.102.683-.294.97l-1.703 2.556a.017.017 0 0 0-.003.01l.001.006c0 .002.002.004.004.006l.006.004.007.001h10.964l.007-.001.006-.004.004-.006.001-.007a.017.017 0 0 0-.003-.01l-1.703-2.554a1.745 1.745 0 0 1-.294-.97V5A3.5 3.5 0 0 0 8 1.5Z"/></svg>`;

let featureToggles = {
  widenDropdown: true,
  fullBranchName: true,
  copyButton: true,
  notifications: true,
  autoNotify: false,
  autoLoadJobSummary: true,
  expandRelativeTimes: true,
};
let dropdownCharCount = 50;
let settingsReady = false;

const BRANCH_LINK_SELECTORS = [
  'a.branch-name', 'span.branch-name', '[data-component="branch-name"]',
  '.WorkflowRunBranch a', '.workflow-run__branch a',
  'svg.octicon-git-branch ~ a', 'svg.octicon-git-branch + span a',
  'td .branch-name',
  '[data-testid="workflow-run-branch"] a', '[data-testid="workflow-run-branch"] span',
];

const RUNNING_ROW_SELECTORS = [
  '[aria-label="In progress"]', '[aria-label="Queued"]',
  'svg.octicon-dot-fill', '.workflow-run-status--in_progress',
  '[data-testid="workflow-run-status-in-progress"]',
];

// ─── Settings loader ──────────────────────────────────────────────────────────

function loadSettings(callback) {
  safeStorageGet(['featureToggles', 'dropdownCharCount'], async (data) => {
    if (!data) return;
    if (data.featureToggles) {
      featureToggles = { ...featureToggles, ...data.featureToggles };
    }
    if (data.dropdownCharCount != null) {
      dropdownCharCount = data.dropdownCharCount;
    }
    if (typeof i18n !== 'undefined') {
      await i18n.load();
    }
    settingsReady = true;
    if (callback) callback();
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (!isContextValid()) return;
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
    reapplyDropdownWidths();
    runAllEnhancements();
  }
});

// ─── Feature 1: Widen branch dropdowns ────────────────────────────────────────

function calcDropdownWidth() {
  return Math.round(dropdownCharCount * 7.5) + 40;
}

function widenBranchDropdowns() {
  if (!featureToggles.widenDropdown) return;
  const width = calcDropdownWidth();

  ['.branch-select-menu .SelectMenu-modal',
   '.js-branch-select-menu .SelectMenu-modal',
   '[data-target="branch-filter.repositoryBranchSelectMenu"] .SelectMenu-modal',
   'details[open] .SelectMenu-modal',
  ].forEach(sel => {
    document.querySelectorAll(sel).forEach(modal => applyWidth(modal, width));
  });

  findBranchOverlays().forEach(overlay => applyWidth(overlay, width));

  document.querySelectorAll('.SelectMenu-filter input').forEach(input => {
    input.style.setProperty('width', '100%', 'important');
  });
}

function applyWidth(el, width) {
  if (el.getAttribute(PROCESSED_ATTR) === 'widened') return;
  el.style.setProperty('width', `${width}px`, 'important');
  el.style.setProperty('max-width', '900px', 'important');
  el.setAttribute(PROCESSED_ATTR, 'widened');
}

function findBranchOverlays() {
  const overlays = [];
  const branchKeywords = ['switch branches', 'switch branches/tags', 'choose a branch'];

  document.querySelectorAll(
    '[role="dialog"], .Overlay, .Overlay-body, .SelectPanel, [data-testid="SelectPanel"], [class*="Overlay"]'
  ).forEach(el => {
    const text = (el.textContent || '').toLowerCase();
    if (branchKeywords.some(kw => text.includes(kw))) {
      overlays.push(el.closest('[class*="Overlay"]') || el);
    }
  });

  document.querySelectorAll('ref-selector, [data-target*="ref-selector"], [data-action*="ref-selector"]').forEach(el => {
    overlays.push(el.closest('[class*="Overlay"]') || el.closest('[role="dialog"]') || el.closest('.SelectMenu-modal') || el);
  });

  document.querySelectorAll('.Overlay--size-small-portrait, .Overlay--size-medium, .Overlay--size-auto, [class*="Box--overlay"]').forEach(el => {
    const text = (el.textContent || '').toLowerCase();
    if (text.includes('branch') || text.includes('tag') || text.includes('find or create')) {
      overlays.push(el);
    }
  });

  return [...new Set(overlays)];
}

function reapplyDropdownWidths() {
  if (!featureToggles.widenDropdown) return;
  const width = calcDropdownWidth();
  document.querySelectorAll(`[${PROCESSED_ATTR}="widened"]`).forEach(modal => {
    modal.style.setProperty('width', `${width}px`, 'important');
  });
}

// Event listeners (stored for cleanup on context invalidation)
function onToggle(e) {
  if (e.target && e.target.tagName === 'DETAILS') {
    setTimeout(widenBranchDropdowns, DROPDOWN_RETRY_DELAYS[0]);
  }
}

function onClick(e) {
  const btn = e.target.closest(
    'summary[aria-label*="ranch"], .branch-select-menu summary, button[aria-label*="ranch"], ' +
    '[data-hotkey="w"], #branch-picker-repos-header-ref-selector, ' +
    'button[id*="branch"], button[id*="ref-selector"], ' +
    '[class*="BranchName"], [class*="branch-name"]'
  );
  if (btn) {
    DROPDOWN_RETRY_DELAYS.forEach(ms => setTimeout(widenBranchDropdowns, ms));
  }
}

document.addEventListener('toggle', onToggle, true);
document.addEventListener('click', onClick, true);

// ─── Detect "Run workflow" button click for auto-notify ─────────────────────
// When the user clicks the "Run workflow" submit button, save a timestamp
// so auto-notify only registers runs triggered by the user themselves.
const AUTO_NOTIFY_WINDOW_MS = 120000; // 2 minutes window after click

function onRunWorkflowClick(e) {
  // GitHub's "Run workflow" submit button inside the dispatch form
  const btn = e.target.closest(
    'button.js-workflow-dispatch-submit, ' +
    'form[action*="workflow_dispatch"] button[type="submit"], ' +
    'div.js-workflow-dispatch button[type="submit"], ' +
    '[data-action*="workflow-dispatch"] button'
  );
  // Also match by button text content as fallback
  if (!btn && e.target.closest('button')) {
    const text = (e.target.closest('button').textContent || '').trim().toLowerCase();
    if (text === 'run workflow') {
      safeStorageSet({ userTriggeredRunAt: Date.now() });
      return;
    }
  }
  if (btn) {
    safeStorageSet({ userTriggeredRunAt: Date.now() });
  }
}
document.addEventListener('click', onRunWorkflowClick, true);

// ─── Feature 2 & 3: Full branch names + copy buttons ─────────────────────────

/** Strict Actions page detection: /owner/repo/actions or /owner/repo/actions/... */
function isActionsPage() {
  return /^\/[^/]+\/[^/]+\/actions(\/|$)/.test(location.pathname);
}

function getBranchText(el) {
  return (el.textContent || el.innerText || '').trim();
}

/**
 * Shows a tooltip bubble above the target element, clamped within viewport.
 */
function showCopyTooltip(target, text) {
  const prev = document.querySelector('.gh-enhancer-tooltip');
  if (prev) prev.remove();

  const tip = document.createElement('div');
  tip.className = 'gh-enhancer-tooltip';
  tip.setAttribute('role', 'status');
  tip.setAttribute('aria-live', 'polite');
  tip.textContent = text;
  document.body.appendChild(tip);

  const rect = target.getBoundingClientRect();
  let top = window.scrollY + rect.top - tip.offsetHeight - 6;
  let left = window.scrollX + rect.left + rect.width / 2 - tip.offsetWidth / 2;

  // Clamp within viewport
  if (top < window.scrollY) top = window.scrollY + rect.bottom + 6;
  if (left < 0) left = 4;
  const maxLeft = document.documentElement.clientWidth - tip.offsetWidth - 4;
  if (left > maxLeft) left = maxLeft;

  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;

  setTimeout(() => {
    tip.classList.add('gh-enhancer-tooltip-hide');
    tip.addEventListener('transitionend', () => tip.remove());
  }, 1500);
}

/**
 * Shows a non-blocking inline warning message (replaces alert()).
 */
function showWarningToast(text) {
  let container = document.getElementById('gh-enhancer-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'gh-enhancer-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'gh-enhancer-toast gh-enhancer-toast-warning';
  toast.innerHTML = '';

  const body = document.createElement('div');
  body.className = 'gh-enhancer-toast-body';
  body.textContent = text;
  toast.appendChild(body);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'gh-enhancer-toast-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => {
    toast.classList.add('gh-enhancer-toast-hide');
    toast.addEventListener('transitionend', () => toast.remove());
  });
  toast.insertBefore(closeBtn, toast.firstChild);

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('gh-enhancer-toast-hide');
      toast.addEventListener('transitionend', () => toast.remove());
    }
  }, 8000);
}

function createCopyButton(branchName) {
  const btn = document.createElement('button');
  btn.className = 'gh-enhancer-copy-btn';
  btn.title = `Copy branch name: ${branchName}`;
  btn.setAttribute('aria-label', `Copy branch name ${branchName}`);
  btn.innerHTML = ICON_COPY;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    let success = false;
    try {
      await navigator.clipboard.writeText(branchName);
      success = true;
    } catch {
      // clipboard API unavailable
    }

    btn.classList.add('copied');
    btn.innerHTML = ICON_CHECK;
    showCopyTooltip(btn, success ? i18n.t('content.copied') : i18n.t('content.copyFailed'));

    setTimeout(() => {
      btn.classList.remove('copied');
      btn.title = `Copy branch name: ${branchName}`;
      btn.innerHTML = ICON_COPY;
    }, 2000);
  });

  return btn;
}

function enhanceBranchNames() {
  if (!isActionsPage()) return;

  const found = new Set();
  BRANCH_LINK_SELECTORS.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => found.add(el));
  });

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

    if (featureToggles.fullBranchName) {
      el.classList.add('gh-enhancer-branch-name');
    }
    if (featureToggles.copyButton) {
      const copyBtn = createCopyButton(branchName);
      if (el.parentElement && !el.parentElement.querySelector('.gh-enhancer-copy-btn')) {
        el.insertAdjacentElement('afterend', copyBtn);
      }
    }
  });
}

// ─── Feature 6: Expand relative times to absolute date/time ──────────────────

function formatAbsoluteTime(datetime) {
  const date = new Date(datetime);
  if (isNaN(date.getTime())) return null;
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function expandRelativeTimes() {
  if (!featureToggles.expandRelativeTimes) return;

  document.querySelectorAll('relative-time[datetime]').forEach(el => {
    if (el.getAttribute(PROCESSED_ATTR) === 'time-expanded') return;
    const datetime = el.getAttribute('datetime');
    if (!datetime) return;

    const formatted = formatAbsoluteTime(datetime);
    if (!formatted) return;

    const span = document.createElement('span');
    span.className = 'gh-enhancer-abs-time';
    span.textContent = formatted;
    span.title = formatted;
    el.insertAdjacentElement('afterend', span);
    el.style.display = 'none';
    el.setAttribute(PROCESSED_ATTR, 'time-expanded');
  });
}

// ─── Feature 5: Auto-load job summaries ──────────────────────────────────────

function autoLoadJobSummaries() {
  if (!featureToggles.autoLoadJobSummary) return;

  document.querySelectorAll('button[data-target="job-summary.loadButton"]').forEach(btn => {
    if (btn.getAttribute(PROCESSED_ATTR)) return;
    btn.setAttribute(PROCESSED_ATTR, 'summary-loaded');
    btn.click();
  });
}

// ─── Feature 4: Workflow completion notifications ─────────────────────────────

function parseWorkflowRunUrl(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], runId: m[3] };
}

function createNotifyButton(runId, runUrl) {
  const btn = document.createElement('button');
  btn.className = 'gh-enhancer-notify-btn';
  btn.dataset.runId = runId;
  btn.title = i18n.t('content.notifyTitle');
  btn.innerHTML = `${ICON_BELL}${i18n.t('content.notify')}`;

  safeStorageGet('watchedRuns', (data) => {
    if (!data) return;
    const watched = data.watchedRuns || {};
    if (watched[runId]) {
      btn.classList.add('active');
      btn.title = i18n.t('content.notifyWatching');
      btn.innerHTML = `${ICON_BELL}${i18n.t('content.notifying')}`;
    }
  });

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isContextValid()) return;

    const data = await new Promise(resolve => safeStorageGet('watchedRuns', resolve));
    if (!data) return;
    const watched = data.watchedRuns || {};

    if (watched[runId]) {
      delete watched[runId];
      await new Promise(resolve => safeStorageSet({ watchedRuns: watched }, resolve));
      btn.classList.remove('active');
      btn.title = i18n.t('content.notifyTitle');
      btn.innerHTML = `${ICON_BELL}${i18n.t('content.notify')}`;
    } else {
      const tokenData = await new Promise(resolve => safeStorageGet('githubToken', resolve));
      if (!tokenData) return;
      if (!tokenData.githubToken) {
        showWarningToast(i18n.t('content.alertTokenRequired'));
        return;
      }
      const parsed = parseWorkflowRunUrl(runUrl);
      if (!parsed) {
        showWarningToast(i18n.t('content.alertParseFailed'));
        return;
      }
      watched[runId] = {
        owner: parsed.owner, repo: parsed.repo, runId, runUrl, addedAt: Date.now(),
      };
      await new Promise(resolve => safeStorageSet({ watchedRuns: watched }, resolve));
      safeSendMessage({ type: 'START_POLLING' });
      btn.classList.add('active');
      btn.title = i18n.t('content.notifyWatching');
      btn.innerHTML = `${ICON_BELL}${i18n.t('content.notifying')}`;
    }
  });

  return btn;
}

function isRowRunning(row) {
  const text = (row.textContent || '').toLowerCase();

  const completedKeywords = ['success', 'failure', 'failed', 'cancelled', 'skipped', 'timed out', 'completed'];
  if (completedKeywords.some(kw => text.includes(kw))) return false;

  const runningKeywords = ['in progress', 'queued', 'waiting', 'pending', 'requested'];

  if (/\d+m\s*\d*s|\d+s/.test(text)) {
    if (!runningKeywords.some(kw => text.includes(kw))) return false;
  }

  const statusIcons = row.querySelectorAll('svg.octicon-check-circle-fill, svg.octicon-x-circle-fill, svg.octicon-stop');
  if (statusIcons.length > 0) return false;

  if (row.querySelector(RUNNING_ROW_SELECTORS.join(','))) return true;
  if (runningKeywords.some(kw => text.includes(kw))) return true;

  const svgs = row.querySelectorAll('svg');
  for (const svg of svgs) {
    if (svg.querySelector('animate, animateTransform')) return true;
    const cls = svg.className?.baseVal || svg.getAttribute('class') || '';
    if (/spin|progress|loading|pending|anim/i.test(cls)) return true;
  }

  return false;
}

function enhanceWorkflowNotifications() {
  if (!isActionsPage()) return;
  if (!featureToggles.notifications) return;

  const allRunRows = new Map();
  document.querySelectorAll('a[href*="/actions/runs/"]').forEach(link => {
    const parsed = parseWorkflowRunUrl(link.href);
    if (!parsed) return;
    const row = link.closest('[data-run-id], li, tr, .Box-row, article, div.Box-row, [class*="WorkflowRun"]')
             || link.parentElement?.closest('div, li');
    if (row && !allRunRows.has(parsed.runId)) {
      allRunRows.set(parsed.runId, { row, runUrl: link.href, parsed });
    }
  });

  safeStorageGet(['watchedRuns', 'githubToken', 'userTriggeredRunAt'], (data) => {
    if (!data) return;
    const watched = data.watchedRuns || {};
    let watchedUpdated = false;

    // Auto-notify only if user recently clicked "Run workflow"
    const triggeredAt = data.userTriggeredRunAt || 0;
    const isUserTriggered = (Date.now() - triggeredAt) < AUTO_NOTIFY_WINDOW_MS;

    allRunRows.forEach(({ row, runUrl, parsed }, runId) => {
      if (row.querySelector('.gh-enhancer-notify-btn')) return;
      const running = isRowRunning(row);
      const isWatched = !!watched[runId];

      if (featureToggles.autoNotify && running && !isWatched && data.githubToken && isUserTriggered) {
        watched[runId] = {
          owner: parsed.owner, repo: parsed.repo, runId, runUrl, addedAt: Date.now(),
        };
        watchedUpdated = true;
      }

      if (!running && !isWatched && !watched[runId]) return;

      const notifyBtn = createNotifyButton(parsed.runId, runUrl);
      const runLink = row.querySelector('a[href*="/actions/runs/"]');
      if (runLink) runLink.insertAdjacentElement('afterend', notifyBtn);
    });

    if (watchedUpdated) {
      safeStorageSet({ watchedRuns: watched });
      safeSendMessage({ type: 'START_POLLING' });
      // Clear the trigger marker after registering
      safeStorageSet({ userTriggeredRunAt: 0 });
    }
  });
}

function enhanceWorkflowRunDetailPage() {
  if (!featureToggles.notifications) return;
  const parsed = parseWorkflowRunUrl(location.href);
  if (!parsed) return;
  if (document.querySelector('.gh-enhancer-detail-notify')) return;

  const pageText = (document.body.textContent || '').toLowerCase();
  const completedKeywords = ['completed', 'success', 'failure', 'failed', 'cancelled', 'skipped', 'timed out'];
  const runningKeywords = ['in progress', 'queued', 'waiting', 'pending', 'requested'];
  const isCompleted = completedKeywords.some(kw => pageText.includes(kw))
                   && !runningKeywords.some(kw => pageText.includes(kw));

  safeStorageGet(['watchedRuns', 'githubToken', 'userTriggeredRunAt'], (data) => {
    if (!data) return;
    const watched = data.watchedRuns || {};
    const isWatched = !!watched[parsed.runId];

    // Auto-notify only if user recently clicked "Run workflow"
    const triggeredAt = data.userTriggeredRunAt || 0;
    const isUserTriggered = (Date.now() - triggeredAt) < AUTO_NOTIFY_WINDOW_MS;

    if (featureToggles.autoNotify && !isCompleted && !isWatched && data.githubToken && isUserTriggered) {
      watched[parsed.runId] = {
        owner: parsed.owner, repo: parsed.repo, runId: parsed.runId, runUrl: location.href, addedAt: Date.now(),
      };
      safeStorageSet({ watchedRuns: watched });
      safeSendMessage({ type: 'START_POLLING' });
      safeStorageSet({ userTriggeredRunAt: 0 });
    }

    if (isCompleted) return;
    if (document.querySelector('.gh-enhancer-detail-notify')) return;

    const notifyBtn = createNotifyButton(parsed.runId, location.href);
    notifyBtn.classList.add('gh-enhancer-detail-notify');
    notifyBtn.style.cssText = 'font-size:13px;padding:4px 12px;margin-left:8px;vertical-align:middle;';

    for (const sel of ['h1 .markdown-title', 'h1 a', 'h1 span.css-truncate-target', 'h1 span', 'h1']) {
      const el = document.querySelector(sel);
      if (el) { el.insertAdjacentElement('afterend', notifyBtn); return; }
    }
  });
}

// ─── Completion toast notification ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'WORKFLOW_COMPLETED') {
    showCompletionToast(message.data);
    disableNotifyButton(message.data.runId);
  }
});

function disableNotifyButton(runId) {
  document.querySelectorAll(`.gh-enhancer-notify-btn[data-run-id="${runId}"]`).forEach(btn => {
    btn.disabled = true;
    btn.classList.remove('active');
    btn.classList.add('completed');
    btn.title = i18n.t('content.notifyCompleted');
    btn.innerHTML = `${ICON_CHECK}${i18n.t('content.notifyDone')}`;
  });
}

function showCompletionToast(data) {
  const { workflowName, branchName, conclusion, runUrl, owner, repo } = data;

  let container = document.getElementById('gh-enhancer-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'gh-enhancer-toast-container';
    document.body.appendChild(container);
  }

  const isSuccess = conclusion === 'success';
  const isCancelled = conclusion === 'cancelled';
  const icon = isSuccess ? '\u2705' : isCancelled ? '\u26a0\ufe0f' : '\u274c';
  const conclusionLabel = {
    success: i18n.t('content.conclusionSuccess'),
    failure: i18n.t('content.conclusionFailure'),
    cancelled: i18n.t('content.conclusionCancelled'),
    timed_out: i18n.t('content.conclusionTimedOut'),
    skipped: i18n.t('content.conclusionSkipped'),
  }[conclusion] ?? conclusion;

  const statusClass = isSuccess ? 'success' : isCancelled ? 'warning' : 'error';

  // Build toast with DOM API to avoid innerHTML XSS surface
  const toast = document.createElement('div');
  toast.className = `gh-enhancer-toast gh-enhancer-toast-${statusClass}`;

  const header = document.createElement('div');
  header.className = 'gh-enhancer-toast-header';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'gh-enhancer-toast-icon';
  iconSpan.textContent = icon;

  const titleEl = document.createElement('strong');
  titleEl.className = 'gh-enhancer-toast-title';
  titleEl.textContent = i18n.t('content.toastTitle');

  const closeBtn = document.createElement('button');
  closeBtn.className = 'gh-enhancer-toast-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => {
    toast.classList.add('gh-enhancer-toast-hide');
    toast.addEventListener('transitionend', () => toast.remove());
  });

  header.append(iconSpan, titleEl, closeBtn);

  const body = document.createElement('div');
  body.className = 'gh-enhancer-toast-body';

  const wfEl = document.createElement('div');
  wfEl.className = 'gh-enhancer-toast-workflow';
  wfEl.textContent = workflowName ?? i18n.t('content.defaultWorkflowName');
  body.appendChild(wfEl);

  if (branchName) {
    const brEl = document.createElement('div');
    brEl.className = 'gh-enhancer-toast-branch';
    brEl.textContent = i18n.t('content.toastBranch', { branch: branchName });
    body.appendChild(brEl);
  }

  const resEl = document.createElement('div');
  resEl.className = 'gh-enhancer-toast-result';
  resEl.textContent = i18n.t('content.toastResult', { conclusion: conclusionLabel });
  body.appendChild(resEl);

  const repoEl = document.createElement('div');
  repoEl.className = 'gh-enhancer-toast-repo';
  repoEl.textContent = `${owner}/${repo}`;
  body.appendChild(repoEl);

  const link = document.createElement('a');
  link.className = 'gh-enhancer-toast-link';
  link.href = runUrl;
  link.target = '_blank';
  link.textContent = i18n.t('content.toastLink');

  toast.append(header, body, link);
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('gh-enhancer-toast-hide');
      toast.addEventListener('transitionend', () => toast.remove());
    }
  }, 15000);
}

// ─── Instant workflow completion detection via DOM ───────────────────────────
// When the user is on a workflow detail page, detect status changes in the DOM
// and notify immediately instead of waiting for the next API poll cycle.

let lastKnownDetailStatus = null;

function detectWorkflowCompletionOnPage() {
  if (!featureToggles.notifications) return;
  const parsed = parseWorkflowRunUrl(location.href);
  if (!parsed) return;

  const pageText = (document.body.textContent || '').toLowerCase();
  const completedKeywords = ['success', 'failure', 'failed', 'cancelled', 'skipped', 'timed out'];
  const isNowCompleted = completedKeywords.some(kw => pageText.includes(kw));

  if (isNowCompleted && lastKnownDetailStatus === 'running') {
    // Page just transitioned from running → completed
    // Tell background to poll immediately instead of waiting up to 60s
    safeSendMessage({ type: 'RUN_COMPLETED_ON_PAGE' });
  }

  const runningKeywords = ['in progress', 'queued', 'waiting', 'pending'];
  if (runningKeywords.some(kw => pageText.includes(kw))) {
    lastKnownDetailStatus = 'running';
  } else if (isNowCompleted) {
    lastKnownDetailStatus = 'completed';
  }
}

// ─── MutationObserver with debounce & filtering ─────────────────────────────

function runAllEnhancements() {
  enhanceBranchNames();
  enhanceWorkflowNotifications();
  enhanceWorkflowRunDetailPage();
  autoLoadJobSummaries();
  expandRelativeTimes();
}

let debounceTimer = null;
const observer = new MutationObserver((mutations) => {
  if (!isContextValid() || !settingsReady) return;

  // Quick filter: skip if only text/attribute changes in irrelevant nodes
  let hasRelevantChange = false;
  for (const m of mutations) {
    if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
      hasRelevantChange = true;
      break;
    }
  }
  if (!hasRelevantChange) return;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    runAllEnhancements();
    widenBranchDropdowns();
    detectWorkflowCompletionOnPage();
  }, DEBOUNCE_MS);
});

observer.observe(document.body, { childList: true, subtree: true });

function guardedRunAll() {
  if (!settingsReady) return;
  lastKnownDetailStatus = null; // Reset on page navigation
  runAllEnhancements();
}
document.addEventListener('turbo:load', guardedRunAll);
document.addEventListener('turbo:render', guardedRunAll);
document.addEventListener('pjax:end', guardedRunAll);

// Cleanup listeners on context invalidation (#9)
function cleanupListeners() {
  document.removeEventListener('toggle', onToggle, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('click', onRunWorkflowClick, true);
  document.removeEventListener('turbo:load', guardedRunAll);
  document.removeEventListener('turbo:render', guardedRunAll);
  document.removeEventListener('pjax:end', guardedRunAll);
}

// Load settings first, then run enhancements
loadSettings(() => {
  runAllEnhancements();
  widenBranchDropdowns();
});
