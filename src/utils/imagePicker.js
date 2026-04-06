const fs = require('fs');
const path = require('path');

const IMAGES_FOLDER = path.join(__dirname, '../../images');
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

/**
 * Returns all valid image files from the images/ folder.
 */
function loadImages() {
  if (!fs.existsSync(IMAGES_FOLDER)) {
    throw new Error(`images/ folder not found at: ${IMAGES_FOLDER}`);
  }

  const files = fs.readdirSync(IMAGES_FOLDER).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return SUPPORTED_EXTENSIONS.includes(ext);
  });

  if (files.length === 0) {
    throw new Error(
      `No images found in images/ folder. Add .jpg, .png, .gif, or .webp files.`
    );
  }

  return files.map(file => path.join(IMAGES_FOLDER, file));
}

/**
 * Returns one random image path from the images/ folder.
 */
function getRandomImage() {
  const images = loadImages();
  const index = Math.floor(Math.random() * images.length);
  return {
    path: images[index],
    filename: path.basename(images[index]),
    index: index + 1,
    total: images.length,
  };
}

/**
 * Returns all image paths from the images/ folder.
 */
function getAllImages() {
  return loadImages();
}

module.exports = { getRandomImage, getAllImages };
