/**
 * run.js — Facebook Posting Assistant
 *
 * Usage:
 *   node run.js                          # uses "default" account
 *   node run.js --account john           # uses account label "john"
 *   node run.js --account john --limit 10  # post to max 10 groups this session
 *   node run.js --stats                  # show today's stats and exit
 */

require('dotenv').config({ quiet: true });

const { launchBrowser, closeBrowser, randomDelay } = require('./src/utils/browser');
const { postToGroup } = require('./src/modules/posting-assistant');
const { getPendingGroups, getStats } = require('./src/utils/groupLoader');
const { printSummary } = require('./src/utils/logger');

// --- Parse CLI args ---
const args = process.argv.slice(2);
const accountIndex = args.indexOf('--account');
const limitIndex = args.indexOf('--limit');
const ACCOUNT_LABEL = accountIndex !== -1 ? args[accountIndex + 1] : 'default';
const SESSION_LIMIT = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : Infinity;
const SHOW_STATS = args.includes('--stats');

// Delay between groups (ms) — realistic human browsing pace
const DELAY_BETWEEN_GROUPS_MIN = 45000;   // 45 seconds
const DELAY_BETWEEN_GROUPS_MAX = 120000;  // 2 minutes

async function main() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   Facebook Posting Assistant v1.0    ║');
  console.log('╚══════════════════════════════════════╝\n');

  // Stats-only mode
  if (SHOW_STATS) {
    printSummary();
    process.exit(0);
  }

  // Show current stats
  const stats = getStats();
  console.log(`Account:         ${ACCOUNT_LABEL}`);
  console.log(`Total groups:    ${stats.total}`);
  console.log(`Posted today:    ${stats.postedToday}`);
  console.log(`Remaining today: ${stats.pendingToday}`);
  if (SESSION_LIMIT !== Infinity) {
    console.log(`Session limit:   ${SESSION_LIMIT}`);
  }
  console.log('');

  if (stats.pendingToday === 0) {
    console.log('✅ All groups have been posted to today. Nothing to do!');
    printSummary();
    process.exit(0);
  }

  // Get pending groups
  const groups = getPendingGroups();
  const toProcess = SESSION_LIMIT !== Infinity
    ? groups.slice(0, SESSION_LIMIT)
    : groups;

  console.log(`Starting session: will post to ${toProcess.length} group(s)\n`);
  console.log('─'.repeat(50));
  console.log('INFO: The browser will open. For each group:');
  console.log('  1. The post text + image will be filled automatically');
  console.log('  2. Assistant clicks the "Post" button automatically');
  console.log('  3. Assistant moves to the next group automatically');
  console.log('─'.repeat(50) + '\n');

  // Launch browser
  let browser, page;
  try {
    ({ browser, page } = await launchBrowser(ACCOUNT_LABEL));
  } catch (err) {
    console.error(`[run] Failed to launch browser: ${err.message}`);
    process.exit(1);
  }

  // Process groups one by one
  let postedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const groupUrl = toProcess[i];
    console.log(`\n[${i + 1}/${toProcess.length}] Processing group...`);

    const result = await postToGroup(page, groupUrl, ACCOUNT_LABEL);

    if (result.success) {
      postedCount++;
    } else {
      skippedCount++;
    }

    // Delay before next group (except after last one)
    if (i < toProcess.length - 1) {
      const delay = Math.floor(
        Math.random() * (DELAY_BETWEEN_GROUPS_MAX - DELAY_BETWEEN_GROUPS_MIN + 1)
      ) + DELAY_BETWEEN_GROUPS_MIN;
      const delaySec = Math.round(delay / 1000);
      console.log(`\n[run] Cooling down for ${delaySec}s before next group...`);

      // Print a countdown every 15 seconds so user knows it's still running
      let remaining = delaySec;
      const interval = setInterval(() => {
        remaining -= 15;
        if (remaining > 0) console.log(`[run] Next group in ${remaining}s...`);
      }, 15000);

      await new Promise(r => setTimeout(r, delay));
      clearInterval(interval);
    }
  }

  // Done — close browser and print summary
  await closeBrowser(browser, page, ACCOUNT_LABEL);

  console.log('\n' + '='.repeat(50));
  console.log('SESSION COMPLETE');
  console.log(`  Posted:  ${postedCount}`);
  console.log(`  Skipped: ${skippedCount}`);
  console.log('='.repeat(50));
  printSummary();
}

main().catch(err => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
