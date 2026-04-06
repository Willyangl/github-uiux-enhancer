/**
 * GitHub UI/UX Enhancer - Content Script Tests
 *
 * Tests cover:
 *   Feature 1: Branch dropdown widening (by character count)
 *   Feature 2: Full branch name display in Actions workflow list
 *   Feature 3: Copy button injection next to branch names
 *   Feature 4: Notify button injection for running workflows
 *   Feature toggles: enable/disable each feature
 *   Cross-cutting: MutationObserver / SPA navigation re-runs
 *
 * @jest-environment jsdom
 */

'use strict';

const { createChromeMock } = require('./chrome-mock');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Shared location mock that content script functions will read from. */
const locationMock = { pathname: '/', href: 'https://github.com/', hostname: 'github.com' };

/** Set the current URL path (updates the shared mock, no jsdom navigation). */
function setPath(path) {
  locationMock.pathname = path;
  locationMock.href = `https://github.com${path}`;
}

/** Build a minimal GitHub-like branch dropdown (Feature 1). */
function buildBranchDropdown({ selector = '.branch-select-menu', open = true } = {}) {
  const details = document.createElement('details');
  if (open) details.setAttribute('open', '');
  details.classList.add(...selector.replace('.', '').split(' '));
  const modal = document.createElement('div');
  modal.classList.add('SelectMenu-modal');
  modal.style.width = '240px';
  modal.getBoundingClientRect = () => ({ width: 240, height: 200, top: 0, left: 0, right: 240, bottom: 200 });
  details.appendChild(modal);
  document.body.appendChild(details);
  return { details, modal };
}

/** Build a workflow run row with a branch name element and optional running indicator. */
function buildWorkflowRow({ branchName = 'feature/long-branch-name', running = false, runId = '12345' } = {}) {
  const row = document.createElement('div');
  row.classList.add('Box-row');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('octicon-git-branch');
  row.appendChild(svg);

  const branchLink = document.createElement('a');
  branchLink.textContent = branchName;
  branchLink.classList.add('branch-name');
  branchLink.href = '#';
  row.appendChild(branchLink);

  const runLink = document.createElement('a');
  runLink.href = `https://github.com/testowner/testrepo/actions/runs/${runId}`;
  runLink.textContent = 'Build';
  row.appendChild(runLink);

  if (running) {
    const indicator = document.createElement('span');
    indicator.setAttribute('aria-label', 'In progress');
    const wrapper = document.createElement('div');
    wrapper.appendChild(indicator);
    row.appendChild(wrapper);
  }

  document.body.appendChild(row);
  return { row, branchLink };
}

// ─── Load content.js functions ────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const contentSrc = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf-8');

function loadContentScript(overrideToggles, overrideCharCount) {
  const sideEffectMarker = '// ─── MutationObserver';
  const markerIdx = contentSrc.indexOf(sideEffectMarker);
  let functionDefs = markerIdx >= 0 ? contentSrc.substring(0, markerIdx) : contentSrc;

  // Strip event listeners between widenBranchDropdowns and Feature 2 section
  const listenerStart = '// Watch for dropdowns being opened';
  const listenerEnd = '// ─── Feature 2';
  const ls = functionDefs.indexOf(listenerStart);
  const le = functionDefs.indexOf(listenerEnd);
  if (ls >= 0 && le > ls) {
    functionDefs = functionDefs.substring(0, ls) + functionDefs.substring(le);
  }

  // Strip settings loader and storage.onChanged listener (side effects)
  const settingsStart = '// ─── Settings loader';
  const settingsEnd = '// ─── Feature 1';
  const ss = functionDefs.indexOf(settingsStart);
  const se = functionDefs.indexOf(settingsEnd);
  if (ss >= 0 && se > ss) {
    functionDefs = functionDefs.substring(0, ss) + functionDefs.substring(se);
  }

  functionDefs = functionDefs.replace(/^'use strict';$/m, '');

  // Remove the original let declarations so we can inject our own via var
  // featureToggles is a multi-line object literal; dropdownCharCount has a trailing comment
  functionDefs = functionDefs.replace(/^let featureToggles\b[\s\S]*?};$/m, '');
  functionDefs = functionDefs.replace(/^let dropdownCharCount\b.*$/m, '');

  // Allow tests to override the mutable settings
  const togglesJson = JSON.stringify(overrideToggles || {
    widenDropdown: true, fullBranchName: true, copyButton: true, notifications: true,
  });
  const charCount = overrideCharCount ?? 50;

  // i18n mock — simple passthrough
  const i18nMockCode = `
    var i18n = {
      t: function(key, params) {
        var map = {
          'content.copied': 'Copied!', 'content.copyFailed': 'Failed to copy',
          'content.notify': '通知', 'content.notifying': '通知中', 'content.notifyDone': '通知完了',
          'content.notifyTitle': 'Notify me', 'content.notifyWatching': 'Watching',
          'content.notifyCompleted': 'Completed', 'content.alertTokenRequired': 'Token required',
          'content.alertParseFailed': 'Parse failed', 'content.toastTitle': 'Workflow Completed',
          'content.toastLink': 'View details',
          'content.conclusionSuccess': 'Success', 'content.conclusionFailure': 'Failure',
          'content.conclusionCancelled': 'Cancelled', 'content.conclusionTimedOut': 'Timed out',
          'content.conclusionSkipped': 'Skipped',
        };
        var val = map[key] || key;
        if (params) { for (var k in params) { val = val.replace('{' + k + '}', params[k]); } }
        return val;
      },
      load: function() { return Promise.resolve('ja'); },
      getLang: function() { return 'ja'; },
    };
  `;

  const fn = new Function(
    'chrome', 'document', 'window', 'navigator', 'location', 'setTimeout', 'alert',
    `
      ${i18nMockCode}
      var featureToggles = ${togglesJson};
      var dropdownCharCount = ${charCount};
      ${functionDefs}
      function runAllEnhancements() {
        enhanceBranchNames();
        enhanceWorkflowNotifications();
      }
      return {
        widenBranchDropdowns,
        calcDropdownWidth,
        reapplyDropdownWidths,
        isActionsPage,
        getBranchText,
        createCopyButton,
        enhanceBranchNames,
        parseWorkflowRunUrl,
        createNotifyButton,
        enhanceWorkflowNotifications,
        runAllEnhancements,
        PROCESSED_ATTR,
      };
    `
  );
  return fn(chrome, document, window, navigator, locationMock, setTimeout, alert);
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('Content Script', () => {
  let funcs;

  beforeAll(() => {
    global.chrome = createChromeMock();
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    global.chrome._resetStore();
    setPath('/');
    funcs = loadContentScript();
  });

  // ─── Feature 1: Branch dropdown widening ──────────────────────────────

  describe('Feature 1: widenBranchDropdowns', () => {
    test('TC-1-01: dropdown modal is widened based on character count (default 50)', () => {
      const { modal } = buildBranchDropdown();
      funcs.widenBranchDropdowns();

      const expected = Math.round(50 * 7.5) + 40; // 415px
      expect(modal.style.getPropertyValue('width')).toBe(`${expected}px`);
    });

    test('TC-1-02: max-width is set to 900px', () => {
      const { modal } = buildBranchDropdown();
      funcs.widenBranchDropdowns();
      expect(modal.style.getPropertyValue('max-width')).toBe('900px');
    });

    test('TC-1-03: already processed dropdown is not widened again', () => {
      const { modal } = buildBranchDropdown();
      funcs.widenBranchDropdowns();
      const firstWidth = modal.style.getPropertyValue('width');

      funcs.widenBranchDropdowns();
      expect(modal.style.getPropertyValue('width')).toBe(firstWidth);
    });

    test('TC-1-04: multiple dropdowns are all widened', () => {
      const d1 = buildBranchDropdown();
      const d2 = buildBranchDropdown();
      funcs.widenBranchDropdowns();

      const expected = `${Math.round(50 * 7.5) + 40}px`;
      expect(d1.modal.style.getPropertyValue('width')).toBe(expected);
      expect(d2.modal.style.getPropertyValue('width')).toBe(expected);
    });

    test('TC-1-05: custom character count changes width', () => {
      const f = loadContentScript(undefined, 80);
      const { modal } = buildBranchDropdown();
      f.widenBranchDropdowns();

      const expected = Math.round(80 * 7.5) + 40; // 640px
      expect(modal.style.getPropertyValue('width')).toBe(`${expected}px`);
    });

    test('TC-1-06: calcDropdownWidth returns correct value', () => {
      expect(funcs.calcDropdownWidth()).toBe(Math.round(50 * 7.5) + 40);
    });

    test('TC-1-07: disabled toggle skips dropdown widening', () => {
      const f = loadContentScript({ widenDropdown: false, fullBranchName: true, copyButton: true, notifications: true });
      const { modal } = buildBranchDropdown();
      f.widenBranchDropdowns();

      expect(modal.getAttribute('data-gh-enhancer')).toBeNull();
    });

    test('TC-1-08: reapplyDropdownWidths updates existing widened modals', () => {
      const { modal } = buildBranchDropdown();
      funcs.widenBranchDropdowns();

      // Simulate char count change — load new script with different char count
      const f2 = loadContentScript(undefined, 70);
      // Manually mark the modal as widened (simulating prior processing)
      modal.setAttribute('data-gh-enhancer', 'widened');
      f2.reapplyDropdownWidths();

      const expected = Math.round(70 * 7.5) + 40;
      expect(modal.style.getPropertyValue('width')).toBe(`${expected}px`);
    });
  });

  // ─── Feature 2: Full branch names ────────────────────────────────────

  describe('Feature 2: Full branch names in Actions', () => {
    beforeEach(() => {
      setPath('/owner/repo/actions');
    });

    test('TC-2-01: branch name element gets gh-enhancer-branch-name class', () => {
      const { branchLink } = buildWorkflowRow({ branchName: 'feature/very-long-branch-name-prefix/JIRA-1234' });
      funcs.enhanceBranchNames();
      expect(branchLink.classList.contains('gh-enhancer-branch-name')).toBe(true);
    });

    test('TC-2-02: data-gh-enhancer attribute is set on processed elements', () => {
      const { branchLink } = buildWorkflowRow();
      funcs.enhanceBranchNames();
      expect(branchLink.getAttribute('data-gh-enhancer')).toBe('branch-enhanced');
    });

    test('TC-2-03: does not process elements on non-Actions pages', () => {
      setPath('/owner/repo/pulls');
      const { branchLink } = buildWorkflowRow();
      funcs.enhanceBranchNames();
      expect(branchLink.classList.contains('gh-enhancer-branch-name')).toBe(false);
    });

    test('TC-2-04: multiple branch names on the same page are all enhanced', () => {
      const r1 = buildWorkflowRow({ branchName: 'main', runId: '100' });
      const r2 = buildWorkflowRow({ branchName: 'feature/x', runId: '200' });
      const r3 = buildWorkflowRow({ branchName: 'bugfix/y', runId: '300' });
      funcs.enhanceBranchNames();

      expect(r1.branchLink.classList.contains('gh-enhancer-branch-name')).toBe(true);
      expect(r2.branchLink.classList.contains('gh-enhancer-branch-name')).toBe(true);
      expect(r3.branchLink.classList.contains('gh-enhancer-branch-name')).toBe(true);
    });

    test('TC-2-05: empty branch name elements are skipped', () => {
      const { branchLink } = buildWorkflowRow({ branchName: '' });
      funcs.enhanceBranchNames();
      expect(branchLink.classList.contains('gh-enhancer-branch-name')).toBe(false);
    });

    test('TC-2-06: isActionsPage returns true for /actions subpaths', () => {
      setPath('/owner/repo/actions/workflows/ci.yml');
      expect(funcs.isActionsPage()).toBe(true);

      setPath('/owner/repo/actions/runs/12345');
      expect(funcs.isActionsPage()).toBe(true);
    });

    test('TC-2-07: isActionsPage returns false for non-actions pages', () => {
      setPath('/owner/repo/issues');
      expect(funcs.isActionsPage()).toBe(false);

      setPath('/owner/repo/pulls');
      expect(funcs.isActionsPage()).toBe(false);
    });

    test('TC-2-08: disabled toggle skips full branch name', () => {
      const f = loadContentScript({ widenDropdown: true, fullBranchName: false, copyButton: true, notifications: true });
      const { branchLink } = buildWorkflowRow({ branchName: 'feature/test' });
      f.enhanceBranchNames();
      expect(branchLink.classList.contains('gh-enhancer-branch-name')).toBe(false);
    });
  });

  // ─── Feature 3: Copy button ──────────────────────────────────────────

  describe('Feature 3: Copy button', () => {
    beforeEach(() => {
      setPath('/owner/repo/actions');
    });

    test('TC-3-01: copy button is injected after branch name element', () => {
      buildWorkflowRow({ branchName: 'feature/my-branch' });
      funcs.enhanceBranchNames();
      expect(document.querySelector('.gh-enhancer-copy-btn')).not.toBeNull();
    });

    test('TC-3-02: copy button has correct aria-label with branch name', () => {
      buildWorkflowRow({ branchName: 'develop' });
      funcs.enhanceBranchNames();
      const copyBtn = document.querySelector('.gh-enhancer-copy-btn');
      expect(copyBtn.getAttribute('aria-label')).toBe('Copy branch name develop');
    });

    test('TC-3-03: clicking copy button writes branch name to clipboard', async () => {
      buildWorkflowRow({ branchName: 'feature/test-copy' });
      funcs.enhanceBranchNames();
      const copyBtn = document.querySelector('.gh-enhancer-copy-btn');
      await copyBtn.click();
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('feature/test-copy');
    });

    test('TC-3-04: only one copy button per branch name (idempotent)', () => {
      buildWorkflowRow({ branchName: 'main' });
      funcs.enhanceBranchNames();
      funcs.enhanceBranchNames();
      expect(document.querySelectorAll('.gh-enhancer-copy-btn').length).toBe(1);
    });

    test('TC-3-05: createCopyButton returns a button element', () => {
      const btn = funcs.createCopyButton('test-branch');
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.className).toBe('gh-enhancer-copy-btn');
    });

    test('TC-3-06: copy button is not injected on non-Actions pages', () => {
      setPath('/owner/repo');
      buildWorkflowRow({ branchName: 'main' });
      funcs.enhanceBranchNames();
      expect(document.querySelector('.gh-enhancer-copy-btn')).toBeNull();
    });

    test('TC-3-07: disabled toggle skips copy button', () => {
      const f = loadContentScript({ widenDropdown: true, fullBranchName: true, copyButton: false, notifications: true });
      buildWorkflowRow({ branchName: 'main' });
      f.enhanceBranchNames();
      expect(document.querySelector('.gh-enhancer-copy-btn')).toBeNull();
    });
  });

  // ─── Feature 4: Notify button ────────────────────────────────────────

  describe('Feature 4: Workflow completion notifications', () => {
    beforeEach(() => {
      setPath('/owner/repo/actions');
    });

    test('TC-4-01: notify button is injected for running workflow rows', () => {
      buildWorkflowRow({ running: true, runId: '99001' });
      funcs.enhanceWorkflowNotifications();
      expect(document.querySelector('.gh-enhancer-notify-btn')).not.toBeNull();
    });

    test('TC-4-02: notify button is NOT injected for non-running rows', () => {
      buildWorkflowRow({ running: false, runId: '99002' });
      funcs.enhanceWorkflowNotifications();
      expect(document.querySelector('.gh-enhancer-notify-btn')).toBeNull();
    });

    test('TC-4-03: notify button displays "通知" label', () => {
      buildWorkflowRow({ running: true, runId: '99003' });
      funcs.enhanceWorkflowNotifications();
      expect(document.querySelector('.gh-enhancer-notify-btn').textContent).toContain('通知');
    });

    test('TC-4-04: notify button has correct data-run-id attribute', () => {
      buildWorkflowRow({ running: true, runId: '77777' });
      funcs.enhanceWorkflowNotifications();
      expect(document.querySelector('.gh-enhancer-notify-btn').dataset.runId).toBe('77777');
    });

    test('TC-4-05: idempotent - notify button only injected once per row', () => {
      buildWorkflowRow({ running: true, runId: '99005' });
      funcs.enhanceWorkflowNotifications();
      funcs.enhanceWorkflowNotifications();
      expect(document.querySelectorAll('.gh-enhancer-notify-btn').length).toBe(1);
    });

    test('TC-4-06: multiple running rows each get a notify button', () => {
      buildWorkflowRow({ running: true, runId: '100' });
      buildWorkflowRow({ running: true, runId: '200' });
      buildWorkflowRow({ running: false, runId: '300' });
      funcs.enhanceWorkflowNotifications();
      expect(document.querySelectorAll('.gh-enhancer-notify-btn').length).toBe(2);
    });

    test('TC-4-07: does not inject on non-Actions pages', () => {
      setPath('/owner/repo/code');
      buildWorkflowRow({ running: true, runId: '99007' });
      funcs.enhanceWorkflowNotifications();
      expect(document.querySelector('.gh-enhancer-notify-btn')).toBeNull();
    });

    test('TC-4-08: disabled toggle skips notification buttons', () => {
      const f = loadContentScript({ widenDropdown: true, fullBranchName: true, copyButton: true, notifications: false });
      buildWorkflowRow({ running: true, runId: '99008' });
      f.enhanceWorkflowNotifications();
      expect(document.querySelector('.gh-enhancer-notify-btn')).toBeNull();
    });
  });

  // ─── parseWorkflowRunUrl ────────────────────────────────────────────

  describe('parseWorkflowRunUrl', () => {
    test('TC-P-01: parses a valid Actions run URL', () => {
      expect(funcs.parseWorkflowRunUrl('https://github.com/owner/repo/actions/runs/12345'))
        .toEqual({ owner: 'owner', repo: 'repo', runId: '12345' });
    });

    test('TC-P-02: returns null for non-matching URL', () => {
      expect(funcs.parseWorkflowRunUrl('https://github.com/owner/repo/pulls')).toBeNull();
    });

    test('TC-P-03: parses URL with long run ID', () => {
      expect(funcs.parseWorkflowRunUrl('https://github.com/my-org/my-repo/actions/runs/9876543210'))
        .toEqual({ owner: 'my-org', repo: 'my-repo', runId: '9876543210' });
    });

    test('TC-P-04: returns null for URL without run ID', () => {
      expect(funcs.parseWorkflowRunUrl('https://github.com/owner/repo/actions/runs/')).toBeNull();
    });

    test('TC-P-05: parses URL with additional path segments after run ID', () => {
      expect(funcs.parseWorkflowRunUrl('https://github.com/owner/repo/actions/runs/555/jobs/1'))
        .toEqual({ owner: 'owner', repo: 'repo', runId: '555' });
    });
  });

  // ─── getBranchText ──────────────────────────────────────────────────

  describe('getBranchText', () => {
    test('TC-B-01: extracts trimmed text content', () => {
      const el = document.createElement('span');
      el.textContent = '  feature/branch  ';
      expect(funcs.getBranchText(el)).toBe('feature/branch');
    });

    test('TC-B-02: returns empty string for empty element', () => {
      const el = document.createElement('span');
      expect(funcs.getBranchText(el)).toBe('');
    });
  });

  // ─── runAllEnhancements ─────────────────────────────────────────────

  describe('runAllEnhancements', () => {
    test('TC-R-01: enhances both branch names and notifications on Actions page', () => {
      setPath('/owner/repo/actions');
      buildWorkflowRow({ branchName: 'main', running: true, runId: '500' });
      funcs.runAllEnhancements();
      expect(document.querySelector('.gh-enhancer-branch-name')).not.toBeNull();
      expect(document.querySelector('.gh-enhancer-notify-btn')).not.toBeNull();
    });

    test('TC-R-02: does nothing on non-Actions pages', () => {
      setPath('/owner/repo/settings');
      buildWorkflowRow({ branchName: 'main', running: true, runId: '600' });
      funcs.runAllEnhancements();
      expect(document.querySelector('.gh-enhancer-branch-name')).toBeNull();
      expect(document.querySelector('.gh-enhancer-notify-btn')).toBeNull();
    });
  });
});
