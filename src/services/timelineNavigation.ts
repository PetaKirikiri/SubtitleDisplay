/**
 * Timeline Navigation Functions
 * 
 * Navigation pattern: Find current subtitle index in cache, navigate to next/previous
 * Uses Netflix API for seeking (via netflixSeek service)
 */

import type { SubtitleTh } from '@/schemas/subtitleThSchema';
import { seekToSubtitleTime } from './netflixSeek';

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

export function setSubtitleCache(subtitles: SubtitleTh[]): void {
  // #region agent log
  const logData = {location:'timelineNavigation.ts:setSubtitleCache',message:'Setting subtitle cache',data:{cacheSize:subtitles.length,firstId:subtitles[0]?.id,lastId:subtitles[subtitles.length-1]?.id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
  console.log('[DEBUG]', logData);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
  // #endregion
  subtitleCache = subtitles;
  
  // Build maps in one pass for O(1) navigation
  subtitleMap.clear();
  subtitleAdjacencyMap.clear();
  subtitleIdToIndexMap.clear();
  
  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    subtitleMap.set(sub.id, sub);
    subtitleIdToIndexMap.set(sub.id, i);
    
    const nextId = i < subtitles.length - 1 ? subtitles[i + 1].id : null;
    const prevId = i > 0 ? subtitles[i - 1].id : null;
    subtitleAdjacencyMap.set(sub.id, { nextId, prevId });
  }
  
  // #region agent log
  const logData2 = {location:'timelineNavigation.ts:setSubtitleCache',message:'Built navigation maps',data:{mapSize:subtitleMap.size,adjacencySize:subtitleAdjacencyMap.size,indexMapSize:subtitleIdToIndexMap.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'};
  console.log('[DEBUG]', logData2);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData2)}).catch(()=>{});
  // #endregion
}

export function setCurrentSubtitleId(id: string | null): void {
  // #region agent log
  const logData = {location:'timelineNavigation.ts:setCurrentSubtitleId',message:'Setting current subtitle ID',data:{oldId:currentSubtitleId,newId:id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'};
  console.log('[DEBUG]', logData);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
  // #endregion
  currentSubtitleId = id;
}

export function setMostRecentlyDisplayedSubtitleId(id: string | null): void {
  // #region agent log
  const logData = {location:'timelineNavigation.ts:setMostRecentlyDisplayedSubtitleId',message:'Setting most recently displayed subtitle ID',data:{oldId:mostRecentlyDisplayedSubtitleId,newId:id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'};
  console.log('[DEBUG]', logData);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
  // #endregion
  mostRecentlyDisplayedSubtitleId = id;
}

/**
 * Helper functions for navigation using maps
 */
export function getSubtitleById(id: string): SubtitleTh | undefined {
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
 * Advance to next subtitle - ArrowRight behavior
 * Seeks to START of NEXT subtitle, starts playback
 * Uses adjacency map for O(1) lookup
 */
export function advanceToNextSubtitle(): void {
  // Use mostRecentlyDisplayedSubtitleId as primary identifier
  const currentId = mostRecentlyDisplayedSubtitleId || currentSubtitleId;
  
  // #region agent log
  const logData1 = {location:'timelineNavigation.ts:advanceToNextSubtitle',message:'Function entry',data:{mostRecentlyDisplayedSubtitleId,currentSubtitleId,currentId,cacheSize:subtitleCache.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
  console.log('[DEBUG]', logData1);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData1)}).catch(()=>{});
  // #endregion
  
  if (!currentId || subtitleMap.size === 0) {
    // #region agent log
    const logData = {location:'timelineNavigation.ts:advanceToNextSubtitle',message:'Early return - no current ID or empty maps',data:{hasCurrentId:!!currentId,mapSize:subtitleMap.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
    console.log('[DEBUG]', logData);
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
    // #endregion
    return;
  }
  
  // O(1) lookup of next subtitle ID
  const adj = subtitleAdjacencyMap.get(currentId);
  // #region agent log
  const logData2 = {location:'timelineNavigation.ts:advanceToNextSubtitle',message:'Found adjacency info',data:{currentId,hasAdj:!!adj,nextId:adj?.nextId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
  console.log('[DEBUG]', logData2);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData2)}).catch(()=>{});
  // #endregion
  
  if (adj?.nextId) {
    // O(1) lookup of next subtitle
    const nextSubtitle = subtitleMap.get(adj.nextId);
    // #region agent log
    const logData3 = {location:'timelineNavigation.ts:advanceToNextSubtitle',message:'Found next subtitle',data:{nextId:adj.nextId,hasSubtitle:!!nextSubtitle,hasStartSec:nextSubtitle?.start_sec_th != null,nextStartSec:nextSubtitle?.start_sec_th},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
    console.log('[DEBUG]', logData3);
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData3)}).catch(()=>{});
    // #endregion
    
    if (nextSubtitle && nextSubtitle.start_sec_th != null) {
      seekToSubtitleTime(nextSubtitle.id, nextSubtitle.start_sec_th);
      // Update most recently displayed after seeking
      setMostRecentlyDisplayedSubtitleId(nextSubtitle.id);
      // Start playback immediately (editor-first workflow)
      const video = document.querySelector('video');
      if (video && video.paused) {
        video.play();
      }
    }
  }
}

/**
 * Restart current subtitle - ArrowLeft behavior
 * Seeks to START of MOST RECENTLY DISPLAYED subtitle, plays video
 * Uses mostRecentlyDisplayedSubtitleId and subtitleMap for O(1) lookup
 */
export function restartCurrentSubtitle(): void {
  // Use mostRecentlyDisplayedSubtitleId as primary identifier
  const subtitleIdToUse = mostRecentlyDisplayedSubtitleId || currentSubtitleId;
  
  // #region agent log
  const logData1 = {location:'timelineNavigation.ts:restartCurrentSubtitle',message:'Function entry',data:{mostRecentlyDisplayedSubtitleId,currentSubtitleId,subtitleIdToUse,mapSize:subtitleMap.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
  console.log('[DEBUG]', logData1);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData1)}).catch(()=>{});
  // #endregion
  
  if (!subtitleIdToUse || subtitleMap.size === 0) {
    // #region agent log
    const logData = {location:'timelineNavigation.ts:restartCurrentSubtitle',message:'Early return - no subtitle ID or empty maps',data:{hasMostRecentId:!!mostRecentlyDisplayedSubtitleId,hasCurrentId:!!currentSubtitleId,subtitleIdToUse,mapSize:subtitleMap.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
    console.log('[DEBUG]', logData);
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
    // #endregion
    return;
  }
  
  // O(1) lookup of subtitle by ID
  const currentSubtitle = subtitleMap.get(subtitleIdToUse);
  // #region agent log
  const logData2 = {location:'timelineNavigation.ts:restartCurrentSubtitle',message:'Found subtitle to restart',data:{found:!!currentSubtitle,subtitleId:subtitleIdToUse,hasStartSec:currentSubtitle?.start_sec_th != null,startSec:currentSubtitle?.start_sec_th},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
  console.log('[DEBUG]', logData2);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData2)}).catch(()=>{});
  // #endregion
  
  if (currentSubtitle && currentSubtitle.start_sec_th != null) {
    seekToSubtitleTime(currentSubtitle.id, currentSubtitle.start_sec_th);
    // Update most recently displayed after seeking
    setMostRecentlyDisplayedSubtitleId(currentSubtitle.id);
    // Resume playback if paused
    const video = document.querySelector('video');
    if (video && video.paused) {
      video.play();
    }
  }
}

/**
 * Go to previous subtitle - ArrowUp behavior
 * Seeks to START of PREVIOUS subtitle, starts playback
 * Uses adjacency map for O(1) lookup
 */
export function goToPreviousSubtitle(): void {
  // Use mostRecentlyDisplayedSubtitleId as primary identifier
  const currentId = mostRecentlyDisplayedSubtitleId || currentSubtitleId;
  
  // #region agent log
  const logData1 = {location:'timelineNavigation.ts:goToPreviousSubtitle',message:'Function entry',data:{mostRecentlyDisplayedSubtitleId,currentSubtitleId,currentId,cacheSize:subtitleCache.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
  console.log('[DEBUG]', logData1);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData1)}).catch(()=>{});
  // #endregion
  
  if (!currentId || subtitleMap.size === 0) {
    // #region agent log
    const logData = {location:'timelineNavigation.ts:goToPreviousSubtitle',message:'Early return - no current ID or empty maps',data:{hasCurrentId:!!currentId,mapSize:subtitleMap.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
    console.log('[DEBUG]', logData);
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
    // #endregion
    return;
  }
  
  // O(1) lookup of previous subtitle ID
  const adj = subtitleAdjacencyMap.get(currentId);
  // #region agent log
  const logData2 = {location:'timelineNavigation.ts:goToPreviousSubtitle',message:'Found adjacency info',data:{currentId,hasAdj:!!adj,prevId:adj?.prevId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
  console.log('[DEBUG]', logData2);
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData2)}).catch(()=>{});
  // #endregion
  
  if (adj?.prevId) {
    // O(1) lookup of previous subtitle
    const previousSubtitle = subtitleMap.get(adj.prevId);
    // #region agent log
    const logData3 = {location:'timelineNavigation.ts:goToPreviousSubtitle',message:'Found previous subtitle',data:{prevId:adj.prevId,hasSubtitle:!!previousSubtitle,hasStartSec:previousSubtitle?.start_sec_th != null,previousStartSec:previousSubtitle?.start_sec_th},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'};
    console.log('[DEBUG]', logData3);
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData3)}).catch(()=>{});
    // #endregion
    
    if (previousSubtitle && previousSubtitle.start_sec_th != null) {
      seekToSubtitleTime(previousSubtitle.id, previousSubtitle.start_sec_th);
      // Update most recently displayed after seeking
      setMostRecentlyDisplayedSubtitleId(previousSubtitle.id);
      // Start playback immediately (editor-first workflow)
      const video = document.querySelector('video');
      if (video && video.paused) {
        video.play();
      }
    }
  }
}
