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
import { saveEpisode, fetchEpisodeByMediaId } from './services/supabaseClient';
import type { Episode } from '@/schemas/episodeSchema';
import { getSubtitles, saveSubtitlesAndAwait } from './hooks/useSubtitles';
import { getUserWordsFromDb, upsertUserWord } from './hooks/useUserWords';
import { parseVTTFile } from '@/services/vtt/vttParser';
import { getLayoutDimensions, createRectangles, setRectangleGeometry, removeRectangles } from './layoutCalculations';
import { SubArea } from './components/subarea/subarea';
import { TokenArea } from './components/tokenarea/tokenarea';
import type { DisplayMode } from './types/display';
import type { SubtitleTh } from '@/schemas/subtitleThSchema';
import { initializeTimelineHotkeys, cleanupTimelineHotkeys } from './services/timelineNavigation/hotkeys-navigation';
import { initializeMeaningHotkeys, cleanupMeaningHotkeys } from './components/tokenarea/helpers/hotkeys-meaning';
import { setSubtitleCache, setCurrentSubtitleId, setMostRecentlyDisplayedSubtitleId, getSubtitleById, getSubtitleCache, findCurrentSubtitleByTime, isTimeInSubtitleRange } from './services/cache/subtitleNavigation';
import { handleTokenNavigation } from './components/subarea/helpers/handleTokenNavigation';
import { unpause, getCurrentTime as getNetflixCurrentTime, pause } from './services/timelineNavigation';
import type { MeaningTh } from '@/schemas/meaningThSchema';
import { setMeaningsForToken } from './components/tokenarea/helpers/subtitleMeaningsCache';
import { handleManualUnpause } from './services/video/handleManualUnpause';
import { supabase, fetchMeaningsByIds, fetchMeaningById, fetchWord } from './supabase';
import type { Session } from '@supabase/supabase-js';

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
let lastKnownTime: number | null = null;
let displayText: string = '';
let displayMode: DisplayMode = 'tokens';
let subtitles: SubtitleTh[] = [];
let videoTimeHandler: (() => void) | null = null;
let videoPlayHandler: (() => void) | null = null;

// Phonetics array for phonetics mode (maps to tokens by index)
// Structure: Array<{ phonetic: string, tokenIndex: number, meaning_id?: bigint }>
let phoneticsArray: Array<{ phonetic: string; tokenIndex: number; meaning_id?: bigint }> = [];

// Auth state (Supabase); subtitles load only when session is present
let currentSession: Session | null = null;
let authUnsubscribe: (() => void) | null = null;

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

// User's saved words (word_id) for green background when meaning selected
let knownWordIds: Set<string> = new Set();

// When user manually hits play after pause-at-end, allow transition to next subtitle (don't re-pause)
let userJustUnpaused = false;

async function refreshKnownWords(): Promise<void> {
  const userId = currentSession?.user?.id;
  if (!userId) {
    knownWordIds = new Set();
    renderSubArea();
    return;
  }
  try {
    const words = await getUserWordsFromDb(userId);
    knownWordIds = new Set(words.map((w) => w.word_id));
  } catch {
    knownWordIds = new Set();
  }
  renderSubArea();
}

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

// Cache for phonetics (word_th -> phonetic_en)
// Preloaded when subtitles are loaded
let phoneticsCache: Map<string, string> = new Map();

/**
 * Update phonetics cache with a single word
 * Called when phonetics are needed and not in cache
 */
async function updatePhoneticsCache(wordTh: string): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:updatePhoneticsCache',message:'Fetching word phonetic',data:{wordTh},timestamp:Date.now(),runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
  // #endregion
  try {
    const word = await fetchWord(wordTh);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:updatePhoneticsCache',message:'Word fetched',data:{wordTh,found:!!word,hasPhonetic:!!word?.phonetic_en,phonetic_en:word?.phonetic_en || null},timestamp:Date.now(),runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    if (word && word.phonetic_en) {
      phoneticsCache.set(wordTh, word.phonetic_en);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:updatePhoneticsCache',message:'Phonetic cached',data:{wordTh,phonetic_en:word.phonetic_en,cacheSize:phoneticsCache.size},timestamp:Date.now(),runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
      // #endregion
    }
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:updatePhoneticsCache',message:'Failed to fetch phonetic',data:{wordTh,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    console.error(`[updatePhoneticsCache] Failed to fetch phonetic for "${wordTh}":`, error);
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
let showUserMode: boolean = false;

/**
 * Toggle between SubtitleEditor and meaning selection views in TokenArea
 */
function toggleSubtitleEditor(): void {
  showSubtitleEditor = !showSubtitleEditor;
  if (showSubtitleEditor) showUserMode = false;
  renderTokenArea();
}

/**
 * Toggle User Mode (word metadata + save) in TokenArea
 */
function toggleUserMode(): void {
  showUserMode = !showUserMode;
  if (showUserMode) showSubtitleEditor = false;
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
    phoneticsArray = [];
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
    phoneticsArray = []; // Clear phonetics array when not in phonetics mode
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'Thai mode displayText set',data:{subtitleId:subtitleToUse.id,displayTextLength:displayText.length,displayTextPreview:displayText.substring(0,50)},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
  } else if (mode === 'phonetics') {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'Phonetics mode - starting',data:{subtitleId:subtitleToUse.id,hasTokens:!!tokens,tokenCount:tokens?.length || 0,phoneticsCacheSize:phoneticsCache.size},timestamp:Date.now(),runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    // Build phonetics array with token mapping (similar to tokens mode)
    if (tokens && Array.isArray(tokens)) {
      const phoneticsPromises = tokens.map(async (token, index) => {
        const tokenText = typeof token === 'string' ? token : token.t;
        if (!tokenText || tokenText.trim().length === 0) {
          return null;
        }
        
        // Get meaning_id from token if it exists
        const meaningId = typeof token === 'object' && token !== null && 'meaning_id' in token
          ? token.meaning_id
          : undefined;
        
        // Check cache first
        const cachedPhonetic = phoneticsCache.get(tokenText.trim());
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'Phonetics lookup',data:{subtitleId:subtitleToUse.id,tokenIndex:index,tokenText:tokenText.trim(),hasCachedPhonetic:!!cachedPhonetic,cachedPhonetic:cachedPhonetic || null},timestamp:Date.now(),runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
        if (cachedPhonetic) {
          return { phonetic: cachedPhonetic, tokenIndex: index, meaning_id: meaningId };
        }
        
        // Fetch if not in cache
        try {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'Fetching phonetic from DB',data:{subtitleId:subtitleToUse.id,tokenIndex:index,tokenText:tokenText.trim()},timestamp:Date.now(),runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
          // #endregion
          await updatePhoneticsCache(tokenText.trim());
          const fetchedPhonetic = phoneticsCache.get(tokenText.trim()) || tokenText.trim();
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'Phonetic fetched',data:{subtitleId:subtitleToUse.id,tokenIndex:index,tokenText:tokenText.trim(),fetchedPhonetic},timestamp:Date.now(),runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
          // #endregion
          return { phonetic: fetchedPhonetic, tokenIndex: index, meaning_id: meaningId };
        } catch (error) {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'Phonetic fetch failed',data:{subtitleId:subtitleToUse.id,tokenIndex:index,tokenText:tokenText.trim(),error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
          // #endregion
          // Fallback to token text if fetch fails
          return { phonetic: tokenText.trim(), tokenIndex: index, meaning_id: meaningId };
        }
      });
      
      const phoneticsResults = await Promise.all(phoneticsPromises);
      phoneticsArray = phoneticsResults.filter((p): p is { phonetic: string; tokenIndex: number; meaning_id?: bigint } => p !== null);
      displayText = ''; // Not used for phonetics mode - phoneticsArray passed directly
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'Phonetics mode array built',data:{subtitleId:subtitleToUse.id,phoneticsArrayLength:phoneticsArray.length},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
    } else {
      phoneticsArray = [];
      displayText = '';
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:mountSubtitle',message:'Phonetics mode - no tokens',data:{subtitleId:subtitleToUse.id},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
    }
  } else {
    // tokens mode - displayText not used, tokens passed directly
    displayText = '';
    phoneticsArray = []; // Clear phonetics array when not in phonetics mode
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
  
  // Extract tokens array (always pass when subtitle exists, for known-word check in phonetics mode)
  const tokens = currentSubtitle?.tokens_th?.tokens;
  const phonetics = displayMode === 'phonetics' ? phoneticsArray : undefined;
  
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
    // Handle clicks from both tokens and phonetics modes
    // In phonetics mode, index is the tokenIndex from the phonetic item
    if (displayMode === 'tokens' && tokens && tokens[index]) {
      const tokenText = typeof tokens[index] === 'string' ? tokens[index] : tokens[index].t;
      setSelectedToken(tokenText, index, currentSubtitle?.id || null);
    } else if (displayMode === 'phonetics' && tokens && tokens[index]) {
      // Phonetics mode - use tokenIndex to get the actual token
      const tokenText = typeof tokens[index] === 'string' ? tokens[index] : tokens[index].t;
      setSelectedToken(tokenText, index, currentSubtitle?.id || null);
    }
  };

  const handleSaveWord = async (tokenText: string): Promise<void> => {
    const uid = currentSession?.user?.id;
    if (!uid || !tokenText.trim()) return;
    try {
      await upsertUserWord({ user_id: uid, word_id: tokenText.trim(), status: 'saved' });
      await refreshKnownWords();
      renderSubArea();
      renderTokenArea();
    } catch (err) {
      console.error('[Content] Failed to save word:', err);
      alert(`Failed to save word: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  
  if (subtitleDisplayAreaRoot && bottomRect) {
    subtitleDisplayAreaRoot.render(
      React.createElement(SubArea, {
        displayText,
        displayMode,
        onDisplayModeChange: async (mode: DisplayMode) => {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:onDisplayModeChange',message:'Display mode change triggered',data:{oldMode:displayMode,newMode:mode,hasCurrentSubtitle:!!currentSubtitle,hasVideoElement:!!videoElement,currentSubtitleId:currentSubtitle?.id},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
          // #endregion
          displayMode = mode;
          // Re-mount subtitle to refresh displayText for the new mode
          if (currentSubtitle && videoElement) {
            await mountSubtitle(currentSubtitle, mode, videoElement);
          } else {
            // If no subtitle, just re-render with empty displayText
            displayText = '';
            renderSubArea();
          }
        },
        currentSubtitle,
        tokens, // Pass tokens directly
        phonetics, // Pass phonetics array for phonetics mode
        onTokenClick: handleTokenClick,
        selectedTokenIndex,
        meaningLabels: meaningLabelsCache, // Pass preloaded meaning labels cache
        knownWordIds,
        onSaveWord: handleSaveWord,
        userId: currentSession?.user?.id ?? null,
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
 * Backfill episode metadata when episode exists with only media_id.
 * Extracts from DOM, merges into existing episode, saves.
 */
async function tryBackfillEpisodeMetadata(mediaId: string): Promise<void> {
  try {
    const existing = await fetchEpisodeByMediaId(mediaId);
    if (!existing || (existing.show_title && existing.show_title.trim().length > 0)) return;
    const extracted = await extractEpisodeFromNetflixPage();
    if (!extracted) return;
    const merged = {
      id: existing.id,
      media_id: existing.media_id,
      show_title: extracted.show_title ?? existing.show_title,
      season_number: extracted.season_number ?? existing.season_number,
      episode_number: extracted.episode_number ?? existing.episode_number,
      episode_title: extracted.episode_title ?? existing.episode_title,
    };
    await saveEpisode(merged);
  } catch {
    // Backfill failed - no logging needed
  }
}

/**
 * Load subtitles for the current page when user is logged in.
 * Called after auth init and when session becomes non-null.
 */
function tryLoadSubtitlesForCurrentPage(): void {
  const mediaId = getMediaIdFromUrl(window.location.href);
  if (!mediaId) return;
  getSubtitles(mediaId)
    .then(newSubtitles => {
      if (newSubtitles.length > 0) {
        loadSubtitles(newSubtitles);
      }
      tryBackfillEpisodeMetadata(mediaId).catch(() => {});
    })
    .catch(() => {});
}

/**
 * Initialize auth: get session, subscribe to changes, load subtitles when logged in.
 */
function initializeAuth(): void {
  supabase.auth.getSession().then(({ data: { session } }) => {
    currentSession = session;
    renderTokenArea();
    if (session) {
      refreshKnownWords();
      tryLoadSubtitlesForCurrentPage();
    } else {
      knownWordIds = new Set();
    }
  });
  authUnsubscribe = supabase.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    renderTokenArea();
    if (session) {
      refreshKnownWords();
      tryLoadSubtitlesForCurrentPage();
    } else {
      knownWordIds = new Set();
    }
  });
}

/**
 * Render TokenArea component
 * Extracts meaning_id from the selected token and passes it to TokenArea
 * so TokenArea knows which meaning is currently selected for highlighting
 */
function renderTokenArea(): void {
  // Skip when user is typing in TokenArea - root.render() causes input defocus
  const activeEl = document.activeElement;
  const isInputFocused =
    activeEl &&
    (activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      (activeEl as HTMLElement).isContentEditable);
  if (isInputFocused && activeEl?.closest?.('[data-token-area]')) {
    return;
  }
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
        isLoggedIn: !!currentSession,
        onLoginSuccess: tryLoadSubtitlesForCurrentPage,
        selectedToken: tokenText,
        subtitleId: selectedSubtitleId,
        tokenIndex: selectedTokenIndex,
        selectedMeaningId: meaningId, // Pass meaning_id so TokenArea knows which meaning is selected
        subtitles: getSubtitleCache(),
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
        showUserMode: showUserMode,
        onToggleUserMode: toggleUserMode,
        userId: (() => {
          const uid = currentSession?.user?.id ?? null;
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:renderTokenArea',message:'USER_ID_PASSED_TO_TOKENAREA',data:{userId:uid,hasSession:!!currentSession,hasUser:!!currentSession?.user,userEmail:currentSession?.user?.email},timestamp:Date.now(),runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
          // #endregion
          return uid;
        })(),
        userName: currentSession?.user?.user_metadata?.full_name ?? currentSession?.user?.user_metadata?.name ?? null,
        userEmail: currentSession?.user?.email ?? null,
        userAvatarUrl: currentSession?.user?.user_metadata?.avatar_url ?? currentSession?.user?.user_metadata?.picture ?? null,
        onWordSaved: refreshKnownWords,
        onExtractAndSave: extractAndSave,
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
 * Pause only when subtitle has tokens AND at least one token has no meaning selected.
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

  // Only pause if at least one token has no meaning selected
  const hasUntaggedToken = tokens.some((token) => {
    const hasMeaning =
      typeof token === 'object' && token !== null && 'meaning_id' in token
        ? token.meaning_id !== undefined && token.meaning_id !== null
        : false;
    return !hasMeaning;
  });
  // #region agent log
  if (currentTime >= endTime && tokens.length > 0) {
    const tokenDetails = tokens.map((t, i) => ({ i, hasMeaning: typeof t === 'object' && t !== null && 'meaning_id' in t && (t as any).meaning_id != null }));
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'17a93b'},body:JSON.stringify({sessionId:'17a93b',location:'content.ts:shouldPauseAtEndTime',message:'SHOULD_PAUSE_EVAL',data:{subtitleId:subtitleToUse.id,hasUntaggedToken,tokenCount:tokens.length,tokenDetails},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
  }
  // #endregion
  if (!hasUntaggedToken) {
    return false; // All tokens tagged - no pause needed
  }
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
  
  const handleTimeUpdate = async (event?: Event) => {
    // Try to get time from Netflix API (with fallback to video.currentTime)
    const currentTime = await getNetflixCurrentTime();
    
    if (currentTime !== null && !isNaN(currentTime)) {
      // Detect manual seek: if time jumped significantly (> 2 seconds), it's likely a manual seek
      const isManualSeek = lastKnownTime !== null && Math.abs(currentTime - lastKnownTime) > 2;
      lastKnownTime = currentTime;
      // When user manually unpaused after pause-at-end, skip pause check so we can transition to next subtitle
      if (userJustUnpaused) {
        userJustUnpaused = false;
      } else if (currentSubtitle && currentSubtitle.end_sec_th !== undefined && currentSubtitle.end_sec_th !== null) {
        // Pause at end_sec_th when tokens incomplete - check BEFORE findCurrentSubtitleByTime
        // Do NOT require isInRange: timeupdate fires ~250ms apart, so we're always past end when we get the tick
        const hasPassedEndTime = currentTime >= currentSubtitle.end_sec_th;
        // #region agent log
        if (hasPassedEndTime) {
          const tokenStates = currentSubtitle.tokens_th?.tokens?.map((t, i) => ({
            i,
            hasMeaning: typeof t === 'object' && t !== null && 'meaning_id' in t && (t as any).meaning_id != null,
          })) ?? [];
          const untaggedCount = tokenStates.filter((x) => !x.hasMeaning).length;
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'17a93b'},body:JSON.stringify({sessionId:'17a93b',location:'content.ts:handleTimeUpdate',message:'PAUSE_AT_END_CHECK',data:{subtitleId:currentSubtitle.id,currentTime,endTime:currentSubtitle.end_sec_th,hasPassedEndTime,tokenCount:tokenStates.length,untaggedCount,tokenStates},timestamp:Date.now(),runId:'post-fix',hypothesisId:'H1_H5'})}).catch(()=>{});
        }
        // #endregion
        if (hasPassedEndTime) {
          const shouldPause = shouldPauseAtEndTime(currentSubtitle, currentTime);
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'17a93b'},body:JSON.stringify({sessionId:'17a93b',location:'content.ts:handleTimeUpdate',message:'SHOULD_PAUSE_RESULT',data:{subtitleId:currentSubtitle.id,shouldPause},timestamp:Date.now(),runId:'post-fix',hypothesisId:'H2'})}).catch(()=>{});
          // #endregion
          if (shouldPause) {
            pause(video);
            console.log('[SubtitleDisplay] Video paused at end_sec_th for subtitle:', currentSubtitle.id);
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'17a93b'},body:JSON.stringify({sessionId:'17a93b',location:'content.ts:handleTimeUpdate',message:'Paused at end_sec_th for current subtitle',data:{subtitleId:currentSubtitle.id,currentTime,endTime:currentSubtitle.end_sec_th},timestamp:Date.now(),runId:'post-fix',hypothesisId:'PAUSE_LOGIC'})}).catch(()=>{});
            // #endregion
            return;
          }
        }
      }
      
      // Find current subtitle based on time using O(1) map lookups
      // CRITICAL: findCurrentSubtitleByTime returns from cache (source of truth)
      const newSubtitle = findCurrentSubtitleByTime(currentTime, currentSubtitle);
      
      // Detect subtitle change
      const subtitleChanged = newSubtitle?.id !== currentSubtitle?.id;
      
      // Also check if current subtitle is no longer valid for current time (outside range)
      // This handles cases where we're still showing an old subtitle after manual seek
      const currentSubtitleInvalid = currentSubtitle && !isTimeInSubtitleRange(currentTime, currentSubtitle);
      const needsUpdate = subtitleChanged || (currentSubtitleInvalid && isManualSeek);
      
      // Handle subtitle change or invalid subtitle
      // CRITICAL: Skip time-based subtitle changes if hotkey navigation just occurred
      // This prevents handleTimeUpdate from overriding the hotkey-selected subtitle
      // BUT: Always allow subtitle updates on manual seek - user explicitly moved timeline
      if (needsUpdate) {
        if (isHotkeyNavigationActive && !isManualSeek) {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleTimeUpdate',message:'SKIPPING_SUBTITLE_CHANGE_HOTKEY_ACTIVE',data:{oldSubtitleId:currentSubtitle?.id,newSubtitleId:newSubtitle?.id,isHotkeyNavigationActive,isManualSeek,currentSubtitleInvalid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_HIGHLIGHT'})}).catch(()=>{});
          // #endregion
          // Skip subtitle change - hotkey navigation is controlling the subtitle (but not on manual seek)
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:handleTimeUpdate',message:'Subtitle change detected',data:{oldSubtitleId:currentSubtitle?.id,newSubtitleId:newSubtitle?.id,isHotkeyNavigationActive,isManualSeek,currentSubtitleInvalid},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'AUTO_HIGHLIGHT'})}).catch(()=>{});
          // #endregion
          const oldSubtitleId = currentSubtitle?.id || null;
          // #region agent log - Check if we missed pause for previous subtitle (H4)
          if (currentSubtitle && currentSubtitle.end_sec_th != null && currentTime >= currentSubtitle.end_sec_th) {
            const prevShouldPause = shouldPauseAtEndTime(currentSubtitle, currentTime);
            if (prevShouldPause) {
              fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'17a93b'},body:JSON.stringify({sessionId:'17a93b',location:'content.ts:handleTimeUpdate',message:'MISSED_PAUSE_TRANSITIONING',data:{oldSubtitleId,newSubtitleId:newSubtitle?.id,currentTime,oldEndTime:currentSubtitle.end_sec_th,prevShouldPause},timestamp:Date.now(),runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
            }
          }
          // #endregion
          
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
      // BUT: Only check if current time is actually WITHIN the subtitle's range
      // If outside subtitle range, allow free playback
      const subtitleToCheck = newSubtitle || currentSubtitle;
      if (subtitleToCheck) {
        const isInRange = isTimeInSubtitleRange(currentTime, subtitleToCheck);
        if (isInRange) {
          // Only check pause logic if we're within the subtitle's range
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
        // If not in range, don't pause - allow free playback outside subtitle ranges
      }
    }
  };
  
  // Handle manual unpause - exit editing mode, allow transition past pause-at-end
  const handlePlay = () => {
    userJustUnpaused = true; // Skip pause-at-end for next tick so we can transition to next subtitle
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

  // Mount subtitle immediately when paused on entry - use timeline position
  // Do this BEFORE preload so user sees subs right away without pressing play
  if (videoElement && newSubtitles.length > 0) {
    const video = document.querySelector('video') as HTMLVideoElement | null;
    const currentTime =
      (await getNetflixCurrentTime()) ??
      (video && !isNaN(video.currentTime) ? video.currentTime : null);
    let subtitleToMount: SubtitleTh | null = null;
    if (currentTime !== null && !isNaN(currentTime)) {
      subtitleToMount = findCurrentSubtitleByTime(currentTime, currentSubtitle);
    }
    await mountSubtitle(subtitleToMount, displayMode, videoElement);
    setCurrentSubtitleId(subtitleToMount?.id || null);
    renderSubArea();
    renderTokenArea();
  }

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
      renderSubArea();
    } catch (error) {
      console.error('[loadSubtitles] Failed to preload meaning labels:', error);
      // Continue even if preload fails - SubArea can fetch individually
    }
  }

  // Preload all phonetics for all tokens
  const uniqueWords = new Set<string>();
  newSubtitles.forEach((subtitle) => {
    const tokens = subtitle.tokens_th?.tokens;
    if (tokens) {
      tokens.forEach((token) => {
        const tokenText = typeof token === 'string' ? token : token.t;
        if (tokenText && tokenText.trim().length > 0) {
          uniqueWords.add(tokenText.trim());
        }
      });
    }
  });
  
  // Batch fetch all phonetics (fetch in parallel but limit concurrency)
  if (uniqueWords.size > 0) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:loadSubtitles',message:'Preloading phonetics',data:{uniqueWordCount:uniqueWords.size},timestamp:Date.now(),runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    try {
      const wordsArray = Array.from(uniqueWords);
      // Fetch phonetics in batches to avoid overwhelming the database
      const batchSize = 50;
      const newPhoneticsCache = new Map<string, string>();
      
      for (let i = 0; i < wordsArray.length; i += batchSize) {
        const batch = wordsArray.slice(i, i + batchSize);
        const fetchPromises = batch.map(async (wordTh) => {
          try {
            const word = await fetchWord(wordTh);
            if (word && word.phonetic_en) {
              newPhoneticsCache.set(wordTh, word.phonetic_en);
            }
          } catch (error) {
            // Silently fail for individual words - they'll be fetched on demand
          }
        });
        await Promise.all(fetchPromises);
      }
      
      phoneticsCache = newPhoneticsCache;
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:loadSubtitles',message:'Phonetics preload complete',data:{uniqueWordCount:uniqueWords.size,cachedPhoneticsCount:phoneticsCache.size},timestamp:Date.now(),runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:loadSubtitles',message:'Phonetics preload failed',data:{uniqueWordCount:uniqueWords.size,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      console.error('[loadSubtitles] Failed to preload phonetics:', error);
      // Continue even if preload fails - phonetics will be fetched on demand
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

  // Re-render TokenArea after preload (caches updated)
  if (videoElement && subtitles.length > 0) {
    renderTokenArea();
  } else if (!videoElement || subtitles.length === 0) {
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
    initializeAuth();

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

    // Subtitles load only when user is logged in (see initializeAuth / onAuthStateChange).

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
      
      // Skip React re-renders when user is typing - prevents defocus on every key press
      // Geometry is already updated above; re-renders will run on next layout change after blur
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable);
      if (!isInputFocused) {
        renderSubArea();
        renderTokenArea();
      }
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
  if (authUnsubscribe) {
    authUnsubscribe();
    authUnsubscribe = null;
  }
  currentSession = null;

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

async function extractAndSave(): Promise<{ episode: Episode; subtitleCount: number } | null> {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'EXTRACT_ENTRY',data:{isExtracting},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
  // #endregion
  if (isExtracting) return null;
  isExtracting = true;

  try {
    const mediaId = getMediaIdFromUrl(window.location.href);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'MEDIA_ID_CHECK',data:{mediaId,url:window.location.href},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
    // #endregion
    if (!mediaId) {
      isExtracting = false;
      return null;
    }

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'WAIT_VIDEO_READY',data:{mediaId},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
    // #endregion
    await waitForVideoReady();

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'EXTRACT_EPISODE_METADATA',data:{mediaId},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
    // #endregion
    const episode = await extractEpisodeFromNetflixPage();
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'EPISODE_RESULT',data:{hasEpisode:!!episode,mediaId:episode?.media_id,showTitle:episode?.show_title},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
    // #endregion
    if (!episode) {
      isExtracting = false;
      return null;
    }

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'FETCH_THAI_VTT',data:{mediaId:episode.media_id},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
    // #endregion
    const thaiVTT = await fetchThaiVTTContent(episode.media_id);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'THAI_VTT_RESULT',data:{hasThaiVTT:!!thaiVTT,vttLength:thaiVTT?.length},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
    // #endregion
    if (!thaiVTT) {
      throw new Error('Could not extract Thai VTT files - extraction failed');
    }

    const subtitles = await parseVTTFile(thaiVTT, episode.media_id);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'PARSE_VTT_DONE',data:{subtitleCount:subtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
    // #endregion

    await saveEpisode(episode);
    await saveSubtitlesAndAwait(subtitles, episode.media_id, true);
    loadSubtitles(subtitles);

    if (videoContainer && videoElement && bottomRect && rightRect) {
      setRectangleGeometry(videoElement, videoContainer);
      const { netflix } = getLayoutDimensions(videoElement, videoContainer);
      videoContainer.style.setProperty('width', `${netflix.width}px`, 'important');
      videoContainer.style.setProperty('height', `${netflix.height}px`, 'important');
      videoContainer.style.setProperty('top', `${netflix.top}px`, 'important');
      renderSubArea();
      renderTokenArea();
    }

    chrome.runtime.sendMessage({
      type: 'EXTRACT_COMPLETE',
      data: {
        mediaId: episode.media_id,
        episodeCount: 1,
        subtitleCount: subtitles.length,
      },
    }).catch(() => {});

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'EXTRACT_SUCCESS',data:{mediaId:episode.media_id,subtitleCount:subtitles.length},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
    // #endregion
    return { episode, subtitleCount: subtitles.length };
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'content.ts:extractAndSave',message:'EXTRACT_ERROR',data:{error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
    // #endregion
    if (error instanceof Error) throw error;
    throw error;
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
      // Inject subtitle script early so JSON.parse interception captures URLs before video loads
      injectNetflixSubtitleScript().catch(() => {});
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
