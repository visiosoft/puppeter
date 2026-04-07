const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../data/posted_log.json');
const ACTIVITY_LOG = path.join(__dirname, '../../data/activity.log');

/**
 * Loads the current log.
 */
function loadLog() {
  if (!fs.existsSync(LOG_FILE)) return {};
  return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
}

/**
 * Records a successful post to a group.
 */
function logPost({ groupUrl, accountLabel, postText, imageFilename }) {
  const log = loadLog();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const accountKey = String(accountLabel || 'default');

  const current = log[groupUrl] || {};
  const accounts = { ...(current.accounts || {}) };

  accounts[accountKey] = {
    lastPostedDate: today,
    lastPostedAt: now.toISOString(),
    account: accountKey,
    postText: postText.slice(0, 80) + (postText.length > 80 ? '...' : ''),
    image: imageFilename || null,
  };

  log[groupUrl] = {
    lastPostedDate: today,
    lastPostedAt: now.toISOString(),
    account: accountKey,
    postText: postText.slice(0, 80) + (postText.length > 80 ? '...' : ''),
    image: imageFilename || null,
    accounts,
  };

  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));

  // Also append to activity log
  const line = `[${now.toISOString()}] POSTED | account=${accountKey} | group=${groupUrl} | image=${imageFilename || 'none'}\n`;
  fs.appendFileSync(ACTIVITY_LOG, line);

  console.log(`[logger] ✓ Logged post to: ${groupUrl}`);
}

/**
 * Records a skipped/failed group.
 */
function logSkip({ groupUrl, accountLabel, reason }) {
  const now = new Date();
  const line = `[${now.toISOString()}] SKIPPED | account=${accountLabel} | group=${groupUrl} | reason=${reason}\n`;
  fs.appendFileSync(ACTIVITY_LOG, line);
  console.log(`[logger] ⚠ Skipped: ${groupUrl} — ${reason}`);
}

/**
 * Prints today's posting summary to console.
 */
function printSummary() {
  const { getStats } = require('./groupLoader');
  const stats = getStats();
  console.log('\n=== TODAY\'S SUMMARY ===');
  console.log(`Total groups:    ${stats.total}`);
  console.log(`Posted today:    ${stats.postedToday}`);
  console.log(`Remaining:       ${stats.pendingToday}`);
  console.log('=======================\n');
}

module.exports = { logPost, logSkip, printSummary };
