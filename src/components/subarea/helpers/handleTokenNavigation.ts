/**
 * Handle Token Navigation (SubArea Domain)
 * Handles token navigation workflow
 */

import type { SubtitleTh } from '@/schemas/subtitleThSchema';

export interface TokenNavigationResult {
  nextTokenIndex: number | null;
  nextTokenText: string | null;
  shouldUnpause: boolean;
  shouldClearSelection: boolean;
}

/**
 * Handle token navigation coordination
 * Simplified: Just moves to next token index - component handles highlighting based on its own render-time check
 * 
 * @param currentSubtitle - Current subtitle (may be null)
 * @param selectedTokenIndex - Currently selected token index (may be null)
 * @param videoElement - Video element (may be null)
 * @param displayState - Unused (kept for compatibility)
 * @returns Navigation result with next token info and unpause/clear flags
 */
export function handleTokenNavigation(
  currentSubtitle: SubtitleTh | null,
  selectedTokenIndex: number | null,
  videoElement: HTMLVideoElement | null,
  displayState: null = null
): TokenNavigationResult {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handleTokenNavigation.ts:handleTokenNavigation',message:'TOKEN_NAV_ENTRY',data:{hasCurrentSubtitle:!!currentSubtitle,selectedTokenIndex,subtitleId:currentSubtitle?.id},timestamp:Date.now(),runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  
  // Validate state
  if (!currentSubtitle || selectedTokenIndex === null) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handleTokenNavigation.ts:handleTokenNavigation',message:'EARLY_RETURN_INVALID_STATE',data:{hasCurrentSubtitle:!!currentSubtitle,selectedTokenIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    return {
      nextTokenIndex: null,
      nextTokenText: null,
      shouldUnpause: false,
      shouldClearSelection: false,
    };
  }
  
  // Find next untagged token (token without meaning_id)
  const tokens = currentSubtitle.tokens_th?.tokens;
  let nextIndex: number | null = null;
  
  if (tokens && tokens.length > 0 && selectedTokenIndex !== null) {
    // Start searching from the token after current selection
    const startIndex = selectedTokenIndex + 1;
    const searchIndices = [];
    for (let i = 0; i < tokens.length; i++) {
      searchIndices.push((startIndex + i) % tokens.length);
    }
    
    // Find first token without meaning_id
    for (const idx of searchIndices) {
      const token = tokens[idx];
      const hasMeaning = typeof token === 'object' && token !== null && 'meaning_id' in token
        ? token.meaning_id !== undefined && token.meaning_id !== null
        : false;
      
      if (!hasMeaning) {
        nextIndex = idx;
        break;
      }
    }
    
    // #region agent log
    const tokenStates = searchIndices.slice(0, 5).map(idx => {
      const token = tokens[idx];
      const hasMeaning = typeof token === 'object' && token !== null && 'meaning_id' in token
        ? token.meaning_id !== undefined && token.meaning_id !== null
        : false;
      return { index: idx, hasMeaning };
    });
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handleTokenNavigation.ts:handleTokenNavigation',message:'SEARCHING_UNTAGGED',data:{selectedTokenIndex,startIndex,nextIndex,tokenStates},timestamp:Date.now(),runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
  }
  
  if (nextIndex === null) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handleTokenNavigation.ts:handleTokenNavigation',message:'NO_UNTAGGED_FOUND',data:{selectedTokenIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    return {
      nextTokenIndex: null,
      nextTokenText: null,
      shouldUnpause: false,
      shouldClearSelection: true,
    };
  }
  
  // Get next token text
  const token = tokens![nextIndex];
  const tokenText = typeof token === 'string' ? token : token.t;
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'handleTokenNavigation.ts:handleTokenNavigation',message:'FOUND_NEXT_UNTAGGED',data:{selectedTokenIndex,nextIndex,tokenText},timestamp:Date.now(),runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  
  return {
    nextTokenIndex: nextIndex,
    nextTokenText: tokenText,
    shouldUnpause: false,
    shouldClearSelection: false,
  };
}
