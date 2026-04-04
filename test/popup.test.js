/**
 * GitHub Enhancer - Popup UI Tests
 *
 * Tests cover:
 *   - Token validation (format check)
 *   - Watched runs rendering
 *   - showStatus helper
 *
 * @jest-environment jsdom
 */

'use strict';

const { createChromeMock } = require('./chrome-mock');
const fs = require('fs');
const path = require('path');

// ─── Setup popup HTML ─────────────────────────────────────────────────────────

const popupHtml = fs.readFileSync(path.resolve(__dirname, '../popup.html'), 'utf-8');

function setupPopupDOM() {
  // Extract the <body> content (without the <script> tag so we load popup.js ourselves)
  const bodyMatch = popupHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    document.body.innerHTML = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '');
  }
}

// Load popup.js source
const popupSrc = fs.readFileSync(path.resolve(__dirname, '../popup.js'), 'utf-8');

function loadPopupScript(chromeMock) {
  global.chrome = chromeMock;
  global.alert = global.alert || jest.fn();
  // popup.js references DOM elements directly, so DOM must be ready
  setupPopupDOM();

  const src = popupSrc.replace(/^'use strict';$/m, '');

  const fn = new Function(
    'chrome', 'fetch', 'document', 'window', 'navigator', 'alert', 'setTimeout', 'Promise',
    `
      ${src}
      return { renderWatchedRuns, showStatus };
    `
  );
  return fn(chromeMock, global.fetch, document, window, navigator, alert, setTimeout, Promise);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Popup UI', () => {
  let chromeMock;
  let funcs;

  beforeEach(() => {
    chromeMock = createChromeMock();
    global.chrome = chromeMock;
    global.fetch = jest.fn();
    funcs = loadPopupScript(chromeMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── DOM Structure ────────────────────────────────────────────────────

  describe('DOM structure', () => {
    test('TC-PO-01: popup has token input field', () => {
      expect(document.getElementById('token-input')).not.toBeNull();
    });

    test('TC-PO-02: popup has save button', () => {
      expect(document.getElementById('save-token-btn')).not.toBeNull();
    });

    test('TC-PO-03: popup has watched-runs-list container', () => {
      expect(document.getElementById('watched-runs-list')).not.toBeNull();
    });

    test('TC-PO-04: popup has token status display', () => {
      expect(document.getElementById('token-status')).not.toBeNull();
    });
  });

  // ─── Token validation ─────────────────────────────────────────────────

  describe('Token validation on save', () => {
    test('TC-PO-05: empty token shows error message', () => {
      const input = document.getElementById('token-input');
      const saveBtn = document.getElementById('save-token-btn');
      input.value = '';
      saveBtn.click();

      const statusMsg = document.getElementById('token-status-msg');
      expect(statusMsg.textContent).toContain('トークンを入力してください');
    });

    test('TC-PO-06: invalid token format shows error message', () => {
      const input = document.getElementById('token-input');
      const saveBtn = document.getElementById('save-token-btn');
      input.value = 'invalid-token-format';
      saveBtn.click();

      const statusMsg = document.getElementById('token-status-msg');
      expect(statusMsg.textContent).toContain('有効なGitHubトークン形式ではありません');
    });

    test('TC-PO-07: ghp_ prefix is accepted as valid format', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ login: 'testuser' }),
      });

      const input = document.getElementById('token-input');
      input.value = 'ghp_validtokenvalue1234';
      const saveBtn = document.getElementById('save-token-btn');
      saveBtn.click();

      // The fetch should be called (format was accepted)
      // Wait for async operations
      await new Promise(r => setTimeout(r, 50));
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({ 'Authorization': 'Bearer ghp_validtokenvalue1234' }),
        }),
      );
    });

    test('TC-PO-08: github_pat_ prefix is accepted as valid format', async () => {
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ login: 'testuser2' }),
      });

      const input = document.getElementById('token-input');
      input.value = 'github_pat_validtokenvalue1234';
      const saveBtn = document.getElementById('save-token-btn');
      saveBtn.click();

      await new Promise(r => setTimeout(r, 50));
      expect(fetch).toHaveBeenCalled();
    });
  });

  // ─── renderWatchedRuns ────────────────────────────────────────────────

  describe('renderWatchedRuns', () => {
    test('TC-PO-09: shows empty message when no runs', () => {
      funcs.renderWatchedRuns({});
      const list = document.getElementById('watched-runs-list');
      expect(list.textContent).toContain('通知待ちのワークフローはありません');
    });

    test('TC-PO-10: renders watched run items', () => {
      funcs.renderWatchedRuns({
        '111': { owner: 'org', repo: 'app', runId: '111', runUrl: 'https://github.com/org/app/actions/runs/111' },
        '222': { owner: 'org', repo: 'lib', runId: '222', runUrl: 'https://github.com/org/lib/actions/runs/222' },
      });

      const items = document.querySelectorAll('.watched-run-item');
      expect(items.length).toBe(2);
    });

    test('TC-PO-11: each item shows owner/repo and run ID', () => {
      funcs.renderWatchedRuns({
        '999': { owner: 'myorg', repo: 'myrepo', runId: '999', runUrl: 'https://github.com/myorg/myrepo/actions/runs/999' },
      });

      const link = document.querySelector('.watched-run-link');
      expect(link.textContent).toBe('myorg/myrepo #999');
    });

    test('TC-PO-12: each item has a remove button', () => {
      funcs.renderWatchedRuns({
        '888': { owner: 'o', repo: 'r', runId: '888', runUrl: 'u' },
      });

      const removeBtn = document.querySelector('.btn-danger');
      expect(removeBtn).not.toBeNull();
      expect(removeBtn.textContent).toBe('解除');
    });

    test('TC-PO-13: remove button removes the run from storage', async () => {
      chromeMock.storage.local.set({
        watchedRuns: {
          '777': { owner: 'o', repo: 'r', runId: '777', runUrl: 'u' },
          '888': { owner: 'o', repo: 'r', runId: '888', runUrl: 'u' },
        },
      });

      funcs.renderWatchedRuns({
        '777': { owner: 'o', repo: 'r', runId: '777', runUrl: 'u' },
        '888': { owner: 'o', repo: 'r', runId: '888', runUrl: 'u' },
      });

      // Click remove on first item
      const removeBtn = document.querySelector('.btn-danger');
      removeBtn.click();

      // Wait for async storage update
      await new Promise(r => setTimeout(r, 50));
      const data = await chromeMock.storage.local.get('watchedRuns');
      expect(Object.keys(data.watchedRuns).length).toBe(1);
    });

    test('TC-PO-14: links have correct href and target=_blank', () => {
      funcs.renderWatchedRuns({
        '555': { owner: 'o', repo: 'r', runId: '555', runUrl: 'https://github.com/o/r/actions/runs/555' },
      });

      const link = document.querySelector('.watched-run-link');
      expect(link.href).toBe('https://github.com/o/r/actions/runs/555');
      expect(link.target).toBe('_blank');
    });
  });

  // ─── showStatus ───────────────────────────────────────────────────────

  describe('showStatus', () => {
    test('TC-PO-15: displays message with success class', () => {
      funcs.showStatus('保存しました', 'success');
      const el = document.getElementById('token-status-msg');
      expect(el.textContent).toBe('保存しました');
      expect(el.className).toContain('success');
    });

    test('TC-PO-16: displays message with error class', () => {
      funcs.showStatus('エラー', 'error');
      const el = document.getElementById('token-status-msg');
      expect(el.textContent).toBe('エラー');
      expect(el.className).toContain('error');
    });
  });
});
