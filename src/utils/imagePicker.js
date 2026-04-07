const fs = require('fs');
const path = require('path');

const IMAGES_FOLDER = path.join(__dirname, '../../images');
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const STATE_FILE = path.join(__dirname, '../../data/image-rotation-state.json');

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
 * Loads the rotation state for tracking which image each account is on.
 */
function loadRotationState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[imagePicker] Failed to load rotation state: ${err.message}`);
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
    console.warn(`[imagePicker] Failed to save rotation state: ${err.message}`);
  }
}

/**
 * Returns the next sequential image for the given account.
 * Each account maintains its own position in the rotation.
 */
function getSequentialImage(accountLabel = 'default') {
  const images = loadImages();
  const state = loadRotationState();

  // Get current index for this account (default to 0)
  const currentIndex = state[accountLabel] || 0;

  // Get the image at current index
  const imagePath = images[currentIndex];

  // Update to next index (wrap around)
  const nextIndex = (currentIndex + 1) % images.length;
  state[accountLabel] = nextIndex;
  saveRotationState(state);

  return {
    path: imagePath,
    filename: path.basename(imagePath),
    index: currentIndex + 1,
    total: images.length,
  };
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

module.exports = { getRandomImage, getSequentialImage, getAllImages };
