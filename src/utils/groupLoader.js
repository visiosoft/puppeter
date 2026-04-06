const fs = require('fs');
const path = require('path');

const GROUPS_FILE = path.join(__dirname, '../../data/groups.txt');
const LOG_FILE = path.join(__dirname, '../../data/posted_log.json');

/**
 * Reads groups.txt and returns all valid group URLs.
 * Skips blank lines and lines starting with #.
 */
function loadGroups() {
  if (!fs.existsSync(GROUPS_FILE)) {
    throw new Error(`groups.txt not found at: ${GROUPS_FILE}`);
  }

  const lines = fs.readFileSync(GROUPS_FILE, 'utf-8').split(/\r?\n/);
  const groups = lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));

  if (groups.length === 0) {
    throw new Error('groups.txt has no group URLs. Add Facebook group URLs, one per line.');
  }

  return groups;
}

/**
 * Reads the posted log. Returns object keyed by groupUrl.
 */
function loadLog() {
  if (!fs.existsSync(LOG_FILE)) return {};
  return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
}

/**
 * Returns groups that have NOT been posted to today.
 */
function getPendingGroups() {
  const groups = loadGroups();
  const log = loadLog();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  return groups.filter(url => {
    const entry = log[url];
    if (!entry) return true;                        // never posted
    return entry.lastPostedDate !== today;          // not posted today
  });
}

/**
 * Returns groups already posted to today.
 */
function getPostedTodayGroups() {
  const groups = loadGroups();
  const log = loadLog();
  const today = new Date().toISOString().slice(0, 10);

  return groups.filter(url => {
    const entry = log[url];
    return entry && entry.lastPostedDate === today;
  });
}

/**
 * Returns summary stats.
 */
function getStats() {
  const all = loadGroups();
  const pending = getPendingGroups();
  const postedToday = getPostedTodayGroups();

  return {
    total: all.length,
    pendingToday: pending.length,
    postedToday: postedToday.length,
  };
}

module.exports = { loadGroups, loadLog, getPendingGroups, getPostedTodayGroups, getStats };
