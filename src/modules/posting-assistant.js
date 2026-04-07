const fs = require('fs');
const path = require('path');
const { randomDelay } = require('../utils/browser');
const { logPost, logSkip } = require('../utils/logger');
const { getSelectorStrategy, saveSelectorStrategy } = require('../utils/selector-strategy');
const { getNextContent } = require('./content-variation');
const { chooseFacebookPostTarget, hasDeepSeekConfig } = require('./ai-dom-selector');

const SUBMIT_TARGET_ATTR = 'data-copilot-submit-target';
const SUBMIT_DEBUG_FILE = path.join(__dirname, '../../data/submit-debug.json');
const COMPOSER_DEBUG_FILE = path.join(__dirname, '../../data/composer-debug.json');
const TRIGGER_DEBUG_FILE = path.join(__dirname, '../../data/trigger-debug.json');

/**
 * Navigates to a Facebook group, fills the post composer, and submits it.
 * After post is detected, logs the result and returns.
 *
 * @param {object} page         - Puppeteer page instance
 * @param {string} groupUrl     - Facebook group URL
 * @param {string} accountLabel - Account identifier for logging
 */
async function postToGroup(page, groupUrl, accountLabel, options = {}) {
  console.log(`\n[posting] Opening group: ${groupUrl}`);

  // Get post content + image (sequential or random based on config)
  const content = typeof options.getContent === 'function'
    ? options.getContent()
    : (options.content || getNextContent({ accountLabel }));
  console.log(`[posting] Post ${content.meta.postIndex}/${content.meta.totalPosts}: "${content.text.slice(0, 60)}..."`);
  if (content.imageFilename) {
    console.log(`[posting] Image: ${content.imageFilename}`);
  }

  try {
    // Navigate to the group
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Simulate landing on the page — pause as if reading it
    console.log('[posting] Reading group page...');
    await randomDelay(3000, 6000);

    // Scroll down slowly as if browsing the feed
    await humanScroll(page);
    await randomDelay(2000, 5000);

    // Scroll back up to the top where the post box is
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await randomDelay(1500, 3000);

    // Click the post box ("Write something..." area)
    const composer = await openPostBox(page);
    if (!composer) {
      logSkip({ groupUrl, accountLabel, reason: 'Could not find post box' });
      return { success: false, reason: 'post_box_not_found' };
    }

    // Pause as if thinking about what to write
    await randomDelay(2000, 4000);

    // Type the post text with human-like speed
    await typeWithHumanDelay(page, composer, content.text);

    // Pause as if re-reading what was typed
    console.log('[posting] Reviewing typed text...');
    await randomDelay(3000, 6000);

    // Attach image if available
    if (content.imagePath) {
      const imageAttached = await attachImage(page, composer, content.imagePath);
      if (!imageAttached) {
        console.log('[posting] ⚠ Could not attach image — continuing without it');
      }
      // Pause as if looking at the attached image
      await randomDelay(3000, 5000);
    }

    // Pause briefly, then submit the post automatically
    console.log('[posting] Final review before submitting...');
    await randomDelay(2000, 4000);

    const submitResult = await submitPost(page, composer);
    if (!submitResult.success) {
      logSkip({ groupUrl, accountLabel, reason: 'Could not find Post button' });
      return { success: false, reason: 'post_button_not_found' };
    }

    console.log('[posting] Post submitted. Waiting for confirmation...');

    // Wait for the post to be submitted (Post button disappears / feed updates)
    const posted = await waitForPostSubmission(page, composer, groupUrl);

    if (posted) {
      if (composer.triggerSource === 'ai' || composer.source === 'ai') {
        const saved = saveSelectorStrategy({
          triggerPattern: composer.triggerPattern || undefined,
          composerPattern: composer.pattern || undefined,
          postButtonPattern: submitResult.pattern || undefined,
        });

        if (saved) {
          console.log('[posting] Learned selector strategy updated from successful AI-assisted post');
        }
      }

      logPost({
        groupUrl,
        accountLabel,
        postText: content.text,
        imageFilename: content.imageFilename,
      });
      console.log(`[posting] ✓ Post confirmed for: ${groupUrl}`);
      return { success: true };
    } else {
      await writeSubmitDebugSnapshot(page, composer, 'post_confirmation_timeout');
      logSkip({ groupUrl, accountLabel, reason: 'Post not detected within timeout' });
      return { success: false, reason: 'post_timeout' };
    }

  } catch (err) {
    console.error(`[posting] Error on ${groupUrl}: ${err.message}`);
    logSkip({ groupUrl, accountLabel, reason: err.message });
    return { success: false, reason: err.message };
  }
}

async function testGroupSetup(page, groupUrl) {
  console.log(`\n[test] Opening group: ${groupUrl}`);

  try {
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(2500, 4500);
    await humanScroll(page);
    await randomDelay(1500, 3000);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await randomDelay(1000, 2000);

    const composer = await openPostBox(page);
    if (!composer) {
      return { success: false, reason: 'Could not find post box for test.' };
    }

    return {
      success: true,
      mode: composer.mode,
      source: composer.source,
    };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

async function submitPost(page, composer) {
  await writeSubmitDebugSnapshot(page, composer, 'before_submit_selection');

  return preferAISelection(
    'submit button',
    () => submitPostWithAI(page, composer),
    () => submitPostWithHeuristics(page, composer),
  );
}

async function submitPostWithHeuristics(page, composer) {
  const strategy = getSelectorStrategy();
  const result = await page.evaluate(({ rootSelector, learnedPattern, submitTargetAttr }) => {
    const root = document.querySelector(rootSelector);
    if (!root) {
      return { success: false, reason: 'composer_root_not_found' };
    }

    document.querySelectorAll(`[${submitTargetAttr}]`).forEach(el => el.removeAttribute(submitTargetAttr));

    const patternScore = (control, pattern) => {
      if (!pattern) return 0;

      let score = 0;
      const label = (control.getAttribute('aria-label') || '').trim().toLowerCase();
      const value = (control.textContent || '').trim().toLowerCase();

      if (pattern.tag && control.tagName.toLowerCase() === pattern.tag) score += 8;
      if (pattern.role && (control.getAttribute('role') || '') === pattern.role) score += 8;
      if (pattern.ariaLabel && label === pattern.ariaLabel) score += 12;
      if (pattern.text && value === pattern.text) score += 12;
      if (pattern.text && value.includes(pattern.text)) score += 6;

      return score;
    };

    const toPattern = control => ({
      tag: control.tagName.toLowerCase(),
      role: control.getAttribute('role') || '',
      ariaLabel: (control.getAttribute('aria-label') || '').trim().toLowerCase(),
      placeholder: (control.getAttribute('aria-placeholder') || '').trim().toLowerCase(),
      contenteditable: control.getAttribute('contenteditable') || '',
      text: (control.textContent || '').trim().toLowerCase(),
    });

    const isVisible = el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 20
        && rect.height > 20;
    };

    const getClickableControl = element => {
      return element.closest('button, [role="button"], [tabindex="0"]');
    };

    const controls = [...root.querySelectorAll('button, [role="button"], span, div')]
      .map(getClickableControl)
      .filter((control, index, array) => control && array.indexOf(control) === index)
      .filter(isVisible)
      .map(control => {
        const label = (control.getAttribute('aria-label') || '').trim().toLowerCase();
        const value = (control.textContent || '').trim().toLowerCase();
        const role = (control.getAttribute('role') || '').trim().toLowerCase();
        const contenteditable = (control.getAttribute('contenteditable') || '').trim().toLowerCase();
        const disabled = control.getAttribute('aria-disabled') === 'true'
          || control.getAttribute('disabled') !== null;
        let score = patternScore(control, learnedPattern);

        if (label === 'post' || value === 'post') score += 20;
        if (label.includes('post') || value.includes('post')) score += 10;
        if (role === 'textbox' || contenteditable === 'true') score -= 100;
        if (value.includes('post anonymously')) score -= 20;
        if (label.includes('photo') || value.includes('photo')) score -= 15;
        if (label.includes('video') || value.includes('video')) score -= 15;
        if (disabled) score -= 50;

        return { control, score, pattern: toPattern(control) };
      })
      .sort((a, b) => b.score - a.score);

    const target = controls.find(item => item.score > 0);
    if (!target) {
      return { success: false, reason: 'no_post_button_found' };
    }

    target.control.setAttribute(submitTargetAttr, 'true');
    return { success: true, source: 'heuristic', pattern: target.pattern };
  }, { ...composer, learnedPattern: strategy.postButtonPattern || null, submitTargetAttr: SUBMIT_TARGET_ATTR });

  if (result.success) {
    const clicked = await clickPreparedSubmitTarget(page);
    if (clicked) {
      return result;
    }
    return { success: false, reason: 'post_button_click_failed', source: 'heuristic' };
  }

  return { ...result, source: 'heuristic' };
}

async function clickPreparedSubmitTarget(page) {
  const selector = `[${SUBMIT_TARGET_ATTR}="true"]`;
  const handle = await page.$(selector);
  if (!handle) {
    return false;
  }

  try {
    await handle.evaluate(el => {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    });
  } catch { }

  try {
    await handle.click({ delay: 120 });
    return true;
  } catch { }

  try {
    const box = await handle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      return true;
    }
  } catch { }

  try {
    return await page.evaluate(attr => {
      const target = document.querySelector(`[${attr}="true"]`);
      if (!target) {
        return false;
      }

      ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      return true;
    }, SUBMIT_TARGET_ATTR);
  } catch {
    return false;
  }
}

async function writeSubmitDebugSnapshot(page, composer, reason) {
  try {
    const snapshot = await captureDomSnapshot(page, 'submit', composer.rootSelector);
    const payload = {
      reason,
      at: new Date().toISOString(),
      rootSelector: composer.rootSelector,
      editorSelector: composer.editorSelector,
      candidates: snapshot.candidates,
      page: snapshot.page,
    };

    fs.writeFileSync(SUBMIT_DEBUG_FILE, JSON.stringify(payload, null, 2));
    console.log(`[posting] Submit debug written to ${SUBMIT_DEBUG_FILE}`);
  } catch (err) {
    console.log(`[posting] Failed to write submit debug: ${err.message}`);
  }
}

async function writeComposerDebugSnapshot(page, reason) {
  try {
    const snapshot = await captureDomSnapshot(page, 'composer');
    const payload = {
      reason,
      at: new Date().toISOString(),
      candidates: snapshot.candidates,
      page: snapshot.page,
    };

    fs.writeFileSync(COMPOSER_DEBUG_FILE, JSON.stringify(payload, null, 2));
    console.log(`[posting] Composer debug written to ${COMPOSER_DEBUG_FILE}`);
  } catch (err) {
    console.log(`[posting] Failed to write composer debug: ${err.message}`);
  }
}

async function writeTriggerDebugSnapshot(page, reason) {
  try {
    const snapshot = await captureDomSnapshot(page, 'trigger');
    const payload = {
      reason,
      at: new Date().toISOString(),
      candidates: snapshot.candidates,
      page: snapshot.page,
    };

    fs.writeFileSync(TRIGGER_DEBUG_FILE, JSON.stringify(payload, null, 2));
    console.log(`[posting] Trigger debug written to ${TRIGGER_DEBUG_FILE}`);
  } catch (err) {
    console.log(`[posting] Failed to write trigger debug: ${err.message}`);
  }
}

/**
 * Clicks on the "Write something" post box to open the post composer.
 */
async function openPostBox(page) {
  const triggerResult = await clickCreatePostTrigger(page);
  if (!triggerResult) {
    return null;
  }

  console.log(`[posting] Trigger selected via ${triggerResult.source || 'unknown'} path`);

  await new Promise(r => setTimeout(r, 1500));

  for (let attempt = 0; attempt < 6; attempt++) {
    const composer = await identifyComposer(page);
    if (composer) {
      composer.triggerSource = triggerResult.source;
      composer.triggerPattern = triggerResult.pattern || null;
      console.log(`[posting] Composer selected via ${composer.source || 'unknown'} path`);
      console.log(`[posting] Post box opened (${composer.mode})`);
      return composer;
    }

    if (attempt === 2) {
      await clickCreatePostTriggerWithAI(page);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  await writeComposerDebugSnapshot(page, 'composer_not_found_after_trigger');

  return null;
}

/**
 * Types text into the active post composer with human-like delays.
 */
async function typeWithHumanDelay(page, composer, text) {
  const editor = await page.$(composer.editorSelector);
  if (!editor) {
    throw new Error('Could not find text editor after opening post box');
  }

  await editor.click();
  await new Promise(r => setTimeout(r, 800));

  console.log('[posting] Typing post text...');
  for (const char of text) {
    await page.keyboard.type(char);

    let delay;
    if (char === '.' || char === '!' || char === '?') {
      // Longer pause after end of sentence
      delay = Math.floor(Math.random() * 600 + 300);
    } else if (char === ',' || char === ';') {
      // Medium pause after comma
      delay = Math.floor(Math.random() * 300 + 150);
    } else if (char === ' ') {
      // Slight pause between words
      delay = Math.floor(Math.random() * 120 + 60);
    } else if (Math.random() < 0.04) {
      // Occasional hesitation mid-word (like a real person thinking)
      delay = Math.floor(Math.random() * 500 + 200);
    } else {
      // Normal typing speed
      delay = Math.floor(Math.random() * 80 + 50);
    }

    await new Promise(r => setTimeout(r, delay));
  }

  console.log('[posting] Text typed');
}

/**
 * Attaches an image to the post using the photo/video upload button.
 */
async function attachImage(page, composer, imagePath) {
  try {
    // Look for the photo/video attach input
    const fileInputSelectors = [
      'input[type="file"][accept*="image"]',
      'input[type="file"]',
    ];

    for (const selector of fileInputSelectors) {
      const input = await page.$(`${composer.rootSelector} ${selector}`);
      if (input) {
        await input.uploadFile(imagePath);
        console.log(`[posting] Image attached: ${path.basename(imagePath)}`);
        return true;
      }
    }

    // Try clicking the photo button to reveal the file input
    const photoButtonSelectors = [
      '[aria-label="Photo/video"]',
      '[aria-label="Photo"]',
      '[data-testid="photo-attachment-button"]',
    ];

    for (const selector of photoButtonSelectors) {
      try {
        await page.click(`${composer.rootSelector} ${selector}`);
        await new Promise(r => setTimeout(r, 1000));

        const input = await page.$(`${composer.rootSelector} input[type="file"]`);
        if (input) {
          await input.uploadFile(imagePath);
          console.log(`[posting] Image attached via photo button: ${path.basename(imagePath)}`);
          return true;
        }
      } catch { }
    }

    return false;
  } catch (err) {
    console.warn(`[posting] Image attach failed: ${err.message}`);
    return false;
  }
}

/**
 * Scrolls the page slowly in a human-like pattern (down, pause, down a bit more).
 */
async function humanScroll(page) {
  const scrollSteps = Math.floor(Math.random() * 3) + 2; // 2-4 scroll steps
  for (let i = 0; i < scrollSteps; i++) {
    const scrollAmount = Math.floor(Math.random() * 300) + 150;
    await page.evaluate(amount => {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }, scrollAmount);
    // Pause between scrolls as if reading content
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 2000) + 1000));
  }
}

/**
 * Waits up to 5 minutes for the submitted post to be confirmed.
 * Detects submission by watching for URL change or post button disappearing.
 */
async function waitForPostSubmission(page, composer, groupUrl, timeoutMs = 300000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, 2000));

    try {
      const currentUrl = page.url();

      // URL changed away from group (sometimes happens after post)
      if (!currentUrl.includes(groupUrl.replace('https://www.facebook.com', ''))) {
        return true;
      }

      // Check for success indicators
      const successIndicator = await page.$('[data-testid="post-success"]');
      if (successIndicator) return true;

      const state = await page.evaluate(({ rootSelector, editorSelector }) => {
        const root = document.querySelector(rootSelector);
        if (!root) {
          return { submitted: true };
        }

        const editor = document.querySelector(editorSelector);
        const text = (editor?.innerText || '').trim();
        const controls = [...root.querySelectorAll('button, [role="button"]')];
        const hasPostButton = controls.some(control => {
          const label = (control.getAttribute('aria-label') || '').trim().toLowerCase();
          const value = (control.textContent || '').trim().toLowerCase();
          return label === 'post' || value === 'post';
        });

        return {
          submitted: !hasPostButton && text.length === 0,
        };
      }, composer);

      if (state.submitted) {
        return true;
      }

    } catch { }
  }

  return false; // Timed out
}

async function clickCreatePostTrigger(page) {
  return preferAISelection(
    'create-post trigger',
    () => clickCreatePostTriggerWithAI(page),
    () => clickCreatePostTriggerWithHeuristics(page),
  );
}

async function clickCreatePostTriggerWithHeuristics(page) {
  const strategy = getSelectorStrategy();
  const clicked = await page.evaluate(learnedPattern => {
    const createPostPlaceholders = [
      'create a public post…',
      'create a public post...',
    ];
    const hasCommentSignalText = text => {
      const normalized = (text || '').toLowerCase();
      return normalized.includes('comment as')
        || normalized.includes('write a comment')
        || normalized.includes('leave a comment')
        || normalized.includes('reply')
        || normalized.includes('comment');
    };

    const toPattern = el => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      ariaLabel: (el.getAttribute('aria-label') || '').trim().toLowerCase(),
      placeholder: (el.getAttribute('aria-placeholder') || '').trim().toLowerCase(),
      text: (el.textContent || '').trim().toLowerCase().slice(0, 120),
      lexical: el.getAttribute('data-lexical-editor') || '',
    });

    const patternScore = (el, pattern) => {
      if (!pattern) return 0;

      let score = 0;
      const text = (el.textContent || '').trim().toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      const placeholder = (el.getAttribute('aria-placeholder') || '').trim().toLowerCase();

      if (pattern.tag && el.tagName.toLowerCase() === pattern.tag) score += 6;
      if (pattern.role && (el.getAttribute('role') || '') === pattern.role) score += 6;
      if (pattern.ariaLabel && ariaLabel === pattern.ariaLabel) score += 10;
      if (pattern.placeholder && placeholder === pattern.placeholder) score += 10;
      if (pattern.text && text.includes(pattern.text)) score += 8;
      if (pattern.lexical && (el.getAttribute('data-lexical-editor') || '') === pattern.lexical) score += 4;

      return score;
    };

    const exactEditor = [...document.querySelectorAll('[contenteditable="true"][role="textbox"][data-lexical-editor="true"]')]
      .find(el => {
        const placeholder = (el.getAttribute('aria-placeholder') || '').trim().toLowerCase();
        const contextText = (el.parentElement?.parentElement?.textContent || '').toLowerCase();
        const rect = el.getBoundingClientRect();
        return createPostPlaceholders.includes(placeholder)
          && !hasCommentSignalText(contextText)
          && rect.top >= 0
          && rect.top < window.innerHeight * 0.8;
      });

    if (exactEditor) {
      exactEditor.click();
      exactEditor.focus();
      return { success: true, source: 'heuristic', pattern: toPattern(exactEditor) };
    }

    const phrases = [
      'write something',
      'write something to the group',
      'create a public post',
      'create post',
      'say something',
    ];

    const isVisible = el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 40
        && rect.height > 20;
    };

    const textFor = el => {
      return [
        el.getAttribute('aria-label') || '',
        el.getAttribute('aria-placeholder') || '',
        el.textContent || '',
      ].join(' ').toLowerCase();
    };

    const isCommentContext = el => {
      const context = el.closest('[role="article"], [data-pagelet*="FeedUnit"], [aria-label*="comment" i], [aria-label*="reply" i]');
      if (!context) {
        return false;
      }

      const contextText = (context.textContent || '').toLowerCase();
      return contextText.includes('comment') || contextText.includes('reply');
    };

    const candidates = [...document.querySelectorAll('[role="button"], div, span, a')]
      .filter(isVisible)
      .map(el => {
        const text = textFor(el);
        if (!phrases.some(phrase => text.includes(phrase))) {
          return null;
        }

        const rect = el.getBoundingClientRect();
        let score = patternScore(el, learnedPattern);

        if (rect.top >= 0 && rect.top < window.innerHeight * 0.7) score += 8;
        if (rect.top >= 0 && rect.top < 250) score += 10;
        if (el.getAttribute('aria-label')) score += 4;
        if (el.getAttribute('aria-placeholder')) score += 3;
        if (el.closest('[role="main"]')) score += 2;
        if (isCommentContext(el)) score -= 20;

        return { el, score, top: rect.top, pattern: toPattern(el) };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.top - b.top);

    const target = candidates[0];
    if (!target) {
      return { success: false };
    }

    target.el.click();
    return { success: true, source: 'heuristic', pattern: target.pattern };
  }, strategy.triggerPattern || null);

  return clicked.success ? clicked : { success: false, reason: 'no_trigger_found_by_heuristics', source: 'heuristic' };
}

async function identifyComposer(page) {
  return preferAISelection(
    'composer',
    () => identifyComposerWithAI(page),
    () => identifyComposerWithHeuristics(page),
  );
}

async function identifyComposerWithHeuristics(page) {
  const strategy = getSelectorStrategy();
  const composer = await page.evaluate(learnedPattern => {
    const ROOT_ATTR = 'data-copilot-post-root';
    const EDITOR_ATTR = 'data-copilot-post-editor';
    const createPostPlaceholders = [
      'create a public post…',
      'create a public post...',
    ];
    const hasCommentSignalText = text => {
      const normalized = (text || '').toLowerCase();
      return normalized.includes('comment as')
        || normalized.includes('write a comment')
        || normalized.includes('leave a comment')
        || normalized.includes('most relevant')
        || normalized.includes('reply');
    };
    const hasCreatePostSignal = text => {
      const normalized = (text || '').toLowerCase();
      return normalized.includes('create a public post')
        || normalized.includes('write something')
        || normalized.includes('write something to the group')
        || normalized.includes('create post');
    };
    const hasPostControl = root => [...(root?.querySelectorAll('button, [role="button"], [tabindex="0"]') || [])].some(control => {
      const label = (control.getAttribute('aria-label') || '').trim().toLowerCase();
      const value = (control.textContent || '').trim().toLowerCase();
      return label === 'post' || value === 'post' || label.includes('post') || value.includes('post');
    });
    const hasAttachControl = root => [...(root?.querySelectorAll('button, [role="button"], [tabindex="0"], input[type="file"]') || [])].some(control => {
      const label = (control.getAttribute('aria-label') || '').trim().toLowerCase();
      const value = (control.textContent || '').trim().toLowerCase();
      return control.tagName === 'INPUT'
        || label.includes('photo')
        || value.includes('photo')
        || label.includes('video')
        || value.includes('video');
    });
    const hasComposerContainerSignal = text => {
      const normalized = (text || '').toLowerCase();
      return normalized.includes('create post')
        || normalized.includes('post anonymously')
        || normalized.includes('public group')
        || normalized.includes('photo/video')
        || normalized.includes('add to your post');
    };
    const findComposerRoot = editor => {
      let node = editor;
      let depth = 0;
      let fallback = editor.parentElement || editor;

      while (node && depth < 12) {
        const text = (node.textContent || '').toLowerCase();
        if (hasCommentSignalText(text)) {
          node = node.parentElement;
          depth += 1;
          continue;
        }

        if (hasPostControl(node) && (hasAttachControl(node) || hasComposerContainerSignal(text))) {
          return node;
        }

        if (hasComposerContainerSignal(text) || node.getAttribute('role') === 'dialog' || node.tagName === 'FORM') {
          fallback = node;
        }

        node = node.parentElement;
        depth += 1;
      }

      return fallback;
    };

    const toPattern = editor => ({
      tag: editor.tagName.toLowerCase(),
      role: editor.getAttribute('role') || '',
      ariaLabel: (editor.getAttribute('aria-label') || '').trim().toLowerCase(),
      placeholder: (editor.getAttribute('aria-placeholder') || '').trim().toLowerCase(),
      text: (editor.textContent || '').trim().toLowerCase().slice(0, 120),
      lexical: editor.getAttribute('data-lexical-editor') || '',
      contenteditable: editor.getAttribute('contenteditable') || '',
    });

    const patternScore = (editor, pattern) => {
      if (!pattern) return 0;

      let score = 0;
      const ariaLabel = (editor.getAttribute('aria-label') || '').trim().toLowerCase();
      const placeholder = (editor.getAttribute('aria-placeholder') || '').trim().toLowerCase();
      const text = (editor.textContent || '').trim().toLowerCase();

      if (pattern.tag && editor.tagName.toLowerCase() === pattern.tag) score += 6;
      if (pattern.role && (editor.getAttribute('role') || '') === pattern.role) score += 6;
      if (pattern.ariaLabel && ariaLabel === pattern.ariaLabel) score += 10;
      if (pattern.placeholder && placeholder === pattern.placeholder) score += 12;
      if (pattern.text && text.includes(pattern.text)) score += 6;
      if (pattern.lexical && (editor.getAttribute('data-lexical-editor') || '') === pattern.lexical) score += 6;
      if (pattern.contenteditable && (editor.getAttribute('contenteditable') || '') === pattern.contenteditable) score += 4;

      return score;
    };

    document.querySelectorAll(`[${ROOT_ATTR}], [${EDITOR_ATTR}]`).forEach(el => {
      el.removeAttribute(ROOT_ATTR);
      el.removeAttribute(EDITOR_ATTR);
    });

    const isVisible = el => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 40
        && rect.height > 20;
    };

    const editors = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter(isVisible)
      .map(editor => {
        const placeholder = (editor.getAttribute('aria-placeholder') || '').trim().toLowerCase();
        const ariaLabel = (editor.getAttribute('aria-label') || '').trim().toLowerCase();
        const editorText = (editor.textContent || '').trim().toLowerCase();
        const isExactCreatePostEditor = editor.getAttribute('role') === 'textbox'
          && editor.getAttribute('data-lexical-editor') === 'true'
          && createPostPlaceholders.includes(placeholder);
        const hasCreateSignal = isExactCreatePostEditor
          || hasCreatePostSignal(placeholder)
          || hasCreatePostSignal(ariaLabel)
          || hasCreatePostSignal(editorText);
        if (!hasCreateSignal) {
          return null;
        }

        const root = findComposerRoot(editor);
        const rect = editor.getBoundingClientRect();
        const rootText = ((root?.textContent) || '').toLowerCase();
        if (hasCommentSignalText(rootText)) {
          return null;
        }

        const hasPostButton = hasPostControl(root);

        let score = patternScore(editor, learnedPattern);
        if (isExactCreatePostEditor) score += 40;
        if (hasCreateSignal) score += 18;
        if (root?.getAttribute('role') === 'dialog') score += 20;
        if (hasPostButton) score += 18;
        if (placeholder.includes('write something')) score += 8;
        if (placeholder.includes('create a public post')) score += 12;
        if (placeholder.includes('comment') || placeholder.includes('reply')) score -= 25;
        if (rootText.includes('comment') || rootText.includes('reply')) score -= 12;
        if (rect.top >= 0 && rect.top < window.innerHeight * 0.8) score += 6;
        if (rect.top >= 0 && rect.top < 300) score += 6;

        return { editor, root, score, pattern: toPattern(editor) };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    const match = editors[0];
    if (!match || !match.root) {
      return null;
    }

    match.root.setAttribute(ROOT_ATTR, 'true');
    match.editor.setAttribute(EDITOR_ATTR, 'true');

    return {
      rootSelector: `[${ROOT_ATTR}="true"]`,
      editorSelector: `[${EDITOR_ATTR}="true"]`,
      mode: match.root.getAttribute('role') === 'dialog' ? 'dialog composer' : 'inline composer',
      source: 'heuristic',
      pattern: match.pattern,
    };
  }, strategy.composerPattern || null);

  return composer || { success: false, reason: 'no_composer_found_by_heuristics', source: 'heuristic' };
}

async function preferAISelection(label, tryAI, tryHeuristics) {
  // Check if AI-first mode is enabled
  const useAIFirst = process.env.USE_AI_FIRST !== 'false';

  if (!useAIFirst) {
    console.log(`[posting] AI-first mode disabled, using heuristics for ${label}`);
    return tryHeuristics();
  }

  const aiResult = await tryAI();
  if (isSuccessfulSelection(aiResult)) {
    return aiResult;
  }

  // Log the reason for AI failure
  const failReason = aiResult && aiResult.reason ? aiResult.reason : 'unknown';
  console.log(`[posting] AI ${label} selection failed: ${failReason}`);

  // Check if heuristics fallback is enabled
  const useHeuristicsFallback = process.env.USE_HEURISTICS_FALLBACK !== 'false';

  if (!useHeuristicsFallback) {
    console.log(`[posting] Heuristics fallback is disabled`);
    return { success: false, reason: 'ai_failed_no_fallback', source: 'none' };
  }

  console.log(`[posting] Falling back to heuristic ${label} selection`);
  return tryHeuristics();
}

function isSuccessfulSelection(result) {
  if (!result) {
    return false;
  }

  if (typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'success')) {
    return Boolean(result.success);
  }

  return true;
}

async function clickCreatePostTriggerWithAI(page) {
  if (!hasDeepSeekConfig()) {
    return { success: false, reason: 'no_deepseek_api_key_configured' };
  }

  try {
    const snapshot = await captureDomSnapshot(page, 'trigger');
    if (!snapshot.candidates.length) {
      await writeTriggerDebugSnapshot(page, 'no_trigger_candidates');
      return { success: false, reason: 'no_trigger_candidates_found' };
    }

    const choice = await chooseFacebookPostTarget(snapshot, 'trigger');
    if (!choice) {
      await writeTriggerDebugSnapshot(page, 'deepseek_returned_none_for_trigger');
      return { success: false, reason: 'deepseek_api_returned_none' };
    }

    const clicked = await page.evaluate(candidateId => {
      const toPattern = el => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        ariaLabel: (el.getAttribute('aria-label') || '').trim().toLowerCase(),
        placeholder: (el.getAttribute('aria-placeholder') || '').trim().toLowerCase(),
        text: (el.textContent || '').trim().toLowerCase().slice(0, 120),
        lexical: el.getAttribute('data-lexical-editor') || '',
      });

      const target = document.querySelector(`[data-copilot-dom-candidate-id="${candidateId}"]`);
      if (!target) {
        return { success: false };
      }

      target.click();
      if (typeof target.focus === 'function') {
        target.focus();
      }
      return { success: true, source: 'ai', pattern: toPattern(target) };
    }, choice.candidateId);

    if (clicked.success) {
      console.log(`[posting] DeepSeek selected trigger ${choice.candidateId}${choice.reason ? `: ${choice.reason}` : ''}`);
      return clicked;
    }
    return { success: false, reason: 'trigger_element_not_found_in_dom' };
  } catch (err) {
    console.log(`[posting] DeepSeek trigger selection error: ${err.message}`);
    await writeTriggerDebugSnapshot(page, 'deepseek_trigger_error');
    return { success: false, reason: `deepseek_api_error: ${err.message}` };
  }
}

async function identifyComposerWithAI(page) {
  if (!hasDeepSeekConfig()) {
    return { success: false, reason: 'no_deepseek_api_key_configured' };
  }

  try {
    const snapshot = await captureDomSnapshot(page, 'composer');
    if (!snapshot.candidates.length) {
      return { success: false, reason: 'no_composer_candidates_found' };
    }

    const choice = await chooseFacebookPostTarget(snapshot, 'composer');
    if (!choice) {
      return { success: false, reason: 'deepseek_api_returned_none' };
    }

    const composer = await page.evaluate(candidateId => {
      const ROOT_ATTR = 'data-copilot-post-root';
      const EDITOR_ATTR = 'data-copilot-post-editor';
      const hasCommentSignalText = text => {
        const normalized = (text || '').toLowerCase();
        return normalized.includes('comment as')
          || normalized.includes('write a comment')
          || normalized.includes('leave a comment')
          || normalized.includes('most relevant')
          || normalized.includes('reply');
      };
      const hasPostControl = root => [...(root?.querySelectorAll('button, [role="button"], [tabindex="0"]') || [])].some(control => {
        const label = (control.getAttribute('aria-label') || '').trim().toLowerCase();
        const value = (control.textContent || '').trim().toLowerCase();
        return label === 'post' || value === 'post' || label.includes('post') || value.includes('post');
      });
      const hasAttachControl = root => [...(root?.querySelectorAll('button, [role="button"], [tabindex="0"], input[type="file"]') || [])].some(control => {
        const label = (control.getAttribute('aria-label') || '').trim().toLowerCase();
        const value = (control.textContent || '').trim().toLowerCase();
        return control.tagName === 'INPUT'
          || label.includes('photo')
          || value.includes('photo')
          || label.includes('video')
          || value.includes('video');
      });
      const hasComposerContainerSignal = text => {
        const normalized = (text || '').toLowerCase();
        return normalized.includes('create post')
          || normalized.includes('post anonymously')
          || normalized.includes('public group')
          || normalized.includes('photo/video')
          || normalized.includes('add to your post');
      };
      const findComposerRoot = editor => {
        let node = editor;
        let depth = 0;
        let fallback = editor.parentElement || editor;

        while (node && depth < 12) {
          const text = (node.textContent || '').toLowerCase();
          if (hasCommentSignalText(text)) {
            node = node.parentElement;
            depth += 1;
            continue;
          }

          if (hasPostControl(node) && (hasAttachControl(node) || hasComposerContainerSignal(text))) {
            return node;
          }

          if (hasComposerContainerSignal(text) || node.getAttribute('role') === 'dialog' || node.tagName === 'FORM') {
            fallback = node;
          }

          node = node.parentElement;
          depth += 1;
        }

        return fallback;
      };

      const toPattern = editor => ({
        tag: editor.tagName.toLowerCase(),
        role: editor.getAttribute('role') || '',
        ariaLabel: (editor.getAttribute('aria-label') || '').trim().toLowerCase(),
        placeholder: (editor.getAttribute('aria-placeholder') || '').trim().toLowerCase(),
        text: (editor.textContent || '').trim().toLowerCase().slice(0, 120),
        lexical: editor.getAttribute('data-lexical-editor') || '',
        contenteditable: editor.getAttribute('contenteditable') || '',
      });

      document.querySelectorAll(`[${ROOT_ATTR}], [${EDITOR_ATTR}]`).forEach(el => {
        el.removeAttribute(ROOT_ATTR);
        el.removeAttribute(EDITOR_ATTR);
      });

      const editor = document.querySelector(`[data-copilot-dom-candidate-id="${candidateId}"]`);
      if (!editor) {
        return null;
      }

      const isEditable = editor.matches('[contenteditable="true"], textarea, input[type="text"], [role="textbox"]');
      if (!isEditable) {
        return null;
      }

      const root = findComposerRoot(editor);
      if (!root || hasCommentSignalText(root.textContent || '')) {
        return null;
      }

      root.setAttribute(ROOT_ATTR, 'true');
      editor.setAttribute(EDITOR_ATTR, 'true');

      return {
        rootSelector: `[${ROOT_ATTR}="true"]`,
        editorSelector: `[${EDITOR_ATTR}="true"]`,
        mode: root.getAttribute('role') === 'dialog' ? 'dialog composer' : 'inline composer',
        source: 'ai',
        pattern: toPattern(editor),
      };
    }, choice.candidateId);

    if (composer) {
      console.log(`[posting] DeepSeek selected composer ${choice.candidateId}${choice.reason ? `: ${choice.reason}` : ''}`);
      return composer;
    }
    return { success: false, reason: 'composer_element_not_editable_or_invalid' };
  } catch (err) {
    console.log(`[posting] DeepSeek composer selection error: ${err.message}`);
    return { success: false, reason: `deepseek_api_error: ${err.message}` };
  }
}

async function submitPostWithAI(page, composer) {
  if (!hasDeepSeekConfig()) {
    return { success: false, reason: 'no_deepseek_api_key_configured' };
  }

  try {
    const snapshot = await captureDomSnapshot(page, 'submit', composer.rootSelector);
    if (!snapshot.candidates.length) {
      return { success: false, reason: 'no_submit_button_candidates_found' };
    }

    const choice = await chooseFacebookPostTarget(snapshot, 'submit');
    if (!choice) {
      return { success: false, reason: 'deepseek_api_returned_none' };
    }

    const result = await page.evaluate(({ candidateId, submitTargetAttr }) => {
      const toPattern = control => ({
        tag: control.tagName.toLowerCase(),
        role: control.getAttribute('role') || '',
        ariaLabel: (control.getAttribute('aria-label') || '').trim().toLowerCase(),
        placeholder: (control.getAttribute('aria-placeholder') || '').trim().toLowerCase(),
        contenteditable: control.getAttribute('contenteditable') || '',
        text: (control.textContent || '').trim().toLowerCase(),
      });

      const target = document.querySelector(`[data-copilot-dom-candidate-id="${candidateId}"]`);
      if (!target) {
        return { success: false };
      }

      document.querySelectorAll(`[${submitTargetAttr}]`).forEach(el => el.removeAttribute(submitTargetAttr));
      const clickable = target.closest('button, [role="button"], [tabindex="0"]') || target;
      const role = (clickable.getAttribute('role') || '').trim().toLowerCase();
      const contenteditable = (clickable.getAttribute('contenteditable') || '').trim().toLowerCase();
      if (role === 'textbox' || contenteditable === 'true') {
        return { success: false };
      }
      clickable.setAttribute(submitTargetAttr, 'true');
      return { success: true, pattern: toPattern(clickable) };
    }, { candidateId: choice.candidateId, submitTargetAttr: SUBMIT_TARGET_ATTR });

    if (result.success) {
      console.log(`[posting] DeepSeek selected submit button ${choice.candidateId}${choice.reason ? `: ${choice.reason}` : ''}`);
      const clicked = await clickPreparedSubmitTarget(page);
      if (clicked) {
        return result;
      }
      return { success: false, reason: 'submit_button_click_failed' };
    }
    return { success: false, reason: 'submit_button_not_clickable_or_invalid' };
  } catch (err) {
    console.log(`[posting] DeepSeek submit selection error: ${err.message}`);
    return { success: false, reason: `deepseek_api_error: ${err.message}` };
  }
}

async function captureDomSnapshot(page, phase, rootSelector = null) {
  return page.evaluate(({ currentPhase, scopedRootSelector }) => {
    const CANDIDATE_ATTR = 'data-copilot-dom-candidate-id';
    const triggerPhrases = [
      'write something',
      'write something to the group',
      'create a public post',
      'create post',
      'say something',
    ];
    const composerPhrases = [
      'create a public post',
      'write something',
      'write something to the group',
      'create post',
    ];

    const root = scopedRootSelector ? document.querySelector(scopedRootSelector) : document;
    if (!root) {
      return {
        page: {
          title: document.title,
          url: location.href,
        },
        candidates: [],
      };
    }

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

    const textFor = el => {
      return [
        el.getAttribute('aria-label') || '',
        el.getAttribute('aria-placeholder') || '',
        el.textContent || '',
      ].join(' ').replace(/\s+/g, ' ').trim();
    };

    const hasCommentSignal = text => {
      const normalized = (text || '').toLowerCase();
      return normalized.includes('comment as')
        || normalized.includes('write a comment')
        || normalized.includes('leave a comment')
        || normalized.includes('reply');
    };

    const hasCreatePostSignal = text => {
      const normalized = (text || '').toLowerCase();
      return composerPhrases.some(phrase => normalized.includes(phrase));
    };

    const summaryFor = el => {
      const rect = el.getBoundingClientRect();
      const text = textFor(el);
      const parent = el.parentElement;
      const parentText = parent ? textFor(parent).slice(0, 120) : '';
      const context = (el.closest('[role="article"], [role="dialog"], form, [data-pagelet], [role="main"]')?.textContent || '')
        .replace(/\s+/g, ' ')
        .slice(0, 180);

      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('aria-placeholder') || '',
        lexical: el.getAttribute('data-lexical-editor') || '',
        contenteditable: el.getAttribute('contenteditable') || '',
        text: text.slice(0, 180),
        parentText,
        context,
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    let all;

    if (currentPhase === 'submit') {
      const submitCandidates = [...root.querySelectorAll('button, [role="button"], [tabindex="0"]')]
        .filter(isVisible)
        .filter((el, index, array) => array.indexOf(el) === index)
        .filter(el => {
          const text = textFor(el).toLowerCase();
          return text.includes('post') && !text.includes('post anonymously');
        })
        .slice(0, 60);

      all = submitCandidates.map((el, index) => {
        const id = `${currentPhase}-${index + 1}`;
        el.setAttribute(CANDIDATE_ATTR, id);
        return {
          id,
          ...summaryFor(el),
        };
      });
    } else {
      const selector = currentPhase === 'composer'
        ? '[contenteditable="true"], textarea, input[type="text"], [role="textbox"]'
        : '[contenteditable="true"], [role="button"], button, div, span, a';

      all = [...root.querySelectorAll(selector)]
        .filter(isVisible)
        .filter(el => {
          const text = textFor(el).toLowerCase();
          if (currentPhase === 'composer') {
            if (!el.matches('[contenteditable="true"], textarea, input[type="text"], [role="textbox"]')) {
              return false;
            }

            if (hasCommentSignal(text)) {
              return false;
            }

            return hasCreatePostSignal(text);
          }

          if (el.matches('[contenteditable="true"]')) {
            return hasCreatePostSignal(text);
          }

          if (hasCommentSignal(text) && !hasCreatePostSignal(text)) {
            return false;
          }

          return triggerPhrases.some(phrase => text.includes(phrase));
        })
        .sort((left, right) => {
          const leftText = textFor(left).toLowerCase();
          const rightText = textFor(right).toLowerCase();
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();

          let leftScore = 0;
          let rightScore = 0;

          if (hasCreatePostSignal(leftText)) leftScore += 20;
          if (hasCreatePostSignal(rightText)) rightScore += 20;
          if (left.closest('[role="main"]')) leftScore += 4;
          if (right.closest('[role="main"]')) rightScore += 4;
          if (leftRect.top >= 0 && leftRect.top < window.innerHeight * 0.6) leftScore += 8;
          if (rightRect.top >= 0 && rightRect.top < window.innerHeight * 0.6) rightScore += 8;
          if (leftRect.top >= 0 && leftRect.top < 300) leftScore += 10;
          if (rightRect.top >= 0 && rightRect.top < 300) rightScore += 10;

          return rightScore - leftScore || leftRect.top - rightRect.top;
        })
        .slice(0, 60)
        .map((el, index) => {
          const id = `${currentPhase}-${index + 1}`;
          el.setAttribute(CANDIDATE_ATTR, id);
          return {
            id,
            ...summaryFor(el),
          };
        });
    }

    return {
      page: {
        title: document.title,
        url: location.href,
      },
      candidates: all,
    };
  }, { currentPhase: phase, scopedRootSelector: rootSelector });
}

module.exports = { postToGroup, testGroupSetup };
