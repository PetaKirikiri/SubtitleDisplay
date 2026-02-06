/**
 * Hotkey Listener - Document-level key capture and delegation
 * 
 * RESPONSIBILITY: Captures keys at document level, delegates navigation to timeline functions
 * Contains ZERO playback logic - only delegates
 * 
 * DELEGATION PATTERN:
 * - ArrowLeft → delegates to restartCurrentSubtitle()
 * - ArrowRight → delegates to advanceToNextSubtitle()
 * - ArrowUp → delegates to goToPreviousSubtitle()
 * - Space → toggles freeplay mode
 */

import { advanceToNextSubtitle, restartCurrentSubtitle, goToPreviousSubtitle } from './timelineNavigation';

let isFreeplayMode = false;
let isEnabled = false;
let numberKeyCallback: ((index: number) => void) | null = null;
let numberKeyHandler: ((e: KeyboardEvent) => void) | null = null;

export function setupArrowKeyNavigation(): void {
  if (isEnabled) return;
  document.addEventListener('keydown', handleArrowKeyDown, true);
  document.addEventListener('keydown', handleSpaceKey, true);
  isEnabled = true;
}

export function removeArrowKeyNavigation(): void {
  if (!isEnabled) return;
  document.removeEventListener('keydown', handleArrowKeyDown, true);
  document.removeEventListener('keydown', handleSpaceKey, true);
  if (numberKeyHandler) {
    document.removeEventListener('keydown', numberKeyHandler, true);
    numberKeyHandler = null;
  }
  isEnabled = false;
}

/**
 * Setup number key selection for meaning selection (0-9)
 * @param callback - Called with meaning index (0-9) when number key is pressed
 * @returns Cleanup function to remove the handler
 */
export function setupNumberKeySelection(callback: (index: number) => void): () => void {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'hotkeys.ts:setupNumberKeySelection',message:'Setting up number key selection',data:{hasOldHandler:!!numberKeyHandler},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
  // #endregion
  
  // Remove old handler if exists
  if (numberKeyHandler) {
    document.removeEventListener('keydown', numberKeyHandler, true);
  }
  
  numberKeyCallback = callback;
  
  numberKeyHandler = (e: KeyboardEvent) => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'hotkeys.ts:numberKeyHandler',message:'Number key pressed',data:{key:e.key,hasCallback:!!numberKeyCallback},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
    // #endregion
    
    // Only handle number keys 0-9
    const key = e.key;
    if (key < '0' || key > '9') {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'hotkeys.ts:numberKeyHandler',message:'Key ignored - not number key',data:{key:e.key},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
      // #endregion
      return;
    }
    
    // Ignore if input/textarea is focused
    const activeElement = document.activeElement;
    const isInputFocused = activeElement && 
      (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
    if (isInputFocused) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'hotkeys.ts:numberKeyHandler',message:'Key ignored - input focused',data:{key:e.key,activeElementTag:activeElement.tagName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
      // #endregion
      return;
    }
    
    // Prevent default behavior
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Convert key to meaning index
    // User-friendly mapping: "1" = first meaning (index 0), "2" = second meaning (index 1), etc.
    // "0" maps to 10th meaning (index 9) if it exists
    const keyNum = parseInt(key, 10);
    const meaningIndex = keyNum === 0 ? 9 : keyNum - 1; // "0" → index 9, "1" → index 0, "2" → index 1, etc.
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'hotkeys.ts:numberKeyHandler',message:'Calling callback',data:{key:e.key,keyNum,meaningIndex,hasCallback:!!numberKeyCallback},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
    // #endregion
    if (numberKeyCallback) {
      numberKeyCallback(meaningIndex);
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'hotkeys.ts:numberKeyHandler',message:'ERROR - no callback registered',data:{key:e.key,keyNum,meaningIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
      // #endregion
    }
  };
  
  document.addEventListener('keydown', numberKeyHandler, true);
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'hotkeys.ts:setupNumberKeySelection',message:'Number key handler registered',data:{hasHandler:!!numberKeyHandler,hasCallback:!!numberKeyCallback},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
  // #endregion
  
  // Return cleanup function
  return () => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'hotkeys.ts:setupNumberKeySelection:cleanup',message:'Cleaning up number key handler',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
    // #endregion
    if (numberKeyHandler) {
      document.removeEventListener('keydown', numberKeyHandler, true);
      numberKeyHandler = null;
      numberKeyCallback = null;
    }
  };
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
