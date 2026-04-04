/**
 * GitHub Enhancer - Background Service Worker
 *
 * Polls GitHub API for watched workflow runs and sends browser notifications
 * when a run completes.
 */

'use strict';

const ALARM_NAME = 'pollWorkflowRuns';
const POLL_INTERVAL_MINUTES = 1; // Poll every minute

// ─── Alarm setup ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: POLL_INTERVAL_MINUTES,
    periodInMinutes: POLL_INTERVAL_MINUTES,
  });
});

// Start polling immediately when triggered by content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'START_POLLING') {
    ensureAlarm();
  }
});

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: POLL_INTERVAL_MINUTES,
      periodInMinutes: POLL_INTERVAL_MINUTES,
    });
  }
}

// ─── Polling logic ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await pollWatchedRuns();
});

async function pollWatchedRuns() {
  const data = await chrome.storage.local.get(['watchedRuns', 'githubToken']);
  const watchedRuns = data.watchedRuns || {};
  const token = data.githubToken;

  if (!token || Object.keys(watchedRuns).length === 0) return;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const completed = [];

  await Promise.all(
    Object.values(watchedRuns).map(async (run) => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${run.owner}/${run.repo}/actions/runs/${run.runId}`,
          { headers }
        );

        if (!res.ok) {
          console.warn(`GitHub Enhancer: API error for run ${run.runId}: ${res.status}`);
          return;
        }

        const json = await res.json();
        const { status, conclusion, name, head_branch } = json;

        // status values: queued | in_progress | completed
        if (status === 'completed') {
          completed.push(run.runId);
          showNotification(run, name, head_branch, conclusion);
        }
      } catch (err) {
        console.warn(`GitHub Enhancer: fetch error for run ${run.runId}`, err);
      }
    })
  );

  // Remove completed runs from watch list
  if (completed.length > 0) {
    completed.forEach(id => delete watchedRuns[id]);
    await chrome.storage.local.set({ watchedRuns });
  }
}

// ─── Notifications ────────────────────────────────────────────────────────────

function showNotification(run, workflowName, branchName, conclusion) {
  const isSuccess = conclusion === 'success';
  const isCancelled = conclusion === 'cancelled';

  const iconMap = {
    success: 'icons/icon48.png',
    failure: 'icons/icon48.png',
    cancelled: 'icons/icon48.png',
  };

  const conclusionLabel = {
    success: '成功',
    failure: '失敗',
    cancelled: 'キャンセル',
    timed_out: 'タイムアウト',
    skipped: 'スキップ',
  }[conclusion] ?? conclusion;

  const title = isSuccess
    ? `✅ ワークフロー完了: ${workflowName ?? 'Workflow'}`
    : isCancelled
    ? `⚠️ ワークフローキャンセル: ${workflowName ?? 'Workflow'}`
    : `❌ ワークフロー失敗: ${workflowName ?? 'Workflow'}`;

  const message = [
    branchName ? `ブランチ: ${branchName}` : '',
    `結果: ${conclusionLabel}`,
    `${run.owner}/${run.repo}`,
  ].filter(Boolean).join('\n');

  chrome.notifications.create(`run-${run.runId}`, {
    type: 'basic',
    iconUrl: iconMap[conclusion] ?? 'icons/icon48.png',
    title,
    message,
    priority: 2,
  });
}

// Open the workflow run page when notification is clicked
chrome.notifications.onClicked.addListener((notificationId) => {
  const runId = notificationId.replace('run-', '');
  chrome.storage.local.get('notificationUrls', (data) => {
    const urls = data.notificationUrls || {};
    const url = urls[runId];
    if (url) {
      chrome.tabs.create({ url });
    }
  });
  chrome.notifications.clear(notificationId);
});
