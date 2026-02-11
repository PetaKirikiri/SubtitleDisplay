/**
 * Subtitle Navigation Functions
 * 
 * Navigation pattern: Find current subtitle index in cache, navigate to next/previous
 * Uses Netflix API for seeking (via netflixPlayer service)
 */

import type { SubtitleTh } from '@/schemas/subtitleThSchema';
import { seekToTime } from '../timelineNavigation';

// Module-level subtitle cache (set by content.ts)
let subtitleCache: SubtitleTh[] = [];
let currentSubtitleId: string | null = null;
// Most recently displayed subtitle (independent of timeline position)
// Used for navigation - always points to last subtitle that was shown/played
let mostRecentlyDisplayedSubtitleId: string | null = null;

// Map-based navigation structures for O(1) lookup
// Built once when subtitles are loaded
let subtitleMap: Map<string, SubtitleTh> = new Map();
let subtitleAdjacencyMap: Map<string, { nextId: string | null; prevId: string | null }> = new Map();
let subtitleIdToIndexMap: Map<string, number> = new Map();

// Extract numeric suffix (index) from IDs (e.g., "81726716_6" -> 6)
function getIdNumber(id: string): number {
  const parts = id.split('_');
  const numPart = parts[parts.length - 1];
  const num = parseInt(numPart, 10);
  return isNaN(num) ? -1 : num;
}

// Extract mediaId prefix from subtitle ID (e.g., "81726716_6" -> "81726716")
function getMediaIdFromSubtitleId(id: string): string | null {
  const lastUnderscoreIndex = id.lastIndexOf('_');
  if (lastUnderscoreIndex === -1) {
    return null;
  }
  return id.substring(0, lastUnderscoreIndex);
}

// Validate that subtitle indices form a complete sequence (0, 1, 2, ..., N with no gaps)
function validateIndexSequence(subtitles: SubtitleTh[]): { isValid: boolean; missingIndices: number[]; maxIndex: number; mediaId: string | null } {
  if (subtitles.length === 0) {
    return { isValid: true, missingIndices: [], maxIndex: -1, mediaId: null };
  }

  // Extract mediaId from first subtitle
  const mediaId = getMediaIdFromSubtitleId(subtitles[0].id);
  if (!mediaId) {
    console.error('[SUBTITLE NAV] Cannot extract mediaId from subtitle ID:', subtitles[0].id);
    return { isValid: false, missingIndices: [], maxIndex: -1, mediaId: null };
  }

  // Extract all indices and find max
  const indicesFound = new Set<number>();
  let maxIndex = -1;
  
  for (const sub of subtitles) {
    const index = getIdNumber(sub.id);
    if (index === -1) {
      console.error('[SUBTITLE NAV] Invalid subtitle ID format:', sub.id);
      return { isValid: false, missingIndices: [], maxIndex: -1, mediaId };
    }
    indicesFound.add(index);
    if (index > maxIndex) {
      maxIndex = index;
    }
  }

  // Check for complete sequence from 0 to maxIndex
  const missingIndices: number[] = [];
  for (let i = 0; i <= maxIndex; i++) {
    if (!indicesFound.has(i)) {
      missingIndices.push(i);
    }
  }

  const isValid = missingIndices.length === 0;
  
  if (!isValid) {
    console.error('[SUBTITLE NAV] Index sequence validation FAILED:', {
      totalSubtitles: subtitles.length,
      maxIndex,
      expectedCount: maxIndex + 1,
      missingIndices,
      mediaId
    });
  }

  return { isValid, missingIndices, maxIndex, mediaId };
}

// Validate adjacency map integrity after construction
function validateAdjacencyMap(
  subtitles: SubtitleTh[],
  mediaId: string,
  maxIndex: number
): void {
  const issues: string[] = [];
  
  // Check 1: All subtitles in cache are in the map
  for (const sub of subtitles) {
    if (!subtitleMap.has(sub.id)) {
      issues.push(`Subtitle ${sub.id} missing from subtitleMap`);
    }
    if (!subtitleAdjacencyMap.has(sub.id)) {
      issues.push(`Subtitle ${sub.id} missing from subtitleAdjacencyMap`);
    }
  }
  
  // Check 2: No orphaned entries (subtitles pointing to non-existent next/prev IDs)
  for (const [id, adj] of subtitleAdjacencyMap.entries()) {
    if (adj.nextId !== null && !subtitleMap.has(adj.nextId)) {
      issues.push(`Subtitle ${id} points to non-existent nextId: ${adj.nextId}`);
    }
    if (adj.prevId !== null && !subtitleMap.has(adj.prevId)) {
      issues.push(`Subtitle ${id} points to non-existent prevId: ${adj.prevId}`);
    }
  }
  
  // Check 3: Sequential ID numbers match expected order
  for (let i = 0; i <= maxIndex; i++) {
    const expectedId = `${mediaId}_${i}`;
    const adj = subtitleAdjacencyMap.get(expectedId);
    
    if (adj) {
      // Verify nextId points to next sequential ID
      if (i < maxIndex) {
        const expectedNextId = `${mediaId}_${i + 1}`;
        if (adj.nextId !== expectedNextId) {
          issues.push(`Subtitle ${expectedId} has incorrect nextId: expected ${expectedNextId}, got ${adj.nextId}`);
        }
      } else {
        // Last subtitle should have null nextId
        if (adj.nextId !== null) {
          issues.push(`Subtitle ${expectedId} (last) should have null nextId, got ${adj.nextId}`);
        }
      }
      
      // Verify prevId points to previous sequential ID
      if (i > 0) {
        const expectedPrevId = `${mediaId}_${i - 1}`;
        if (adj.prevId !== expectedPrevId) {
          issues.push(`Subtitle ${expectedId} has incorrect prevId: expected ${expectedPrevId}, got ${adj.prevId}`);
        }
      } else {
        // First subtitle should have null prevId
        if (adj.prevId !== null) {
          issues.push(`Subtitle ${expectedId} (first) should have null prevId, got ${adj.prevId}`);
        }
      }
    }
  }
  
  if (issues.length > 0) {
    const errorMsg = `[SUBTITLE NAV] Adjacency map validation FAILED:\n${issues.join('\n')}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  console.log('[SUBTITLE NAV] Adjacency map validation passed:', {
    subtitleCount: subtitles.length,
    mapSize: subtitleMap.size,
    adjacencyMapSize: subtitleAdjacencyMap.size,
    maxIndex,
    mediaId
  });
}

export function setSubtitleCache(subtitles: SubtitleTh[]): void {
  // #region agent log
  const firstSubtitleTokenMeaningIds = subtitles[0]?.tokens_th?.tokens?.slice(0, 3).map((t, idx) => {
    if (typeof t === 'object' && t !== null && 'meaning_id' in t) {
      return { index: idx, meaningId: (t as any).meaning_id?.toString() || null };
    }
    return { index: idx, meaningId: null };
  }) || [];
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cache/subtitleNavigation.ts:setSubtitleCache',message:'CACHE_UPDATED',data:{subtitleCount:subtitles.length,firstSubtitleId:subtitles[0]?.id,firstSubtitleTokenCount:subtitles[0]?.tokens_th?.tokens?.length || 0,firstSubtitleTokenMeaningIds},timestamp:Date.now(),runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
  // #endregion
  // Validate index sequence completeness - log warnings but allow gaps
  const validation = validateIndexSequence(subtitles);
  if (!validation.isValid) {
    console.warn(`[SUBTITLE NAV] Incomplete subtitle sequence detected. Missing indices: [${validation.missingIndices.join(', ')}]. Expected sequence: 0 to ${validation.maxIndex}, but found ${subtitles.length} subtitles. Building adjacency map based on sorted order.`);
  }

  subtitleCache = subtitles;
  
  // Build maps in one pass for O(1) navigation
  subtitleMap.clear();
  subtitleAdjacencyMap.clear();
  subtitleIdToIndexMap.clear();
  
  // Build maps - first create ID map
  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    subtitleMap.set(sub.id, sub);
    subtitleIdToIndexMap.set(sub.id, i);
  }
  
  // Build adjacency map based on sorted order (handles gaps gracefully)
  // Sort subtitles by index number (not by start_sec_th or ID string)
  const sortedByIndex = [...subtitles].sort((a, b) => {
    const aIndex = getIdNumber(a.id);
    const bIndex = getIdNumber(b.id);
    return aIndex - bIndex;
  });
  
  // Build adjacency map based on sorted array order
  // Each subtitle's nextId is the next subtitle in the sorted array, prevId is the previous
  for (let i = 0; i < sortedByIndex.length; i++) {
    const sub = sortedByIndex[i];
    
    // Build next/prev IDs based on sorted array position (handles gaps)
    const nextId = i < sortedByIndex.length - 1 ? sortedByIndex[i + 1].id : null;
    const prevId = i > 0 ? sortedByIndex[i - 1].id : null;
    
    subtitleAdjacencyMap.set(sub.id, { nextId, prevId });
  }
  
  // Log validation info if available
  if (validation.mediaId) {
    const idGaps: number[] = [];
    for (let i = 0; i <= validation.maxIndex; i++) {
      const expectedId = `${validation.mediaId}_${i}`;
      if (!subtitleMap.has(expectedId)) {
        idGaps.push(i);
      }
    }
    if (idGaps.length > 0) {
      console.warn('[SUBTITLE NAV] Detected ID gaps:', {
        gaps: idGaps.slice(0, 20), // Log first 20 gaps
        totalGaps: idGaps.length,
        maxIndex: validation.maxIndex,
        mediaId: validation.mediaId
      });
    }
  }
}

export function getSubtitleCache(): SubtitleTh[] {
  return subtitleCache;
}

export function setCurrentSubtitleId(id: string | null): void {
  currentSubtitleId = id;
}

export function setMostRecentlyDisplayedSubtitleId(id: string | null): void {
  mostRecentlyDisplayedSubtitleId = id;
}

/**
 * Helper functions for navigation using maps
 */
export function getSubtitleById(id: string): SubtitleTh | undefined {
  // #region agent log
  const subtitle = subtitleMap.get(id);
  const tokenMeaningIds = subtitle?.tokens_th?.tokens?.map((t, idx) => {
    if (typeof t === 'object' && t !== null && 'meaning_id' in t) {
      return { index: idx, meaningId: (t as any).meaning_id?.toString() || null };
    }
    return { index: idx, meaningId: null };
  }) || [];
  const stackTrace = new Error().stack;
  const callerLocation = stackTrace?.split('\n')[2]?.trim() || 'unknown';
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cache/subtitleNavigation.ts:getSubtitleById',message:'GET_SUBTITLE_FROM_CACHE',data:{subtitleId:id,found:!!subtitle,tokenCount:subtitle?.tokens_th?.tokens?.length || 0,tokenMeaningIds,callerLocation},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
  return subtitleMap.get(id);
}

export function getNextSubtitleId(id: string): string | null {
  return subtitleAdjacencyMap.get(id)?.nextId ?? null;
}

export function getPreviousSubtitleId(id: string): string | null {
  return subtitleAdjacencyMap.get(id)?.prevId ?? null;
}

export function getCurrentSubtitleId(): string | null {
  return mostRecentlyDisplayedSubtitleId || currentSubtitleId;
}

/**
 * Get the first subtitle ID (the one with no previous subtitle)
 * Returns null if no subtitles are loaded
 */
export function getFirstSubtitleId(): string | null {
  // Find subtitle with prevId === null (first in sequence)
  for (const [id, adjacency] of subtitleAdjacencyMap.entries()) {
    if (adjacency.prevId === null) {
      return id;
    }
  }
  return null;
}

// ============================================================================
// Time-based Subtitle Finding
// ============================================================================

/**
 * Find current subtitle based on video time using O(1) map lookups
 * Uses subtitleMap and adjacencyMap for fast lookups instead of iteration
 * 
 * @param currentTime - Current playback time in seconds
 * @param currentSubtitle - Current subtitle reference (may be null)
 * @returns The subtitle that should be displayed, or null if none
 */
export function findCurrentSubtitleByTime(currentTime: number, currentSubtitle: SubtitleTh | null): SubtitleTh | null {
  // If we have current subtitle, check if still valid using O(1) map lookups
  if (currentSubtitle) {
    // CRITICAL: Always refresh from cache (source of truth) to ensure latest meaning_id values
    // Cache is the single source of truth - all subtitle references must come from cache
    const currentSubtitleFromCache = getSubtitleById(currentSubtitle.id);
    const subtitleToCheck = currentSubtitleFromCache || currentSubtitle;
    
    const start = subtitleToCheck.start_sec_th ?? 0;
    
    // Check if time is still within current subtitle's range
    // Current subtitle persists until next subtitle's start_sec_th is reached
    const nextId = getNextSubtitleId(subtitleToCheck.id);
    const nextSubtitle = nextId ? getSubtitleById(nextId) : undefined;
    const nextStart = nextSubtitle?.start_sec_th;
    
    // Still within current subtitle's range?
    if (currentTime >= start && (nextStart === undefined || currentTime < nextStart)) {
      return subtitleToCheck; // Return from cache (source of truth)
    }
    
    // Past current subtitle, check if we've reached next subtitle
    if (nextSubtitle && nextStart !== undefined && currentTime >= nextStart) {
      // Check if we've jumped past multiple subtitles (seek/jump case)
      // Traverse forward via adjacency map until we find the correct subtitle
      let candidate: SubtitleTh | undefined = nextSubtitle;
      let candidateId: string | null = nextId;
      
      while (candidate && candidateId) {
        const candidateStart = candidate.start_sec_th ?? 0;
        const candidateNextId = getNextSubtitleId(candidateId);
        const candidateNext = candidateNextId ? getSubtitleById(candidateNextId) : undefined;
        const candidateNextStart = candidateNext?.start_sec_th;
        
        // Is this the right subtitle?
        if (currentTime >= candidateStart && (candidateNextStart === undefined || currentTime < candidateNextStart)) {
          return candidate;
        }
        
        // Move to next subtitle if we've passed this one
        if (candidateNext && candidateNextStart !== undefined && currentTime >= candidateNextStart) {
          candidateId = candidateNextId;
          candidate = candidateNext;
        } else {
          // No more subtitles or we're before the next one
          break;
        }
      }
      
      return candidate || null;
    }
    
    // Time is before current subtitle's start (backwards seek)
    // Traverse backwards via adjacency map
    let candidate: SubtitleTh | undefined = currentSubtitle;
    let candidateId: string | null = currentSubtitle.id;
    
    while (candidate && candidateId) {
      const candidateStart = candidate.start_sec_th ?? 0;
      const candidatePrevId = getPreviousSubtitleId(candidateId);
      const candidatePrev = candidatePrevId ? getSubtitleById(candidatePrevId) : undefined;
      const candidatePrevStart = candidatePrev?.start_sec_th ?? 0;
      
      // Is this the right subtitle?
      if (currentTime >= candidateStart) {
        return candidate;
      }
      
      // Move to previous subtitle if we're before this one
      if (candidatePrev && currentTime < candidateStart) {
        // Check if we're before previous subtitle too
        if (currentTime < candidatePrevStart) {
          candidateId = candidatePrevId;
          candidate = candidatePrev;
        } else {
          // We're between prev and current
          return candidatePrev;
        }
      } else {
        // No previous subtitle or we're at the start
        break;
      }
    }
    
    return candidate || null;
  }
  
  // No current subtitle (initial load) - find first matching subtitle
  // Start from the first subtitle (prevId === null) and traverse forward
  const firstSubtitleId = getFirstSubtitleId();
  if (!firstSubtitleId) {
    return null; // No subtitles loaded
  }
  
  // Traverse forward from first subtitle to find matching one
  let candidateId: string | null = firstSubtitleId;
  let candidate: SubtitleTh | undefined = getSubtitleById(firstSubtitleId);
  
  while (candidate && candidateId) {
    const candidateStart = candidate.start_sec_th ?? 0;
    const candidateNextId = getNextSubtitleId(candidateId);
    const candidateNext = candidateNextId ? getSubtitleById(candidateNextId) : undefined;
    const candidateNextStart = candidateNext?.start_sec_th;
    
    // Is this the right subtitle?
    if (currentTime >= candidateStart && (candidateNextStart === undefined || currentTime < candidateNextStart)) {
      return candidate;
    }
    
    // Move to next subtitle if we've passed this one
    if (candidateNext && candidateNextStart !== undefined && currentTime >= candidateNextStart) {
      candidateId = candidateNextId;
      candidate = candidateNext;
    } else {
      // No more subtitles or we're before the next one
      // If we're past the last subtitle, return the last one
      if (currentTime >= candidateStart) {
        return candidate;
      }
      break;
    }
  }
  
  return candidate || null;
}

/**
 * Check if current time has reached or passed the subtitle's start time
 * 
 * @param currentTime - Current playback time in seconds
 * @param subtitle - Subtitle to check
 * @returns true if currentTime >= start_sec_th
 */
export function hasReachedStartTime(currentTime: number, subtitle: SubtitleTh): boolean {
  const start = subtitle.start_sec_th ?? 0;
  return currentTime >= start;
}

/**
 * Check if current time has reached or passed the subtitle's end time
 * 
 * @param currentTime - Current playback time in seconds
 * @param subtitle - Subtitle to check
 * @returns true if currentTime >= end_sec_th
 */
export function hasReachedEndTime(currentTime: number, subtitle: SubtitleTh): boolean {
  const endTime = subtitle.end_sec_th;
  if (endTime === undefined || endTime === null) {
    return false;
  }
  return currentTime >= endTime;
}

/**
 * Check if current time is within the subtitle's time range
 * 
 * @param currentTime - Current playback time in seconds
 * @param subtitle - Subtitle to check
 * @returns true if currentTime is between start_sec_th and end_sec_th (inclusive)
 */
export function isTimeInSubtitleRange(currentTime: number, subtitle: SubtitleTh): boolean {
  const start = subtitle.start_sec_th ?? 0;
  const endTime = subtitle.end_sec_th;
  
  if (endTime === undefined || endTime === null) {
    // If no end time, check only start time
    return currentTime >= start;
  }
  
  return currentTime >= start && currentTime <= endTime;
}

// Callback for mounting subtitle directly (without seeking)
let mountSubtitleDirectlyCallback: ((subtitleId: string) => Promise<void>) | null = null;

/**
 * Set callback for mounting subtitle directly (used by hotkeys)
 */
export function setMountSubtitleDirectlyCallback(callback: ((subtitleId: string) => Promise<void>) | null): void {
  mountSubtitleDirectlyCallback = callback;
}

/**
 * Advance to next subtitle - ArrowRight behavior
 * If mountSubtitleDirectlyCallback is set, mounts subtitle directly without seeking
 * Otherwise, seeks to START of NEXT subtitle, starts playback
 * Uses adjacency map for O(1) lookup
 */
export function advanceToNextSubtitle(): void {
  // #region agent log
  console.log('[HOTKEY NAV] advanceToNextSubtitle called');
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cache/subtitleNavigation.ts:advanceToNextSubtitle',message:'HOTKEY NAVIGATION - Next',data:{currentId:mostRecentlyDisplayedSubtitleId || currentSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'NAV'})}).catch(()=>{});
  // #endregion
  
  // Use mostRecentlyDisplayedSubtitleId as primary identifier
  const currentId = mostRecentlyDisplayedSubtitleId || currentSubtitleId;
  
  if (!currentId || subtitleMap.size === 0) {
    return;
  }
  
  // O(1) lookup of next subtitle ID
  const adj = subtitleAdjacencyMap.get(currentId);
  
  if (adj?.nextId) {
    // O(1) lookup of next subtitle
    const nextSubtitle = subtitleMap.get(adj.nextId);
    
    if (nextSubtitle && nextSubtitle.start_sec_th != null) {
      // #region agent log
      console.log('[HOTKEY NAV] Navigating to next subtitle', {
        fromId: currentId,
        toId: nextSubtitle.id,
        startTime: nextSubtitle.start_sec_th,
        endTime: nextSubtitle.end_sec_th
      });
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cache/subtitleNavigation.ts:advanceToNextSubtitle',message:'HOTKEY NAV - Navigating to next',data:{fromId:currentId,toId:nextSubtitle.id,startTime:nextSubtitle.start_sec_th,endTime:nextSubtitle.end_sec_th,hasMountCallback:!!mountSubtitleDirectlyCallback},timestamp:Date.now(),runId:'run1',hypothesisId:'NAV'})}).catch(()=>{});
      // #endregion
      
      // Mount subtitle directly AND seek timeline (hotkey navigation does both)
      if (mountSubtitleDirectlyCallback) {
        mountSubtitleDirectlyCallback(nextSubtitle.id);
        setMostRecentlyDisplayedSubtitleId(nextSubtitle.id);
        // Also seek timeline to subtitle start time
        seekToTime(nextSubtitle.start_sec_th);
        // Start playback immediately (editor-first workflow)
        const video = document.querySelector('video');
        if (video && video.paused) {
          video.play();
        }
      } else {
        // Fallback: seek to subtitle start time (legacy behavior)
        seekToTime(nextSubtitle.start_sec_th);
        setMostRecentlyDisplayedSubtitleId(nextSubtitle.id);
        // Start playback immediately (editor-first workflow)
        const video = document.querySelector('video');
        if (video && video.paused) {
          video.play();
        }
      }
    }
  }
}

/**
 * Restart current subtitle - ArrowLeft behavior
 * If mountSubtitleDirectlyCallback is set, mounts subtitle directly without seeking
 * Otherwise, seeks to START of MOST RECENTLY DISPLAYED subtitle, plays video
 * Uses mostRecentlyDisplayedSubtitleId and subtitleMap for O(1) lookup
 */
export function restartCurrentSubtitle(): void {
  // #region agent log
  console.log('[HOTKEY NAV] restartCurrentSubtitle called');
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cache/subtitleNavigation.ts:restartCurrentSubtitle',message:'HOTKEY NAVIGATION - Restart',data:{subtitleId:mostRecentlyDisplayedSubtitleId || currentSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'NAV'})}).catch(()=>{});
  // #endregion
  
  // Use mostRecentlyDisplayedSubtitleId as primary identifier
  const subtitleIdToUse = mostRecentlyDisplayedSubtitleId || currentSubtitleId;
  
  if (!subtitleIdToUse || subtitleMap.size === 0) {
    return;
  }
  
  // O(1) lookup of subtitle by ID
  const currentSubtitle = subtitleMap.get(subtitleIdToUse);
  
  if (currentSubtitle && currentSubtitle.start_sec_th != null) {
    // #region agent log
    console.log('[HOTKEY NAV] Restarting current subtitle', {
      subtitleId: currentSubtitle.id,
      startTime: currentSubtitle.start_sec_th,
      endTime: currentSubtitle.end_sec_th
    });
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cache/subtitleNavigation.ts:restartCurrentSubtitle',message:'HOTKEY NAV - Restarting',data:{subtitleId:currentSubtitle.id,startTime:currentSubtitle.start_sec_th,endTime:currentSubtitle.end_sec_th,hasMountCallback:!!mountSubtitleDirectlyCallback},timestamp:Date.now(),runId:'run1',hypothesisId:'NAV'})}).catch(()=>{});
    // #endregion
    
    // Mount subtitle directly AND seek timeline (hotkey navigation does both)
    if (mountSubtitleDirectlyCallback) {
      mountSubtitleDirectlyCallback(currentSubtitle.id);
      setMostRecentlyDisplayedSubtitleId(currentSubtitle.id);
      // Also seek timeline to subtitle start time
      seekToTime(currentSubtitle.start_sec_th);
      // Resume playback if paused
      const video = document.querySelector('video');
      if (video && video.paused) {
        video.play();
      }
    } else {
      // Fallback: seek to subtitle start time (legacy behavior)
      seekToTime(currentSubtitle.start_sec_th);
      setMostRecentlyDisplayedSubtitleId(currentSubtitle.id);
      // Resume playback if paused
      const video = document.querySelector('video');
      if (video && video.paused) {
        video.play();
      }
    }
  }
}

/**
 * Go to previous subtitle - ArrowUp behavior
 * If mountSubtitleDirectlyCallback is set, mounts subtitle directly without seeking
 * Otherwise, seeks to START of PREVIOUS subtitle, starts playback
 * Uses adjacency map for O(1) lookup
 */
export function goToPreviousSubtitle(): void {
  // #region agent log
  console.log('[HOTKEY NAV] goToPreviousSubtitle called');
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cache/subtitleNavigation.ts:goToPreviousSubtitle',message:'HOTKEY NAVIGATION - Previous',data:{currentId:mostRecentlyDisplayedSubtitleId || currentSubtitleId},timestamp:Date.now(),runId:'run1',hypothesisId:'NAV'})}).catch(()=>{});
  // #endregion
  
  // Use mostRecentlyDisplayedSubtitleId as primary identifier
  const currentId = mostRecentlyDisplayedSubtitleId || currentSubtitleId;
  
  if (!currentId || subtitleMap.size === 0) {
    return;
  }
  
  // O(1) lookup of previous subtitle ID
  const adj = subtitleAdjacencyMap.get(currentId);
  
  if (adj?.prevId) {
    // O(1) lookup of previous subtitle
    const previousSubtitle = subtitleMap.get(adj.prevId);
    
    if (previousSubtitle && previousSubtitle.start_sec_th != null) {
      // #region agent log
      console.log('[HOTKEY NAV] Navigating to previous subtitle', {
        fromId: currentId,
        toId: previousSubtitle.id,
        startTime: previousSubtitle.start_sec_th,
        endTime: previousSubtitle.end_sec_th
      });
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cache/subtitleNavigation.ts:goToPreviousSubtitle',message:'HOTKEY NAV - Navigating to previous',data:{fromId:currentId,toId:previousSubtitle.id,startTime:previousSubtitle.start_sec_th,endTime:previousSubtitle.end_sec_th,hasMountCallback:!!mountSubtitleDirectlyCallback},timestamp:Date.now(),runId:'run1',hypothesisId:'NAV'})}).catch(()=>{});
      // #endregion
      
      // Mount subtitle directly AND seek timeline (hotkey navigation does both)
      if (mountSubtitleDirectlyCallback) {
        mountSubtitleDirectlyCallback(previousSubtitle.id);
        setMostRecentlyDisplayedSubtitleId(previousSubtitle.id);
        // Also seek timeline to subtitle start time
        seekToTime(previousSubtitle.start_sec_th);
        // Start playback immediately (editor-first workflow)
        const video = document.querySelector('video');
        if (video && video.paused) {
          video.play();
        }
      } else {
        // Fallback: seek to subtitle start time (legacy behavior)
        seekToTime(previousSubtitle.start_sec_th);
        setMostRecentlyDisplayedSubtitleId(previousSubtitle.id);
        // Start playback immediately (editor-first workflow)
        const video = document.querySelector('video');
        if (video && video.paused) {
          video.play();
        }
      }
    }
  }
}
