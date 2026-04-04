/**
 * Mock for chrome.* APIs used by the extension.
 * Provides a minimal in-memory implementation of chrome.storage.local,
 * chrome.alarms, chrome.notifications, chrome.runtime, and chrome.tabs.
 */

'use strict';

function createChromeMock() {
  let store = {};
  const changeListeners = [];

  const storage = {
    local: {
      get(keys, callback) {
        if (typeof keys === 'string') keys = [keys];
        if (!Array.isArray(keys) && typeof keys === 'object' && keys !== null) {
          keys = Object.keys(keys);
        }
        const result = {};
        (keys || Object.keys(store)).forEach(k => {
          if (store[k] !== undefined) result[k] = store[k];
        });
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set(items, callback) {
        const changes = {};
        Object.entries(items).forEach(([k, v]) => {
          changes[k] = { oldValue: store[k], newValue: v };
          store[k] = v;
        });
        changeListeners.forEach(fn => fn(changes, 'local'));
        if (callback) callback();
        return Promise.resolve();
      },
      remove(keys, callback) {
        if (typeof keys === 'string') keys = [keys];
        keys.forEach(k => delete store[k]);
        if (callback) callback();
        return Promise.resolve();
      },
      clear(callback) {
        store = {};
        if (callback) callback();
        return Promise.resolve();
      },
    },
    onChanged: {
      addListener(fn) { changeListeners.push(fn); },
      removeListener(fn) {
        const idx = changeListeners.indexOf(fn);
        if (idx >= 0) changeListeners.splice(idx, 1);
      },
    },
  };

  const alarmCallbacks = [];
  const alarms = {};
  const alarmsApi = {
    create(name, info) { alarms[name] = info; },
    get(name) { return Promise.resolve(alarms[name] || null); },
    clear(name) { delete alarms[name]; return Promise.resolve(true); },
    onAlarm: {
      addListener(fn) { alarmCallbacks.push(fn); },
    },
    // Test helper: fire an alarm
    _fire(name) {
      alarmCallbacks.forEach(fn => fn({ name }));
    },
  };

  const notificationCallbacks = [];
  const createdNotifications = [];
  const notifications = {
    create(id, options, callback) {
      createdNotifications.push({ id, options });
      if (callback) callback(id);
    },
    clear(id, callback) {
      if (callback) callback(true);
    },
    onClicked: {
      addListener(fn) { notificationCallbacks.push(fn); },
    },
    _getCreated() { return createdNotifications; },
    _clearCreated() { createdNotifications.length = 0; },
  };

  const messageListeners = [];
  const runtime = {
    sendMessage(msg, callback) {
      messageListeners.forEach(fn => fn(msg));
      if (callback) callback();
    },
    onMessage: {
      addListener(fn) { messageListeners.push(fn); },
    },
    onInstalled: {
      addListener(fn) { /* store but don't auto-fire */ },
    },
    getURL(path) { return `chrome-extension://mock-id/${path}`; },
  };

  const createdTabs = [];
  const tabs = {
    create(options) { createdTabs.push(options); },
    query() { return Promise.resolve([]); },
    sendMessage() { return Promise.resolve(); },
    _getCreated() { return createdTabs; },
  };

  return {
    storage,
    alarms: alarmsApi,
    notifications,
    runtime,
    tabs,
    // Test helpers
    _store: () => store,
    _resetStore() { store = {}; },
  };
}

module.exports = { createChromeMock };
