const state = {
    config: null,
    status: null,
    selectedAccountId: null,
};

const STORAGE_KEY = 'dashboard.selectedAccountId';

const accountsTableBody = document.getElementById('accountsTableBody');
const accountSelect = document.getElementById('accountSelect');
const selectedAccountBadge = document.getElementById('selectedAccountBadge');
const groupPasteInput = document.getElementById('groupPasteInput');
const groupList = document.getElementById('groupList');
const groupCountLabel = document.getElementById('groupCountLabel');
const postEditor = document.getElementById('postEditor');
const statusMessage = document.getElementById('statusMessage');
const saveConfigButton = document.getElementById('saveConfigButton');
const addAccountButton = document.getElementById('addAccountButton');
const appendGroupsButton = document.getElementById('appendGroupsButton');
const replaceGroupsButton = document.getElementById('replaceGroupsButton');
const startRunButton = document.getElementById('startRunButton');
const stopRunButton = document.getElementById('stopRunButton');
const runModeSelect = document.getElementById('runModeSelect');

if (addAccountButton) {
    addAccountButton.addEventListener('click', () => {
        if (!state.config) {
            return;
        }

        const account = createAccount();
        state.config.accounts.push(account);
        state.selectedAccountId = account.id;
        persistSelectedAccount();
        renderAccounts();
        setStatusMessage(`Created ${account.label}. Save when ready.`);
    });
}

if (appendGroupsButton) {
    appendGroupsButton.addEventListener('click', () => mergeGroups('append'));
}

if (replaceGroupsButton) {
    replaceGroupsButton.addEventListener('click', () => mergeGroups('replace'));
}

if (saveConfigButton) {
    saveConfigButton.addEventListener('click', async () => {
        await withErrorHandling(async () => {
            await saveConfig();
        });
    });
}

if (startRunButton) {
    startRunButton.addEventListener('click', async () => {
        await withErrorHandling(async () => {
            await saveConfig();
            await request('/api/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: runModeSelect?.value || 'dashboard',
                    accountId: state.selectedAccountId,
                }),
            });

            const mode = runModeSelect?.value || 'dashboard';
            setStatusMessage(mode === 'test'
                ? 'Test started for the selected account. No post will be submitted.'
                : 'Run started. The dashboard will update automatically.');
            await loadStatus();
        });
    });
}

if (stopRunButton) {
    stopRunButton.addEventListener('click', async () => {
        await withErrorHandling(async () => {
            await request('/api/stop', { method: 'POST' });
            setStatusMessage('Stop requested. The current step will finish first.');
            await loadStatus();
        });
    });
}

if (accountsTableBody) {
    accountsTableBody.addEventListener('input', event => {
        const row = event.target.closest('tr[data-account-id]');
        if (!row || !state.config) {
            return;
        }

        const account = state.config.accounts.find(item => item.id === row.dataset.accountId);
        if (!account) {
            return;
        }

        if (event.target.matches('[data-field="enabled"]')) {
            account.enabled = event.target.checked;
            return;
        }

        account[event.target.dataset.field] = event.target.value;
    });

    accountsTableBody.addEventListener('click', event => {
        const selectButton = event.target.closest('.select-account');
        if (selectButton) {
            if (selectButton.dataset.action === 'open-settings') {
                selectAccount(selectButton.dataset.accountId, { navigate: true });
                return;
            }

            selectAccount(selectButton.dataset.accountId);
            return;
        }

        const removeButton = event.target.closest('.remove-account');
        if (!removeButton || !state.config) {
            return;
        }

        const row = removeButton.closest('tr[data-account-id]');
        state.config.accounts = state.config.accounts.filter(account => account.id !== row.dataset.accountId);
        if (state.selectedAccountId === row.dataset.accountId) {
            state.selectedAccountId = state.config.accounts[0]?.id || null;
            persistSelectedAccount();
        }

        renderAccounts();
        renderWorkspace();
        setStatusMessage('Account removed. Save changes to keep this update.');
    });
}

if (accountSelect) {
    accountSelect.addEventListener('change', event => {
        selectAccount(event.target.value);
    });
}

if (groupList) {
    groupList.addEventListener('click', event => {
        const button = event.target.closest('.remove-group');
        if (!button) {
            return;
        }

        const url = button.closest('.group-row').dataset.groupUrl;
        const account = getSelectedAccount();
        if (!account) {
            return;
        }

        account.groups = account.groups.filter(group => group !== url);
        renderGroups();
        setStatusMessage('Group removed. Save changes when ready.');
    });
}

document.querySelectorAll('.tool').forEach(button => {
    button.addEventListener('click', () => {
        if (!postEditor) {
            return;
        }

        postEditor.focus();
        document.execCommand(button.dataset.command, false, button.dataset.value || null);
        postEditor.dataset.dirty = 'true';
    });
});

if (postEditor) {
    postEditor.addEventListener('input', () => {
        postEditor.dataset.dirty = 'true';
    });
}

window.addEventListener('load', async () => {
    if (!needsAppState()) {
        return;
    }

    await withErrorHandling(async () => {
        await loadConfig();

        if (document.getElementById('runStateBadge')) {
            await loadStatus();
            window.setInterval(() => {
                void withErrorHandling(loadStatus, false);
            }, 3000);
        }
    });
});

function needsAppState() {
    return Boolean(accountsTableBody || accountSelect || saveConfigButton || startRunButton);
}

async function loadConfig() {
    state.config = normalizeClientConfig(await request('/api/config'));
    state.selectedAccountId = window.localStorage.getItem(STORAGE_KEY);
    ensureSelectedAccount();
    renderConfig();
}

async function saveConfig() {
    syncConfigFromView();
    state.config = normalizeClientConfig(state.config);
    state.config = await request('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.config),
    });
    state.config = normalizeClientConfig(state.config);
    ensureSelectedAccount();
    renderConfig();
    setStatusMessage('Changes saved.');
}

async function loadStatus() {
    state.status = await request('/api/status');
    renderStatus();
}

function renderConfig() {
    if (!state.config) {
        return;
    }

    state.config = normalizeClientConfig(state.config);
    ensureSelectedAccount();
    renderAccounts();
    renderWorkspace();

    setInputValue('sessionLimitInput', state.config.settings.sessionLimit || '');
    setInputValue('rotateEveryInput', state.config.settings.rotateEvery || '');
    setInputValue('delayMinInput', Math.round((state.config.settings.delayMinMs || 0) / 1000));
    setInputValue('delayMaxInput', Math.round((state.config.settings.delayMaxMs || 0) / 1000));
    setInputValue('dashboardPortInput', state.config.settings.dashboardPort || 3010);
}

function renderAccounts() {
    if (!accountsTableBody || !state.config) {
        return;
    }

    if (!state.config.accounts.length) {
        accountsTableBody.innerHTML = `
            <tr>
                <td colspan="6"><div class="empty-state">No accounts yet. Add one, then save.</div></td>
            </tr>
        `;
        return;
    }

    const onAccountsPage = window.location.pathname.endsWith('/accounts.html');
    accountsTableBody.innerHTML = state.config.accounts.map(account => `
        <tr class="account-row ${account.id === state.selectedAccountId ? 'active-row' : ''}" data-account-id="${escapeHtml(account.id)}">
            <td><button class="button button-select select-account ${account.id === state.selectedAccountId && !onAccountsPage ? 'active' : ''}" data-action="${onAccountsPage ? 'open-settings' : 'select'}" data-account-id="${escapeHtml(account.id)}" type="button">${onAccountsPage ? 'Open Settings' : (account.id === state.selectedAccountId ? 'Selected' : 'Use This')}</button></td>
            <td><input data-field="enabled" type="checkbox" ${account.enabled ? 'checked' : ''}></td>
            <td><input data-field="label" type="text" value="${escapeHtml(account.label)}"></td>
            <td><input data-field="username" type="text" value="${escapeHtml(account.username)}"></td>
            <td><input data-field="password" type="password" value="${escapeHtml(account.password)}"></td>
            <td><button class="button button-link remove-account" type="button">Remove</button></td>
        </tr>
    `).join('');
}

function renderWorkspace() {
    renderAccountSelect();
    renderGroups();

    const account = getSelectedAccount();
    if (selectedAccountBadge) {
        selectedAccountBadge.textContent = account ? `${account.label} selected` : 'No account selected';
    }

    if (!postEditor) {
        return;
    }

    if (!account) {
        postEditor.innerHTML = '';
        postEditor.dataset.dirty = 'false';
        return;
    }

    if (!postEditor.innerHTML.trim() || postEditor.dataset.dirty !== 'true') {
        postEditor.innerHTML = account.post?.html || textToHtml(account.post?.text || '');
        postEditor.dataset.dirty = 'false';
    }
}

function renderAccountSelect() {
    if (!accountSelect || !state.config) {
        return;
    }

    if (!state.config.accounts.length) {
        accountSelect.innerHTML = '<option value="">No accounts saved</option>';
        return;
    }

    accountSelect.innerHTML = state.config.accounts.map(account => `
        <option value="${escapeHtml(account.id)}" ${account.id === state.selectedAccountId ? 'selected' : ''}>${escapeHtml(account.label)}</option>
    `).join('');
}

function renderGroups() {
    if (!groupList || !groupCountLabel) {
        return;
    }

    const account = getSelectedAccount();
    const groups = account?.groups || [];
    groupCountLabel.textContent = `${groups.length} group${groups.length === 1 ? '' : 's'}`;
    groupList.innerHTML = '';

    if (!account) {
        groupList.innerHTML = '<div class="empty-state">Create or select an account first.</div>';
        return;
    }

    const template = document.getElementById('groupItemTemplate');
    groups.forEach(group => {
        const fragment = template.content.cloneNode(true);
        const row = fragment.querySelector('.group-row');
        row.dataset.groupUrl = group;
        fragment.querySelector('.group-url').textContent = group;
        groupList.appendChild(fragment);
    });
}

function renderStatus() {
    if (!state.status) {
        return;
    }

    const badge = document.getElementById('runStateBadge');
    if (!badge) {
        return;
    }

    const isRunning = state.status.running;
    const hasError = Boolean(state.status.error);
    badge.textContent = hasError ? 'Attention' : (isRunning ? 'Running' : 'Idle');
    badge.className = `state-badge ${hasError ? 'error' : (isRunning ? 'running' : 'idle')}`;

    setText('statusTarget', state.status.totalTarget);
    setText('statusProcessed', state.status.processedCount);
    setText('statusSuccess', state.status.successCount);
    setText('statusSkipped', state.status.skippedCount);
    setText('currentAccountLabel', state.status.currentAccount || '-');
    setText('currentGroupLabel', state.status.currentGroup || '-');
    setText('remainingLabel', state.status.remainingCount);

    const eventFeed = document.getElementById('eventFeed');
    if (eventFeed) {
        const events = state.status.recentEvents || [];
        eventFeed.innerHTML = events.length
            ? events.map(item => `
                <div class="event-item">
                    <span class="event-time">${formatDate(item.at)}</span>
                    <div>${escapeHtml(item.message)}</div>
                </div>
            `).join('')
            : '<div class="empty-state">No run events yet.</div>';
    }

    if (state.status.error) {
        setStatusMessage(state.status.error);
    } else if (state.status.running) {
        setStatusMessage(state.status.runMode === 'test' ? 'Test in progress.' : 'Run in progress.');
    }
}

function syncConfigFromView() {
    if (!state.config) {
        return;
    }

    syncSelectedAccountFromView();

    const sessionLimitInput = document.getElementById('sessionLimitInput');
    const rotateEveryInput = document.getElementById('rotateEveryInput');
    const delayMinInput = document.getElementById('delayMinInput');
    const delayMaxInput = document.getElementById('delayMaxInput');
    const dashboardPortInput = document.getElementById('dashboardPortInput');

    if (sessionLimitInput) state.config.settings.sessionLimit = toPositiveInteger(sessionLimitInput.value, 10);
    if (rotateEveryInput) state.config.settings.rotateEvery = toPositiveInteger(rotateEveryInput.value, 5);
    if (delayMinInput) state.config.settings.delayMinMs = toPositiveInteger(delayMinInput.value, 45) * 1000;
    if (delayMaxInput) state.config.settings.delayMaxMs = toPositiveInteger(delayMaxInput.value, 120) * 1000;
    if (dashboardPortInput) state.config.settings.dashboardPort = toPositiveInteger(dashboardPortInput.value, 3010);
    if (postEditor) postEditor.dataset.dirty = 'false';
}

function syncSelectedAccountFromView(accountId = null) {
    const account = accountId
        ? state.config?.accounts?.find(acc => acc.id === accountId)
        : getSelectedAccount();

    if (!account || !postEditor) {
        return;
    }

    account.post.html = postEditor.innerHTML.trim();
    account.post.text = postEditor.innerText.replace(/\n{3,}/g, '\n\n').trim();
}

function mergeGroups(mode) {
    const account = getSelectedAccount();
    if (!account) {
        setStatusMessage('Select an account first.');
        return;
    }

    const parsed = uniqueValues(String(groupPasteInput?.value || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean));

    if (!parsed.length) {
        setStatusMessage('Paste at least one valid group URL first.');
        return;
    }

    account.groups = mode === 'replace'
        ? parsed
        : uniqueValues([...(account.groups || []), ...parsed]);

    if (groupPasteInput) {
        groupPasteInput.value = '';
    }

    renderGroups();
    setStatusMessage(`${parsed.length} group URL${parsed.length === 1 ? '' : 's'} ${mode === 'replace' ? 'loaded' : 'added'}.`);
}

function createAccount() {
    const index = (state.config?.accounts?.length || 0) + 1;
    return {
        id: `account-${Date.now()}-${index}`,
        label: `Account ${index}`,
        username: '',
        password: '',
        enabled: true,
        groups: [],
        post: {
            html: '',
            text: '',
        },
    };
}

function normalizeClientConfig(config) {
    const source = config && typeof config === 'object' ? config : {};
    const fallbackGroups = normalizeGroupList(source.groups);
    const fallbackPostText = String(source.post?.text || '').trim();
    const fallbackPostHtml = String(source.post?.html || textToHtml(fallbackPostText));

    return {
        version: source.version || 1,
        accounts: Array.isArray(source.accounts)
            ? source.accounts.map((account, index) => normalizeClientAccount(account, index, fallbackGroups, fallbackPostText, fallbackPostHtml))
            : [],
        groups: fallbackGroups,
        post: {
            text: fallbackPostText,
            html: fallbackPostHtml,
        },
        settings: {
            ...(source.settings || {}),
        },
    };
}

function normalizeClientAccount(account, index, fallbackGroups, fallbackPostText, fallbackPostHtml) {
    const source = account && typeof account === 'object' ? account : {};
    const postSource = source.post && typeof source.post === 'object' ? source.post : {};
    const label = String(source.label || source.username || `Account ${index + 1}`).trim();

    return {
        id: String(source.id || `account-${index + 1}`),
        label: label || `Account ${index + 1}`,
        username: String(source.username || ''),
        password: String(source.password || ''),
        enabled: source.enabled !== false,
        groups: normalizeGroupList(Object.prototype.hasOwnProperty.call(source, 'groups') ? source.groups : fallbackGroups),
        post: {
            text: Object.prototype.hasOwnProperty.call(postSource, 'text')
                ? String(postSource.text || '').trim()
                : fallbackPostText,
            html: Object.prototype.hasOwnProperty.call(postSource, 'html')
                ? String(postSource.html || '')
                : fallbackPostHtml,
        },
    };
}

function normalizeGroupList(groups) {
    return uniqueValues((Array.isArray(groups) ? groups : [])
        .map(group => String(group || '').trim())
        .filter(Boolean));
}

function ensureSelectedAccount() {
    if (!state.config?.accounts?.length) {
        state.selectedAccountId = null;
        persistSelectedAccount();
        return;
    }

    if (!state.config.accounts.some(account => account.id === state.selectedAccountId)) {
        state.selectedAccountId = state.config.accounts[0].id;
    }

    persistSelectedAccount();
}

function selectAccount(accountId, options = {}) {
    if (!accountId) {
        return;
    }

    // Save current account's data BEFORE switching
    const previousAccountId = state.selectedAccountId;
    if (previousAccountId && previousAccountId !== accountId) {
        syncSelectedAccountFromView(previousAccountId);
    }

    // Now switch to new account
    state.selectedAccountId = accountId;
    persistSelectedAccount();

    // Reset dirty flag to force refresh of post editor with NEW account's data
    if (postEditor) {
        postEditor.dataset.dirty = 'false';
    }

    // Clear the group paste input when switching accounts
    if (groupPasteInput) {
        groupPasteInput.value = '';
    }

    renderAccounts();
    renderWorkspace();

    const account = getSelectedAccount();
    if (account) {
        setStatusMessage(`Editing ${account.label}. Groups and post text belong to this account.`);
    }

    if (options.navigate) {
        window.location.href = '/settings.html';
    }
}

function persistSelectedAccount() {
    if (state.selectedAccountId) {
        window.localStorage.setItem(STORAGE_KEY, state.selectedAccountId);
        return;
    }

    window.localStorage.removeItem(STORAGE_KEY);
}

function getSelectedAccount() {
    return state.config?.accounts?.find(account => account.id === state.selectedAccountId) || null;
}

function uniqueValues(values) {
    return [...new Set(values)];
}

function textToHtml(text) {
    return escapeHtml(String(text || '')).replace(/\n/g, '<br>');
}

function setStatusMessage(message) {
    if (statusMessage) {
        statusMessage.textContent = message;
    }
}

function setInputValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.value = value;
    }
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = String(value ?? '');
    }
}

function formatDate(value) {
    if (!value) {
        return '-';
    }

    return new Date(value).toLocaleString();
}

function toPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function request(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const requestUrl = method === 'GET'
        ? withCacheBuster(url)
        : url;
    const response = await fetch(requestUrl, {
        cache: 'no-store',
        ...options,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.error || 'Request failed.');
    }

    return payload;
}

async function withErrorHandling(task, showError = true) {
    try {
        return await task();
    } catch (error) {
        if (showError) {
            setStatusMessage(error.message || 'Something went wrong.');
        }
        console.error(error);
        return null;
    }
}

function withCacheBuster(url) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_ts=${Date.now()}`;
}
