import React, { useEffect, useState } from 'react';
import { fetchMeaningsByWordTh } from '../supabase';
import type { MeaningTh } from '@/schemas/meaningThSchema';

interface MeaningCardProps {
  meaning: MeaningTh;
  index: number;
  isSelected: boolean;
  canSelect: boolean;
  tokenIndex: number | null | undefined;
  onMeaningSelect?: (tokenIndex: number, meaningId: bigint) => void;
}

const MeaningCard: React.FC<MeaningCardProps> = ({
  meaning,
  index,
  isSelected,
  canSelect,
  tokenIndex,
  onMeaningSelect,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (canSelect && tokenIndex !== null && tokenIndex !== undefined) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:MeaningCard:handleClick',message:'Meaning card clicked',data:{tokenIndex,meaningId:meaning.id.toString(),definitionTh:meaning.definition_th.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
      // #endregion
      onMeaningSelect?.(tokenIndex, meaning.id);
    }
  };

  return (
    <div
      className={`bg-white/5 border rounded-lg p-6 transition-all duration-200 ${
        isSelected 
          ? 'border-[#e50914] bg-[#e50914]/10 shadow-lg shadow-[#e50914]/20' 
          : 'border-white/10'
      } ${
        canSelect 
          ? 'cursor-pointer hover:bg-white/15 hover:border-[#e50914]/50 hover:shadow-lg hover:shadow-[#e50914]/10 hover:scale-[1.02]' 
          : ''
      }`}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={canSelect ? 'Click to select this meaning' : undefined}
    >
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0">
          <div className={`font-semibold rounded-full w-14 h-14 flex items-center justify-center text-2xl transition-all ${
            isSelected 
              ? 'bg-[#e50914] text-white' 
              : 'bg-[#e50914]/20 text-[#e50914]'
          }`}>
            {index + 1}
          </div>
        </div>
        <div className="flex-1">
          <div className="text-white/90 text-2xl leading-loose">
            {meaning.definition_th}
          </div>
          {isSelected && (
            <div className="mt-2 text-[#e50914] text-sm font-semibold">
              ✓ Selected
            </div>
          )}
          {canSelect && !isSelected && isHovered && (
            <div className="mt-2 text-white/60 text-sm font-medium animate-pulse">
              Click to select
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export interface TokenAreaProps {
  selectedToken: string | null;
  subtitleId?: string | null;
  tokenIndex?: number | null;
  selectedMeaningId?: bigint | null;
  onMeaningSelect?: (tokenIndex: number, meaningId: bigint) => void;
  onMeaningsFetched?: (meanings: MeaningTh[]) => void;
}

export const TokenArea: React.FC<TokenAreaProps> = ({ 
  selectedToken, 
  subtitleId, 
  tokenIndex, 
  selectedMeaningId, 
  onMeaningSelect,
  onMeaningsFetched
}) => {
  const [meanings, setMeanings] = useState<MeaningTh[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Fetch meanings when selectedToken changes
  useEffect(() => {
    if (!selectedToken) {
      setMeanings([]);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    fetchMeaningsByWordTh(selectedToken)
      .then((fetchedMeanings) => {
        setMeanings(fetchedMeanings);
        setIsLoading(false);
        // Notify parent component of fetched meanings
        if (onMeaningsFetched) {
          onMeaningsFetched(fetchedMeanings);
        }
      })
      .catch((error) => {
        console.error('[TokenArea] Failed to fetch meanings:', error);
        setMeanings([]);
        setIsLoading(false);
        // Notify parent even on error (empty array)
        if (onMeaningsFetched) {
          onMeaningsFetched([]);
        }
      });
  }, [selectedToken, onMeaningsFetched]);
  
  return (
    <div
      className="relative h-full w-full bg-black text-white p-6 overflow-auto pointer-events-auto box-border border-l-[3px] border-l-[#e50914] border-t-0 border-r-0 border-b-0 text-base"
    >
      {selectedToken ? (
        isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#e50914] border-t-transparent"></div>
              <div className="text-white/60 text-xl">Loading meanings...</div>
            </div>
          </div>
        ) : meanings.length > 0 ? (
          <div>
            <div className="mb-6 pb-4 border-b border-white/10">
              <h3 className="text-white text-3xl font-semibold mb-2">
                Meanings for:{' '}
                <span className="text-[#e50914] font-bold">{selectedToken}</span>
              </h3>
            </div>
            <div className="space-y-5">
              {meanings.map((meaning, index) => {
                const isSelected = selectedMeaningId !== null && 
                  selectedMeaningId !== undefined && 
                  meaning.id === selectedMeaningId;
                const canSelect = subtitleId !== null && 
                  subtitleId !== undefined && 
                  tokenIndex !== null && 
                  tokenIndex !== undefined && 
                  onMeaningSelect !== undefined;
                
                return (
                  <MeaningCard
                    key={meaning.id.toString()}
                    meaning={meaning}
                    index={index}
                    isSelected={isSelected}
                    canSelect={canSelect}
                    tokenIndex={tokenIndex}
                    onMeaningSelect={onMeaningSelect}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-white/40 text-4xl mb-3">📖</div>
              <div className="text-white/60 text-xl">
                No meanings found for:{' '}
                <span className="text-[#e50914] font-semibold">{selectedToken}</span>
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-white/40 text-4xl mb-3">👆</div>
            <div className="text-white/60 text-xl">Click a token to see its meanings</div>
          </div>
        </div>
      )}
    </div>
  );
};
