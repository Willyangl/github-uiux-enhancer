/**
 * GitHub Enhancer - Content Script Tests
 *
 * Tests cover:
 *   Feature 1: Branch dropdown widening (1.7x)
 *   Feature 2: Full branch name display in Actions workflow list
 *   Feature 3: Copy button injection next to branch names
 *   Feature 4: Notify button injection for running workflows
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
  // Simulate a natural width by setting inline style
  modal.style.width = '240px';
  // getBoundingClientRect mock (jsdom returns 0 by default)
  modal.getBoundingClientRect = () => ({ width: 240, height: 200, top: 0, left: 0, right: 240, bottom: 200 });
  details.appendChild(modal);
  document.body.appendChild(details);
  return { details, modal };
}

/** Build a workflow run row with a branch name element and optional running indicator. */
function buildWorkflowRow({ branchName = 'feature/long-branch-name', running = false, runId = '12345' } = {}) {
  const row = document.createElement('div');
  row.classList.add('Box-row');

  // Branch icon + branch link
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('octicon-git-branch');
  row.appendChild(svg);

  const branchLink = document.createElement('a');
  branchLink.textContent = branchName;
  branchLink.classList.add('branch-name');
  branchLink.href = '#';
  row.appendChild(branchLink);

  // Run link (needed for notification feature)
  const runLink = document.createElement('a');
  runLink.href = `https://github.com/testowner/testrepo/actions/runs/${runId}`;
  runLink.textContent = 'Build';
  row.appendChild(runLink);

  // Running indicator
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

/**
 * content.js was written as a plain script (not a module), so we load it by
 * evaluating it after setting up globals. We extract the key functions we need
 * to test.
 */
const fs = require('fs');
const path = require('path');
const contentSrc = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf-8');

/**
 * Execute content.js in the current global scope, returning references to
 * its internal functions via a wrapper that exposes them.
 */
function loadContentScript() {
  // Strip all side-effect code (MutationObserver, event listeners, initial calls)
  // that runs at module-load time. We only want the function definitions.
  const sideEffectMarker = '// ─── MutationObserver';
  const markerIdx = contentSrc.indexOf(sideEffectMarker);
  let functionDefs = markerIdx >= 0 ? contentSrc.substring(0, markerIdx) : contentSrc;

  // Strip the two top-level event listeners between widenBranchDropdowns and Feature 2.
  const listenerStart = '// Watch for dropdowns being opened';
  const listenerEnd = '// ─── Feature 2';
  const ls = functionDefs.indexOf(listenerStart);
  const le = functionDefs.indexOf(listenerEnd);
  if (ls >= 0 && le > ls) {
    functionDefs = functionDefs.substring(0, ls) + functionDefs.substring(le);
  }

  // Strip 'use strict' — already in strict mode via vm
  functionDefs = functionDefs.replace(/^'use strict';$/m, '');

  // Use new Function to evaluate stripped source with access to browser globals.
  // `location` is the shared locationMock — setPath() mutates it in place.
  const fn = new Function(
    'chrome', 'document', 'window', 'navigator', 'location', 'setTimeout', 'alert',
    `
      ${functionDefs}
      function runAllEnhancements() {
        enhanceBranchNames();
        enhanceWorkflowNotifications();
      }
      return {
        widenBranchDropdowns,
        isActionsPage,
        getBranchText,
        createCopyButton,
        enhanceBranchNames,
        parseWorkflowRunUrl,
        createNotifyButton,
        enhanceWorkflowNotifications,
        runAllEnhancements,
        DROPDOWN_SCALE,
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
    // Clipboard mock
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    global.chrome._resetStore();
    funcs = loadContentScript();
  });

  // ─── Feature 1: Branch dropdown widening ──────────────────────────────────

  describe('Feature 1: widenBranchDropdowns', () => {
    test('TC-1-01: dropdown modal is widened to 1.7x of natural width', () => {
      const { modal } = buildBranchDropdown();
      funcs.widenBranchDropdowns();

      const expected = Math.min(Math.round(240 * 1.7), 680);
      expect(modal.style.getPropertyValue('width')).toBe(`${expected}px`);
    });

    test('TC-1-02: max-width is capped at 680px', () => {
      const { modal } = buildBranchDropdown();
      // Simulate a very wide natural dropdown
      modal.getBoundingClientRect = () => ({ width: 500, height: 200, top: 0, left: 0, right: 500, bottom: 200 });
      funcs.widenBranchDropdowns();

      expect(modal.style.getPropertyValue('max-width')).toBe('680px');
    });

    test('TC-1-03: already processed dropdown is not widened again', () => {
      const { modal } = buildBranchDropdown();
      funcs.widenBranchDropdowns();
      const firstWidth = modal.style.getPropertyValue('width');

      // Change the mock width — should NOT update because already processed
      modal.getBoundingClientRect = () => ({ width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200 });
      funcs.widenBranchDropdowns();
      expect(modal.style.getPropertyValue('width')).toBe(firstWidth);
    });

    test('TC-1-04: multiple dropdowns are all widened independently', () => {
      const d1 = buildBranchDropdown();
      const d2 = buildBranchDropdown();
      d2.modal.getBoundingClientRect = () => ({ width: 280, height: 200, top: 0, left: 0, right: 280, bottom: 200 });

      funcs.widenBranchDropdowns();

      expect(d1.modal.style.getPropertyValue('width')).toBe(`${Math.round(240 * 1.7)}px`);
      expect(d2.modal.style.getPropertyValue('width')).toBe(`${Math.round(280 * 1.7)}px`);
    });

    test('TC-1-05: scale constant is 1.7', () => {
      expect(funcs.DROPDOWN_SCALE).toBe(1.7);
    });
  });

  // ─── Feature 2: Full branch names ────────────────────────────────────────

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
  });

  // ─── Feature 3: Copy button ──────────────────────────────────────────────

  describe('Feature 3: Copy button', () => {
    beforeEach(() => {
      setPath('/owner/repo/actions');
    });

    test('TC-3-01: copy button is injected after branch name element', () => {
      buildWorkflowRow({ branchName: 'feature/my-branch' });
      funcs.enhanceBranchNames();

      const copyBtn = document.querySelector('.gh-enhancer-copy-btn');
      expect(copyBtn).not.toBeNull();
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
      funcs.enhanceBranchNames(); // Run again

      const copyBtns = document.querySelectorAll('.gh-enhancer-copy-btn');
      expect(copyBtns.length).toBe(1);
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

      const copyBtn = document.querySelector('.gh-enhancer-copy-btn');
      expect(copyBtn).toBeNull();
    });
  });

  // ─── Feature 4: Notify button ────────────────────────────────────────────

  describe('Feature 4: Workflow completion notifications', () => {
    beforeEach(() => {
      setPath('/owner/repo/actions');
    });

    test('TC-4-01: notify button is injected for running workflow rows', () => {
      buildWorkflowRow({ running: true, runId: '99001' });
      funcs.enhanceWorkflowNotifications();

      const notifyBtn = document.querySelector('.gh-enhancer-notify-btn');
      expect(notifyBtn).not.toBeNull();
    });

    test('TC-4-02: notify button is NOT injected for non-running rows', () => {
      buildWorkflowRow({ running: false, runId: '99002' });
      funcs.enhanceWorkflowNotifications();

      const notifyBtn = document.querySelector('.gh-enhancer-notify-btn');
      expect(notifyBtn).toBeNull();
    });

    test('TC-4-03: notify button displays "通知" label', () => {
      buildWorkflowRow({ running: true, runId: '99003' });
      funcs.enhanceWorkflowNotifications();

      const notifyBtn = document.querySelector('.gh-enhancer-notify-btn');
      expect(notifyBtn.textContent).toContain('通知');
    });

    test('TC-4-04: notify button has correct data-run-id attribute', () => {
      buildWorkflowRow({ running: true, runId: '77777' });
      funcs.enhanceWorkflowNotifications();

      const notifyBtn = document.querySelector('.gh-enhancer-notify-btn');
      expect(notifyBtn.dataset.runId).toBe('77777');
    });

    test('TC-4-05: idempotent - notify button only injected once per row', () => {
      buildWorkflowRow({ running: true, runId: '99005' });
      funcs.enhanceWorkflowNotifications();
      funcs.enhanceWorkflowNotifications(); // Run again

      const notifyBtns = document.querySelectorAll('.gh-enhancer-notify-btn');
      expect(notifyBtns.length).toBe(1);
    });

    test('TC-4-06: multiple running rows each get a notify button', () => {
      buildWorkflowRow({ running: true, runId: '100' });
      buildWorkflowRow({ running: true, runId: '200' });
      buildWorkflowRow({ running: false, runId: '300' }); // Not running
      funcs.enhanceWorkflowNotifications();

      const notifyBtns = document.querySelectorAll('.gh-enhancer-notify-btn');
      expect(notifyBtns.length).toBe(2);
    });

    test('TC-4-07: does not inject on non-Actions pages', () => {
      setPath('/owner/repo/code');
      buildWorkflowRow({ running: true, runId: '99007' });
      funcs.enhanceWorkflowNotifications();

      const notifyBtn = document.querySelector('.gh-enhancer-notify-btn');
      expect(notifyBtn).toBeNull();
    });
  });

  // ─── parseWorkflowRunUrl ────────────────────────────────────────────────

  describe('parseWorkflowRunUrl', () => {
    test('TC-P-01: parses a valid Actions run URL', () => {
      const result = funcs.parseWorkflowRunUrl('https://github.com/owner/repo/actions/runs/12345');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', runId: '12345' });
    });

    test('TC-P-02: returns null for non-matching URL', () => {
      expect(funcs.parseWorkflowRunUrl('https://github.com/owner/repo/pulls')).toBeNull();
    });

    test('TC-P-03: parses URL with long run ID', () => {
      const result = funcs.parseWorkflowRunUrl('https://github.com/my-org/my-repo/actions/runs/9876543210');
      expect(result).toEqual({ owner: 'my-org', repo: 'my-repo', runId: '9876543210' });
    });

    test('TC-P-04: returns null for URL without run ID', () => {
      expect(funcs.parseWorkflowRunUrl('https://github.com/owner/repo/actions/runs/')).toBeNull();
    });

    test('TC-P-05: parses URL with additional path segments after run ID', () => {
      const result = funcs.parseWorkflowRunUrl('https://github.com/owner/repo/actions/runs/555/jobs/1');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', runId: '555' });
    });
  });

  // ─── getBranchText ──────────────────────────────────────────────────────

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

  // ─── runAllEnhancements ─────────────────────────────────────────────────

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
