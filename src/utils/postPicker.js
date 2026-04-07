const fs = require('fs');
const path = require('path');

const POSTS_FILE = path.join(__dirname, '../../data/posts.txt');
const STATE_FILE = path.join(__dirname, '../../data/post-rotation-state.json');

/**
 * Reads posts.txt and returns all non-empty posts.
 * Each line in the file is treated as a separate post.
 */
function loadPosts() {
  if (!fs.existsSync(POSTS_FILE)) {
    throw new Error(`posts.txt not found at: ${POSTS_FILE}`);
  }

  const raw = fs.readFileSync(POSTS_FILE, 'utf-8');

  // Split by newlines - each line is a separate post
  const posts = raw
    .split(/\r?\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (posts.length === 0) {
    throw new Error('posts.txt is empty. Add at least one post message.');
  }

  return posts;
}

/**
 * Loads the rotation state for tracking which post each account is on.
 */
function loadRotationState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[postPicker] Failed to load rotation state: ${err.message}`);
    return {};
  }
}

/**
 * Saves the rotation state.
 */
function saveRotationState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn(`[postPicker] Failed to save rotation state: ${err.message}`);
  }
}

/**
 * Returns the next sequential post for the given account.
 * Each account maintains its own position in the rotation.
 */
function getSequentialPost(accountLabel = 'default') {
  const posts = loadPosts();
  const state = loadRotationState();

  // Get current index for this account (default to 0)
  const currentIndex = state[accountLabel] || 0;

  // Get the post at current index
  const post = posts[currentIndex];

  // Update to next index (wrap around)
  const nextIndex = (currentIndex + 1) % posts.length;
  state[accountLabel] = nextIndex;
  saveRotationState(state);

  return {
    text: post,
    index: currentIndex + 1,
    total: posts.length,
  };
}

/**
 * Returns one random post from posts.txt.
 */
function getRandomPost() {
  const posts = loadPosts();
  const index = Math.floor(Math.random() * posts.length);
  return {
    text: posts[index],
    index: index + 1,
    total: posts.length,
  };
}

/**
 * Returns all posts from posts.txt.
 */
function getAllPosts() {
  return loadPosts();
}

module.exports = { getRandomPost, getSequentialPost, getAllPosts };
