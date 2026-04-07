const { getRandomPost, getSequentialPost } = require('../utils/postPicker');
const { getRandomImage, getSequentialImage } = require('../utils/imagePicker');

/**
 * Picks content (post + image) for posting.
 * 
 * Modes:
 * - sequential: Uses sequential rotation per account (recommended for different posts per group)
 * - random: Picks random post and image each time
 * 
 * Returns:
 * {
 *   text: "post message...",
 *   imagePath: "D:/...images/photo1.jpg",
 *   imageFilename: "photo1.jpg",
 *   meta: { postIndex, totalPosts, imageIndex, totalImages }
 * }
 */
function getNextContent(options = {}) {
  const {
    requireImage = false,
    accountLabel = 'default',
    mode = process.env.POST_SELECTION_MODE || 'sequential'  // 'sequential' or 'random'
  } = options;

  // Select post based on mode
  const post = mode === 'sequential'
    ? getSequentialPost(accountLabel)
    : getRandomPost();

  // Select image based on mode
  let image = null;
  try {
    image = mode === 'sequential'
      ? getSequentialImage(accountLabel)
      : getRandomImage();
  } catch (err) {
    if (requireImage) throw err;
    // Image folder empty or missing — post without image
    console.warn(`[content-variation] No image attached: ${err.message}`);
  }

  return {
    text: post.text,
    imagePath: image ? image.path : null,
    imageFilename: image ? image.filename : null,
    meta: {
      postIndex: post.index,
      totalPosts: post.total,
      imageIndex: image ? image.index : null,
      totalImages: image ? image.total : null,
    },
  };
}

module.exports = { getNextContent };
