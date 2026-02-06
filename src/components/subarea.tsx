import React, { useEffect } from 'react';
import type { DisplayMode } from '../services/subtitleDisplayLogic';
import { hasTokens } from '../services/subtitleDisplayLogic';
import type { SubtitleTh } from '@/schemas/subtitleThSchema';
import { SubtitleDisplayModeDropdown } from './SubtitleDisplayModeDropdown';
import type { TokenObject } from '@/types/token';
import { getTokenText, hasMeaningSelection } from '@/services/tokenCodec';

export interface SubAreaProps {
  displayText: string;
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  currentSubtitle: SubtitleTh | null;
  tokens?: TokenObject[] | string[];
  onTokenClick?: (token: TokenObject | string, index: number) => void;
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
      className="relative w-full h-full bg-black text-white text-center p-5 overflow-visible pointer-events-auto text-[77px] box-border border-t-[3px] border-t-[#e50914] border-l-0 border-r-0 border-b-0"
    >
      <SubtitleDisplayModeDropdown
        currentMode={displayMode}
        onModeChange={onDisplayModeChange}
        hasTokens={hasTokens(currentSubtitle)}
      />
      {displayMode === 'tokens' && tokens ? (
        <div className="flex flex-wrap justify-center gap-2">
          {tokens.map((token, index) => {
            const tokenText = getTokenText(token);
            const hasSelection = hasMeaningSelection(token);
            const isCurrentToken = selectedTokenIndex !== null && selectedTokenIndex !== undefined && index === selectedTokenIndex;
            
            return (
              <span
                key={index}
                className={`cursor-pointer px-1 rounded transition-colors ${
                  hasSelection
                    ? 'bg-[#e50914]/20 border border-[#e50914]/50 hover:bg-[#e50914]/30'
                    : isCurrentToken
                    ? 'ring-2 ring-[#e50914]/30 bg-[#e50914]/5 hover:bg-[#e50914]/10'
                    : 'hover:bg-white/20'
                }`}
                onClick={() => onTokenClick?.(token, index)}
                title={hasSelection ? 'Meaning selected' : isCurrentToken ? 'Currently editing' : 'Click to select meaning'}
              >
                {tokenText}
              </span>
            );
          })}
        </div>
      ) : (
        displayText
      )}
    </div>
  );
};
