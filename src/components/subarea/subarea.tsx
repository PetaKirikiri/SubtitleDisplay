import React from 'react';
import type { DisplayMode } from '../../types/display';
import type { SubtitleTh, TokenObject } from '@/schemas/subtitleThSchema';
import { SubtitleDisplayModeDropdown } from './SubtitleDisplayModeDropdown';

export interface SubAreaProps {
  displayText: string;
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  currentSubtitle: SubtitleTh | null;
  tokens?: TokenObject[] | string[]; // Pass tokens directly
  phonetics?: Array<{ phonetic: string; tokenIndex: number; meaning_id?: bigint }>; // Pass phonetics array for phonetics mode
  onTokenClick?: (index: number) => void;
  selectedTokenIndex?: number | null;
  meaningLabels?: Map<string, string>; // Preloaded meaning labels cache (meaning_id -> label_eng)
  knownWordIds?: Set<string>; // User's saved words for green background when meaning selected
  onSaveWord?: (tokenText: string) => void;
  userId?: string | null;
}

// Track previous token states to detect unexpected background changes
let previousTokenStates: Map<string, Map<number, { meaningId: string | null, appliedStyle: string }>> = new Map();

export const SubArea: React.FC<SubAreaProps> = ({
  displayText,
  displayMode,
  onDisplayModeChange,
  currentSubtitle,
  tokens,
  phonetics,
  onTokenClick,
  selectedTokenIndex,
  meaningLabels: meaningLabelsProp = new Map(),
  knownWordIds = new Set(),
  onSaveWord,
  userId,
}) => {
  // Track token state changes for stability verification
  const subtitleId = currentSubtitle?.id || 'unknown';
  const previousStates = previousTokenStates.get(subtitleId) || new Map();
  
  return (
    <div 
      className="relative w-full h-full bg-black text-white text-center p-5 overflow-visible pointer-events-auto text-[77px] box-border border-t-[3px] border-t-[#e50914] border-l-0 border-r-0 border-b-0 select-text"
    >
      <div className="absolute top-2 right-2 z-50 flex items-center gap-2">
        {currentSubtitle?.id && (
          <div className="bg-black/80 text-white text-base px-4 py-2 rounded border border-white/20">
            {currentSubtitle.id}
          </div>
        )}
        <SubtitleDisplayModeDropdown
          currentMode={displayMode}
          onModeChange={onDisplayModeChange}
          hasTokens={!!(currentSubtitle?.tokens_th?.tokens && currentSubtitle.tokens_th.tokens.length > 0)}
        />
      </div>
      {(displayMode === 'tokens' && tokens) || (displayMode === 'phonetics' && phonetics) ? (
        <div className="flex flex-wrap justify-center gap-2">
          {(displayMode === 'tokens' ? tokens : phonetics).map((item, index) => {
            // Handle both tokens and phonetics
            let tokenText: string;
            let hasMeaning: boolean;
            let meaningIdValue: bigint | null = null;
            let tokenIndex: number;
            
            if (displayMode === 'tokens') {
              const token = item as TokenObject | string;
              tokenText = typeof token === 'string' ? token : token.t;
              hasMeaning = typeof token === 'object' && token !== null && 'meaning_id' in token 
                ? token.meaning_id !== undefined && token.meaning_id !== null 
                : false;
              meaningIdValue = typeof token === 'object' && token !== null && 'meaning_id' in token 
                ? (token as any).meaning_id 
                : null;
              tokenIndex = index;
            } else {
              // phonetics mode
              const phoneticItem = item as { phonetic: string; tokenIndex: number; meaning_id?: bigint };
              tokenText = phoneticItem.phonetic;
              hasMeaning = phoneticItem.meaning_id !== undefined && phoneticItem.meaning_id !== null;
              meaningIdValue = phoneticItem.meaning_id || null;
              tokenIndex = phoneticItem.tokenIndex; // Use the token index for clicking
            }
            
            const isCurrentToken = selectedTokenIndex !== null && selectedTokenIndex !== undefined && tokenIndex === selectedTokenIndex;
            const wordForKnownCheck =
              displayMode === 'tokens'
                ? tokenText
                : tokens?.[tokenIndex]
                  ? typeof tokens[tokenIndex] === 'string'
                    ? tokens[tokenIndex]
                    : (tokens[tokenIndex] as TokenObject).t
                  : '';

            // #region agent log
            const appliedStyle = isCurrentToken ? 'yellow-border' : hasMeaning ? 'red-background' : 'white';
            const meaningIdStr = meaningIdValue?.toString() || null;
            
            // CRITICAL: Track background stability - detect white->red changes without user action
            const previousState = previousStates.get(tokenIndex);
            const backgroundChanged = previousState && previousState.appliedStyle !== appliedStyle;
            const unexpectedRedChange = previousState && previousState.appliedStyle === 'white' && appliedStyle === 'red-background';
            
            // Verify state matches rendered background
            const stateMatchesRender = (hasMeaning && appliedStyle === 'red-background') || (!hasMeaning && appliedStyle !== 'red-background' && !isCurrentToken);
            const stateMismatch = hasMeaning && appliedStyle !== 'red-background' && !isCurrentToken;
            
            if (unexpectedRedChange && previousState) {
              // FAILURE: Token turned red without user interaction - this violates stability requirement
              fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subarea.tsx:render',message:'STABILITY_FAILURE_WHITE_TO_RED',data:{subtitleId,tokenIndex,displayMode,tokenText,previousMeaningId:previousState.meaningId,currentMeaningId:meaningIdStr,previousStyle:previousState.appliedStyle,currentStyle:appliedStyle,hasMeaning},timestamp:Date.now(),runId:'run1',hypothesisId:'STABILITY'})}).catch(()=>{});
            }
            
            if (stateMismatch) {
              // FAILURE: Token has meaning_id but doesn't render red - indicates state was set incorrectly
              fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subarea.tsx:render',message:'STATE_MISMATCH_RENDER',data:{subtitleId,tokenIndex,displayMode,tokenText,meaningId:meaningIdStr,hasMeaning,appliedStyle,isCurrentToken},timestamp:Date.now(),runId:'run1',hypothesisId:'STABILITY'})}).catch(()=>{});
            }
            
            // Log when token renders with red background (meaning_id present) - verify state matches render
            if (hasMeaning && appliedStyle === 'red-background') {
              fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subarea.tsx:render',message:'TOKEN_RENDERED_RED',data:{subtitleId,tokenIndex,displayMode,tokenText,meaningId:meaningIdStr,stateMatchesRender},timestamp:Date.now(),runId:'run1',hypothesisId:'STABILITY'})}).catch(()=>{});
            }
            
            // Log when token renders with white background (no meaning_id) - verify state matches render
            if (!hasMeaning && appliedStyle === 'white') {
              fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subarea.tsx:render',message:'TOKEN_RENDERED_WHITE',data:{subtitleId,tokenIndex,displayMode,tokenText,meaningId:meaningIdStr,stateMatchesRender},timestamp:Date.now(),runId:'run1',hypothesisId:'STABILITY'})}).catch(()=>{});
            }
            
            fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subarea.tsx:render',message:'TOKEN_BACKGROUND_APPLIED',data:{subtitleId,tokenIndex,displayMode,tokenText,meaningId:meaningIdStr,hasMeaning,appliedStyle,isCurrentToken,backgroundChanged,unexpectedRedChange,stateMatchesRender,stateMismatch,previousStyle:previousState?.appliedStyle || null},timestamp:Date.now(),runId:'run1',hypothesisId:'STABILITY'})}).catch(()=>{});
            
            // Update previous state tracking (use tokenIndex for phonetics mode)
            if (!previousTokenStates.has(subtitleId)) {
              previousTokenStates.set(subtitleId, new Map());
            }
            previousTokenStates.get(subtitleId)!.set(tokenIndex, { meaningId: meaningIdStr, appliedStyle });
            // #endregion
            
            // Get label_eng for this token if it has a meaning_id
            let labelEng: string | undefined;
            if (hasMeaning && meaningIdValue !== null) {
              const meaningIdStr = typeof meaningIdValue === 'bigint' ? meaningIdValue.toString() : String(meaningIdValue);
              labelEng = meaningLabelsProp.get(meaningIdStr);
            }
            
            return (
              <div
                key={displayMode === 'phonetics' ? `phonetic-${tokenIndex}` : index}
                className="flex flex-col items-center"
              >
                {labelEng && (
                  <div className="text-white text-[28px] mb-1 select-text font-medium">
                    {labelEng}
                  </div>
                )}
                <span
                  className={`select-text cursor-pointer px-1 rounded transition-colors ${
                    isCurrentToken
                      ? 'border-4 border-yellow-400 bg-yellow-400/20 shadow-lg shadow-yellow-400/50'
                      : knownWordIds.has(wordForKnownCheck)
                      ? 'bg-green-500/20 border border-green-500/50 hover:bg-green-500/30'
                      : hasMeaning
                      ? 'bg-[#e50914]/20 border border-[#e50914]/50 hover:bg-[#e50914]/30'
                      : 'hover:bg-white/20'
                  }`}
                  onClick={(e) => {
                    // Only trigger click if no text is selected
                    if (window.getSelection()?.toString().length === 0) {
                      onTokenClick?.(tokenIndex); // Use tokenIndex so phonetics click selects corresponding token
                    }
                  }}
                  title={hasMeaning ? 'Meaning selected' : isCurrentToken ? 'Currently editing' : 'Click to select meaning'}
                >
                  {tokenText}
                </span>
                {onSaveWord && userId && wordForKnownCheck && (displayMode === 'tokens' || displayMode === 'phonetics') && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSaveWord(wordForKnownCheck);
                    }}
                    className={`mt-px px-0.5 py-px rounded text-[7px] leading-none font-medium transition-all scale-[0.33] ${
                      knownWordIds.has(wordForKnownCheck)
                        ? 'bg-green-500/30 text-green-300 border border-green-500/50'
                        : 'bg-white/5 text-white/70 hover:bg-[#e50914]/30 hover:text-[#e50914] border border-white/10 hover:border-[#e50914]/50'
                    }`}
                    title="Save to my words"
                  >
                    {knownWordIds.has(wordForKnownCheck) ? '✓' : '+'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="select-text">
          {/* #region agent log */}
          {(() => {
            fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'subarea.tsx:render',message:'Rendering displayText',data:{displayMode,displayTextLength:displayText.length,displayTextPreview:displayText.substring(0,100),hasCurrentSubtitle:!!currentSubtitle,currentSubtitleId:currentSubtitle?.id},timestamp:Date.now(),runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
            return null;
          })()}
          {/* #endregion */}
          {displayText}
        </div>
      )}
    </div>
  );
};
