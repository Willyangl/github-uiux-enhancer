'use strict';

const tokenInput = document.getElementById('token-input');
const saveTokenBtn = document.getElementById('save-token-btn');
const tokenStatusMsg = document.getElementById('token-status-msg');
const tokenStatus = document.getElementById('token-status');
const watchedRunsList = document.getElementById('watched-runs-list');
const langSelect = document.getElementById('lang-select');

// Feature toggles
const toggleIds = {
  widenDropdown: 'toggle-widenDropdown',
  fullBranchName: 'toggle-fullBranchName',
  copyButton: 'toggle-copyButton',
  notifications: 'toggle-notifications',
  autoNotify: 'toggle-autoNotify',
};
const dropdownCharInput = document.getElementById('dropdown-char-count');
const dropdownCharSetting = document.getElementById('dropdown-char-setting');

const DEFAULTS = {
  featureToggles: {
    widenDropdown: true,
    fullBranchName: true,
    copyButton: true,
    notifications: true,
    autoNotify: false,
  },
  dropdownCharCount: 50,
};

// ─── i18n helpers ─────────────────────────────────────────────────────────────

/**
 * Applies translations to all elements with data-i18n attribute.
 */
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = i18n.t(key);
    if (text !== key) el.textContent = text;
  });
  // Also translate the placeholder
  if (tokenInput) tokenInput.placeholder = i18n.t('popup.tokenPlaceholder');
}

// ─── Load saved state ─────────────────────────────────────────────────────────

(async () => {
  // Load language first, then apply translations
  const lang = await i18n.load();
  if (langSelect) langSelect.value = lang;
  applyTranslations();

  chrome.storage.local.get(['githubToken', 'watchedRuns', 'featureToggles', 'dropdownCharCount'], (data) => {
    // Token status
    if (data.githubToken) {
      tokenInput.placeholder = i18n.t('popup.tokenPlaceholderSaved');
      tokenStatus.innerHTML = `
        <div class="token-set-indicator">
          ✅ ${i18n.t('popup.tokenSet')}
        </div>`;
    } else {
      tokenStatus.innerHTML = `
        <div class="token-not-set-indicator">
          ⚠️ ${i18n.t('popup.tokenNotSet')}
        </div>`;
    }

    // Feature toggles
    const toggles = { ...DEFAULTS.featureToggles, ...(data.featureToggles || {}) };
    Object.entries(toggleIds).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.checked = toggles[key];
    });

    // Dropdown char count
    const charCount = data.dropdownCharCount ?? DEFAULTS.dropdownCharCount;
    if (dropdownCharInput) dropdownCharInput.value = charCount;

    // Show/hide sub-settings based on toggles
    updateDropdownCharVisibility(toggles.widenDropdown);
    updateAutoNotifyVisibility(toggles.notifications);

    renderWatchedRuns(data.watchedRuns || {});
  });
})();

// ─── Language selector ────────────────────────────────────────────────────────

if (langSelect) {
  langSelect.addEventListener('change', async () => {
    await i18n.setLang(langSelect.value);
    applyTranslations();
    // Re-render dynamic content
    chrome.storage.local.get(['githubToken', 'watchedRuns'], (data) => {
      if (data.githubToken) {
        tokenInput.placeholder = i18n.t('popup.tokenPlaceholderSaved');
        tokenStatus.innerHTML = `<div class="token-set-indicator">✅ ${i18n.t('popup.tokenSet')}</div>`;
      } else {
        tokenStatus.innerHTML = `<div class="token-not-set-indicator">⚠️ ${i18n.t('popup.tokenNotSet')}</div>`;
      }
      renderWatchedRuns(data.watchedRuns || {});
    });
  });
}

// ─── Feature toggle handlers ──────────────────────────────────────────────────

Object.entries(toggleIds).forEach(([key, id]) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    chrome.storage.local.get('featureToggles', (data) => {
      const toggles = { ...DEFAULTS.featureToggles, ...(data.featureToggles || {}) };
      toggles[key] = el.checked;
      chrome.storage.local.set({ featureToggles: toggles });

      if (key === 'widenDropdown') {
        updateDropdownCharVisibility(el.checked);
      }
      if (key === 'notifications') {
        updateAutoNotifyVisibility(el.checked);
      }
    });
  });
});

function updateDropdownCharVisibility(enabled) {
  if (dropdownCharSetting) {
    dropdownCharSetting.style.display = enabled ? 'flex' : 'none';
  }
}

function updateAutoNotifyVisibility(enabled) {
  const el = document.getElementById('auto-notify-setting');
  if (el) {
    el.style.display = enabled ? 'flex' : 'none';
  }
}

// Dropdown char count handler
if (dropdownCharInput) {
  dropdownCharInput.addEventListener('change', () => {
    let val = parseInt(dropdownCharInput.value, 10);
    if (isNaN(val) || val < 20) val = 20;
    if (val > 120) val = 120;
    dropdownCharInput.value = val;
    chrome.storage.local.set({ dropdownCharCount: val });
  });
}

// ─── Save token ───────────────────────────────────────────────────────────────

saveTokenBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showStatus(i18n.t('popup.tokenEmpty'), 'error');
    return;
  }

  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
    showStatus(i18n.t('popup.tokenInvalid'), 'error');
    return;
  }

  // Verify token with GitHub API
  saveTokenBtn.disabled = true;
  saveTokenBtn.textContent = i18n.t('popup.tokenSaving');

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
      },
    });

    if (res.ok) {
      const user = await res.json();
      chrome.storage.local.set({ githubToken: token }, () => {
        tokenInput.value = '';
        tokenInput.placeholder = i18n.t('popup.tokenPlaceholderSaved');
        tokenStatus.innerHTML = `<div class="token-set-indicator">✅ ${i18n.t('popup.tokenSetUser', { user: user.login })}</div>`;
        showStatus(i18n.t('popup.tokenSaved', { user: user.login }), 'success');
        chrome.runtime.sendMessage({ type: 'START_POLLING' });
      });
    } else if (res.status === 401) {
      showStatus(i18n.t('popup.tokenUnauthorized'), 'error');
    } else {
      showStatus(i18n.t('popup.tokenError', { status: res.status }), 'error');
    }
  } catch {
    showStatus(i18n.t('popup.tokenNetworkError'), 'error');
  } finally {
    saveTokenBtn.disabled = false;
    saveTokenBtn.textContent = i18n.t('popup.tokenSave');
  }
});

// Allow saving with Enter key
tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveTokenBtn.click();
});

// ─── Watched runs list ────────────────────────────────────────────────────────

function renderWatchedRuns(watchedRuns) {
  const runs = Object.values(watchedRuns);

  if (runs.length === 0) {
    watchedRunsList.innerHTML = `<p class="empty-msg">${i18n.t('popup.watchedEmpty')}</p>`;
    return;
  }

  watchedRunsList.innerHTML = '';
  runs.forEach(run => {
    const item = document.createElement('div');
    item.className = 'watched-run-item';

    const link = document.createElement('a');
    link.className = 'watched-run-link';
    link.href = run.runUrl;
    link.target = '_blank';
    link.textContent = `${run.owner}/${run.repo} #${run.runId}`;
    link.title = run.runUrl;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-danger';
    removeBtn.style.cssText = 'padding:2px 6px;font-size:11px;flex-shrink:0;margin-left:6px';
    removeBtn.textContent = i18n.t('popup.watchedRemove');
    removeBtn.addEventListener('click', () => {
      chrome.storage.local.get('watchedRuns', (data) => {
        const watched = data.watchedRuns || {};
        delete watched[run.runId];
        chrome.storage.local.set({ watchedRuns: watched }, () => {
          renderWatchedRuns(watched);
        });
      });
    });

    item.appendChild(link);
    item.appendChild(removeBtn);
    watchedRunsList.appendChild(item);
  });
}

// Auto-refresh watched runs list
chrome.storage.onChanged.addListener((changes) => {
  if (changes.watchedRuns) {
    renderWatchedRuns(changes.watchedRuns.newValue || {});
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showStatus(msg, type) {
  tokenStatusMsg.textContent = msg;
  tokenStatusMsg.className = `status-msg ${type}`;
  setTimeout(() => {
    tokenStatusMsg.textContent = '';
    tokenStatusMsg.className = 'status-msg';
  }, 3500);
}
