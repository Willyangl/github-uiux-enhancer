/**
 * GitHub Enhancer - i18n module
 *
 * Provides translation support for ja, en, zh.
 * Usage:
 *   await i18n.load();        // Load language from storage (or detect from browser)
 *   i18n.t('popup.tokenSave') // → "保存" / "Save" / "保存"
 *   i18n.t('popup.tokenSetUser', { user: 'alice' }) // → "トークン設定済み（alice）"
 */

'use strict';

const i18n = (() => {
  const SUPPORTED = ['ja', 'en', 'zh'];
  const DEFAULT_LANG = 'ja';
  let currentLang = DEFAULT_LANG;
  let messages = {};
  const cache = {}; // lang → messages

  /**
   * Detects the best default language from the browser locale.
   */
  function detectLang() {
    const browserLang = (navigator.language || '').toLowerCase();
    if (browserLang.startsWith('zh')) return 'zh';
    if (browserLang.startsWith('en')) return 'en';
    if (browserLang.startsWith('ja')) return 'ja';
    return DEFAULT_LANG;
  }

  /**
   * Fetches a translation JSON file.
   */
  async function fetchMessages(lang) {
    if (cache[lang]) return cache[lang];
    try {
      const url = chrome.runtime.getURL(`i18n/${lang}.json`);
      const res = await fetch(url);
      if (!res.ok) return {};
      const json = await res.json();
      cache[lang] = json;
      return json;
    } catch {
      return {};
    }
  }

  /**
   * Loads the language from storage, falling back to browser detection.
   */
  async function load() {
    return new Promise((resolve) => {
      chrome.storage.local.get('language', async (data) => {
        currentLang = data.language || detectLang();
        if (!SUPPORTED.includes(currentLang)) currentLang = DEFAULT_LANG;
        messages = await fetchMessages(currentLang);
        resolve(currentLang);
      });
    });
  }

  /**
   * Synchronous load variant for content scripts that already have
   * the language setting available.
   */
  async function loadWithLang(lang) {
    currentLang = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
    messages = await fetchMessages(currentLang);
    return currentLang;
  }

  /**
   * Returns the translated string for a dotted key path.
   * Supports placeholder replacement: {key} → value.
   *
   *   t('popup.tokenSetUser', { user: 'alice' })
   *   → "トークン設定済み（alice）"
   */
  function t(key, params) {
    const parts = key.split('.');
    let val = messages;
    for (const p of parts) {
      if (val == null) break;
      val = val[p];
    }
    if (typeof val !== 'string') return key; // fallback to key

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      }
    }
    return val;
  }

  /**
   * Returns the current language code.
   */
  function getLang() {
    return currentLang;
  }

  /**
   * Saves a new language to storage and reloads messages.
   */
  async function setLang(lang) {
    if (!SUPPORTED.includes(lang)) return;
    currentLang = lang;
    messages = await fetchMessages(lang);
    await new Promise(resolve => chrome.storage.local.set({ language: lang }, resolve));
  }

  return { load, loadWithLang, t, getLang, setLang, SUPPORTED, detectLang };
})();
