import React, { useEffect, useState, useRef } from 'react';
import { fetchMeaningsByWordTh, updateMeaning, deleteMeaning, createMeaning } from '../supabase';
import type { MeaningTh } from '@/schemas/meaningThSchema';

interface MeaningCardProps {
  meaning: MeaningTh;
  index: number;
  isSelected: boolean;
  canSelect: boolean;
  tokenIndex: number | null | undefined;
  onMeaningSelect?: (tokenIndex: number, meaningId: bigint) => void;
  onMeaningUpdate?: (meaning: MeaningTh) => void;
  onMeaningDelete?: (meaningId: bigint) => void;
}

const MeaningCard: React.FC<MeaningCardProps> = ({
  meaning,
  index,
  isSelected,
  canSelect,
  tokenIndex,
  onMeaningSelect,
  onMeaningUpdate,
  onMeaningDelete,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(meaning.definition_th);
  const [editedSource, setEditedSource] = useState(meaning.source || '');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handleClick = () => {
    // Only trigger click if no text is selected and not editing
    if (!isEditing && window.getSelection()?.toString().length === 0) {
      if (canSelect && tokenIndex !== null && tokenIndex !== undefined) {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:MeaningCard:handleClick',message:'Meaning card clicked',data:{tokenIndex,meaningId:meaning.id.toString(),definitionTh:meaning.definition_th.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'MEANING_SELECT'})}).catch(()=>{});
        // #endregion
        onMeaningSelect?.(tokenIndex, meaning.id);
      }
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditedText(meaning.definition_th);
    setEditedSource(meaning.source || '');
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedText(meaning.definition_th);
    setEditedSource(meaning.source || '');
  };

  const handleSave = async () => {
    if (!editedText.trim()) {
      alert('Definition cannot be empty');
      return;
    }

    setIsSaving(true);
    try {
      const updated = await updateMeaning(meaning.id, {
        definition_th: editedText.trim(),
        source: editedSource.trim() || undefined,
      });
      setIsEditing(false);
      onMeaningUpdate?.(updated);
    } catch (error) {
      console.error('[MeaningCard] Failed to update meaning:', error);
      alert(`Failed to update meaning: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      await deleteMeaning(meaning.id);
      setShowDeleteConfirm(false);
      onMeaningDelete?.(meaning.id);
    } catch (error) {
      console.error('[MeaningCard] Failed to delete meaning:', error);
      alert(`Failed to delete meaning: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <>
      <div
        className={`bg-white/5 border rounded-lg p-6 transition-all duration-200 relative ${
          isSelected 
            ? 'border-[#e50914] bg-[#e50914]/10 shadow-lg shadow-[#e50914]/20' 
            : 'border-white/10'
        } ${
          canSelect && !isEditing
            ? 'cursor-pointer hover:bg-white/15 hover:border-[#e50914]/50 hover:shadow-lg hover:shadow-[#e50914]/10 hover:scale-[1.02]' 
            : ''
        }`}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title={canSelect && !isEditing ? 'Click to select this meaning' : undefined}
      >
        {/* Edit and Delete buttons */}
        <div className="absolute top-4 right-4 flex gap-2">
          <button
            onClick={handleEdit}
            className="p-2 rounded bg-[#e50914]/20 hover:bg-[#e50914]/40 text-[#e50914] transition-colors"
            title="Edit meaning"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={handleDeleteClick}
            className="p-2 rounded bg-[#e50914]/20 hover:bg-[#e50914]/40 text-[#e50914] transition-colors"
            title="Delete meaning"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            <div className={`font-semibold rounded-full w-14 h-14 flex items-center justify-center transition-all ${
              isSelected 
                ? 'bg-[#e50914] text-white' 
                : 'bg-[#e50914]/20 text-[#e50914]'
            }`}>
              {index + 1}
            </div>
          </div>
          <div className="flex-1 pr-16">
            {isEditing ? (
              <div className="space-y-4">
                <textarea
                  ref={textareaRef}
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-white/10 border border-white/20 rounded p-3 text-white/90 leading-loose focus:outline-none focus:border-[#e50914] resize-y min-h-[120px]"
                  placeholder="Enter definition..."
                />
                <input
                  type="text"
                  value={editedSource}
                  onChange={(e) => setEditedSource(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                  placeholder="Source (optional)"
                />
                <div className="flex gap-3">
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !editedText.trim()}
                    className="px-6 py-2 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={isSaving}
                    className="px-6 py-2 bg-white/10 text-white rounded hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <div className="text-white/60">
                  Press Ctrl+Enter to save, Esc to cancel
                </div>
              </div>
            ) : (
              <>
                <div className="text-white/90 leading-loose select-text">
                  {meaning.definition_th}
                </div>
                {meaning.source && (
                  <div className="mt-2 text-white/60 select-text">
                    Source: {meaning.source}
                  </div>
                )}
                {isSelected && (
                  <div className="mt-2 text-[#e50914] font-semibold">
                    ✓ Selected
                  </div>
                )}
                {canSelect && !isSelected && isHovered && (
                  <div className="mt-2 text-white/60 font-medium animate-pulse">
                    Click to select
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-black border-2 border-[#e50914] rounded-lg p-8 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-white font-semibold mb-4">Delete Meaning?</div>
            <div className="text-white/80 mb-2">
              Are you sure you want to delete this meaning?
            </div>
            <div className="text-white/60 mb-6">
              "{meaning.definition_th.substring(0, 50)}{meaning.definition_th.length > 50 ? '...' : ''}"
            </div>
            <div className="flex gap-4">
              <button
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="flex-1 px-6 py-3 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="flex-1 px-6 py-3 bg-white/10 text-white rounded hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
  const [isCreating, setIsCreating] = useState(false);
  const [newDefinition, setNewDefinition] = useState('');
  const [newSource, setNewSource] = useState('');
  const [isSavingNew, setIsSavingNew] = useState(false);
  const newTextareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Function to fetch meanings
  const fetchMeanings = async () => {
    if (!selectedToken) {
      setMeanings([]);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    try {
      const fetchedMeanings = await fetchMeaningsByWordTh(selectedToken);
      setMeanings(fetchedMeanings);
      // Notify parent component of fetched meanings
      if (onMeaningsFetched) {
        onMeaningsFetched(fetchedMeanings);
      }
    } catch (error) {
      console.error('[TokenArea] Failed to fetch meanings:', error);
      setMeanings([]);
      // Notify parent even on error (empty array)
      if (onMeaningsFetched) {
        onMeaningsFetched([]);
      }
    } finally {
      setIsLoading(false);
    }
  };
  
  // Fetch meanings when selectedToken changes
  useEffect(() => {
    fetchMeanings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedToken]);
  
  // Focus textarea when entering create mode
  useEffect(() => {
    if (isCreating && newTextareaRef.current) {
      newTextareaRef.current.focus();
    }
  }, [isCreating]);
  
  // Handle meaning update
  const handleMeaningUpdate = async (updatedMeaning: MeaningTh) => {
    setMeanings(prev => prev.map(m => m.id === updatedMeaning.id ? updatedMeaning : m));
    // Refresh to ensure consistency
    await fetchMeanings();
  };
  
  // Handle meaning delete
  const handleMeaningDelete = async (meaningId: bigint) => {
    setMeanings(prev => prev.filter(m => m.id !== meaningId));
    // Refresh to ensure consistency
    await fetchMeanings();
  };
  
  // Handle create new meaning
  const handleCreateNew = () => {
    setIsCreating(true);
    setNewDefinition('');
    setNewSource('');
  };
  
  const handleCancelCreate = () => {
    setIsCreating(false);
    setNewDefinition('');
    setNewSource('');
  };
  
  const handleSaveNew = async () => {
    if (!selectedToken || !newDefinition.trim()) {
      alert('Definition cannot be empty');
      return;
    }
    
    setIsSavingNew(true);
    try {
      const newMeaning = await createMeaning(selectedToken, newDefinition.trim(), newSource.trim() || undefined);
      setMeanings(prev => [...prev, newMeaning].sort((a, b) => {
        // Sort by ID (newer meanings typically have higher IDs)
        return Number(a.id - b.id);
      }));
      setIsCreating(false);
      setNewDefinition('');
      setNewSource('');
      // Refresh to ensure consistency
      await fetchMeanings();
    } catch (error) {
      console.error('[TokenArea] Failed to create meaning:', error);
      alert(`Failed to create meaning: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSavingNew(false);
    }
  };
  
  const handleNewKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancelCreate();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveNew();
    }
  };
  
  return (
    <div
      className="relative h-full w-full bg-black text-white p-6 overflow-auto pointer-events-auto box-border border-l-[3px] border-l-[#e50914] border-t-0 border-r-0 border-b-0 text-4xl select-text"
    >
      {selectedToken ? (
        isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#e50914] border-t-transparent"></div>
              <div className="text-white/60 select-text">Loading meanings...</div>
            </div>
          </div>
        ) : meanings.length > 0 ? (
          <div>
            <div className="mb-6 pb-4 border-b border-white/10">
              <div className="text-white font-semibold mb-2 select-text">
                Meanings for:{' '}
                <span className="text-[#e50914] font-bold">{selectedToken}</span>
              </div>
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
                    onMeaningUpdate={handleMeaningUpdate}
                    onMeaningDelete={handleMeaningDelete}
                  />
                );
              })}
              
              {/* Add New Meaning Form */}
              {isCreating ? (
                <div className="bg-white/5 border-2 border-dashed border-[#e50914]/50 rounded-lg p-6">
                  <div className="space-y-4">
                    <div className="text-white font-semibold mb-4">Add New Meaning</div>
                    <textarea
                      ref={newTextareaRef}
                      value={newDefinition}
                      onChange={(e) => setNewDefinition(e.target.value)}
                      onKeyDown={handleNewKeyDown}
                      className="w-full bg-white/10 border border-white/20 rounded p-3 text-white/90 leading-loose focus:outline-none focus:border-[#e50914] resize-y min-h-[120px]"
                      placeholder="Enter definition..."
                    />
                    <input
                      type="text"
                      value={newSource}
                      onChange={(e) => setNewSource(e.target.value)}
                      onKeyDown={handleNewKeyDown}
                      className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                      placeholder="Source (optional)"
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={handleSaveNew}
                        disabled={isSavingNew || !newDefinition.trim()}
                        className="px-6 py-2 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
                      >
                        {isSavingNew ? 'Creating...' : 'Create'}
                      </button>
                      <button
                        onClick={handleCancelCreate}
                        disabled={isSavingNew}
                        className="px-6 py-2 bg-white/10 text-white rounded hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="text-white/60">
                      Press Ctrl+Enter to save, Esc to cancel
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleCreateNew}
                  className="w-full py-6 bg-[#e50914] text-white rounded-lg hover:bg-[#e50914]/80 transition-colors font-semibold flex items-center justify-center gap-3"
                >
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add New Meaning
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-white/40 text-7xl mb-3">📖</div>
              <div className="text-white/60 select-text">
                No meanings found for:{' '}
                <span className="text-[#e50914] font-semibold">{selectedToken}</span>
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-white/40 text-7xl mb-3">👆</div>
            <div className="text-white/60 select-text">Click a token to see its meanings</div>
          </div>
        </div>
      )}
    </div>
  );
};
