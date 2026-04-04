/**
 * GitHub Enhancer - Background Service Worker
 *
 * Polls GitHub API for watched workflow runs and sends browser notifications
 * when a run completes.
 */

'use strict';

const ALARM_NAME = 'pollWorkflowRuns';
const POLL_INTERVAL_MINUTES = 1;
const FETCH_TIMEOUT_MS = 15000; // 15 seconds

// ─── Alarm setup ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: POLL_INTERVAL_MINUTES,
    periodInMinutes: POLL_INTERVAL_MINUTES,
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'START_POLLING') {
    ensureAlarm();
  }
  // Content script detected completion via DOM — trigger immediate poll
  if (message.type === 'RUN_COMPLETED_ON_PAGE') {
    pollWatchedRuns();
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

// ─── Fetch with timeout ──────────────────────────────────────────────────────

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── i18n for background (loads JSON directly) ──────────────────────────────

const bgI18nCache = {};

async function loadBgI18n() {
  const data = await chrome.storage.local.get('language');
  const lang = data.language || detectBgLang();
  if (bgI18nCache[lang]) return bgI18nCache[lang];
  const url = chrome.runtime.getURL(`i18n/${lang}.json`);
  const res = await fetch(url);
  const json = await res.json();
  bgI18nCache[lang] = json;
  return json;
}

function detectBgLang() {
  const browserLang = (navigator.language || '').toLowerCase();
  if (browserLang.startsWith('zh')) return 'zh';
  if (browserLang.startsWith('en')) return 'en';
  return 'ja';
}

function bgT(messages, key, params) {
  const parts = key.split('.');
  let val = messages;
  for (const p of parts) {
    if (val == null) break;
    val = val[p];
  }
  if (typeof val !== 'string') return key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return val;
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

  if (!token || Object.keys(watchedRuns).length === 0) {
    // No runs to watch — stop the alarm to save resources
    chrome.alarms.clear(ALARM_NAME);
    return;
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const completed = [];

  await Promise.all(
    Object.values(watchedRuns).map(async (run) => {
      try {
        const res = await fetchWithTimeout(
          `https://api.github.com/repos/${run.owner}/${run.repo}/actions/runs/${run.runId}`,
          { headers }
        );

        if (!res.ok) {
          console.warn(`GitHub Enhancer: API error for run ${run.runId}: ${res.status}`);
          return;
        }

        const json = await res.json();
        const { status, conclusion, name, head_branch } = json;

        if (status === 'completed') {
          completed.push(run.runId);
          await saveNotificationUrl(run.runId, run.runUrl);
          showNotification(run, name, head_branch, conclusion);
          notifyContentScripts(run, name, head_branch, conclusion);
        }
      } catch (err) {
        console.warn(`GitHub Enhancer: fetch error for run ${run.runId}`, err);
      }
    })
  );

  if (completed.length > 0) {
    completed.forEach(id => delete watchedRuns[id]);
    await chrome.storage.local.set({ watchedRuns });
  }
}

// ─── Notifications ────────────────────────────────────────────────────────────

async function showNotification(run, workflowName, branchName, conclusion) {
  const messages = await loadBgI18n();
  const isSuccess = conclusion === 'success';
  const isCancelled = conclusion === 'cancelled';

  const conclusionKey = `content.conclusion${conclusion.charAt(0).toUpperCase() + conclusion.slice(1)}`;
  const translated = bgT(messages, conclusionKey);
  const conclusionLabel = (translated !== conclusionKey) ? translated : conclusion;

  const title = isSuccess
    ? `✅ ${bgT(messages, 'content.toastTitle')}: ${workflowName ?? 'Workflow'}`
    : isCancelled
    ? `⚠️ ${bgT(messages, 'content.toastTitle')}: ${workflowName ?? 'Workflow'}`
    : `❌ ${bgT(messages, 'content.toastTitle')}: ${workflowName ?? 'Workflow'}`;

  const message = [
    branchName ? bgT(messages, 'content.toastBranch', { branch: branchName }) : '',
    bgT(messages, 'content.toastResult', { conclusion: conclusionLabel }),
    `${run.owner}/${run.repo}`,
  ].filter(Boolean).join('\n');

  chrome.notifications.create(`run-${run.runId}`, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
    priority: 2,
  });
}

/**
 * Sends a WORKFLOW_COMPLETED message to all open GitHub tabs.
 */
async function notifyContentScripts(run, workflowName, branchName, conclusion) {
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
  const data = {
    workflowName, branchName, conclusion,
    runUrl: run.runUrl, owner: run.owner, repo: run.repo, runId: run.runId,
  };
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'WORKFLOW_COMPLETED', data }).catch(() => {});
  }
}

async function saveNotificationUrl(runId, url) {
  const data = await chrome.storage.local.get('notificationUrls');
  const urls = data.notificationUrls || {};
  urls[runId] = url;
  await chrome.storage.local.set({ notificationUrls: urls });
}

// Open the workflow run page when OS notification is clicked
chrome.notifications.onClicked.addListener((notificationId) => {
  const runId = notificationId.replace('run-', '');
  chrome.storage.local.get('notificationUrls', (data) => {
    if (!data) return;
    const urls = data.notificationUrls || {};
    const url = urls[runId];
    if (url) {
      chrome.tabs.create({ url });
      delete urls[runId];
      chrome.storage.local.set({ notificationUrls: urls });
    }
  });
  chrome.notifications.clear(notificationId);
});
