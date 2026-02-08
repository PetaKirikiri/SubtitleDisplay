/**
 * Timeline Navigation Hotkeys
 * 
 * RESPONSIBILITY: Captures timeline navigation keys at document level
 * 
 * HOTKEY PATTERNS:
 * - ArrowLeft → delegates to restartCurrentSubtitle()
 * - ArrowRight → delegates to advanceToNextSubtitle()
 * - ArrowUp → delegates to goToPreviousSubtitle()
 * - Space → toggles freeplay mode
 */

import { advanceToNextSubtitle, restartCurrentSubtitle, goToPreviousSubtitle, setMountSubtitleDirectlyCallback } from '../cache/subtitleNavigation';

interface TimelineHotkeyStateAccessors {
  mountSubtitleDirectly: (subtitleId: string) => Promise<void>;
}

let isFreeplayMode = false;
let isEnabled = false;
let stateAccessors: TimelineHotkeyStateAccessors | null = null;

/**
 * Initialize timeline navigation hotkeys with state accessors
 * Sets up arrow key handlers (ArrowLeft/Right/Up) and Space key handler
 */
export function initializeTimelineHotkeys(accessors: TimelineHotkeyStateAccessors): void {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'timelineNavigation/hotkeys-navigation.ts:initializeTimelineHotkeys',message:'Function entry',data:{isEnabled,hasAccessors:!!accessors,hasMountSubtitleDirectly:!!accessors?.mountSubtitleDirectly},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  if (isEnabled) {
    cleanupTimelineHotkeys();
  }
  
  stateAccessors = accessors;
  
  // Set mount callback for direct subtitle mounting (without seeking)
  if (accessors.mountSubtitleDirectly) {
    setMountSubtitleDirectlyCallback(accessors.mountSubtitleDirectly);
  }
  
  document.addEventListener('keydown', handleArrowKeyDown, true);
  document.addEventListener('keydown', handleSpaceKey, true);
  
  isEnabled = true;
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'timelineNavigation/hotkeys-navigation.ts:initializeTimelineHotkeys',message:'Function exit',data:{isEnabled,hasStateAccessors:!!stateAccessors},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
}

/**
 * Cleanup timeline navigation hotkey handlers
 */
export function cleanupTimelineHotkeys(): void {
  if (!isEnabled) return;
  
  document.removeEventListener('keydown', handleArrowKeyDown, true);
  document.removeEventListener('keydown', handleSpaceKey, true);
  
  stateAccessors = null;
  isEnabled = false;
}

export function getFreeplayMode(): boolean {
  return isFreeplayMode;
}

function handleArrowKeyDown(e: KeyboardEvent): void {
  // Only handle left/right/up arrow keys
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp') {
    return;
  }
  
  // Ignore if input/textarea is focused
  const activeElement = document.activeElement;
  const isInputFocused = activeElement && 
    (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
  if (isInputFocused) {
    return;
  }
  
  // Prevent default behavior
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  
  if (e.key === 'ArrowRight') {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'timelineNavigation/hotkeys-navigation.ts:handleArrowKeyDown',message:'RIGHT_ARROW_PRESSED',data:{key:e.key,shouldCallAdvanceToNextSubtitle:true},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    advanceToNextSubtitle();
  } else if (e.key === 'ArrowLeft') {
    restartCurrentSubtitle();
  } else if (e.key === 'ArrowUp') {
    goToPreviousSubtitle();
  }
}

function handleSpaceKey(e: KeyboardEvent): void {
  if (e.key !== ' ') {
    return;
  }
  
  // Ignore if input/textarea focused
  const activeElement = document.activeElement;
  const isInputFocused = activeElement && 
    (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
  if (isInputFocused) {
    return;
  }
  
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  
  // Toggle freeplay mode
  isFreeplayMode = !isFreeplayMode;
  
  // If freeplay mode ON, resume playback
  if (isFreeplayMode) {
    const video = document.querySelector('video');
    if (video && video.paused) {
      video.play();
    }
  }
}
