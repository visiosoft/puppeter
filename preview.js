/**
 * preview.js
 * Run: node preview.js
 *
 * Shows what post text + image will be used for the next post.
 * Use this to test your posts.txt and images/ folder before running the assistant.
 */

const { getNextContent } = require('./src/modules/content-variation');
const { getAllPosts } = require('./src/utils/postPicker');
const { getAllImages } = require('./src/utils/imagePicker');

const args = process.argv.slice(2);

// node preview.js --list  →  show all posts and images
if (args.includes('--list')) {
  console.log('\n=== ALL POSTS (posts.txt) ===\n');
  const posts = getAllPosts();
  posts.forEach((p, i) => {
    console.log(`[Post ${i + 1}]`);
    console.log(p);
    console.log('---');
  });

  console.log('\n=== ALL IMAGES (images/) ===\n');
  try {
    const images = getAllImages();
    images.forEach((img, i) => {
      const path = require('path');
      console.log(`[Image ${i + 1}] ${path.basename(img)}`);
    });
  } catch (e) {
    console.log('No images found:', e.message);
  }

  process.exit(0);
}

// Default: show a single random pick
console.log('\n=== CONTENT PREVIEW ===\n');

try {
  const content = getNextContent();

  console.log(`Post ${content.meta.postIndex} of ${content.meta.totalPosts}`);
  console.log('─'.repeat(50));
  console.log(content.text);
  console.log('─'.repeat(50));

  if (content.imagePath) {
    console.log(`\nImage ${content.meta.imageIndex} of ${content.meta.totalImages}: ${content.imageFilename}`);
    console.log(`Path: ${content.imagePath}`);
  } else {
    console.log('\nNo image (images/ folder empty or missing)');
  }

  console.log('\nRun again to get a different random pick.');
  console.log('Run with --list to see all posts and images.');
} catch (err) {
  console.error('\nError:', err.message);
  process.exit(1);
}
