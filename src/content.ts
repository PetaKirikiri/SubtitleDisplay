/**
 * Content Script for Netflix Pages
 * Extracts VTT files and metadata, saves to Supabase
 * Uses Zod schema field names directly throughout
 */

import './styles/tailwind.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { fetchThaiVTTContent, injectNetflixSubtitleScript } from './services/netflixVTTExtractor';
import { extractEpisodeFromNetflixPage, getMediaIdFromUrl } from './services/netflixMetadataExtractor';
import { saveEpisode, saveSubtitlesBatch, fetchSubtitles } from './services/supabaseClient';
import { parseVTTFile } from '@/services/vtt/vttParser';
import { getLayoutDimensions, createRectangles, setRectangleGeometry, removeRectangles } from './layoutCalculations';
import { SubArea } from './components/subarea';
import { TokenArea } from './components/tokenarea';
import { formatSubtitleForDisplay, type DisplayMode } from './services/subtitleDisplayLogic';
import type { SubtitleTh } from '@/schemas/subtitleThSchema';
import { setupArrowKeyNavigation, removeArrowKeyNavigation, setupNumberKeySelection } from './services/hotkeys';
import { setSubtitleCache, setCurrentSubtitleId, setMostRecentlyDisplayedSubtitleId } from './services/timelineNavigation';
import { saveTokenMeaningSelection } from './supabase';
import { normalizeTokens, getTokenMeaningId, hasMeaningSelection } from './services/tokenCodec';
import type { MeaningTh } from '@/schemas/meaningThSchema';

let isExtracting = false;
let resizeObserver: ResizeObserver | null = null;
let videoContainer: HTMLElement | null = null;
let videoElement: HTMLVideoElement | null = null;
let bottomRect: HTMLElement | null = null;
let rightRect: HTMLElement | null = null;

// React roots for components
let subtitleDisplayAreaRoot: ReturnType<typeof createRoot> | null = null;
let additionalInformationAreaRoot: ReturnType<typeof createRoot> | null = null;

// Subtitle state
let currentSubtitle: SubtitleTh | null = null;
let displayText: string = '';
let displayMode: DisplayMode = 'tokens';
let subtitles: SubtitleTh[] = [];
let videoTimeHandler: (() => void) | null = null;
let videoPlayHandler: (() => void) | null = null;
let updateAbortController: AbortController | null = null;

// Selected token state for meanings display
let selectedToken: string | null = null;
let selectedTokenIndex: number | null = null;
let selectedSubtitleId: string | null = null;

// Meanings state for number key selection
// Maps "subtitleId_tokenIndex" to meanings array
let meaningsByToken: Map<string, MeaningTh[]> = new Map();

// Editing state - tracks if we're in editing mode (paused for token tagging)
let isEditingMode: boolean = false;

// Video control state
let hasInitialPause: boolean = false;
let hasTokensShown: boolean = false;

// Auto-select state - tracks if we should auto-select first meaning when meanings are fetched
let shouldAutoSelectFirstMeaning: boolean = false;

function setSelectedToken(token: string | null, index: number | null = null, subtitleId: string | null = null): void {
  selectedToken = token;
  selectedTokenIndex = index;
  selectedSubtitleId = subtitleId;
  renderTokenArea();
}

/**
 * Inject CSS styles for subtitle display
 */
function injectStyles(): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('styles/content.css');
  document.head.appendChild(link);
}

/**
 * Debug function to log computed styles of an element
 */
function debugElementStyles(element: HTMLElement, name: string): void {
  const styles = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  console.log(`[SubtitleDisplay] ${name} computed styles:`, {
    borderTop: styles.borderTop,
    borderLeft: styles.borderLeft,
    borderRight: styles.borderRight,
    borderBottom: styles.borderBottom,
    zIndex: styles.zIndex,
    position: styles.position,
    width: styles.width,
    height: styles.height,
    display: styles.display,
    backgroundColor: styles.backgroundColor,
    boundingRect: {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
    },
  });
  
  // Check for z-index conflicts - find elements with higher z-index
  const allElements = document.querySelectorAll('*');
  const higherZIndexElements: Array<{ element: Element; zIndex: string; tagName: string }> = [];
  allElements.forEach((el) => {
    const elStyles = window.getComputedStyle(el);
    const zIndex = parseInt(elStyles.zIndex, 10);
    if (!isNaN(zIndex) && zIndex > 9999) {
      higherZIndexElements.push({
        element: el,
        zIndex: elStyles.zIndex,
        tagName: el.tagName,
      });
    }
  });
  if (higherZIndexElements.length > 0) {
    console.warn(`[SubtitleDisplay] ${name} z-index conflict: Found ${higherZIndexElements.length} elements with z-index > 9999:`, higherZIndexElements.slice(0, 5));
  }
}

/**
 * Render SubArea component with current state
 */
function renderSubArea(): void {
  // Extract tokens array when in tokens mode
  const tokens = displayMode === 'tokens' && currentSubtitle?.tokens_th && 
    typeof currentSubtitle.tokens_th === 'object' && 'tokens' in currentSubtitle.tokens_th
    ? (currentSubtitle.tokens_th as any).tokens
    : undefined;
  
  const handleTokenClick = (token: string | { t: string; meaning_id?: bigint }, index: number): void => {
    const tokenText = typeof token === 'string' ? token : token.t;
    setSelectedToken(tokenText, index, currentSubtitle?.id || null);
  };
  
  if (subtitleDisplayAreaRoot && bottomRect) {
    subtitleDisplayAreaRoot.render(
      React.createElement(SubArea, {
        displayText,
        displayMode,
        onDisplayModeChange: (mode: DisplayMode) => {
          displayMode = mode;
          updateSubtitleDisplay();
        },
        currentSubtitle,
        tokens,
        onTokenClick: handleTokenClick,
        selectedTokenIndex,
      })
    );
  }
}

/**
 * Handle meaning selection for a token
 */
async function handleMeaningSelect(tokenIndex: number, meaningId: bigint): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'Function entry',data:{tokenIndex,meaningId:meaningId.toString(),selectedSubtitleId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
  // #endregion
  
  if (!selectedSubtitleId) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'Early return - no subtitle ID',data:{tokenIndex,meaningId:meaningId.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
    console.error('[Content] Cannot save meaning selection: no subtitle ID');
    return;
  }
  
  try {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'Calling saveTokenMeaningSelection',data:{subtitleId:selectedSubtitleId,tokenIndex,meaningId:meaningId.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
    await saveTokenMeaningSelection(selectedSubtitleId, tokenIndex, meaningId);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'saveTokenMeaningSelection completed',data:{subtitleId:selectedSubtitleId,tokenIndex,meaningId:meaningId.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
    
    // Update local subtitle cache
    const subtitleIndex = subtitles.findIndex(sub => sub.id === selectedSubtitleId);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'Updating local cache',data:{subtitleIndex,hasTokens:subtitleIndex !== -1 && !!subtitles[subtitleIndex]?.tokens_th?.tokens},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
    if (subtitleIndex !== -1) {
      const subtitle = subtitles[subtitleIndex];
      if (subtitle.tokens_th && subtitle.tokens_th.tokens) {
        const normalizedTokens = normalizeTokens(subtitle.tokens_th.tokens);
        normalizedTokens[tokenIndex] = {
          ...normalizedTokens[tokenIndex],
          meaning_id: meaningId,
        };
        subtitles[subtitleIndex] = {
          ...subtitle,
          tokens_th: {
            tokens: normalizedTokens,
          },
        };
        
        // Update current subtitle if it's the one being edited
        if (currentSubtitle?.id === selectedSubtitleId) {
          currentSubtitle = subtitles[subtitleIndex];
        }
        
        // Update cache
        setSubtitleCache(subtitles);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'Cache updated, calling render functions',data:{subtitleId:selectedSubtitleId,currentSubtitleId:currentSubtitle?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
        // #endregion
      }
    }
    
    // Re-render both areas to show updated state
    renderSubArea();
    renderTokenArea();
    
    // Auto-advance to next untagged token (or unpause if all tagged)
    if (isEditingMode && currentSubtitle?.id === selectedSubtitleId) {
      navigateToNextUntaggedToken();
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'Function exit - success',data:{subtitleId:selectedSubtitleId,tokenIndex,meaningId:meaningId.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'Function exit - error',data:{error:error instanceof Error ? error.message : String(error),tokenIndex,meaningId:meaningId.toString()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
    // #endregion
    console.error('[Content] Failed to save meaning selection:', error);
  }
}

/**
 * Handle meanings fetched callback from TokenArea
 */
function handleMeaningsFetched(meanings: MeaningTh[]): void {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningsFetched',message:'Meanings fetched',data:{selectedSubtitleId,selectedTokenIndex,meaningCount:meanings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
  // #endregion
  
  if (selectedSubtitleId !== null && selectedTokenIndex !== null) {
    const key = `${selectedSubtitleId}_${selectedTokenIndex}`;
    meaningsByToken.set(key, meanings);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningsFetched',message:'Meanings stored',data:{key,meaningCount:meanings.length,mapSize:meaningsByToken.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
    // #endregion
    
    // Auto-select first meaning if flag is set
    if (shouldAutoSelectFirstMeaning && meanings.length > 0) {
      shouldAutoSelectFirstMeaning = false;
      const firstMeaning = meanings[0];
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningsFetched',message:'Auto-selecting first meaning',data:{tokenIndex:selectedTokenIndex,meaningId:firstMeaning.id.toString(),meaningCount:meanings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_SELECT'})}).catch(()=>{});
      // #endregion
      handleMeaningSelect(selectedTokenIndex, firstMeaning.id);
    }
  }
}

/**
 * Handle number key press for meaning selection
 */
function handleNumberKeySelection(meaningIndex: number): void {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleNumberKeySelection',message:'Function entry',data:{meaningIndex,selectedSubtitleId,selectedTokenIndex,isEditingMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
  // #endregion
  
  // Only handle if we have a selected token and are in editing mode
  if (selectedSubtitleId === null || selectedTokenIndex === null || !isEditingMode) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleNumberKeySelection',message:'Early return - invalid state',data:{meaningIndex,selectedSubtitleId,selectedTokenIndex,isEditingMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  // Look up meanings for current token
  const key = `${selectedSubtitleId}_${selectedTokenIndex}`;
  const meanings = meaningsByToken.get(key);
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleNumberKeySelection',message:'Looking up meanings',data:{meaningIndex,key,hasMeanings:!!meanings,meaningCount:meanings?.length || 0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
  // #endregion
  
  if (!meanings || meanings.length === 0) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleNumberKeySelection',message:'No meanings available',data:{meaningIndex,key},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
    // #endregion
    return; // No meanings available
  }
  
  // Check if index is valid
  // meaningIndex is 0-based (0 = first meaning, 1 = second meaning, etc.)
  if (meaningIndex < 0 || meaningIndex >= meanings.length) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleNumberKeySelection',message:'Invalid index',data:{meaningIndex,meaningCount:meanings.length,validRange:`0-${meanings.length - 1}`},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
    // #endregion
    return; // Invalid index
  }
  
  // Select the meaning at the given index
  const selectedMeaning = meanings[meaningIndex];
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleNumberKeySelection',message:'Calling handleMeaningSelect',data:{meaningIndex,meaningId:selectedMeaning.id.toString(),tokenIndex:selectedTokenIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
  // #endregion
  handleMeaningSelect(selectedTokenIndex, selectedMeaning.id);
}

/**
 * Render TokenArea component
 */
function renderTokenArea(): void {
  if (additionalInformationAreaRoot && rightRect) {
    // Get selected meaning ID from current subtitle if available
    let selectedMeaningId: bigint | null = null;
    if (currentSubtitle?.tokens_th?.tokens && 
        selectedTokenIndex !== null && 
        selectedTokenIndex !== undefined &&
        selectedTokenIndex >= 0 &&
        selectedTokenIndex < currentSubtitle.tokens_th.tokens.length) {
      const token = currentSubtitle.tokens_th.tokens[selectedTokenIndex];
      const meaningId = getTokenMeaningId(token);
      if (meaningId !== undefined) {
        selectedMeaningId = meaningId;
      }
    }
    
    additionalInformationAreaRoot.render(
      React.createElement(TokenArea, {
        selectedToken,
        subtitleId: selectedSubtitleId,
        tokenIndex: selectedTokenIndex,
        selectedMeaningId,
        onMeaningSelect: handleMeaningSelect,
        onMeaningsFetched: handleMeaningsFetched,
      })
    );
  }
}

/**
 * Find current subtitle based on video time
 * Subtitles persist until the next subtitle's start_sec_th is reached
 * Only checks start_sec_th, not end_sec_th (for persistence)
 */
function findCurrentSubtitle(currentTime: number): SubtitleTh | null {
  // Find the most recent subtitle whose start time we've passed
  // Subtitles persist until the next one starts
  let found: SubtitleTh | null = null;
  for (const sub of subtitles) {
    const start = sub.start_sec_th ?? 0;
    if (currentTime >= start) {
      found = sub;
    } else {
      break; // Subtitles are sorted by start_sec_th
    }
  }
  return found;
}

/**
 * Update subtitle display text based on current subtitle and display mode
 */
async function updateSubtitleDisplay(): Promise<void> {
  // Cancel previous async operation
  if (updateAbortController) {
    updateAbortController.abort();
  }
  updateAbortController = new AbortController();
  
  if (!currentSubtitle) {
    displayText = '';
    renderSubArea();
    return;
  }
  
  // Track most recently displayed subtitle whenever a subtitle is shown
  setMostRecentlyDisplayedSubtitleId(currentSubtitle.id);
  
  // Check if tokens are now visible for the first time
  const hasTokens = currentSubtitle.tokens_th?.tokens && 
    Array.isArray(currentSubtitle.tokens_th.tokens) && 
    currentSubtitle.tokens_th.tokens.length > 0;
  
  if (!hasTokensShown && hasTokens && videoElement && videoElement.paused) {
    // Tokens first appeared, auto-unpause
    try {
      videoElement.play();
      hasTokensShown = true;
    } catch (error) {
      console.warn('[SubtitleDisplay] Could not unpause video when tokens appeared:', error);
    }
  }
  
  if (hasTokens) {
    hasTokensShown = true;
  }
  
  try {
    const formattedText = await formatSubtitleForDisplay(currentSubtitle, displayMode);
    if (!updateAbortController.signal.aborted) {
      displayText = formattedText;
      renderSubArea();
    }
  } catch (error) {
    if (!updateAbortController.signal.aborted) {
      displayText = currentSubtitle.thai || '';
      renderSubArea();
    }
  }
}

/**
 * Find first untagged token index in subtitle
 */
function findFirstUntaggedTokenIndex(subtitle: SubtitleTh): number | null {
  if (!subtitle.tokens_th?.tokens) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:findFirstUntaggedTokenIndex',message:'No tokens found',data:{subtitleId:subtitle.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
    // #endregion
    return null;
  }
  const tokens = subtitle.tokens_th.tokens;
  
  // Log token states for debugging
  const tokenStates = tokens.map((token, idx) => ({
    index: idx,
    text: typeof token === 'string' ? token : token.t,
    hasMeaning: hasMeaningSelection(token),
    meaningId: typeof token === 'string' ? null : (token.meaning_id?.toString() || null)
  }));
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:findFirstUntaggedTokenIndex',message:'Checking token states',data:{subtitleId:subtitle.id,tokenCount:tokens.length,tokenStates},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
  // #endregion
  
  for (let i = 0; i < tokens.length; i++) {
    if (!hasMeaningSelection(tokens[i])) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:findFirstUntaggedTokenIndex',message:'Found first untagged token',data:{subtitleId:subtitle.id,foundIndex:i,tokenText:typeof tokens[i] === 'string' ? tokens[i] : tokens[i].t,skippedCount:i},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
      // #endregion
      return i;
    }
  }
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:findFirstUntaggedTokenIndex',message:'All tokens tagged',data:{subtitleId:subtitle.id,tokenCount:tokens.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
  // #endregion
  return null; // All tokens are tagged
}

/**
 * Find next untagged token index after startIndex
 */
function findNextUntaggedTokenIndex(subtitle: SubtitleTh, startIndex: number): number | null {
  if (!subtitle.tokens_th?.tokens) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:findNextUntaggedTokenIndex',message:'No tokens found',data:{subtitleId:subtitle.id,startIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
    // #endregion
    return null;
  }
  const tokens = subtitle.tokens_th.tokens;
  
  // Log token states for debugging
  const tokenStates = tokens.map((token, idx) => ({
    index: idx,
    text: typeof token === 'string' ? token : token.t,
    hasMeaning: hasMeaningSelection(token),
    meaningId: typeof token === 'string' ? null : (token.meaning_id?.toString() || null)
  }));
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:findNextUntaggedTokenIndex',message:'Checking token states',data:{subtitleId:subtitle.id,startIndex,tokenCount:tokens.length,tokenStates},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
  // #endregion
  
  // Check from startIndex + 1 to end
  for (let i = startIndex + 1; i < tokens.length; i++) {
    if (!hasMeaningSelection(tokens[i])) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:findNextUntaggedTokenIndex',message:'Found next untagged token (forward)',data:{subtitleId:subtitle.id,startIndex,foundIndex:i,tokenText:typeof tokens[i] === 'string' ? tokens[i] : tokens[i].t,skippedCount:i - startIndex - 1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
      // #endregion
      return i;
    }
  }
  // Wrap around: check from beginning to startIndex
  for (let i = 0; i < startIndex; i++) {
    if (!hasMeaningSelection(tokens[i])) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:findNextUntaggedTokenIndex',message:'Found next untagged token (wrapped)',data:{subtitleId:subtitle.id,startIndex,foundIndex:i,tokenText:typeof tokens[i] === 'string' ? tokens[i] : tokens[i].t},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
      // #endregion
      return i;
    }
  }
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:findNextUntaggedTokenIndex',message:'All tokens tagged',data:{subtitleId:subtitle.id,startIndex,tokenCount:tokens.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
  // #endregion
  return null; // All tokens are tagged
}

/**
 * Check if all tokens in subtitle are tagged
 */
function areAllTokensTagged(subtitle: SubtitleTh): boolean {
  if (!subtitle.tokens_th?.tokens || subtitle.tokens_th.tokens.length === 0) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:areAllTokensTagged',message:'No tokens - returning true',data:{subtitleId:subtitle.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
    // #endregion
    return true; // No tokens means "all tagged" (nothing to tag)
  }
  const tokens = subtitle.tokens_th.tokens;
  const allTagged = tokens.every(token => hasMeaningSelection(token));
  
  // Log token states
  const taggedCount = tokens.filter(token => hasMeaningSelection(token)).length;
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:areAllTokensTagged',message:'Checked all tokens',data:{subtitleId:subtitle.id,tokenCount:tokens.length,taggedCount,untaggedCount:tokens.length - taggedCount,allTagged},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_SKIP'})}).catch(()=>{});
  // #endregion
  
  return allTagged;
}

/**
 * Navigate to first untagged token in current subtitle
 */
function navigateToFirstUntaggedToken(): void {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToFirstUntaggedToken',message:'Function entry',data:{hasCurrentSubtitle:!!currentSubtitle,subtitleId:currentSubtitle?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_NAV'})}).catch(()=>{});
  // #endregion
  
  if (!currentSubtitle) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToFirstUntaggedToken',message:'Early return - no current subtitle',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_NAV'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  const tokenIndex = findFirstUntaggedTokenIndex(currentSubtitle);
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToFirstUntaggedToken',message:'Found untagged token index',data:{tokenIndex,subtitleId:currentSubtitle.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_NAV'})}).catch(()=>{});
  // #endregion
  
  if (tokenIndex === null) {
    // All tokens are tagged, unpause and clear selection
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToFirstUntaggedToken',message:'All tokens tagged - unpausing',data:{subtitleId:currentSubtitle.id,videoPaused:videoElement?.paused},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_CONTINUE'})}).catch(()=>{});
    // #endregion
    if (videoElement && videoElement.paused) {
      videoElement.play();
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToFirstUntaggedToken',message:'Video unpaused',data:{subtitleId:currentSubtitle.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_CONTINUE'})}).catch(()=>{});
      // #endregion
    }
    isEditingMode = false;
    setSelectedToken(null, null, null);
    return;
  }
  
  const tokens = currentSubtitle.tokens_th!.tokens;
  const token = tokens[tokenIndex];
  const tokenText = typeof token === 'string' ? token : token.t;
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToFirstUntaggedToken',message:'Setting selected token',data:{tokenIndex,tokenText,subtitleId:currentSubtitle.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_NAV'})}).catch(()=>{});
  // #endregion
  setSelectedToken(tokenText, tokenIndex, currentSubtitle.id);
  isEditingMode = true;
  // Set flag to auto-select first meaning when meanings are fetched
  shouldAutoSelectFirstMeaning = true;
  
  // Check if meanings are already cached and auto-select immediately
  const key = `${currentSubtitle.id}_${tokenIndex}`;
  const cachedMeanings = meaningsByToken.get(key);
  if (cachedMeanings && cachedMeanings.length > 0) {
    // Meanings already cached, auto-select immediately
    shouldAutoSelectFirstMeaning = false;
    const firstMeaning = cachedMeanings[0];
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToFirstUntaggedToken',message:'Auto-selecting first meaning from cache',data:{tokenIndex,meaningId:firstMeaning.id.toString(),meaningCount:cachedMeanings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_SELECT'})}).catch(()=>{});
    // #endregion
    handleMeaningSelect(tokenIndex, firstMeaning.id);
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToFirstUntaggedToken',message:'Editing mode enabled, auto-select flag set',data:{tokenIndex,isEditingMode,shouldAutoSelectFirstMeaning,hasCachedMeanings:!!cachedMeanings},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_NAV'})}).catch(()=>{});
  // #endregion
}

/**
 * Navigate to next untagged token after current selection
 */
function navigateToNextUntaggedToken(): void {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'Function entry',data:{hasCurrentSubtitle:!!currentSubtitle,selectedTokenIndex,subtitleId:currentSubtitle?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_NAV'})}).catch(()=>{});
  // #endregion
  
  if (!currentSubtitle || selectedTokenIndex === null) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'Early return - no subtitle or token index',data:{hasCurrentSubtitle:!!currentSubtitle,selectedTokenIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_NAV'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  const nextIndex = findNextUntaggedTokenIndex(currentSubtitle, selectedTokenIndex);
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'Found next untagged token',data:{currentIndex:selectedTokenIndex,nextIndex,subtitleId:currentSubtitle.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_NAV'})}).catch(()=>{});
  // #endregion
  
  if (nextIndex === null) {
    // All tokens are tagged, unpause and clear selection
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'All tokens tagged - unpausing',data:{subtitleId:currentSubtitle.id,videoPaused:videoElement?.paused},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_CONTINUE'})}).catch(()=>{});
    // #endregion
    if (videoElement && videoElement.paused) {
      videoElement.play();
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'Video unpaused',data:{subtitleId:currentSubtitle.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_CONTINUE'})}).catch(()=>{});
      // #endregion
    }
    isEditingMode = false;
    setSelectedToken(null, null, null);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'Editing mode disabled',data:{isEditingMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_CONTINUE'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  const tokens = currentSubtitle.tokens_th!.tokens;
  const token = tokens[nextIndex];
  const tokenText = typeof token === 'string' ? token : token.t;
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'Setting next selected token',data:{currentIndex:selectedTokenIndex,nextIndex,tokenText,subtitleId:currentSubtitle.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'TOKEN_NAV'})}).catch(()=>{});
  // #endregion
  setSelectedToken(tokenText, nextIndex, currentSubtitle.id);
}

/**
 * Check if video time has crossed end_sec_th and handle pause/navigation
 * Only pauses if not all tokens are tagged
 */
function checkAndHandleEndTime(currentTime: number): void {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:checkAndHandleEndTime',message:'Function entry',data:{currentTime,hasCurrentSubtitle:!!currentSubtitle,hasVideoElement:!!videoElement,isEditingMode},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_PAUSE'})}).catch(()=>{});
  // #endregion
  
  if (!currentSubtitle || !videoElement) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:checkAndHandleEndTime',message:'Early return - no subtitle or video',data:{currentTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_PAUSE'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  const endTime = currentSubtitle.end_sec_th;
  if (endTime === undefined || endTime === null) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:checkAndHandleEndTime',message:'No end_sec_th',data:{currentTime,subtitleId:currentSubtitle.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_PAUSE'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:checkAndHandleEndTime',message:'Checking end time',data:{currentTime,endTime,timeDiff:currentTime - endTime,isPastEnd:currentTime >= endTime,isEditingMode,videoPaused:videoElement.paused},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_PAUSE'})}).catch(()=>{});
  // #endregion
  
  // Check if we've crossed the end time
  if (currentTime >= endTime && !isEditingMode) {
    // Only pause if not all tokens are tagged
    const allTagged = areAllTokensTagged(currentSubtitle);
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:checkAndHandleEndTime',message:'End time crossed - checking if all tokens tagged',data:{currentTime,endTime,subtitleId:currentSubtitle.id,allTagged},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_PAUSE'})}).catch(()=>{});
    // #endregion
    
    if (!allTagged) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:checkAndHandleEndTime',message:'End time crossed - pausing and navigating',data:{currentTime,endTime,subtitleId:currentSubtitle.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_PAUSE'})}).catch(()=>{});
      // #endregion
      // Pause video if not already paused
      if (!videoElement.paused) {
        videoElement.pause();
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:checkAndHandleEndTime',message:'Video paused',data:{currentTime,endTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_PAUSE'})}).catch(()=>{});
        // #endregion
      }
      // Navigate to first untagged token (which will auto-select first meaning)
      navigateToFirstUntaggedToken();
    }
  }
}

/**
 * Setup video event listeners for subtitle timing
 */
function setupVideoEvents(video: HTMLVideoElement): void {
  // Remove old listeners
  if (videoTimeHandler && videoElement) {
    videoElement.removeEventListener('timeupdate', videoTimeHandler);
    videoElement.removeEventListener('seeked', videoTimeHandler);
    videoElement.removeEventListener('play', videoTimeHandler);
    videoElement.removeEventListener('pause', videoTimeHandler);
    videoElement.removeEventListener('loadeddata', videoTimeHandler);
  }
  if (videoPlayHandler && videoElement) {
    videoElement.removeEventListener('play', videoPlayHandler);
  }
  
  videoElement = video;
  
  // Pause video by default when first detected
  if (!hasInitialPause && !video.paused) {
    try {
      video.pause();
      hasInitialPause = true;
    } catch (error) {
      console.warn('[SubtitleDisplay] Could not pause video initially:', error);
    }
  }
  
  const handleTimeUpdate = () => {
    if (subtitles.length > 0 && video.currentTime !== null && !isNaN(video.currentTime)) {
      const currentTime = video.currentTime;
      const newSubtitle = findCurrentSubtitle(currentTime);
      if (newSubtitle?.id !== currentSubtitle?.id) {
        currentSubtitle = newSubtitle;
        // Update current subtitle ID for timeline navigation
        setCurrentSubtitleId(newSubtitle?.id || null);
        updateSubtitleDisplay();
        // Reset editing mode when subtitle changes
        if (isEditingMode) {
          isEditingMode = false;
          setSelectedToken(null, null, null);
        }
      }
      // Check for end_sec_th pause trigger
      checkAndHandleEndTime(currentTime);
    }
  };
  
  // Handle manual unpause - exit editing mode
  const handlePlay = () => {
    if (isEditingMode && video && !video.paused) {
      // User manually unpaused, exit editing mode
      isEditingMode = false;
      setSelectedToken(null, null, null);
    }
  };
  
  video.addEventListener('timeupdate', handleTimeUpdate);
  video.addEventListener('seeked', handleTimeUpdate);
  video.addEventListener('play', handleTimeUpdate);
  video.addEventListener('play', handlePlay);
  video.addEventListener('pause', handleTimeUpdate);
  video.addEventListener('loadeddata', handleTimeUpdate);
  videoTimeHandler = handleTimeUpdate;
  videoPlayHandler = handlePlay;
  
  // Initial update if video already has time
  if (video.currentTime !== null && !isNaN(video.currentTime) && subtitles.length > 0) {
    const newSubtitle = findCurrentSubtitle(video.currentTime);
    if (newSubtitle?.id !== currentSubtitle?.id) {
      currentSubtitle = newSubtitle;
      // Update current subtitle ID for timeline navigation
      setCurrentSubtitleId(newSubtitle?.id || null);
      updateSubtitleDisplay();
    }
  }
}

/**
 * Load subtitles and start displaying
 */
function loadSubtitles(newSubtitles: SubtitleTh[]): void {
  subtitles = newSubtitles;
  // Update subtitle cache for timeline navigation
  setSubtitleCache(newSubtitles);
  
  if (videoElement && subtitles.length > 0) {
    const newSubtitle = findCurrentSubtitle(videoElement.currentTime);
    currentSubtitle = newSubtitle;
    // Update current subtitle ID for timeline navigation
    setCurrentSubtitleId(newSubtitle?.id || null);
    updateSubtitleDisplay();
  } else {
    currentSubtitle = null;
    setCurrentSubtitleId(null);
    displayText = '';
    renderSubArea();
  }
}

/**
 * Find Netflix video player container
 */
function findVideoContainer(): { container: HTMLElement | null; video: HTMLVideoElement | null } {
  const video = document.querySelector('video') as HTMLVideoElement;
  if (!video) {
    return { container: null, video: null };
  }
  
  let container = video.parentElement;
  let depth = 0;
  let bestContainer: HTMLElement | null = null;
  let bestContainerScore = 0;

  while (container && depth < 15 && container !== document.body) {
    const rect = container.getBoundingClientRect();
    const className = container.className || '';
    const classStr = typeof className === 'string' ? className : String(className);
    
    const isNetflixPlayerContainer = 
      classStr.includes('watch-video') ||
      classStr.includes('player-view') ||
      classStr.includes('video-player');
    
    const playButton = container.querySelector('[data-uia*="control"]') ||
                      container.querySelector('[aria-label*="Play"]') ||
                      container.querySelector('button[aria-label*="play"]');
    const timeline = container.querySelector('[data-uia*="progress"]') ||
                    container.querySelector('[class*="progress-bar"]') ||
                    container.querySelector('[class*="timeline"]');
    const containerHasControls = !!(playButton || timeline);
    
    const widthMatch = Math.min(rect.width / window.innerWidth, window.innerWidth / rect.width);
    const heightMatch = Math.min(rect.height / window.innerHeight, window.innerHeight / rect.height);
    const sizeScore = (widthMatch + heightMatch) / 2;
    
    const netflixContainerBonus = isNetflixPlayerContainer ? 0.5 : 0;
    const controlsBonus = containerHasControls ? 0.3 : 0;
    
    const hasInlineStyles = container.style.width || container.style.height || container.style.maxWidth || container.style.maxHeight;
    const score = (sizeScore + netflixContainerBonus + controlsBonus) * (hasInlineStyles ? 0.5 : 1.0);
    
    if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.3) {
      if (score > bestContainerScore) {
        bestContainer = container;
        bestContainerScore = score;
      }
    }
    container = container.parentElement;
    depth++;
  }

  if (bestContainer) {
    const bestRect = bestContainer.getBoundingClientRect();
    console.log('[SubtitleDisplay] findVideoContainer: Found best container', {
      className: bestContainer.className,
      rect: { width: bestRect.width, height: bestRect.height, top: bestRect.top, left: bestRect.left },
      score: bestContainerScore
    });
    return { container: bestContainer, video };
  }
  
  const fallbackRect = video.parentElement?.getBoundingClientRect();
  console.log('[SubtitleDisplay] findVideoContainer: Using fallback container (video parent)', {
    rect: fallbackRect ? { width: fallbackRect.width, height: fallbackRect.height, top: fallbackRect.top, left: fallbackRect.left } : null
  });
  return { container: video.parentElement, video };
}

/**
 * Initialize layout system for subtitle display
 */
async function initializeLayoutSystem(video: HTMLVideoElement): Promise<boolean> {
  try {
    cleanupLayoutSystem();
    
    const { container, video: foundVideo } = findVideoContainer();
    if (!container || !foundVideo) {
      console.error('[SubtitleDisplay] initializeLayoutSystem: No container or video found');
      return false;
    }
    
    console.log('[SubtitleDisplay] initializeLayoutSystem: Container and video found');
    
    // Create rectangles ONCE (reuse if already exist)
    const rectangles = createRectangles();
    bottomRect = rectangles.bottom;
    rightRect = rectangles.right;
    
    // Create React roots ONCE (reuse if already exist)
    if (!subtitleDisplayAreaRoot) {
      subtitleDisplayAreaRoot = createRoot(bottomRect);
    }
    if (!additionalInformationAreaRoot) {
      additionalInformationAreaRoot = createRoot(rightRect);
    }
    
    // Initial render
    renderSubArea();
    renderTokenArea();
    
    // Setup video events
    setupVideoEvents(foundVideo);

    // Setup arrow key navigation
    setupArrowKeyNavigation();
    setupNumberKeySelection(handleNumberKeySelection);

    const mediaId = getMediaIdFromUrl(window.location.href);
    if (mediaId) {
      fetchSubtitles(mediaId)
        .then(newSubtitles => {
          if (newSubtitles.length > 0) {
            loadSubtitles(newSubtitles);
          }
        })
        .catch(() => {});
    }

    // Wait for video to have real dimensions
    let retryCount = 0;
    const maxRetries = 10;
    
    while ((foundVideo.videoWidth === 0 || foundVideo.videoHeight === 0) && retryCount < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 200));
      retryCount++;
    }
    
    if (foundVideo.videoWidth === 0 || foundVideo.videoHeight === 0) {
      console.error('[SubtitleDisplay] initializeLayoutSystem: Video size not ready after retries');
      return false;
    }
    
    console.log('[SubtitleDisplay] initializeLayoutSystem: Video size ready, setting up layout');
    
    // Store references for layout updates
    videoContainer = container;
    videoElement = foundVideo;
    
    // Debug: Log computed styles to verify borders and z-index
    setTimeout(() => {
      if (bottomRect) {
        debugElementStyles(bottomRect, 'SubArea');
      }
      if (rightRect) {
        debugElementStyles(rightRect, 'TokenArea');
      }
    }, 100);
    
    // Update layout function - sets geometry of rectangles and video container
    const updateLayout = () => {
      if (!videoContainer || !videoElement || !bottomRect || !rightRect) return;
      
      // Set rectangle geometry (numbers only)
      setRectangleGeometry(videoElement, videoContainer);
      
      // Update video container geometry (separate concern)
      const { netflix } = getLayoutDimensions(videoElement, videoContainer);
      videoContainer.style.setProperty('position', 'fixed', 'important');
      videoContainer.style.setProperty('left', '0', 'important');
      videoContainer.style.setProperty('top', `${netflix.top}px`, 'important');
      videoContainer.style.setProperty('width', `${netflix.width}px`, 'important');
      videoContainer.style.setProperty('height', `${netflix.height}px`, 'important');
      videoContainer.style.setProperty('margin', '0', 'important');
      videoContainer.style.setProperty('transform', 'none', 'important');
      videoContainer.style.setProperty('overflow', 'visible', 'important');
      videoContainer.style.setProperty('clip-path', 'none', 'important');
      
      if (videoElement) {
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
        videoElement.style.objectFit = 'contain';
        videoElement.style.objectPosition = 'center';
      }
      
      // Trigger React re-renders (geometry handled by DOM, React just renders content)
      renderSubArea();
      renderTokenArea();
    };
    
    // Set up resize observer
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateLayout();
      });
      resizeObserver.observe(container);
      resizeObserver.observe(document.documentElement);
    }

    window.addEventListener('resize', () => {
      updateLayout();
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        updateLayout();
      });
    }

    // Initial layout
    updateLayout();
    console.log('[SubtitleDisplay] initializeLayoutSystem: Layout applied successfully');

    return true;
  } catch (error) {
    console.error('[SubtitleDisplay] initializeLayoutSystem: Error', error);
    return false;
  }
}

/**
 * Clean up layout system
 */
function cleanupLayoutSystem(): void {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  
  // Cleanup video event listeners
  if (videoTimeHandler && videoElement) {
    videoElement.removeEventListener('timeupdate', videoTimeHandler);
    videoElement.removeEventListener('seeked', videoTimeHandler);
    videoElement.removeEventListener('play', videoTimeHandler);
    videoElement.removeEventListener('pause', videoTimeHandler);
    videoElement.removeEventListener('loadeddata', videoTimeHandler);
    videoTimeHandler = null;
  }
  
  // Cancel in-flight async operations
  if (updateAbortController) {
    updateAbortController.abort();
    updateAbortController = null;
  }
  
  // DO NOT unmount React roots (rule 5: mount once, reuse)
  // DO NOT remove rectangles (rule 4: never recreate)
  
  // Remove arrow key navigation
  removeArrowKeyNavigation();
  
  // Clear state references (but keep DOM elements and React roots)
  videoContainer = null;
  videoElement = null;
  
  // Reset subtitle state
  currentSubtitle = null;
  setCurrentSubtitleId(null);
  displayText = '';
  displayMode = 'tokens';
  subtitles = [];
  setSubtitleCache([]);
  selectedToken = null;
}

/**
 * Full teardown (only called when extension is fully disabled)
 */
function fullTeardown(): void {
  cleanupLayoutSystem();
  
  // Only now unmount React roots (full extension disable)
  if (subtitleDisplayAreaRoot) {
    subtitleDisplayAreaRoot.unmount();
    subtitleDisplayAreaRoot = null;
  }
  if (additionalInformationAreaRoot) {
    additionalInformationAreaRoot.unmount();
    additionalInformationAreaRoot = null;
  }
  
  // Only now remove rectangles (full extension disable)
  removeRectangles();
  bottomRect = null;
  rightRect = null;
}


/**
 * Wait for video to be ready before extraction
 * Ensures video element exists, has loaded metadata, and Netflix API is available
 * @returns {Promise<void>} Resolves when video is ready, rejects on timeout
 */
async function waitForVideoReady(): Promise<void> {
  const maxWaitTime = 30000; // 30 seconds max wait
  const startTime = Date.now();
  
  // Wait for video element to exist
  while (!document.querySelector('video')) {
    if (Date.now() - startTime > maxWaitTime) {
      throw new Error('Video element not found after 30 seconds');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const video = document.querySelector('video') as HTMLVideoElement;
  
  // Wait for video readyState >= 2 (loadedmetadata)
  if (video.readyState < 2) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        video.removeEventListener('loadedmetadata', checkReady);
        if (video.readyState < 2) {
          reject(new Error('Video metadata not loaded after 10 seconds'));
        } else {
          resolve();
        }
      }, 10000);
      
      const checkReady = () => {
        if (video.readyState >= 2) {
          clearTimeout(timeout);
          video.removeEventListener('loadedmetadata', checkReady);
          resolve();
        }
      };
      
      video.addEventListener('loadedmetadata', checkReady);
    });
  }
  
  // Wait for Netflix API to be available (check in page context via injection)
  // We'll check this when we inject the script, but also wait a bit for Netflix to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Initialize layout system (always initialize, even without subtitles)
  const layoutInitSuccess = await initializeLayoutSystem(video);
}

async function extractAndSave() {
  if (isExtracting) {
    return;
  }

  isExtracting = true;

  try {
    // Extract episode metadata (returns Episode with Zod field names directly)
    const episode = extractEpisodeFromNetflixPage();
    if (!episode) {
      isExtracting = false;
      return;
    }

    // Wait for video to be ready before attempting VTT extraction
    await waitForVideoReady();

    // Extract Thai VTT file
    const thaiVTT = await fetchThaiVTTContent(episode.media_id);
    
    if (!thaiVTT) {
      throw new Error('Could not extract Thai VTT files - extraction failed');
    }

    // Parse Thai VTT file (returns SubtitleTh[] with Zod field names directly)
    const subtitles = await parseVTTFile(
      thaiVTT,
      episode.media_id
    );

    // Save episode (already validated with episodeSchema)
    await saveEpisode(episode);

    // Save subtitles in batch (preserve existing tokens)
    await saveSubtitlesBatch(subtitles, true);

    // Load subtitles into display system
    loadSubtitles(subtitles);
    
    // Recalculate layout now that areas will be visible
    if (videoContainer && videoElement && bottomRect && rightRect) {
      // Set rectangle geometry (numbers only)
      setRectangleGeometry(videoElement, videoContainer);
      
      // Update video container geometry (separate concern)
      const { netflix } = getLayoutDimensions(videoElement, videoContainer);
      videoContainer.style.setProperty('width', `${netflix.width}px`, 'important');
      videoContainer.style.setProperty('height', `${netflix.height}px`, 'important');
      videoContainer.style.setProperty('top', `${netflix.top}px`, 'important');
      
      // Trigger re-render of TSX components
      renderSubArea();
      renderTokenArea();
    }

    // Notify background script
    chrome.runtime.sendMessage({
      type: 'EXTRACT_COMPLETE',
      data: {
        mediaId: episode.media_id,
        episodeCount: 1,
        subtitleCount: subtitles.length,
      },
    }).catch(() => {});
  } catch (error) {
    // Extraction error - no logging needed
  } finally {
    isExtracting = false;
  }
}

// Wait for page to be ready - Auto-initialize layout system when video loads
async function waitForPageReady() {
  // Only initialize layout on watch pages
  if (!window.location.pathname.includes('/watch/')) {
    return;
  }
  
  // Wait for video and initialize layout system automatically
  try {
    await waitForVideoReady();
  } catch (error) {
    // Video ready failed - no logging needed
  }
}

// Track if layout system is initialized
let isLayoutInitialized = false;
let isInitializing = false; // Guard against concurrent initialization

// Check and mount layout system (based on SmartSubs approach)
function checkAndMount() {
  const urlMatch = window.location.pathname.match(/\/watch\/(\d+)/);
  const isVideoPage = !!urlMatch;
  const videoElement = document.querySelector('video');
  
  if (isVideoPage && videoElement && !isLayoutInitialized && !isInitializing) {
    isInitializing = true;
    waitForPageReady().then(() => {
      isLayoutInitialized = true;
      isInitializing = false;
    }).catch(() => {
      isInitializing = false;
      // Layout initialization failed
    });
  } else if (!isVideoPage && isLayoutInitialized) {
    cleanupLayoutSystem();
    isLayoutInitialized = false;
    isInitializing = false;
  }
}

// Initialize function (based on SmartSubs approach)
function initialize() {
  if (document.body) {
    // Inject CSS styles
    if (window.location.hostname.includes('netflix.com')) {
      injectStyles();
    }
    
    // Initial check
    checkAndMount();
    
    // Watch for video element appearance with MutationObserver
    const observer = new MutationObserver(() => {
      checkAndMount();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Watch for URL changes (SPA navigation) - setInterval approach from SmartSubs
    let lastUrl = window.location.href;
    const urlCheckInterval = setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        checkAndMount();
      }
    }, 100);
    
    // Also listen to popstate events (browser back/forward)
    window.addEventListener('popstate', checkAndMount);
    
    // Intercept pushState/replaceState for SPA navigation (SmartSubs approach)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      setTimeout(checkAndMount, 0);
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      setTimeout(checkAndMount, 0);
    };
  } else {
    // Wait for DOMContentLoaded if body doesn't exist yet
    document.addEventListener('DOMContentLoaded', () => {
      initialize();
    });
  }
}

// Start initialization
initialize();

// Listen for manual trigger from popup or button
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'INJECT_SUBTITLE_SCRIPT') {
    // Inject subtitle script on demand
    injectNetflixSubtitleScript().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (message.type === 'EXTRACT_NOW') {
    extractAndSave().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (message.type === 'LOAD_SUBTITLES') {
      // Load subtitles from Supabase for display
      if (message.subtitles) {
        loadSubtitles(message.subtitles);
        if (videoContainer && videoElement && bottomRect && rightRect) {
          // Set rectangle geometry (numbers only)
          setRectangleGeometry(videoElement, videoContainer);
          
          // Update video container geometry (separate concern)
          const { netflix } = getLayoutDimensions(videoElement, videoContainer);
          videoContainer.style.setProperty('width', `${netflix.width}px`, 'important');
          videoContainer.style.setProperty('height', `${netflix.height}px`, 'important');
          videoContainer.style.setProperty('top', `${netflix.top}px`, 'important');
          
          // Trigger re-render of TSX components
          renderSubArea();
          renderTokenArea();
        }
        sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Subtitles not available' });
    }
    return true;
  }
});
