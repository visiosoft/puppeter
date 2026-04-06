const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SESSIONS_DIR = path.join(__dirname, '../../data/sessions');
const FB_URL = 'https://www.facebook.com';

// Ensure sessions folder exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function getSessionFile(accountLabel) {
  return path.join(SESSIONS_DIR, `${accountLabel}.json`);
}

/**
 * Launches a visible browser window.
 * Loads saved cookies for the account if they exist.
 * If not logged in, waits for the human to log in manually, then saves cookies.
 *
 * @param {string} accountLabel - e.g. "account1", "john", "team_member_1"
 * @returns {{ browser, page }}
 */
async function launchBrowser(accountLabel = 'default') {
  console.log(`\n[browser] Launching browser for account: ${accountLabel}`);

  const browser = await puppeteer.launch({
    headless: false,           // Always visible — human needs to interact
    defaultViewport: null,     // Use full window size
    args: [
      '--start-maximized',
      '--disable-notifications',
      '--disable-infobars',
    ],
  });

  const page = await browser.newPage();

  // Set a realistic user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Load saved cookies if they exist
  const sessionFile = getSessionFile(accountLabel);
  if (fs.existsSync(sessionFile)) {
    const cookies = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    await page.setCookie(...cookies);
    console.log(`[browser] Session loaded for: ${accountLabel}`);
  }

  // Navigate to Facebook
  await page.goto(FB_URL, { waitUntil: 'domcontentloaded' });

  // Check if already logged in
  const isLoggedIn = await checkLoggedIn(page);

  if (!isLoggedIn) {
    console.log(`\n[browser] ⚠️  Not logged in for account: ${accountLabel}`);
    console.log('[browser] Please log in manually in the browser window...');
    console.log('[browser] Waiting for login (up to 2 minutes)...\n');

    // Wait until the user logs in (home feed appears)
    await page.waitForSelector('[aria-label="Facebook"], [data-pagelet="LeftRail"]', {
      timeout: 120000,
    }).catch(() => {
      throw new Error('Login timeout. Please run again and log in within 2 minutes.');
    });

    console.log('[browser] Login detected! Saving session...');
    await saveSession(page, accountLabel);
    console.log(`[browser] Session saved for: ${accountLabel}`);
  } else {
    console.log(`[browser] Already logged in as: ${accountLabel}`);
  }

  return { browser, page };
}

/**
 * Saves cookies for the account session.
 */
async function saveSession(page, accountLabel) {
  const cookies = await page.cookies();
  const sessionFile = getSessionFile(accountLabel);
  fs.writeFileSync(sessionFile, JSON.stringify(cookies, null, 2));
}

/**
 * Checks if the current page is a logged-in Facebook session.
 */
async function checkLoggedIn(page) {
  try {
    // If the login form is visible, we are NOT logged in
    const loginForm = await page.$('[data-testid="royal_login_button"], #loginbutton, [name="login"]');
    if (loginForm) return false;

    // Check for logged-in indicators
    const loggedIn = await page.$('[aria-label="Facebook"], [data-pagelet="LeftRail"], [data-pagelet="TopNavDesktop"]');
    return !!loggedIn;
  } catch {
    return false;
  }
}

/**
 * Closes the browser and optionally saves the session.
 */
async function closeBrowser(browser, page, accountLabel) {
  if (page && accountLabel) {
    await saveSession(page, accountLabel).catch(() => {});
  }
  await browser.close();
}

/**
 * Human-like delay between actions to avoid bot detection.
 * @param {number} min - min ms
 * @param {number} max - max ms
 */
function randomDelay(min = 1000, max = 3000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { launchBrowser, closeBrowser, saveSession, randomDelay };
