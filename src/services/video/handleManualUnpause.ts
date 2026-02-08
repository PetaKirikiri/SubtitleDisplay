/**
 * Manual Unpause Handler Service (Cross-Domain)
 * Decision logic for exiting editing mode when user manually unpauses video
 */

export interface ManualUnpauseResult {
  shouldExitEditing: boolean;
}

/**
 * Handle manual unpause
 * Determines if editing mode should be exited when user manually unpauses
 * 
 * @param video - Video element (may be null)
 * @param isEditingMode - Current editing mode state
 * @returns Result with exit editing flag
 */
export function handleManualUnpause(
  video: HTMLVideoElement | null,
  isEditingMode: boolean
): ManualUnpauseResult {
  // Exit editing mode if user manually unpaused while in editing mode
  if (isEditingMode && video && !video.paused) {
    return {
      shouldExitEditing: true,
    };
  }
  
  return {
    shouldExitEditing: false,
  };
}
