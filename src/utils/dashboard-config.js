const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const CONFIG_FILE = path.join(DATA_DIR, 'dashboard-config.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.txt');
const POSTS_FILE = path.join(DATA_DIR, 'posts.txt');

const DEFAULT_SETTINGS = {
    sessionLimit: 10,
    rotateEvery: 1,
    delayMinMs: 45000,
    delayMaxMs: 120000,
    dashboardPort: 3010,
};

function loadDashboardConfig() {
    const source = fs.existsSync(CONFIG_FILE)
        ? readJsonFile(CONFIG_FILE, null)
        : buildInitialConfig();

    return normalizeConfig(source || buildInitialConfig());
}

function saveDashboardConfig(config) {
    const normalized = normalizeConfig(config);

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalized, null, 2));
    syncLegacyFiles(normalized);

    return normalized;
}

function normalizeConfig(config = {}) {
    const initial = buildInitialConfig();
    const groups = normalizeGroups(hasOwn(config, 'groups') ? config.groups : initial.groups);
    const postText = String(hasOwn(config?.post, 'text') ? config.post.text : initial.post.text).trim();
    const postHtml = String(hasOwn(config?.post, 'html') ? config.post.html : textToHtml(postText));
    const accounts = normalizeAccounts(config.accounts || initial.accounts, {
        fallbackGroups: groups,
        fallbackPostText: postText,
        fallbackPostHtml: postHtml,
    });
    const settings = normalizeSettings(config.settings || {});

    return {
        version: 1,
        accounts,
        groups,
        post: {
            html: postHtml,
            text: postText,
        },
        settings,
    };
}

function buildInitialConfig() {
    const legacyGroups = loadLegacyGroups();
    const legacyPostText = loadLegacyPostText();
    const legacyPostHtml = textToHtml(legacyPostText);

    return {
        version: 1,
        accounts: loadAccountsFromSessions().map(account => ({
            ...account,
            groups: legacyGroups,
            post: {
                html: legacyPostHtml,
                text: legacyPostText,
            },
        })),
        groups: legacyGroups,
        post: {
            html: legacyPostHtml,
            text: legacyPostText,
        },
        settings: { ...DEFAULT_SETTINGS },
    };
}

function normalizeAccounts(accounts, defaults = {}) {
    const seen = new Set();
    const fallbackGroups = normalizeGroups(defaults.fallbackGroups || loadLegacyGroups());
    const fallbackPostText = String(defaults.fallbackPostText || loadLegacyPostText()).trim();
    const fallbackPostHtml = String(defaults.fallbackPostHtml || textToHtml(fallbackPostText));

    const next = (Array.isArray(accounts) ? accounts : [])
        .map((account, index) => {
            const label = String(account?.label || account?.username || `Account ${index + 1}`).trim();
            const preferredId = String(account?.id || slugify(label) || `account-${index + 1}`).trim();
            const id = uniqueId(preferredId, seen);
            const accountGroups = normalizeGroups(hasOwn(account, 'groups') ? account.groups : fallbackGroups);
            const accountPostText = String(hasOwn(account?.post, 'text') ? account.post.text : fallbackPostText).trim();
            const accountPostHtml = String(hasOwn(account?.post, 'html') ? account.post.html : textToHtml(accountPostText));

            return {
                id,
                label,
                username: String(account?.username || '').trim(),
                password: String(account?.password || ''),
                enabled: account?.enabled !== false,
                groups: accountGroups,
                post: {
                    html: accountPostHtml,
                    text: accountPostText,
                },
            };
        })
        .filter(account => account.label.length > 0);

    if (next.length > 0) {
        return next;
    }

    return [{
        id: 'account-1',
        label: 'Account 1',
        username: '',
        password: '',
        enabled: true,
        groups: fallbackGroups,
        post: {
            html: fallbackPostHtml,
            text: fallbackPostText,
        },
    }];
}

function normalizeGroups(groups) {
    const seen = new Set();

    return (Array.isArray(groups) ? groups : [])
        .map(group => String(group || '').trim())
        .filter(Boolean)
        .filter(group => {
            if (seen.has(group)) {
                return false;
            }

            seen.add(group);
            return true;
        });
}

function normalizeSettings(settings) {
    const sessionLimit = toPositiveInteger(settings.sessionLimit, DEFAULT_SETTINGS.sessionLimit);
    const rotateEvery = toPositiveInteger(settings.rotateEvery, DEFAULT_SETTINGS.rotateEvery);
    const delayMinMs = toPositiveInteger(settings.delayMinMs, DEFAULT_SETTINGS.delayMinMs);
    const delayMaxMs = toPositiveInteger(settings.delayMaxMs, DEFAULT_SETTINGS.delayMaxMs);
    const dashboardPort = toPositiveInteger(settings.dashboardPort, DEFAULT_SETTINGS.dashboardPort);

    return {
        sessionLimit,
        rotateEvery,
        delayMinMs: Math.min(delayMinMs, delayMaxMs),
        delayMaxMs: Math.max(delayMinMs, delayMaxMs),
        dashboardPort,
    };
}

function syncLegacyFiles(config) {
    const primaryAccount = config.accounts.find(account => account.enabled) || config.accounts[0];
    const groups = primaryAccount?.groups?.length ? primaryAccount.groups : config.groups;
    const postText = primaryAccount?.post?.text?.trim() || config.post.text;

    fs.writeFileSync(GROUPS_FILE, `${groups.join('\n')}${groups.length ? '\n' : ''}`);
    fs.writeFileSync(POSTS_FILE, postText ? `${postText.trim()}\n` : '');
}

function loadLegacyGroups() {
    if (!fs.existsSync(GROUPS_FILE)) {
        return [];
    }

    return fs.readFileSync(GROUPS_FILE, 'utf-8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
}

function loadLegacyPostText() {
    if (!fs.existsSync(POSTS_FILE)) {
        return '';
    }

    return fs.readFileSync(POSTS_FILE, 'utf-8').trim();
}

function loadAccountsFromSessions() {
    if (!fs.existsSync(SESSIONS_DIR)) {
        return [];
    }

    return fs.readdirSync(SESSIONS_DIR)
        .filter(file => path.extname(file).toLowerCase() === '.json')
        .map((file, index) => {
            const base = path.basename(file, '.json');
            return {
                id: slugify(base) || `account-${index + 1}`,
                label: base,
                username: '',
                password: '',
                enabled: true,
                groups: [],
                post: {
                    html: '',
                    text: '',
                },
            };
        });
}

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function uniqueId(base, seen) {
    let candidate = base;
    let index = 2;

    while (!candidate || seen.has(candidate)) {
        candidate = `${base || 'account'}-${index}`;
        index += 1;
    }

    seen.add(candidate);
    return candidate;
}

function toPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function textToHtml(text) {
    const safe = escapeHtml(String(text || ''));
    return safe.replace(/\n/g, '<br>');
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hasOwn(value, key) {
    return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function readJsonFile(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return fallback;
    }
}

module.exports = {
    loadDashboardConfig,
    saveDashboardConfig,
    normalizeConfig,
};