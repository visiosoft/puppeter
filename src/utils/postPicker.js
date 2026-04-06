const fs = require('fs');
const path = require('path');

const POSTS_FILE = path.join(__dirname, '../../data/posts.txt');

/**
 * Reads posts.txt and returns all non-empty posts.
 * Each post is separated by a blank line (supports multi-line posts).
 */
function loadPosts() {
  if (!fs.existsSync(POSTS_FILE)) {
    throw new Error(`posts.txt not found at: ${POSTS_FILE}`);
  }

  const raw = fs.readFileSync(POSTS_FILE, 'utf-8');

  // Split by blank lines to support multi-line posts
  const posts = raw
    .split(/\r?\n\s*\r?\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (posts.length === 0) {
    throw new Error('posts.txt is empty. Add at least one post message.');
  }

  return posts;
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

module.exports = { getRandomPost, getAllPosts };
