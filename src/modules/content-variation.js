const { getRandomPost } = require('../utils/postPicker');
const { getRandomImage } = require('../utils/imagePicker');

/**
 * Picks a random post + random image and returns them as a ready-to-use package.
 * Called before each group post in the posting assistant.
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
  const { requireImage = false } = options;

  const post = getRandomPost();

  let image = null;
  try {
    image = getRandomImage();
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
