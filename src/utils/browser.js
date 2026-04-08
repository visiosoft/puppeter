const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { chooseFacebookAuthTarget, hasDeepSeekConfig } = require('../modules/ai-dom-selector');

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
async function launchBrowser(accountLabel = 'default', options = {}) {
  const {
    displayLabel = accountLabel,
    username = '',
    password = '',
    manualLoginFallback = true,
    loginTimeoutMs = 120000,
  } = options;

  console.log(`\n[browser] Launching browser for account: ${displayLabel}`);

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
    console.log(`[browser] Session loaded for: ${displayLabel}`);
  }

  // Navigate to Facebook
  await page.goto(FB_URL, { waitUntil: 'domcontentloaded' });

  // Check if already logged in
  const isLoggedIn = await checkLoggedIn(page);

  if (!isLoggedIn) {
    console.log(`\n[browser] Not logged in for account: ${displayLabel}`);

    if (username && password) {
      console.log('[browser] Attempting saved credential login...');
      const credentialLoginWorked = await loginWithCredentials(page, { username, password, timeoutMs: loginTimeoutMs });

      if (credentialLoginWorked) {
        console.log('[browser] Credential login detected. Saving session...');
        await saveSession(page, accountLabel);
        console.log(`[browser] Session saved for: ${displayLabel}`);
        return { browser, page };
      }

      if (!manualLoginFallback) {
        throw new Error('Automatic login failed. Facebook may require a challenge or updated credentials.');
      }
    }

    if (!manualLoginFallback) {
      throw new Error('No valid saved session was found for this account.');
    }

    console.log('[browser] Please log in manually in the browser window...');
    console.log('[browser] Waiting for login (up to 2 minutes)...\n');

    await page.waitForSelector('[aria-label="Facebook"], [data-pagelet="LeftRail"]', {
      timeout: loginTimeoutMs,
    }).catch(() => {
      throw new Error('Login timeout. Please run again and log in within 2 minutes.');
    });

    console.log('[browser] Login detected! Saving session...');
    await saveSession(page, accountLabel);
    console.log(`[browser] Session saved for: ${displayLabel}`);
  } else {
    console.log(`[browser] Already logged in as: ${displayLabel}`);
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

async function loginWithCredentials(page, { username, password, timeoutMs = 45000 }) {
  const useAIFirst = process.env.USE_AI_FIRST !== 'false';

  if (useAIFirst && hasDeepSeekConfig()) {
    console.log('[browser] AI-first login enabled. Selecting login controls with DeepSeek...');
    return loginWithCredentialsAI(page, { username, password, timeoutMs });
  }

  try {
    await page.waitForSelector('#email, input[name="email"]', { timeout: 15000 });
    await clearAndType(page, '#email, input[name="email"]', username);
    await clearAndType(page, '#pass, input[name="pass"]', password);

    const loginButton = await page.$('[data-testid="royal_login_button"], #loginbutton, button[name="login"], [name="login"]');
    if (!loginButton) {
      return false;
    }

    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs }),
      loginButton.click({ delay: 120 }),
    ]);

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await checkLoggedIn(page)) {
        return true;
      }

      if (await page.$('[id="approvals_code"], input[name="approvals_code"], [action*="checkpoint"], [data-pagelet="Checkpoint"], [data-testid="login_error"]')) {
        return false;
      }

      await page.waitForSelector('body', { timeout: 1500 }).catch(() => { });
    }

    return false;
  } catch {
    return false;
  }
}

async function loginWithCredentialsAI(page, { username, password, timeoutMs = 45000 }) {
  try {
    await page.waitForSelector('body', { timeout: 15000 });
    await page.waitForSelector('input, button, [role="button"]', { timeout: 15000 }).catch(() => { });

    const emailTarget = await chooseLoginTarget(page, 'email');
    const passwordTarget = await chooseLoginTarget(page, 'password');
    const buttonTarget = await chooseLoginTarget(page, 'login');

    if (!emailTarget || !passwordTarget || !buttonTarget) {
      console.log('[browser] AI login selection did not find all required targets.');
      return false;
    }

    await fillLoginCandidate(page, emailTarget.candidateId, username);
    await fillLoginCandidate(page, passwordTarget.candidateId, password, true);
    await clickLoginCandidate(page, buttonTarget.candidateId);

    await Promise.allSettled([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs }),
      page.waitForSelector('body', { timeout: 5000 }).catch(() => { }),
    ]);

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await checkLoggedIn(page)) {
        console.log('[browser] AI-assisted login succeeded.');
        return true;
      }

      if (await page.$('[id="approvals_code"], input[name="approvals_code"], [action*="checkpoint"], [data-pagelet="Checkpoint"], [data-testid="login_error"]')) {
        return false;
      }

      await page.waitForSelector('body', { timeout: 1500 }).catch(() => { });
    }

    return false;
  } catch (error) {
    console.log(`[browser] AI login selection error: ${error.message}`);
    return false;
  }
}

async function chooseLoginTarget(page, phase) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const snapshot = await captureLoginDomSnapshot(page, phase);
      if (!snapshot.candidates.length) {
        console.log(`[browser] No ${phase} candidates found for AI login selection on attempt ${attempt}.`);
        await page.waitForSelector('body', { timeout: 1200 }).catch(() => { });
        await new Promise(resolve => setTimeout(resolve, 400));
        continue;
      }

      console.log(`[browser] ${phase} candidate count for AI login: ${snapshot.candidates.length}`);
      const choice = await chooseFacebookAuthTarget(snapshot, phase);
      if (!choice) {
        console.log(`[browser] DeepSeek did not select a ${phase} target on attempt ${attempt}.`);
        await new Promise(resolve => setTimeout(resolve, 400));
        continue;
      }

      console.log(`[browser] DeepSeek selected ${phase} target ${choice.candidateId}${choice.reason ? `: ${choice.reason}` : ''}`);
      return choice;
    } catch (error) {
      console.log(`[browser] DeepSeek ${phase} selection error on attempt ${attempt}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  return null;
}

async function fillLoginCandidate(page, candidateId, value, isPassword = false) {
  const result = await page.evaluate(({ id, text, password }) => {
    const target = document.querySelector(`[data-copilot-login-candidate-id="${id}"]`);
    if (!target) {
      return false;
    }

    target.focus();
    target.click();
    target.value = '';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));

    if (password && target.getAttribute('type') !== 'password') {
      // Continue anyway; some password fields are wrapped or dynamically managed.
    }

    target.value = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { id: candidateId, text: value, password: isPassword });

  if (!result) {
    throw new Error(`Could not fill login candidate ${candidateId}`);
  }
}

async function clickLoginCandidate(page, candidateId) {
  const clicked = await page.evaluate(id => {
    const target = document.querySelector(`[data-copilot-login-candidate-id="${id}"]`);
    if (!target) {
      return false;
    }

    ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });

    if (typeof target.click === 'function') {
      target.click();
    }

    return true;
  }, candidateId);

  if (!clicked) {
    throw new Error(`Could not click login candidate ${candidateId}`);
  }
}

async function captureLoginDomSnapshot(page, phase) {
  return page.evaluate(currentPhase => {
    const CANDIDATE_ATTR = 'data-copilot-login-candidate-id';

    document.querySelectorAll(`[${CANDIDATE_ATTR}]`).forEach(el => {
      el.removeAttribute(CANDIDATE_ATTR);
    });

    const isVisible = el => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 24
        && rect.height > 16;
    };

    const textFor = el => [
      el.getAttribute('aria-label') || '',
      el.getAttribute('aria-placeholder') || '',
      el.getAttribute('placeholder') || '',
      el.getAttribute('name') || '',
      el.getAttribute('id') || '',
      el.getAttribute('autocomplete') || '',
      el.getAttribute('value') || '',
      el.getAttribute('data-testid') || '',
      el.textContent || '',
    ].join(' ').replace(/\s+/g, ' ').trim();

    const isEnabled = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true';

    const summaryFor = el => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        role: el.getAttribute('role') || '',
        idAttr: el.getAttribute('id') || '',
        nameAttr: el.getAttribute('name') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        text: textFor(el).slice(0, 180),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const candidates = currentPhase === 'login'
      ? [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], div[role="button"], a[role="button"]')]
      : [...document.querySelectorAll('input, textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]')];

    const filtered = candidates
      .filter(isVisible)
      .filter(isEnabled)
      .filter(el => {
        const text = textFor(el).toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
        const id = (el.getAttribute('id') || '').toLowerCase();
        const name = (el.getAttribute('name') || '').toLowerCase();

        if (currentPhase === 'email') {
          return type !== 'password' && (
            text.includes('email')
            || text.includes('phone')
            || text.includes('mobile')
            || text.includes('login')
            || text.includes('username')
            || autocomplete.includes('username')
            || autocomplete.includes('email')
            || id === 'email'
            || name === 'email'
            || name === 'login'
          );
        }

        if (currentPhase === 'password') {
          return type === 'password'
            || text.includes('password')
            || autocomplete.includes('current-password')
            || id === 'pass'
            || name === 'pass';
        }

        return text.includes('log in')
          || text.includes('login')
          || text.includes('sign in')
          || text.includes('royal_login_button')
          || id === 'loginbutton'
          || name === 'login';
      })
      .slice(0, 40)
      .map((el, index) => {
        const id = `${currentPhase}-${index + 1}`;
        el.setAttribute(CANDIDATE_ATTR, id);
        return {
          id,
          ...summaryFor(el),
        };
      });

    return {
      page: {
        title: document.title,
        url: location.href,
      },
      candidates: filtered,
    };
  }, phase);
}

async function clearAndType(page, selector, value) {
  const input = await page.$(selector);
  if (!input) {
    throw new Error(`Missing input: ${selector}`);
  }

  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await input.type(value, { delay: 60 });
}

/**
 * Closes the browser and optionally saves the session.
 */
async function closeBrowser(browser, page, accountLabel) {
  if (page && accountLabel) {
    await saveSession(page, accountLabel).catch(() => { });
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
