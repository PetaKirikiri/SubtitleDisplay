import React, { useEffect } from 'react';
import type { DisplayMode } from '../types/display';
import type { SubtitleTh, TokenObject } from '@/schemas/subtitleThSchema';
import { SubtitleDisplayModeDropdown } from './SubtitleDisplayModeDropdown';

export interface SubAreaProps {
  displayText: string;
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  currentSubtitle: SubtitleTh | null;
  tokens?: TokenObject[] | string[]; // Pass tokens directly
  onTokenClick?: (index: number) => void;
  selectedTokenIndex?: number | null;
}

export const SubArea: React.FC<SubAreaProps> = ({
  displayText,
  displayMode,
  onDisplayModeChange,
  currentSubtitle,
  tokens,
  onTokenClick,
  selectedTokenIndex,
}) => {
  
  return (
    <div 
      className="relative w-full h-full bg-black text-white text-center p-5 overflow-visible pointer-events-auto text-[77px] box-border border-t-[3px] border-t-[#e50914] border-l-0 border-r-0 border-b-0 select-text"
    >
      <SubtitleDisplayModeDropdown
        currentMode={displayMode}
        onModeChange={onDisplayModeChange}
        hasTokens={!!(currentSubtitle?.tokens_th?.tokens && currentSubtitle.tokens_th.tokens.length > 0)}
      />
      {displayMode === 'tokens' && tokens ? (
        <div className="flex flex-wrap justify-center gap-2">
          {tokens.map((token, index) => {
            // Check meaning_id directly - no helper function needed
            const hasMeaning = typeof token === 'object' && token !== null && 'meaning_id' in token 
              ? token.meaning_id !== undefined && token.meaning_id !== null 
              : false;
            const tokenText = typeof token === 'string' ? token : token.t;
            const isCurrentToken = selectedTokenIndex !== null && selectedTokenIndex !== undefined && index === selectedTokenIndex;
            
            return (
              <span
                key={index}
                className={`select-text cursor-pointer px-1 rounded transition-colors ${
                  isCurrentToken
                    ? 'border-4 border-yellow-400 bg-yellow-400/20 shadow-lg shadow-yellow-400/50'
                    : hasMeaning
                    ? 'bg-[#e50914]/20 border border-[#e50914]/50 hover:bg-[#e50914]/30'
                    : 'hover:bg-white/20'
                }`}
                onClick={(e) => {
                  // Only trigger click if no text is selected
                  if (window.getSelection()?.toString().length === 0) {
                    onTokenClick?.(index);
                  }
                }}
                title={hasMeaning ? 'Meaning selected' : isCurrentToken ? 'Currently editing' : 'Click to select meaning'}
              >
                {tokenText}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="select-text">{displayText}</div>
      )}
    </div>
  );
};
