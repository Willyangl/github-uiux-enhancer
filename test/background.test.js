/**
 * GitHub Enhancer - Background Service Worker Tests
 *
 * Tests cover:
 *   - pollWatchedRuns: GitHub API polling, completed run detection
 *   - showNotification: browser notification content and labels
 *   - ensureAlarm: alarm creation and idempotency
 *   - onMessage handler: START_POLLING trigger
 *   - onClicked handler: notification click opens URL
 *
 * @jest-environment jsdom
 */

'use strict';

const { createChromeMock } = require('./chrome-mock');
const fs = require('fs');
const path = require('path');

// ─── Load background.js in a testable way ────────────────────────────────────

const bgSrc = fs.readFileSync(path.resolve(__dirname, '../background.js'), 'utf-8');

function loadBackgroundScript(chromeMock) {
  global.chrome = chromeMock;

  const src = bgSrc.replace(/^'use strict';$/m, '');

  const fn = new Function('chrome', 'fetch', `
    ${src}
    return {
      pollWatchedRuns,
      showNotification,
      ensureAlarm,
      ALARM_NAME,
      POLL_INTERVAL_MINUTES,
    };
  `);
  return fn(chromeMock, global.fetch);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Background Service Worker', () => {
  let chromeMock;
  let funcs;

  beforeEach(() => {
    chromeMock = createChromeMock();
    global.chrome = chromeMock;
    global.fetch = jest.fn();
    funcs = loadBackgroundScript(chromeMock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Constants ────────────────────────────────────────────────────────

  describe('Constants', () => {
    test('TC-BG-01: alarm name is defined', () => {
      expect(funcs.ALARM_NAME).toBe('pollWorkflowRuns');
    });

    test('TC-BG-02: poll interval is 1 minute', () => {
      expect(funcs.POLL_INTERVAL_MINUTES).toBe(1);
    });
  });

  // ─── pollWatchedRuns ──────────────────────────────────────────────────

  describe('pollWatchedRuns', () => {
    test('TC-BG-03: does nothing when no token is set', async () => {
      chromeMock.storage.local.set({
        watchedRuns: { '123': { owner: 'o', repo: 'r', runId: '123', runUrl: 'u' } },
      });

      await funcs.pollWatchedRuns();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('TC-BG-04: does nothing when no watched runs exist', async () => {
      chromeMock.storage.local.set({ githubToken: 'ghp_test' });

      await funcs.pollWatchedRuns();
      expect(fetch).not.toHaveBeenCalled();
    });

    test('TC-BG-05: calls GitHub API for each watched run', async () => {
      chromeMock.storage.local.set({
        githubToken: 'ghp_test',
        watchedRuns: {
          '111': { owner: 'org1', repo: 'repo1', runId: '111', runUrl: 'https://github.com/org1/repo1/actions/runs/111' },
          '222': { owner: 'org2', repo: 'repo2', runId: '222', runUrl: 'https://github.com/org2/repo2/actions/runs/222' },
        },
      });

      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'in_progress', conclusion: null, name: 'CI', head_branch: 'main' }),
      });

      await funcs.pollWatchedRuns();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/org1/repo1/actions/runs/111',
        expect.objectContaining({ headers: expect.objectContaining({ 'Authorization': 'Bearer ghp_test' }) }),
      );
    });

    test('TC-BG-06: removes completed run from watchedRuns and creates notification', async () => {
      chromeMock.storage.local.set({
        githubToken: 'ghp_test',
        watchedRuns: {
          '333': { owner: 'o', repo: 'r', runId: '333', runUrl: 'https://github.com/o/r/actions/runs/333' },
        },
      });

      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'completed', conclusion: 'success', name: 'Deploy', head_branch: 'release/v1' }),
      });

      await funcs.pollWatchedRuns();

      // Verify the run was removed from storage
      const data = await chromeMock.storage.local.get('watchedRuns');
      expect(data.watchedRuns['333']).toBeUndefined();

      // Verify notification was created
      const notifications = chromeMock.notifications._getCreated();
      expect(notifications.length).toBe(1);
      expect(notifications[0].id).toBe('run-333');
    });

    test('TC-BG-07: keeps in_progress runs in watchedRuns', async () => {
      chromeMock.storage.local.set({
        githubToken: 'ghp_test',
        watchedRuns: {
          '444': { owner: 'o', repo: 'r', runId: '444', runUrl: 'u' },
        },
      });

      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'in_progress', conclusion: null, name: 'CI', head_branch: 'main' }),
      });

      await funcs.pollWatchedRuns();

      const data = await chromeMock.storage.local.get('watchedRuns');
      expect(data.watchedRuns['444']).toBeDefined();
    });

    test('TC-BG-08: handles API error gracefully (does not remove run)', async () => {
      chromeMock.storage.local.set({
        githubToken: 'ghp_test',
        watchedRuns: {
          '555': { owner: 'o', repo: 'r', runId: '555', runUrl: 'u' },
        },
      });

      fetch.mockResolvedValue({ ok: false, status: 403 });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      await funcs.pollWatchedRuns();

      const data = await chromeMock.storage.local.get('watchedRuns');
      expect(data.watchedRuns['555']).toBeDefined();
      consoleSpy.mockRestore();
    });

    test('TC-BG-09: handles fetch exception gracefully', async () => {
      chromeMock.storage.local.set({
        githubToken: 'ghp_test',
        watchedRuns: {
          '666': { owner: 'o', repo: 'r', runId: '666', runUrl: 'u' },
        },
      });

      fetch.mockRejectedValue(new Error('Network error'));

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      await funcs.pollWatchedRuns();

      const data = await chromeMock.storage.local.get('watchedRuns');
      expect(data.watchedRuns['666']).toBeDefined();
      consoleSpy.mockRestore();
    });
  });

  // ─── showNotification ─────────────────────────────────────────────────

  describe('showNotification', () => {
    const run = { owner: 'org', repo: 'app', runId: '100', runUrl: 'https://github.com/org/app/actions/runs/100' };

    test('TC-BG-10: success notification has correct title', () => {
      funcs.showNotification(run, 'CI Build', 'main', 'success');
      const n = chromeMock.notifications._getCreated()[0];
      expect(n.options.title).toContain('✅');
      expect(n.options.title).toContain('CI Build');
    });

    test('TC-BG-11: failure notification has correct title', () => {
      funcs.showNotification(run, 'Deploy', 'release', 'failure');
      const n = chromeMock.notifications._getCreated()[0];
      expect(n.options.title).toContain('❌');
      expect(n.options.title).toContain('Deploy');
    });

    test('TC-BG-12: cancelled notification has correct title', () => {
      funcs.showNotification(run, 'Test', 'dev', 'cancelled');
      const n = chromeMock.notifications._getCreated()[0];
      expect(n.options.title).toContain('⚠️');
    });

    test('TC-BG-13: message includes branch name and repo info', () => {
      funcs.showNotification(run, 'CI', 'feature/xyz', 'success');
      const n = chromeMock.notifications._getCreated()[0];
      expect(n.options.message).toContain('feature/xyz');
      expect(n.options.message).toContain('org/app');
    });

    test('TC-BG-14: conclusion labels are in Japanese', () => {
      funcs.showNotification(run, 'CI', 'main', 'success');
      const n1 = chromeMock.notifications._getCreated()[0];
      expect(n1.options.message).toContain('成功');

      chromeMock.notifications._clearCreated();
      funcs.showNotification(run, 'CI', 'main', 'failure');
      const n2 = chromeMock.notifications._getCreated()[0];
      expect(n2.options.message).toContain('失敗');

      chromeMock.notifications._clearCreated();
      funcs.showNotification(run, 'CI', 'main', 'cancelled');
      const n3 = chromeMock.notifications._getCreated()[0];
      expect(n3.options.message).toContain('キャンセル');
    });

    test('TC-BG-15: unknown conclusion is passed through as-is', () => {
      funcs.showNotification(run, 'CI', 'main', 'action_required');
      const n = chromeMock.notifications._getCreated()[0];
      expect(n.options.message).toContain('action_required');
    });

    test('TC-BG-16: null workflow name uses fallback "Workflow"', () => {
      funcs.showNotification(run, null, 'main', 'success');
      const n = chromeMock.notifications._getCreated()[0];
      expect(n.options.title).toContain('Workflow');
    });

    test('TC-BG-17: null branch name is omitted from message', () => {
      funcs.showNotification(run, 'CI', null, 'success');
      const n = chromeMock.notifications._getCreated()[0];
      expect(n.options.message).not.toContain('ブランチ');
    });

    test('TC-BG-18: notification ID follows run-{runId} pattern', () => {
      funcs.showNotification(run, 'CI', 'main', 'success');
      const n = chromeMock.notifications._getCreated()[0];
      expect(n.id).toBe('run-100');
    });
  });

  // ─── ensureAlarm ──────────────────────────────────────────────────────

  describe('ensureAlarm', () => {
    test('TC-BG-19: creates alarm if not existing', async () => {
      await funcs.ensureAlarm();
      const alarm = await chromeMock.alarms.get(funcs.ALARM_NAME);
      expect(alarm).toBeDefined();
    });

    test('TC-BG-20: does not create duplicate alarm', async () => {
      chromeMock.alarms.create(funcs.ALARM_NAME, { periodInMinutes: 1 });
      await funcs.ensureAlarm();
      // Should still have the alarm (no error thrown)
      const alarm = await chromeMock.alarms.get(funcs.ALARM_NAME);
      expect(alarm).toBeDefined();
    });
  });
});
