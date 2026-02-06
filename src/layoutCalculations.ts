/**
 * Layout Calculations
 * ONE file that calculates layout dimensions
 * Exports: calculateLayout() to compute values, then 3 pure getters
 */

// Stored calculated values
let netflixWidth: number = 0;
let netflixHeight: number = 0;
let netflixTop: number = 0;
let bottomHeight: number = 0;
let rightWidth: number = 0;

// Global references to the 2 rectangles (never recreated)
let bottomRect: HTMLElement | null = null;
let rightRect: HTMLElement | null = null;

/**
 * Calculate all layout dimensions and store them
 * Call this once, then use the getters to retrieve values
 */
export function calculateLayout(videoElement: HTMLVideoElement, containerElement: HTMLElement): void {
  // Measure screen - use window dimensions, NOT container rect (container is what we're resizing!)
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const containerRect = containerElement.getBoundingClientRect();
  const containerTop = containerRect.top;

  // Get video aspect ratio
  const videoAspectRatio = videoElement.videoWidth > 0 && videoElement.videoHeight > 0
    ? (videoElement.videoWidth / videoElement.videoHeight)
    : (16 / 9);

  // Calculate the 3 outputs
  const MIN_SUBTITLE_HEIGHT = 250;
  const MIN_ADDITIONAL_WIDTH = 300;

  let videoWidth = screenWidth;
  let videoHeight = videoWidth / videoAspectRatio;

  if (videoHeight > screenHeight - MIN_SUBTITLE_HEIGHT) {
    videoHeight = screenHeight - MIN_SUBTITLE_HEIGHT;
    videoWidth = videoHeight * videoAspectRatio;
  }

  const remainingWidth = screenWidth - videoWidth;
  if (remainingWidth < MIN_ADDITIONAL_WIDTH) {
    videoWidth = screenWidth - MIN_ADDITIONAL_WIDTH;
    videoHeight = videoWidth / videoAspectRatio;
  }

  const subtitleHeight = Math.max(screenHeight - videoHeight, MIN_SUBTITLE_HEIGHT);
  const additionalWidth = Math.max(screenWidth - videoWidth, 0);

  // Store calculated values
  netflixWidth = videoWidth;
  netflixHeight = videoHeight;
  netflixTop = containerTop;
  bottomHeight = subtitleHeight;
  rightWidth = additionalWidth;
}

/**
 * Get Netflix player dimensions
 * Pure getter - returns stored values
 */
export function getNetflixDimensions(): { width: number; height: number; top: number } {
  return { width: netflixWidth, height: netflixHeight, top: netflixTop };
}

/**
 * Get bottom panel height
 * Pure getter - returns stored value
 */
export function getBottomHeight(): number {
  return bottomHeight;
}

/**
 * Get right panel width
 * Pure getter - returns stored value
 */
export function getRightWidth(): number {
  return rightWidth;
}

/**
 * Calculate layout and return all dimensions
 * Returns pure numbers - no styling
 */
export function getLayoutDimensions(
  videoElement: HTMLVideoElement,
  containerElement: HTMLElement
): {
  netflix: { width: number; height: number; top: number };
  bottomHeight: number;
  rightWidth: number;
} {
  calculateLayout(videoElement, containerElement);
  return {
    netflix: getNetflixDimensions(),
    bottomHeight: getBottomHeight(),
    rightWidth: getRightWidth(),
  };
}

/**
 * Create exactly 2 DOM rectangles, append to document.body
 * Called ONCE per session - never recreate
 */
export function createRectangles(): { bottom: HTMLElement; right: HTMLElement } {
  if (bottomRect && rightRect) {
    // Already exist, return existing references
    return { bottom: bottomRect, right: rightRect };
  }

  // Create bottom rectangle
  bottomRect = document.createElement('div');
  bottomRect.id = 'subtitle-display-bottom';
  // Geometry only: position, z-index, pointer-events
  bottomRect.style.position = 'fixed';
  bottomRect.style.bottom = '0';
  bottomRect.style.left = '0';
  bottomRect.style.right = '0';
  bottomRect.style.zIndex = '99999';
  bottomRect.style.pointerEvents = 'auto';
  // Initial size (will be updated by setRectangleGeometry)
  bottomRect.style.width = '0px';
  bottomRect.style.height = '0px';
  document.body.appendChild(bottomRect);

  // Create right rectangle
  rightRect = document.createElement('div');
  rightRect.id = 'subtitle-display-right';
  // Geometry only: position, z-index, pointer-events
  rightRect.style.position = 'fixed';
  rightRect.style.right = '0';
  rightRect.style.zIndex = '99999';
  rightRect.style.pointerEvents = 'auto';
  // Initial size (will be updated by setRectangleGeometry)
  rightRect.style.width = '0px';
  rightRect.style.height = '0px';
  rightRect.style.top = '0px';
  rightRect.style.bottom = '0px';
  document.body.appendChild(rightRect);

  return { bottom: bottomRect, right: rightRect };
}

/**
 * Set geometry of all rectangles from calculated dimensions
 * Only updates numbers - never recreates elements
 */
export function setRectangleGeometry(
  videoElement: HTMLVideoElement,
  containerElement: HTMLElement
): void {
  if (!bottomRect || !rightRect) {
    throw new Error('Rectangles must be created before setting geometry');
  }

  // Calculate dimensions
  calculateLayout(videoElement, containerElement);
  const netflix = getNetflixDimensions();
  const bottomHeight = getBottomHeight();
  const rightWidth = getRightWidth();

  // Set bottom rectangle geometry (numbers only)
  bottomRect.style.width = `${window.innerWidth}px`;
  bottomRect.style.height = `${bottomHeight}px`;

  // Set right rectangle geometry (numbers only)
  rightRect.style.width = `${rightWidth}px`;
  rightRect.style.top = `${netflix.top}px`;
  rightRect.style.height = `${window.innerHeight - bottomHeight}px`;
  rightRect.style.bottom = `${bottomHeight}px`;
}

/**
 * Remove rectangles (only called on full extension teardown)
 */
export function removeRectangles(): void {
  if (bottomRect) {
    bottomRect.remove();
    bottomRect = null;
  }
  if (rightRect) {
    rightRect.remove();
    rightRect = null;
  }
}
