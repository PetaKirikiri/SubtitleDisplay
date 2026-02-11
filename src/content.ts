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
import { saveEpisode, saveSubtitlesBatch } from './services/supabaseClient';
import { getSubtitles } from './hooks/useSubtitles';
import { parseVTTFile } from '@/services/vtt/vttParser';
import { getLayoutDimensions, createRectangles, setRectangleGeometry, removeRectangles } from './layoutCalculations';
import { SubArea } from './components/subarea/subarea';
import { TokenArea } from './components/tokenarea/tokenarea';
import type { DisplayMode } from './types/display';
import type { SubtitleTh } from '@/schemas/subtitleThSchema';
import { initializeTimelineHotkeys, cleanupTimelineHotkeys } from './services/timelineNavigation/hotkeys-navigation';
import { initializeMeaningHotkeys, cleanupMeaningHotkeys } from './components/tokenarea/helpers/hotkeys-meaning';
import { setSubtitleCache, setCurrentSubtitleId, setMostRecentlyDisplayedSubtitleId, getSubtitleById, findCurrentSubtitleByTime } from './services/cache/subtitleNavigation';
import { handleTokenNavigation } from './components/subarea/helpers/handleTokenNavigation';
import { unpause, getCurrentTime as getNetflixCurrentTime, pause } from './services/timelineNavigation';
import type { MeaningTh } from '@/schemas/meaningThSchema';
import { setMeaningsForToken } from './components/tokenarea/helpers/subtitleMeaningsCache';
import { handleManualUnpause } from './services/video/handleManualUnpause';
import { fetchMeaningsByIds, fetchMeaningById } from './supabase';

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

// Selected token state for meanings display
let selectedToken: string | null = null;
let selectedTokenIndex: number | null = null;
let selectedSubtitleId: string | null = null;

// Meanings state for number key selection
// Maps "subtitleId_tokenIndex" to meanings array
let meaningsByToken: Map<string, MeaningTh[]> = new Map();

// Cache for meaning labels (meaning_id -> label_eng)
// Preloaded when subtitles are loaded
let meaningLabelsCache: Map<string, string> = new Map();

/**
 * Update meaning labels cache with a single meaning
 * Called when a meaning is selected, updated, or created
 */
async function updateMeaningLabelCache(meaningId: bigint): Promise<void> {
  try {
    const meaning = await fetchMeaningById(meaningId);
    if (meaning && meaning.label_eng) {
      meaningLabelsCache.set(meaning.id.toString(), meaning.label_eng);
      // Re-render SubArea to show updated label
      renderSubArea();
    }
  } catch (error) {
    console.error(`[updateMeaningLabelCache] Failed to fetch meaning ${meaningId.toString()}:`, error);
  }
}

// Flag to prevent time-based subtitle changes immediately after hotkey navigation
let isHotkeyNavigationActive = false;
let hotkeyNavigationTimeout: ReturnType<typeof setTimeout> | null = null;

// Editing state - tracks if we're in editing mode (paused for token tagging)
let isEditingMode: boolean = false;

// Video control state
let hasInitialPause: boolean = false;
let hasTokensShown: boolean = false;


// Auto-select state - tracks if we should auto-select first meaning when meanings are fetched
let shouldAutoSelectFirstMeaning: boolean = false;

// Subtitle editor toggle state - controls whether to show SubtitleEditor or meaning selection in TokenArea
let showSubtitleEditor: boolean = false;

/**
 * Toggle between SubtitleEditor and meaning selection views in TokenArea
 */
function toggleSubtitleEditor(): void {
  showSubtitleEditor = !showSubtitleEditor;
  renderTokenArea();
}

function setSelectedToken(token: string | null, index: number | null = null, subtitleId: string | null = null): void {
  // #region agent log
  const stackTrace = new Error().stack;
  const callerLocation = stackTrace?.split('\n')[2]?.trim() || 'unknown';
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:setSelectedToken',message:'SET_SELECTED_TOKEN_CALLED',data:{callerLocation,token,index,subtitleId,previousIndex:selectedTokenIndex,previousSubtitleId:selectedSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
  selectedToken = token;
  selectedTokenIndex = index;
  selectedSubtitleId = subtitleId;
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:setSelectedToken',message:'BEFORE_RENDER_CALLS',data:{token,index,subtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
  renderSubArea();
  renderTokenArea();
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:setSelectedToken',message:'AFTER_RENDER_CALLS',data:{token,index,subtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
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
 * Mount subtitle - sets state/data correctly from cache/DB
 * This is the ONLY place where subtitle state is set for display
 * SubArea component reactively reads this state and applies Tailwind classes
 */
async function mountSubtitle(
  subtitle: SubtitleTh | null,
  mode: DisplayMode,
  video: HTMLVideoElement | null
): Promise<void> {
  // #region agent log
  const stackTrace = new Error().stack;
  const callerLocation = stackTrace?.split('\n')[2]?.trim() || 'unknown';
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'MOUNT_SUBTITLE_CALLED',data:{callerLocation,subtitleId:subtitle?.id,displayMode:mode},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
  // #endregion

  if (!subtitle) {
    currentSubtitle = null;
    displayText = '';
    renderSubArea();
    return;
  }

  // CRITICAL: Cache is source of truth - ALWAYS get subtitle from cache before mount
  const subtitleFromCache = subtitle.id ? getSubtitleById(subtitle.id) : null;
  const subtitleToUse = subtitleFromCache || subtitle;
  
  // Reset selected token state when subtitle changes
  const subtitleChanged = currentSubtitle?.id !== subtitleToUse.id;
  if (subtitleChanged) {
    selectedToken = null;
    selectedTokenIndex = null;
    selectedSubtitleId = null;
    // Clear TokenArea display when subtitle changes (will be re-rendered at end of mountSubtitle)
  }
  
  // #region agent log - Log token meaning_id states BEFORE mount (this is the state being set)
  const tokenMeaningIds = subtitleToUse?.tokens_th?.tokens?.map((t, idx) => {
    if (typeof t === 'object' && t !== null && 'meaning_id' in t) {
      return { 
        index: idx, 
        meaningId: (t as any).meaning_id?.toString() || null,
        tokenText: typeof t === 'object' && 't' in t ? t.t : String(t)
      };
    }
    return { 
      index: idx, 
      meaningId: null,
      tokenText: typeof t === 'string' ? t : (typeof t === 'object' && 't' in t ? t.t : String(t))
    };
  }) || [];
  const meaningIdCount = tokenMeaningIds.filter(t => t.meaningId !== null).length;
  const tokensWithMeaning = tokenMeaningIds.filter(t => t.meaningId !== null);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'MOUNT_SUBTITLE - State being set',data:{subtitleId:subtitleToUse.id,fromCache:!!subtitleFromCache,tokenCount:tokenMeaningIds.length,meaningIdCount,tokensWithMeaning,allTokenMeaningIds:tokenMeaningIds},timestamp:Date.now(),runId:'run1',hypothesisId:'MOUNT'})}).catch(()=>{});
  // #endregion

  // Set currentSubtitle (this is the state SubArea will read)
  currentSubtitle = subtitleToUse;
  setMostRecentlyDisplayedSubtitleId(subtitleToUse.id);

  // Extract tokens array - this is what SubArea will read reactively
  const tokens = subtitleToUse?.tokens_th?.tokens;
  
  // #region agent log - Verify tokens array has meaning_id values set correctly
  const extractedTokenMeaningIds = tokens?.map((t, idx) => {
    if (typeof t === 'object' && t !== null && 'meaning_id' in t) {
      return { index: idx, meaningId: (t as any).meaning_id?.toString() || null };
    }
    return { index: idx, meaningId: null };
  }) || [];
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'MOUNT_SUBTITLE - Tokens array extracted',data:{subtitleId:subtitleToUse.id,tokenCount:tokens?.length || 0,extractedTokenMeaningIds},timestamp:Date.now(),runId:'run1',hypothesisId:'MOUNT'})}).catch(()=>{});
  // #endregion


  // Handle auto-unpause logic - unpause if tokens are now visible for the first time
  if (video && !hasTokensShown && subtitleToUse?.tokens_th?.tokens && subtitleToUse.tokens_th.tokens.length > 0) {
    unpause(video);
    hasTokensShown = true;
  }
  
  // Track that tokens have been shown
  if (subtitleToUse?.tokens_th?.tokens && subtitleToUse.tokens_th.tokens.length > 0) {
    hasTokensShown = true;
  }

  // Set displayText for non-tokens modes (tokens mode passes tokens array directly to SubArea)
  if (mode === 'thai') {
    displayText = subtitleToUse.thai || '';
  } else if (mode === 'phonetics') {
    // For phonetics, we'd need async lookup - for now just use tokens text
    // This can be enhanced later if needed
    if (tokens && Array.isArray(tokens)) {
      displayText = tokens.map(t => typeof t === 'string' ? t : t.t).join(' ');
    } else {
      displayText = '';
    }
  } else {
    // tokens mode - displayText not used, tokens passed directly
    displayText = '';
  }

  // #region agent log - Mount complete
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'MOUNT_SUBTITLE - Complete',data:{subtitleId:subtitleToUse.id,displayMode:mode,displayTextLength:displayText.length,tokenCount:tokens?.length || 0},timestamp:Date.now(),runId:'run1',hypothesisId:'MOUNT'})}).catch(()=>{});
  // #endregion

  // Render SubArea - it will read state and apply Tailwind classes reactively
  renderSubArea();
  // Also render TokenArea to ensure SubtitleEditor gets updated currentSubtitle
  renderTokenArea();
}

/**
 * Render SubArea component with current state
 * CRITICAL: currentSubtitle should already be refreshed from cache at assignment points
 * This function should receive subtitle with correct meaning_id values from the start
 */
function renderSubArea(): void {
  // #region agent log
  const stackTrace = new Error().stack;
  const callerLocation = stackTrace?.split('\n')[2]?.trim() || 'unknown';
  const tokenMeaningIds = currentSubtitle?.tokens_th?.tokens?.map((t, idx) => {
    if (typeof t === 'object' && t !== null && 'meaning_id' in t) {
      return { index: idx, meaningId: (t as any).meaning_id?.toString() || null };
    }
    return { index: idx, meaningId: null };
  }) || [];
  // Verify cache matches - if not, log warning (should not happen after fix)
  const cacheSubtitle = currentSubtitle?.id ? getSubtitleById(currentSubtitle.id) : null;
  const cacheTokenMeaningIds = cacheSubtitle?.tokens_th?.tokens?.map((t, idx) => {
    if (typeof t === 'object' && t !== null && 'meaning_id' in t) {
      return { index: idx, meaningId: (t as any).meaning_id?.toString() || null };
    }
    return { index: idx, meaningId: null };
  }) || [];
  const isStale = cacheSubtitle && JSON.stringify(tokenMeaningIds) !== JSON.stringify(cacheTokenMeaningIds);
  if (isStale) {
    // Refresh from cache if stale (should not happen after fix, but safety net)
    currentSubtitle = cacheSubtitle;
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:renderSubArea',message:'STALE_SUBTITLE_DETECTED_REFRESHED',data:{callerLocation,subtitleId:currentSubtitle?.id,wasStale:true},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
  }
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:renderSubArea',message:'RENDER_SUBAREA_CALLED',data:{callerLocation,subtitleId:currentSubtitle?.id,tokenCount:currentSubtitle?.tokens_th?.tokens?.length || 0,tokenMeaningIds:cacheSubtitle ? cacheTokenMeaningIds : tokenMeaningIds,displayMode,wasStale:isStale},timestamp:Date.now(),runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  
  // Extract tokens array when in tokens mode
  const tokens = displayMode === 'tokens' ? currentSubtitle?.tokens_th?.tokens : undefined;
  
  // #region agent log
  const extractedTokenMeaningIds = tokens?.map((t, idx) => {
    if (typeof t === 'object' && t !== null && 'meaning_id' in t) {
      return { index: idx, meaningId: (t as any).meaning_id?.toString() || null };
    }
    return { index: idx, meaningId: null };
  }) || [];
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:renderSubArea',message:'TOKENS_EXTRACTED_FOR_RENDER',data:{subtitleId:currentSubtitle?.id,tokenCount:tokens?.length || 0,extractedTokenMeaningIds},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  
  // Auto-select first untagged token if no selection exists for current subtitle
  // Only auto-select on initial render, not when user manually selects a token
  if (tokens && tokens.length > 0 && displayMode === 'tokens') {
    // Check if we need to auto-select first untagged token (only on initial render)
    const needsAutoSelect = selectedTokenIndex === null || 
                            selectedSubtitleId !== currentSubtitle?.id;
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:renderSubArea',message:'AUTO_SELECT_CHECK',data:{selectedTokenIndex,selectedSubtitleId,currentSubtitleId:currentSubtitle?.id,needsAutoSelect},timestamp:Date.now(),runId:'run1',hypothesisId:'H'})}).catch(()=>{});
    // #endregion
    
    if (needsAutoSelect) {
      // Find first token without meaning_id
      const firstUntaggedIndex = tokens.findIndex(token => {
        const hasMeaning = typeof token === 'object' && token !== null && 'meaning_id' in token
          ? token.meaning_id !== undefined && token.meaning_id !== null
          : false;
        return !hasMeaning;
      });
      
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:renderSubArea',message:'FIRST_UNTAGGED_FOUND',data:{firstUntaggedIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'H'})}).catch(()=>{});
      // #endregion
      
      if (firstUntaggedIndex !== -1) {
        const token = tokens[firstUntaggedIndex];
        const tokenText = typeof token === 'string' ? token : token.t;
        setSelectedToken(tokenText, firstUntaggedIndex, currentSubtitle?.id || null);
        // setSelectedToken already calls renderSubArea() and renderTokenArea(), so we can return early
        return;
      }
    }
  }
  
  const handleTokenClick = (index: number): void => {
    if (tokens && tokens[index]) {
      const tokenText = typeof tokens[index] === 'string' ? tokens[index] : tokens[index].t;
      setSelectedToken(tokenText, index, currentSubtitle?.id || null);
    }
  };
  
  if (subtitleDisplayAreaRoot && bottomRect) {
    subtitleDisplayAreaRoot.render(
      React.createElement(SubArea, {
        displayText,
        displayMode,
        onDisplayModeChange: (mode: DisplayMode) => {
          displayMode = mode;
          // Just re-render - SubArea reads same state/data and applies different Tailwind classes based on displayMode
          renderSubArea();
        },
        currentSubtitle,
        tokens, // Pass tokens directly
        onTokenClick: handleTokenClick,
        selectedTokenIndex,
        meaningLabels: meaningLabelsCache, // Pass preloaded meaning labels cache
      })
    );
  }
}

/**
 * Handle meaning selection for a token
 */
async function handleMeaningSelect(tokenIndex: number, meaningId: bigint): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'HOTKEY_MEANING_SELECT_ENTRY',data:{tokenIndex,meaningId:meaningId.toString(),selectedSubtitleId,hasHandler:!!(window as any).__tokenAreaSelectMeaning,isEditingMode},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // TokenArea component handles the save internally
  // Call the component's internal handler if available (for hotkeys)
  if ((window as any).__tokenAreaSelectMeaning) {
    await (window as any).__tokenAreaSelectMeaning(tokenIndex, meaningId);
  } else {
    console.warn('[Content] TokenArea meaning selection handler not available');
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'AFTER_TOKENAREA_SAVE',data:{tokenIndex,meaningId:meaningId.toString(),selectedSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // Refresh current subtitle from cache (TokenArea already updated it)
  if (!selectedSubtitleId) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'EARLY_RETURN_NO_SUBTITLE_ID',data:{tokenIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  const subtitleFromCache = getSubtitleById(selectedSubtitleId);
  // #region agent log
  const cacheTokenMeaningId = subtitleFromCache?.tokens_th?.tokens?.[tokenIndex] && typeof subtitleFromCache.tokens_th.tokens[tokenIndex] === 'object' && 'meaning_id' in subtitleFromCache.tokens_th.tokens[tokenIndex] ? (subtitleFromCache.tokens_th.tokens[tokenIndex] as any).meaning_id?.toString() : null;
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelect',message:'CACHE_CHECK_AFTER_SAVE',data:{tokenIndex,meaningId:meaningId.toString(),selectedSubtitleId,hasSubtitleFromCache:!!subtitleFromCache,cacheTokenMeaningId},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  if (subtitleFromCache) {
    currentSubtitle = subtitleFromCache;
    await mountSubtitle(currentSubtitle, displayMode, videoElement);
    renderTokenArea();
    
    // Auto-advance to next untagged token if in editing mode
    if (isEditingMode) {
      navigateToNextUntaggedToken();
    }
  }
}

async function handleMeaningSelectComplete(): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelectComplete',message:'MEANING_SELECT_COMPLETE_ENTRY',data:{selectedSubtitleId,selectedTokenIndex,isEditingMode},timestamp:Date.now(),runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  // Called after TokenArea completes meaning selection
  // Refresh current subtitle from cache
  if (!selectedSubtitleId) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelectComplete',message:'EARLY_RETURN_NO_SUBTITLE_ID',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  const subtitleFromCache = getSubtitleById(selectedSubtitleId);
  // #region agent log
  const cacheTokenMeaningId = subtitleFromCache?.tokens_th?.tokens?.[selectedTokenIndex ?? -1] && typeof subtitleFromCache.tokens_th.tokens[selectedTokenIndex ?? -1] === 'object' && 'meaning_id' in subtitleFromCache.tokens_th.tokens[selectedTokenIndex ?? -1] ? (subtitleFromCache.tokens_th.tokens[selectedTokenIndex ?? -1] as any).meaning_id?.toString() : null;
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelectComplete',message:'CACHE_CHECK_BEFORE_RENDER',data:{selectedSubtitleId,selectedTokenIndex,hasSubtitleFromCache:!!subtitleFromCache,cacheTokenMeaningId},timestamp:Date.now(),runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  if (subtitleFromCache) {
    // Update currentSubtitle to reflect the new meaning_id
    currentSubtitle = subtitleFromCache;
    // Re-render both areas to show updated state
    renderSubArea();
    renderTokenArea();
    
    // Check if current selected token now has a meaning_id
    // If so, auto-advance to next untagged token
    if (selectedTokenIndex !== null && selectedTokenIndex !== undefined) {
      const tokens = subtitleFromCache.tokens_th?.tokens;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelectComplete',message:'CHECKING_CURRENT_TOKEN_FOR_MEANING',data:{selectedTokenIndex,hasTokens:!!tokens,tokenCount:tokens?.length || 0},timestamp:Date.now(),runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      if (tokens && selectedTokenIndex < tokens.length) {
        const token = tokens[selectedTokenIndex];
        const hasMeaning = typeof token === 'object' && token !== null && 'meaning_id' in token
          ? token.meaning_id !== undefined && token.meaning_id !== null
          : false;
        
        // #region agent log
        const tokenMeaningId = typeof token === 'object' && token !== null && 'meaning_id' in token ? (token as any).meaning_id?.toString() : null;
        fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelectComplete',message:'CURRENT_TOKEN_MEANING_CHECK',data:{selectedTokenIndex,tokenMeaningId,hasMeaning},timestamp:Date.now(),runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        
        if (hasMeaning) {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelectComplete',message:'CALLING_NAVIGATE_NEXT_UNTAGGED',data:{selectedTokenIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'F'})}).catch(()=>{});
          // #endregion
          // Update meaning label cache for the newly assigned meaning
          const tokenMeaningId = typeof token === 'object' && token !== null && 'meaning_id' in token ? (token as any).meaning_id : null;
          if (tokenMeaningId !== null && tokenMeaningId !== undefined) {
            const meaningId = typeof tokenMeaningId === 'bigint' ? tokenMeaningId : BigInt(tokenMeaningId);
            updateMeaningLabelCache(meaningId);
          }
          // Current token now has meaning_id, move to next untagged token
          navigateToNextUntaggedToken();
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningSelectComplete',message:'SKIPPING_AUTO_ADVANCE_NO_MEANING',data:{selectedTokenIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
        }
      }
    }
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
    setMeaningsForToken(meaningsByToken, selectedSubtitleId, selectedTokenIndex, meanings);
    // #region agent log
    const key = `${selectedSubtitleId}_${selectedTokenIndex}`;
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningsFetched',message:'Meanings stored',data:{key,meaningCount:meanings.length,mapSize:meaningsByToken.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'HOTKEY'})}).catch(()=>{});
    // #endregion
    
    // Auto-select first meaning if flag is set and meanings were just fetched (not cached before)
    if (shouldAutoSelectFirstMeaning && meanings.length > 0) {
      shouldAutoSelectFirstMeaning = false;
      const firstMeaning = meanings[0];
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleMeaningsFetched',message:'Auto-selecting first meaning',data:{tokenIndex:selectedTokenIndex,meaningId:firstMeaning.id.toString(),meaningCount:meanings.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_SELECT'})}).catch(()=>{});
      // #endregion
      
      // Auto-select first meaning - trigger through TokenArea
      if (selectedTokenIndex !== null && selectedTokenIndex !== undefined && (window as any).__tokenAreaSelectMeaning) {
        (window as any).__tokenAreaSelectMeaning(selectedTokenIndex, firstMeaning.id).catch((error: Error) => {
          console.error('[Content] Failed to auto-select meaning:', error);
        });
      }
    }
  }
}


/**
 * Render TokenArea component
 * Extracts meaning_id from the selected token and passes it to TokenArea
 * so TokenArea knows which meaning is currently selected for highlighting
 */
function renderTokenArea(): void {
  if (additionalInformationAreaRoot && rightRect) {
    // CRITICAL: Always get latest subtitle from cache to ensure SubtitleEditor shows current subtitle
    const latestCurrentSubtitle = currentSubtitle?.id ? getSubtitleById(currentSubtitle.id) : currentSubtitle;
    
    // Use subtitle from cache that matches selectedSubtitleId
    // This ensures we get the latest updated subtitle with meaning_id after selection
    const subtitleForToken = selectedSubtitleId ? getSubtitleById(selectedSubtitleId) : null;
    
    // Extract token data directly - no helper function needed
    let tokenText: string | null = selectedToken;
    let meaningId: bigint | null = null;
    
    if (subtitleForToken?.tokens_th?.tokens && selectedTokenIndex !== null && selectedTokenIndex !== undefined && selectedTokenIndex >= 0) {
      const tokens = subtitleForToken.tokens_th.tokens;
      if (selectedTokenIndex < tokens.length) {
        const token = tokens[selectedTokenIndex];
        tokenText = typeof token === 'string' ? token : token.t;
        // Extract meaning_id from token - TokenArea uses this to highlight the matching meaning
        // TokenArea is purely reactive - it receives meaning_id from the token, doesn't ask for it
        if (typeof token === 'object' && token !== null && 'meaning_id' in token) {
          const extractedMeaningId = token.meaning_id;
          // #region agent log
          const meaningIdType = typeof extractedMeaningId;
          const meaningIdValue = extractedMeaningId?.toString() || null;
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:renderTokenArea',message:'EXTRACTING_MEANING_ID',data:{selectedTokenIndex,tokenText,meaningIdType,meaningIdValue,hasMeaningId:extractedMeaningId !== undefined && extractedMeaningId !== null},timestamp:Date.now(),runId:'run1',hypothesisId:'D'})}).catch(()=>{});
          // #endregion
          if (extractedMeaningId !== undefined && extractedMeaningId !== null) {
            // Convert to bigint to match meaning.id type (handles both number and bigint from DB)
            // This ensures the comparison meaning.id === selectedMeaningId works correctly
            meaningId = typeof extractedMeaningId === 'bigint' 
              ? extractedMeaningId 
              : BigInt(extractedMeaningId);
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:renderTokenArea',message:'CONVERTED_TO_BIGINT',data:{selectedTokenIndex,originalType:meaningIdType,convertedType:typeof meaningId,meaningIdValue:meaningId?.toString() || null},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
          }
        }
      }
    }
    
    // #region agent log
    const meaningIdType = typeof meaningId;
    const meaningIdValue = meaningId?.toString() || null;
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:renderTokenArea',message:'RENDER_TOKENAREA_EXTRACTED_MEANING_ID',data:{selectedSubtitleId,selectedTokenIndex,tokenText,meaningIdType,meaningIdValue,hasSubtitleForToken:!!subtitleForToken},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    additionalInformationAreaRoot.render(
      React.createElement(TokenArea, {
        selectedToken: tokenText,
        subtitleId: selectedSubtitleId,
        tokenIndex: selectedTokenIndex,
        selectedMeaningId: meaningId, // Pass meaning_id so TokenArea knows which meaning is selected
        subtitles: subtitles,
        currentSubtitle: latestCurrentSubtitle,
        onMeaningSelect: handleMeaningSelect, // For external calls (hotkeys)
        onMeaningSelectComplete: handleMeaningSelectComplete, // Called after save completes
        onMeaningsFetched: handleMeaningsFetched,
        onMeaningUpdate: async (updatedMeaning: MeaningTh) => {
          // Update meaning label cache when a meaning is updated
          if (updatedMeaning.label_eng) {
            meaningLabelsCache.set(updatedMeaning.id.toString(), updatedMeaning.label_eng);
          } else {
            // Remove from cache if label_eng was cleared
            meaningLabelsCache.delete(updatedMeaning.id.toString());
          }
          renderSubArea(); // Re-render to show updated label
        },
        showEditor: showSubtitleEditor,
        onToggleEditor: toggleSubtitleEditor,
        onSubtitleUpdate: (updatedSubtitle: SubtitleTh) => {
          // Update currentSubtitle from cache after subtitle edit
          const updatedFromCache = getSubtitleById(updatedSubtitle.id);
          if (updatedFromCache) {
            currentSubtitle = updatedFromCache;
          }
          renderSubArea();
          renderTokenArea();
        },
      })
    );
  }
}

/**
 * Check subtitle contract - determines if subtitle should pause at end_sec_th
 * Simplified contract: pause at end_sec_th if subtitle has tokens
 * 
 * @param subtitle - Subtitle to check (from cache)
 * @param currentTime - Current playback time
 * @returns true if video should pause, false otherwise
 */
function shouldPauseAtEndTime(subtitle: SubtitleTh | null, currentTime: number): boolean {
  if (!subtitle) {
    return false;
  }
  
  // CRITICAL: Cache is source of truth - refresh subtitle from cache
  const subtitleFromCache = subtitle.id ? getSubtitleById(subtitle.id) : null;
  const subtitleToUse = subtitleFromCache || subtitle;
  
  const endTime = subtitleToUse.end_sec_th;
  if (endTime === undefined || endTime === null) {
    return false; // No end time defined
  }
  
  // Check if we've reached end time
  if (currentTime < endTime) {
    return false; // Not at end time yet
  }
  
  // Check if subtitle has tokens
  const tokens = subtitleToUse.tokens_th?.tokens;
  if (!tokens || tokens.length === 0) {
    return false; // No tokens, no pause needed
  }
  
  // Pause at end_sec_th if subtitle has tokens
  return true;
}


/**
 * Update subtitle display text based on current subtitle and display mode
 */

/**
 * Find first untagged token index in subtitle
 */
// findFirstUntaggedTokenIndex moved to subtitleTokenNavigation.ts

/**
 * Find next untagged token index after startIndex
 */
// findNextUntaggedTokenIndex moved to subtitleTokenNavigation.ts

/**
 * Check if all tokens in subtitle are tagged
 */
// areAllTokensTagged moved to subtitleTokenNavigation.ts

// navigateToFirstUntaggedToken DELETED - logic moved to content.ts:shouldPauseAtEndTime()

/**
 * Navigate to next untagged token after current selection
 */
function navigateToNextUntaggedToken(): void {
  // #region agent log
  const stackTrace = new Error().stack;
  const callerLocation = stackTrace?.split('\n')[2]?.trim() || 'unknown';
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'TOKEN_NAV_CALLED',data:{callerLocation,hasCurrentSubtitle:!!currentSubtitle,selectedTokenIndex,subtitleId:currentSubtitle?.id},timestamp:Date.now(),runId:'run1',hypothesisId:'F'})}).catch(()=>{});
  // #endregion
  
  // Use coordinator to handle navigation workflow
  const result = handleTokenNavigation(currentSubtitle, selectedTokenIndex, videoElement, null);
  
  if (result.shouldClearSelection) {
    // All tokens tagged - clear selection and exit editing mode
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'All tokens tagged - clearing selection',data:{subtitleId:currentSubtitle?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_CONTINUE'})}).catch(()=>{});
    // #endregion
    isEditingMode = false;
    setSelectedToken(null, null, null);
    return;
  }
  
  if (result.nextTokenIndex !== null && result.nextTokenText !== null) {
    // Navigate to next token
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'SETTING_NEXT_SELECTED_TOKEN',data:{currentIndex:selectedTokenIndex,nextIndex:result.nextTokenIndex,tokenText:result.nextTokenText,subtitleId:currentSubtitle?.id},timestamp:Date.now(),runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    setSelectedToken(result.nextTokenText, result.nextTokenIndex, currentSubtitle?.id || null);
  } else {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:navigateToNextUntaggedToken',message:'NO_NEXT_TOKEN_FOUND',data:{currentIndex:selectedTokenIndex,subtitleId:currentSubtitle?.id},timestamp:Date.now(),runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
  }
}

// checkAndHandleEndTime DELETED - logic moved to content.ts:shouldPauseAtEndTime()

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
  
  // Pause video by default when first detected (force pause regardless of current state)
  if (!hasInitialPause) {
    try {
      video.pause();
      hasInitialPause = true;
      console.log('[SubtitleDisplay] Video paused on initial entry');
    } catch (error) {
      console.warn('[SubtitleDisplay] Could not pause video initially:', error);
    }
  }
  
  const handleTimeUpdate = async () => {
    // Try to get time from Netflix API (with fallback to video.currentTime)
    const currentTime = await getNetflixCurrentTime();
    
    if (currentTime !== null && !isNaN(currentTime)) {
      // CRITICAL: Check contract for CURRENT subtitle BEFORE finding new subtitle
      // This ensures we check end_sec_th even if next subtitle starts immediately after
      if (currentSubtitle && currentSubtitle.end_sec_th !== undefined && currentSubtitle.end_sec_th !== null) {
        const hasPassedEndTime = currentTime >= currentSubtitle.end_sec_th;
        if (hasPassedEndTime) {
          // Check contract for current subtitle
          const shouldPause = shouldPauseAtEndTime(currentSubtitle, currentTime);
          if (shouldPause) {
            // Pause video
            pause(video);
            console.log('[SubtitleDisplay] Video paused at end_sec_th for subtitle:', currentSubtitle.id);
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleTimeUpdate',message:'Paused at end_sec_th for current subtitle',data:{subtitleId:currentSubtitle.id,currentTime,endTime:currentSubtitle.end_sec_th},timestamp:Date.now(),runId:'run1',hypothesisId:'PAUSE_LOGIC'})}).catch(()=>{});
            // #endregion
            // Keep current subtitle, don't transition yet
            return;
          }
        }
      }
      
      // Find current subtitle based on time using O(1) map lookups
      // CRITICAL: findCurrentSubtitleByTime returns from cache (source of truth)
      const newSubtitle = findCurrentSubtitleByTime(currentTime, currentSubtitle);
      
      // Detect subtitle change
      const subtitleChanged = newSubtitle?.id !== currentSubtitle?.id;
      
      // Handle subtitle change
      // CRITICAL: Skip time-based subtitle changes if hotkey navigation just occurred
      // This prevents handleTimeUpdate from overriding the hotkey-selected subtitle
      if (subtitleChanged) {
        if (isHotkeyNavigationActive) {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleTimeUpdate',message:'SKIPPING_SUBTITLE_CHANGE_HOTKEY_ACTIVE',data:{oldSubtitleId:currentSubtitle?.id,newSubtitleId:newSubtitle?.id,isHotkeyNavigationActive},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_HIGHLIGHT'})}).catch(()=>{});
          // #endregion
          // Skip subtitle change - hotkey navigation is controlling the subtitle
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleTimeUpdate',message:'Subtitle change detected',data:{oldSubtitleId:currentSubtitle?.id,newSubtitleId:newSubtitle?.id,isHotkeyNavigationActive},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_HIGHLIGHT'})}).catch(()=>{});
          // #endregion
          const oldSubtitleId = currentSubtitle?.id || null;
          
          // CRITICAL: Cache is source of truth - ALWAYS get subtitle from cache
          // findCurrentSubtitleByTime already returns from cache, but ensure we use cache directly
          const subtitleFromCache = newSubtitle?.id ? getSubtitleById(newSubtitle.id) : null;
          const subtitleToUse = subtitleFromCache || newSubtitle;
          
          // #region agent log
          // Log token meaning_id states when subtitle changes - critical for stability verification
          const newSubtitleTokenMeaningIds = subtitleToUse?.tokens_th?.tokens?.map((t, idx) => {
            if (typeof t === 'object' && t !== null && 'meaning_id' in t) {
              return { index: idx, meaningId: (t as any).meaning_id?.toString() || null, tokenText: typeof t === 'object' && 't' in t ? t.t : String(t) };
            }
            return { index: idx, meaningId: null, tokenText: typeof t === 'string' ? t : (typeof t === 'object' && 't' in t ? t.t : String(t)) };
          }) || [];
          const newMeaningIdCount = newSubtitleTokenMeaningIds.filter(t => t.meaningId !== null).length;
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleTimeUpdate',message:'SUBTITLE_CHANGED_ASSIGNED',data:{oldSubtitleId,newSubtitleId:subtitleToUse?.id,tokenCount:newSubtitleTokenMeaningIds.length,meaningIdCount:newMeaningIdCount,allTokenMeaningIds:newSubtitleTokenMeaningIds,fromCache:!!subtitleFromCache},timestamp:Date.now(),runId:'run1',hypothesisId:'STABILITY'})}).catch(()=>{});
          // #endregion
          
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleTimeUpdate',message:'HANDLE_TIME_UPDATE - Before mount',data:{oldSubtitleId,newSubtitleId:subtitleToUse?.id},timestamp:Date.now(),runId:'run1',hypothesisId:'MOUNT'})}).catch(()=>{});
          // #endregion
          
          // Mount subtitle - this sets state/data correctly from cache
          await mountSubtitle(subtitleToUse, displayMode, video);
          
          // Update current subtitle ID for timeline navigation
          setCurrentSubtitleId(subtitleToUse?.id || null);
          
          // Reset editing mode when subtitle changes
          if (isEditingMode) {
            isEditingMode = false;
            setSelectedToken(null, null, null);
          }
        }
      }
      
      // Check contract for new subtitle (or current if unchanged)
      const subtitleToCheck = newSubtitle || currentSubtitle;
      if (subtitleToCheck) {
        const shouldPause = shouldPauseAtEndTime(subtitleToCheck, currentTime);
        if (shouldPause) {
          // Pause video
          pause(video);
          console.log('[SubtitleDisplay] Video paused at end_sec_th for subtitle:', subtitleToCheck.id);
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleTimeUpdate',message:'Paused at end_sec_th',data:{subtitleId:subtitleToCheck.id,currentTime,endTime:subtitleToCheck.end_sec_th},timestamp:Date.now(),runId:'run1',hypothesisId:'PAUSE_LOGIC'})}).catch(()=>{});
          // #endregion
        }
      }
    }
  };
  
  // Handle manual unpause - exit editing mode
  const handlePlay = () => {
    // Use coordinator to handle manual unpause
    const result = handleManualUnpause(video, isEditingMode);
    if (result.shouldExitEditing) {
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
  (async () => {
    const currentTime = await getNetflixCurrentTime();
    if (currentTime !== null && !isNaN(currentTime)) {
      // Find current subtitle based on time using O(1) map lookups
      const newSubtitle = findCurrentSubtitleByTime(currentTime, currentSubtitle);
      
      if (newSubtitle?.id !== currentSubtitle?.id) {
        // CRITICAL: Cache is source of truth - findCurrentSubtitleByTime already returns from cache
        // But ensure we use cache directly (defensive check)
        const subtitleFromCache = newSubtitle?.id ? getSubtitleById(newSubtitle.id) : null;
        const subtitleToUse = subtitleFromCache || newSubtitle;
        // Mount subtitle - this sets state/data correctly from cache
        await mountSubtitle(subtitleToUse, displayMode, video);
        // Update current subtitle ID for timeline navigation
        setCurrentSubtitleId(subtitleToUse?.id || null);
      }
    }
  })();
}

/**
 * Load subtitles and start displaying
 */
async function loadSubtitles(newSubtitles: SubtitleTh[]): Promise<void> {
  subtitles = newSubtitles;
  // CRITICAL: Update cache FIRST before any operations that use it
  // Cache is the source of truth - all subtitle references must come from cache
  // When subtitles are loaded from DB, they should already have meaning_id values in tokens
  // Cache stores these values, and all subtitle references must come from cache
  setSubtitleCache(newSubtitles);
  
  // Preload all meaning labels for tokens with meaning_id
  const meaningIds = new Set<bigint>();
  newSubtitles.forEach((subtitle) => {
    const tokens = subtitle.tokens_th?.tokens;
    if (tokens) {
      tokens.forEach((token) => {
        if (typeof token === 'object' && token !== null && 'meaning_id' in token) {
          const meaningId = token.meaning_id;
          if (meaningId !== undefined && meaningId !== null) {
            const id = typeof meaningId === 'bigint' ? meaningId : BigInt(meaningId);
            meaningIds.add(id);
          }
        }
      });
    }
  });
  
  // Batch fetch all meanings
  if (meaningIds.size > 0) {
    try {
      const meanings = await fetchMeaningsByIds(Array.from(meaningIds));
      const newLabelsCache = new Map<string, string>();
      meanings.forEach((meaning) => {
        if (meaning.label_eng) {
          newLabelsCache.set(meaning.id.toString(), meaning.label_eng);
        }
      });
      meaningLabelsCache = newLabelsCache;
    } catch (error) {
      console.error('[loadSubtitles] Failed to preload meaning labels:', error);
      // Continue even if preload fails - SubArea can fetch individually
    }
  }
  // #region agent log
  const firstSubtitleTokenMeaningIds = newSubtitles[0]?.tokens_th?.tokens?.slice(0, 5).map((t, idx) => {
    if (typeof t === 'object' && t !== null && 'meaning_id' in t) {
      return { index: idx, meaningId: (t as any).meaning_id?.toString() || null };
    }
    return { index: idx, meaningId: null };
  }) || [];
  const meaningIdCount = newSubtitles[0]?.tokens_th?.tokens?.filter(t => typeof t === 'object' && t !== null && 'meaning_id' in t).length || 0;
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:loadSubtitles',message:'CACHE_SET_FIRST',data:{subtitleCount:newSubtitles.length,hasVideoElement:!!videoElement,currentSubtitleId:currentSubtitle?.id,firstSubtitleId:newSubtitles[0]?.id,firstSubtitleTokenCount:newSubtitles[0]?.tokens_th?.tokens?.length || 0,firstSubtitleTokenMeaningIds,meaningIdCount},timestamp:Date.now(),runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
  // #endregion
  
  if (videoElement && subtitles.length > 0) {
    // Find current subtitle based on video time
    const currentTime = await getNetflixCurrentTime();
    let subtitleToMount: SubtitleTh | null = null;
    
    if (currentTime !== null && !isNaN(currentTime)) {
      subtitleToMount = findCurrentSubtitleByTime(currentTime, currentSubtitle);
    }
    
    const oldSubtitleId = currentSubtitle?.id || null;
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:loadSubtitles',message:'LOAD_SUBTITLES - Before mount',data:{subtitleId:subtitleToMount?.id,oldSubtitleId,subtitleCount:newSubtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'MOUNT'})}).catch(()=>{});
    // #endregion
    
    // Mount subtitle - this sets state/data correctly from cache
    await mountSubtitle(subtitleToMount, displayMode, videoElement);
    
    // Update current subtitle ID for timeline navigation
    setCurrentSubtitleId(subtitleToMount?.id || null);
    renderTokenArea(); // Ensure TokenArea is rendered after subtitle load
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
    
    // Reset initial pause flag so video pauses on entry
    hasInitialPause = false;
    
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

    // Initialize timeline navigation hotkeys
    initializeTimelineHotkeys({
      mountSubtitleDirectly: async (subtitleId: string) => {
        // Set flag to prevent time-based subtitle changes
        isHotkeyNavigationActive = true;
        // Clear any existing timeout
        if (hotkeyNavigationTimeout) {
          clearTimeout(hotkeyNavigationTimeout);
        }
        // Reset flag after a short delay (enough for seek to complete)
        hotkeyNavigationTimeout = setTimeout(() => {
          isHotkeyNavigationActive = false;
          hotkeyNavigationTimeout = null;
        }, 1000); // 1 second should be enough for seek to complete
        
        const subtitle = getSubtitleById(subtitleId);
        if (subtitle) {
          await mountSubtitle(subtitle, displayMode, foundVideo);
          setCurrentSubtitleId(subtitleId);
        }
      },
    });
    
    // Initialize meaning selection hotkeys
    initializeMeaningHotkeys({
      getSelectedSubtitleId: () => selectedSubtitleId,
      getSelectedTokenIndex: () => selectedTokenIndex,
      getMeaningsByToken: () => meaningsByToken,
      handleMeaningSelect: handleMeaningSelect,
    });

    const mediaId = getMediaIdFromUrl(window.location.href);
    if (mediaId) {
      // CRITICAL: Use TanStack Query for all database operations
      // This ensures proper caching and cache invalidation
      getSubtitles(mediaId)
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
  
  
  // DO NOT unmount React roots (rule 5: mount once, reuse)
  // DO NOT remove rectangles (rule 4: never recreate)
  
  // Cleanup hotkeys
  cleanupTimelineHotkeys();
  cleanupMeaningHotkeys();
  
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
