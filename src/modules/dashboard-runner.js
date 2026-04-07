const fs = require('fs');
const path = require('path');
const { launchBrowser, closeBrowser, randomDelay } = require('../utils/browser');
const { loadDashboardConfig, normalizeConfig } = require('../utils/dashboard-config');
const { postToGroup, testGroupSetup } = require('./posting-assistant');
const { getNextContent } = require('./content-variation');

const LOG_FILE = path.join(__dirname, '../../data/posted_log.json');
const MAX_EVENTS = 80;

const state = {
    running: false,
    stopRequested: false,
    startedAt: null,
    finishedAt: null,
    currentAccount: null,
    currentGroup: null,
    processedCount: 0,
    successCount: 0,
    skippedCount: 0,
    remainingCount: 0,
    totalTarget: 0,
    runMode: 'dashboard',
    error: null,
    recentEvents: [],
};

async function startDashboardRun(options = {}) {
    if (state.running) {
        throw new Error('A dashboard run is already in progress.');
    }

    const config = normalizeConfig(loadDashboardConfig());
    const accounts = config.accounts.filter(account => account.enabled);
    const mode = options.mode === 'test' ? 'test' : 'dashboard';

    if (!accounts.length) {
        throw new Error('Add at least one enabled Facebook account before starting a run.');
    }

    const activeAccounts = accounts.filter(account => account.groups.length && account.post.text.trim());
    if (!activeAccounts.length) {
        throw new Error('Each enabled account needs its own groups and post text.');
    }

    resetState();
    state.running = true;
    state.startedAt = new Date().toISOString();
    state.runMode = mode;

    if (mode === 'test') {
        await runTestMode(accounts, options.accountId);
        state.running = false;
        state.currentAccount = null;
        state.currentGroup = null;
        state.finishedAt = new Date().toISOString();
        return;
    }

    const accountQueues = activeAccounts.map(account => ({
        account,
        queue: getPendingGroupsForAccount(account.id, account.groups),
    })).filter(item => item.queue.length > 0);

    const totalPending = accountQueues.reduce((sum, item) => sum + item.queue.length, 0);
    const sessionLimit = Math.min(config.settings.sessionLimit, totalPending);
    state.totalTarget = sessionLimit;
    state.remainingCount = sessionLimit;

    addEvent(`Run started with ${accountQueues.length} ready account(s) and ${sessionLimit} pending group(s).`);

    try {
        if (!sessionLimit) {
            addEvent('No pending groups found for today.');
            return;
        }

        await runQueue(accountQueues, config, sessionLimit);
        addEvent(state.stopRequested ? 'Run stopped by user.' : 'Run completed.');
    } catch (error) {
        state.error = error.message;
        addEvent(`Run failed: ${error.message}`);
    } finally {
        state.running = false;
        state.currentAccount = null;
        state.currentGroup = null;
        state.finishedAt = new Date().toISOString();
    }
}

function stopDashboardRun() {
    if (!state.running) {
        return false;
    }

    state.stopRequested = true;
    addEvent('Stop requested. Finishing current step before exiting.');
    return true;
}

function getDashboardStatus() {
    return {
        ...state,
        recentEvents: [...state.recentEvents],
    };
}

async function runQueue(accountQueues, config, sessionLimit) {
    let remainingBudget = sessionLimit;

    while (remainingBudget > 0 && !state.stopRequested) {
        let cycleProgress = false;

        for (const item of accountQueues) {
            if (remainingBudget <= 0 || state.stopRequested) {
                break;
            }

            const processed = await runAccountSlice(item.account, item.queue, config, remainingBudget);
            if (processed > 0) {
                cycleProgress = true;
                remainingBudget -= processed;
                state.remainingCount = remainingBudget;
            }
        }

        if (!cycleProgress && remainingBudget > 0) {
            throw new Error('No account could process the pending groups. Check login details or saved sessions.');
        }
    }
}

async function runTestMode(accounts, accountId) {
    const account = accounts.find(item => item.id === accountId) || accounts[0];
    if (!account) {
        throw new Error('Select an account to test.');
    }

    if (!account.groups.length) {
        throw new Error('The selected account has no groups to test.');
    }

    state.totalTarget = 1;
    state.remainingCount = 1;
    state.currentAccount = account.label;
    state.currentGroup = account.groups[0];
    addEvent(`Test started for ${account.label} on ${account.groups[0]}.`);

    let browser = null;
    let page = null;

    try {
        ({ browser, page } = await launchBrowser(account.id, {
            displayLabel: account.label,
            username: account.username,
            password: account.password,
            manualLoginFallback: false,
        }));

        const result = await testGroupSetup(page, account.groups[0]);
        state.processedCount = 1;
        state.remainingCount = 0;

        if (!result.success) {
            state.skippedCount = 1;
            throw new Error(result.reason || 'Test could not open the composer.');
        }

        state.successCount = 1;
        addEvent(`Test passed for ${account.label}. Composer opened successfully.`);
    } finally {
        if (browser) {
            await closeBrowser(browser, page, account.id).catch(() => { });
        }
    }
}

async function runAccountSlice(account, queue, config, remainingBudget) {
    const limitForAccount = Math.min(config.settings.rotateEvery, queue.length, remainingBudget);
    if (limitForAccount <= 0) {
        return 0;
    }

    state.currentAccount = account.label;
    addEvent(`Switching to ${account.label}.`);

    let browser = null;
    let page = null;
    let processed = 0;

    try {
        ({ browser, page } = await launchBrowser(account.id, {
            displayLabel: account.label,
            username: account.username,
            password: account.password,
            manualLoginFallback: false,
        }));
    } catch (error) {
        addEvent(`Login failed for ${account.label}: ${error.message}`);
        return 0;
    }

    try {
        while (processed < limitForAccount && queue.length && !state.stopRequested) {
            const groupUrl = queue.shift();
            state.currentGroup = groupUrl;
            addEvent(`Posting to ${groupUrl} with ${account.label}.`);

            const result = await postToGroup(page, groupUrl, account.id, {
                getContent: () => getDashboardContent(account.post.text, account.id),
            });

            processed += 1;
            state.processedCount += 1;
            state.remainingCount = queue.length;

            if (result.success) {
                state.successCount += 1;
                addEvent(`Posted successfully to ${groupUrl}.`);
            } else {
                state.skippedCount += 1;
                addEvent(`Skipped ${groupUrl}: ${result.reason || 'unknown reason'}.`);
            }

            const moreWorkForThisAccount = processed < limitForAccount && queue.length && !state.stopRequested;
            if (moreWorkForThisAccount) {
                const delaySeconds = Math.round(randomBetween(config.settings.delayMinMs, config.settings.delayMaxMs) / 1000);
                addEvent(`Cooling down for ${delaySeconds}s before the next group on ${account.label}.`);
                await randomDelay(config.settings.delayMinMs, config.settings.delayMaxMs);
            }
        }
    } finally {
        state.currentGroup = null;
        if (browser) {
            await closeBrowser(browser, page, account.id).catch(() => { });
        }
    }

    return processed;
}

function getDashboardContent(text, accountId) {
    const baseContent = getNextContent({ accountLabel: accountId });

    // If text contains multiple lines, split and pick sequentially
    if (text.includes('\n')) {
        const posts = text
            .split(/\r?\n/)
            .map(p => p.trim())
            .filter(p => p.length > 0);

        if (posts.length > 1) {
            // Load rotation state for this account
            const STATE_FILE = path.join(__dirname, '../../data/post-rotation-state.json');
            let state = {};

            if (fs.existsSync(STATE_FILE)) {
                try {
                    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
                } catch { }
            }

            // Get current index for this account
            const currentIndex = state[accountId] || 0;
            const selectedPost = posts[currentIndex];

            // Update to next index (wrap around)
            const nextIndex = (currentIndex + 1) % posts.length;
            state[accountId] = nextIndex;

            // Save state
            try {
                fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
            } catch { }

            return {
                ...baseContent,
                text: selectedPost,
                meta: {
                    ...baseContent.meta,
                    postIndex: currentIndex + 1,
                    totalPosts: posts.length,
                },
            };
        }
    }

    // Single post or no newlines
    return {
        ...baseContent,
        text,
        meta: {
            ...baseContent.meta,
            postIndex: 1,
            totalPosts: 1,
        },
    };
}

function getPendingGroupsForAccount(accountId, groups) {
    const log = loadPostedLog();
    const today = new Date().toISOString().slice(0, 10);

    return groups.filter(groupUrl => {
        const entry = log[groupUrl];
        const accountEntry = entry?.accounts?.[accountId];
        if (accountEntry) {
            return accountEntry.lastPostedDate !== today;
        }

        if (entry?.account === accountId) {
            return entry.lastPostedDate !== today;
        }

        return true;
    });
}

function loadPostedLog() {
    if (!fs.existsSync(LOG_FILE)) {
        return {};
    }

    try {
        return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    } catch {
        return {};
    }
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function addEvent(message) {
    state.recentEvents.unshift({
        at: new Date().toISOString(),
        message,
    });
    state.recentEvents = state.recentEvents.slice(0, MAX_EVENTS);
}

function resetState() {
    state.stopRequested = false;
    state.startedAt = null;
    state.finishedAt = null;
    state.currentAccount = null;
    state.currentGroup = null;
    state.processedCount = 0;
    state.successCount = 0;
    state.skippedCount = 0;
    state.remainingCount = 0;
    state.totalTarget = 0;
    state.runMode = 'dashboard';
    state.error = null;
    state.recentEvents = [];
}

module.exports = {
    startDashboardRun,
    stopDashboardRun,
    getDashboardStatus,
};