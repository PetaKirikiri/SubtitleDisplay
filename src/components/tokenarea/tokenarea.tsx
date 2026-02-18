import React, { useEffect, useState, useRef } from 'react';
import { supabase, fetchWord, updateMeaning, deleteMeaning, createMeaning, saveWordOnly } from '../../supabase';
import { getMeanings, setMeaningsCache, updateTokenMeaningOptimistic, saveTokenMeaningInBackground } from '../../hooks/useSubtitles';
import { upsertUserWord } from '../../hooks/useUserWords';
import type { WordTh } from '@/schemas/wordThSchema';
import type { MeaningTh } from '@/schemas/meaningThSchema';
import type { SubtitleTh } from '@/schemas/subtitleThSchema';
import { SubtitleEditor } from './SubtitleEditor';
import { extractEpisodeFromNetflixPage } from '../../services/netflixMetadataExtractor';

function getInitials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return '?';
}

interface ProfileButtonProps {
  userName: string | null;
  userEmail: string | null;
  userAvatarUrl: string | null;
  onSignOut: () => void;
}

const ProfileButton: React.FC<ProfileButtonProps> = ({ userName, userEmail, userAvatarUrl, onSignOut }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-10 h-10 rounded-full overflow-hidden bg-white/10 border border-white/20 hover:bg-white/20 flex items-center justify-center text-white font-semibold text-sm transition-colors"
        title="Profile"
      >
        {userAvatarUrl ? (
          <img src={userAvatarUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          getInitials(userName, userEmail)
        )}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 w-40 py-1 bg-black border border-white/20 rounded shadow-lg z-50">
          <button
            onClick={() => setOpen(false)}
            className="w-full px-4 py-2 text-left text-white hover:bg-white/10 text-sm"
          >
            Settings
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-full px-4 py-2 text-left text-white hover:bg-white/10 text-sm"
          >
            Words
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="w-full px-4 py-2 text-left text-white hover:bg-white/10 text-sm"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

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
  const [editedDefinitionEng, setEditedDefinitionEng] = useState(meaning.definition_eng);
  const [editedPosEng, setEditedPosEng] = useState(meaning.pos_eng);
  const [editedPosTh, setEditedPosTh] = useState(meaning.pos_th);
  const [editedSource, setEditedSource] = useState(meaning.source || '');
  const [editedLabelEng, setEditedLabelEng] = useState(meaning.label_eng || '');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync state with props ONLY when NOT editing - prevents defocus during editing
  useEffect(() => {
    if (!isEditing) {
      setEditedText(meaning.definition_th);
      setEditedDefinitionEng(meaning.definition_eng);
      setEditedPosEng(meaning.pos_eng);
      setEditedPosTh(meaning.pos_th);
      setEditedSource(meaning.source || '');
      setEditedLabelEng(meaning.label_eng || '');
    }
  }, [meaning.definition_th, meaning.definition_eng, meaning.pos_eng, meaning.pos_th, meaning.source, meaning.label_eng, isEditing]);

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
    setEditedDefinitionEng(meaning.definition_eng);
    setEditedPosEng(meaning.pos_eng);
    setEditedPosTh(meaning.pos_th);
    setEditedSource(meaning.source || '');
    setEditedLabelEng(meaning.label_eng || '');
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedText(meaning.definition_th);
    setEditedDefinitionEng(meaning.definition_eng);
    setEditedPosEng(meaning.pos_eng);
    setEditedPosTh(meaning.pos_th);
    setEditedSource(meaning.source || '');
    setEditedLabelEng(meaning.label_eng || '');
  };

  const handleSave = async () => {
    if (!editedText.trim()) {
      alert('Definition (Thai) cannot be empty');
      return;
    }
    
    if (!editedDefinitionEng.trim()) {
      alert('Definition (English) cannot be empty');
      return;
    }
    
    if (!editedPosEng.trim()) {
      alert('Part of speech (English) cannot be empty');
      return;
    }
    
    if (!editedPosTh.trim()) {
      alert('Part of speech (Thai) cannot be empty');
      return;
    }

    setIsSaving(true);
    try {
      const updated = await updateMeaning(meaning.id, {
        definition_th: editedText.trim(),
        definition_eng: editedDefinitionEng.trim(),
        pos_eng: editedPosEng.trim(),
        pos_th: editedPosTh.trim(),
        source: editedSource.trim() || undefined,
        label_eng: editedLabelEng.trim() || undefined,
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
                <div>
                  <div className="block text-white/70 text-sm mb-1">Definition (Thai)</div>
                  <textarea
                    ref={textareaRef}
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-white/10 border border-white/20 rounded p-3 text-white/90 leading-loose focus:outline-none focus:border-[#e50914] resize-y min-h-[120px]"
                    placeholder="Enter Thai definition..."
                  />
                </div>
                <div>
                  <div className="block text-white/70 text-sm mb-1">Definition (English)</div>
                  <textarea
                    value={editedDefinitionEng}
                    onChange={(e) => setEditedDefinitionEng(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-white/10 border border-white/20 rounded p-3 text-white/90 leading-loose focus:outline-none focus:border-[#e50914] resize-y min-h-[120px]"
                    placeholder="Enter English definition..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="block text-white/70 text-sm mb-1">POS (Thai)</div>
                    <input
                      type="text"
                      value={editedPosTh}
                      onChange={(e) => setEditedPosTh(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                      placeholder="Part of speech (Thai)"
                    />
                  </div>
                  <div>
                    <div className="block text-white/70 text-sm mb-1">POS (English)</div>
                    <input
                      type="text"
                      value={editedPosEng}
                      onChange={(e) => setEditedPosEng(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                      placeholder="Part of speech (English)"
                    />
                  </div>
                </div>
                <div>
                  <div className="block text-white/70 text-sm mb-1">Label (English) (optional)</div>
                  <input
                    type="text"
                    value={editedLabelEng}
                    onChange={(e) => setEditedLabelEng(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                    placeholder="English label (optional)"
                  />
                </div>
                <div>
                  <div className="block text-white/70 text-sm mb-1">Source (optional)</div>
                  <input
                    type="text"
                    value={editedSource}
                    onChange={(e) => setEditedSource(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                    placeholder="Source (optional)"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !editedText.trim() || !editedDefinitionEng.trim() || !editedPosEng.trim() || !editedPosTh.trim()}
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
                <div className="mb-3">
                  {meaning.label_eng && (
                    <div className="mb-3 px-4 py-2 bg-[#e50914]/30 text-[#e50914] rounded text-3xl font-bold select-text border border-[#e50914]/50">
                      {meaning.label_eng}
                    </div>
                  )}
                  <div className="flex gap-2 mb-2">
                    <div className="px-4 py-3 bg-[#e50914]/20 text-[#e50914] rounded text-2xl font-semibold select-text">
                      {meaning.pos_th}
                    </div>
                    <div className="px-4 py-3 bg-white/10 text-white/70 rounded text-2xl select-text">
                      {meaning.pos_eng}
                    </div>
                  </div>
                  <div className="text-white/90 leading-loose select-text">
                    {meaning.definition_th}
                  </div>
                  <div className="mt-2 text-white/70 leading-loose select-text">
                    {meaning.definition_eng}
                  </div>
                </div>
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
  isLoggedIn: boolean;
  onLoginSuccess?: () => void;
  selectedToken: string | null;
  subtitleId?: string | null;
  tokenIndex?: number | null;
  selectedMeaningId?: bigint | null;
  subtitles?: SubtitleTh[];
  currentSubtitle?: SubtitleTh | null;
  onMeaningSelect?: (tokenIndex: number, meaningId: bigint) => void; // Called when meaning is selected - component handles save internally
  onMeaningsFetched?: (meanings: MeaningTh[]) => void;
  onMeaningSelectComplete?: () => void; // Called after save completes - parent can refresh
  onMeaningUpdate?: (meaning: MeaningTh) => void; // Called when a meaning is updated - parent can update cache
  showEditor?: boolean; // If true, show SubtitleEditor instead of meaning selection UI
  onSubtitleUpdate?: (updatedSubtitle: SubtitleTh) => void; // Called when subtitle is updated via editor
  onToggleEditor?: () => void; // Called when toggle button is clicked
  showUserMode?: boolean; // If true, show word metadata + save instead of meanings
  onToggleUserMode?: () => void;
  userId?: string | null; // Current user id for saving words
  userName?: string | null;
  userEmail?: string | null;
  userAvatarUrl?: string | null;
  onWordSaved?: () => void; // Called after user saves a word to their list
  onExtractAndSave?: () => Promise<{ episode: { id: bigint; media_id: string; show_title?: string | null; season_number?: number | null; episode_number?: number | null; episode_title?: string | null }; subtitleCount: number } | null>;
}

export const TokenArea: React.FC<TokenAreaProps> = ({
  isLoggedIn,
  onLoginSuccess,
  selectedToken,
  subtitleId,
  tokenIndex,
  selectedMeaningId,
  subtitles = [],
  currentSubtitle = null,
  onMeaningSelect,
  onMeaningsFetched,
  onMeaningSelectComplete,
  onMeaningUpdate: onMeaningUpdateExternal,
  showEditor = false,
  onSubtitleUpdate,
  onToggleEditor,
  showUserMode = false,
  onToggleUserMode,
  userId = null,
  userName = null,
  userEmail = null,
  userAvatarUrl = null,
  onWordSaved,
  onExtractAndSave,
}) => {
  // #region agent log
  const selectedMeaningIdType = typeof selectedMeaningId;
  const selectedMeaningIdValue = selectedMeaningId?.toString() || null;
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:TokenArea',message:'TOKENAREA_RECEIVED_PROPS',data:{selectedToken,subtitleId,tokenIndex,selectedMeaningIdType,selectedMeaningIdValue},timestamp:Date.now(),runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  const [meanings, setMeanings] = useState<MeaningTh[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newDefinition, setNewDefinition] = useState('');
  const [newDefinitionEng, setNewDefinitionEng] = useState('');
  const [newPosEng, setNewPosEng] = useState('');
  const [newPosTh, setNewPosTh] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newLabelEng, setNewLabelEng] = useState('');
  const [isSavingNew, setIsSavingNew] = useState(false);
  const newTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [wordData, setWordData] = useState<WordTh | null>(null);
  const [wordLoading, setWordLoading] = useState(false);
  const [isSavingWord, setIsSavingWord] = useState(false);
  const [wordSaved, setWordSaved] = useState(false);

  const [userModeMeanings, setUserModeMeanings] = useState<MeaningTh[]>([]);
  const [episodeDebug, setEpisodeDebug] = useState<{ seed: Record<string, unknown>; subtitleCount?: number; error?: string } | null>(null);
  const [isExtractingEpisode, setIsExtractingEpisode] = useState(false);

  const handleExtractEpisodeMetadata = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleExtractEpisodeMetadata',message:'EXTRACT_BUTTON_CLICKED',data:{hasOnExtractAndSave:!!onExtractAndSave},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
    // #endregion
    setEpisodeDebug(null);
    if (onExtractAndSave) {
      setIsExtractingEpisode(true);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleExtractEpisodeMetadata',message:'CALLING_ONEXTRACTANDSAVE',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
      // #endregion
      try {
        const result = await onExtractAndSave();
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleExtractEpisodeMetadata',message:'ONEXTRACTANDSAVE_RETURNED',data:{hasResult:!!result,subtitleCount:result?.subtitleCount},timestamp:Date.now(),runId:'run1',hypothesisId:'EXTRACT'})}).catch(()=>{});
        // #endregion
        if (result) {
          const seed = {
            id: result.episode.id.toString(),
            media_id: result.episode.media_id,
            show_title: result.episode.show_title ?? null,
            season_number: result.episode.season_number ?? null,
            episode_number: result.episode.episode_number ?? null,
            episode_title: result.episode.episode_title ?? null,
          };
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleExtractEpisodeMetadata',message:'SUCCESS episode subtitles saved',data:{seed,subtitleCount:result.subtitleCount},timestamp:Date.now(),runId:'run1',hypothesisId:'H11'})}).catch(()=>{});
          // #endregion
          setEpisodeDebug({ seed, subtitleCount: result.subtitleCount });
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleExtractEpisodeMetadata',message:'Extraction returned null',data:{},timestamp:Date.now(),runId:'run1',hypothesisId:'H11'})}).catch(()=>{});
          // #endregion
          setEpisodeDebug({ seed: {}, error: 'Extraction failed - check .cursor/debug.log' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleExtractEpisodeMetadata',message:'Button handler caught error',data:{error:msg},timestamp:Date.now(),runId:'run1',hypothesisId:'H11'})}).catch(()=>{});
        // #endregion
        setEpisodeDebug({ seed: {}, error: msg });
      } finally {
        setIsExtractingEpisode(false);
      }
    } else {
      try {
        const episode = await extractEpisodeFromNetflixPage();
        if (!episode) {
          setEpisodeDebug({ seed: {}, error: 'No episode found (not on watch page or no media_id)' });
          return;
        }
        const seed = {
          id: episode.id.toString(),
          media_id: episode.media_id,
          show_title: episode.show_title ?? null,
          season_number: episode.season_number ?? null,
          episode_number: episode.episode_number ?? null,
          episode_title: episode.episode_title ?? null,
        };
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleExtractEpisodeMetadata',message:'Metadata only seed',data:{seed},timestamp:Date.now(),runId:'run1',hypothesisId:'H12'})}).catch(()=>{});
        // #endregion
        setEpisodeDebug({ seed });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleExtractEpisodeMetadata',message:'Metadata only error',data:{error:msg},timestamp:Date.now(),runId:'run1',hypothesisId:'H12'})}).catch(()=>{});
        // #endregion
        setEpisodeDebug({ seed: {}, error: msg });
      }
    }
  };

  useEffect(() => {
    if (showUserMode && selectedToken) {
      setWordData(null);
      setWordSaved(false);
      setWordLoading(true);
      setUserModeMeanings([]);
      Promise.all([fetchWord(selectedToken), getMeanings(selectedToken)])
        .then(([w, m]) => {
          setWordData(w ?? null);
          setUserModeMeanings(m ?? []);
        })
        .catch(() => {
          setWordData(null);
          setUserModeMeanings([]);
        })
        .finally(() => setWordLoading(false));
    } else {
      setWordData(null);
      setUserModeMeanings([]);
    }
  }, [showUserMode, selectedToken]);

  const handleSaveWord = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleSaveWord',message:'SAVE_WORD_ENTRY',data:{userId,selectedToken,hasUserId:!!userId,hasSelectedToken:!!selectedToken,selectedTokenLength:selectedToken?.length},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    if (!userId || !selectedToken) return;
    setIsSavingWord(true);
    setWordSaved(false);
    try {
      const row = { user_id: userId, word_id: selectedToken, status: 'saved' };
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleSaveWord',message:'BEFORE_UPSERT',data:{row},timestamp:Date.now(),runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
      await upsertUserWord(row);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleSaveWord',message:'UPSERT_SUCCESS',data:{userId,wordId:selectedToken},timestamp:Date.now(),runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      setWordSaved(true);
      onWordSaved?.();
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:handleSaveWord',message:'UPSERT_ERROR',data:{userId,selectedToken,errorMessage:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      console.error('[TokenArea] Failed to save word:', error);
      alert(`Failed to save word: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSavingWord(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError('Email and password are required');
      return;
    }
    setIsSigningIn(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      if (error) {
        setLoginError(error.message);
        return;
      }
      onLoginSuccess?.();
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = () => {
    supabase.auth.signOut();
  };

  // Function to fetch meanings (cache-first via TanStack Query)
  const fetchMeanings = async () => {
    if (!selectedToken) {
      setMeanings([]);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    try {
      // Use TanStack Query for cache-first behavior - returns cached data immediately if available
      const fetchedMeanings = await getMeanings(selectedToken);
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
  
  // Handle meaning update - UI-first: update state and cache immediately
  const handleMeaningUpdate = async (updatedMeaning: MeaningTh) => {
    const updatedMeanings = meanings.map(m => (m.id === updatedMeaning.id ? updatedMeaning : m));
    setMeanings(updatedMeanings);
    if (selectedToken) setMeaningsCache(selectedToken, updatedMeanings);
    if (onMeaningsFetched) onMeaningsFetched(updatedMeanings);
    onMeaningUpdateExternal?.(updatedMeaning);
  };
  
  // Handle meaning delete - UI-first: update state and cache immediately
  const handleMeaningDelete = async (meaningId: bigint) => {
    const updatedMeanings = meanings.filter(m => m.id !== meaningId);
    setMeanings(updatedMeanings);
    if (selectedToken) setMeaningsCache(selectedToken, updatedMeanings);
    if (onMeaningsFetched) onMeaningsFetched(updatedMeanings);
  };

  // Handle meaning selection - local-first: optimistic update, then save in background
  const handleMeaningSelectInternal = (tokenIdx: number, meaningId: bigint) => {
    if (!subtitleId) {
      console.error('[TokenArea] Cannot save meaning selection: no subtitle ID');
      return;
    }
    const lastUnderscoreIndex = subtitleId.lastIndexOf('_');
    const mediaId = lastUnderscoreIndex !== -1 ? subtitleId.substring(0, lastUnderscoreIndex) : subtitleId;

    // 1. Optimistic update - instant UI
    updateTokenMeaningOptimistic(subtitleId, tokenIdx, meaningId, mediaId);

    // 2. Notify parent to re-render (uses cache)
    onMeaningSelectComplete?.();

    // 3. Save to DB in background
    saveTokenMeaningInBackground(subtitleId, tokenIdx, meaningId, mediaId);
  };
  
  // Expose handler for external calls (e.g., hotkeys)
  useEffect(() => {
    if (subtitleId && tokenIndex !== null && tokenIndex !== undefined) {
      // Store the handler so it can be called externally
      (window as any).__tokenAreaSelectMeaning = handleMeaningSelectInternal;
    }
    return () => {
      delete (window as any).__tokenAreaSelectMeaning;
    };
  }, [subtitleId, tokenIndex]);
  
  // Handle create new meaning
  const handleCreateNew = () => {
    setIsCreating(true);
    setNewDefinition('');
    setNewDefinitionEng('');
    setNewPosEng('');
    setNewPosTh('');
    setNewSource('');
    setNewLabelEng('');
  };
  
  const handleCancelCreate = () => {
    setIsCreating(false);
    setNewDefinition('');
    setNewDefinitionEng('');
    setNewPosEng('');
    setNewPosTh('');
    setNewSource('');
    setNewLabelEng('');
  };
  
  const handleSaveNew = async () => {
    if (!selectedToken || !newDefinition.trim()) {
      alert('Definition (Thai) cannot be empty');
      return;
    }
    
    if (!newDefinitionEng.trim()) {
      alert('Definition (English) cannot be empty');
      return;
    }
    
    if (!newPosEng.trim()) {
      alert('Part of speech (English) cannot be empty');
      return;
    }
    
    if (!newPosTh.trim()) {
      alert('Part of speech (Thai) cannot be empty');
      return;
    }
    
    setIsSavingNew(true);
    try {
      // First, ensure the word exists in words_th table
      try {
        await saveWordOnly({
          word_th: selectedToken,
        });
      } catch (wordError) {
        console.warn('[TokenArea] Failed to save word to words_th (non-critical):', wordError);
        // Continue even if word save fails - meaning creation can still proceed
      }
      
      // Then create the meaning
      const newMeaning = await createMeaning(
        selectedToken, 
        newDefinition.trim(), 
        newDefinitionEng.trim(),
        newPosEng.trim(),
        newPosTh.trim(),
        newSource.trim() || undefined,
        newLabelEng.trim() || undefined
      );
      // UI-first: update state, cache, and parent immediately (no fetch - avoids stale overwrite)
      const updatedMeanings = [...meanings, newMeaning].sort((a, b) => Number(a.id - b.id));
      setMeanings(updatedMeanings);
      setMeaningsCache(selectedToken, updatedMeanings);
      if (onMeaningsFetched) onMeaningsFetched(updatedMeanings);
      setIsCreating(false);
      setNewDefinition('');
      setNewDefinitionEng('');
      setNewPosEng('');
      setNewPosTh('');
      setNewSource('');
      setNewLabelEng('');
      onMeaningUpdateExternal?.(newMeaning);
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
      data-token-area
      className="relative h-full w-full bg-black text-white p-6 overflow-auto pointer-events-auto box-border border-l-[3px] border-l-[#e50914] border-t-0 border-r-0 border-b-0 text-4xl select-text"
    >
      {!isLoggedIn ? (
        <div className="flex flex-col items-center justify-center h-full gap-4 max-w-md mx-auto">
          <div className="text-white/80 text-xl mb-2 select-text">Sign in to start</div>
          <form onSubmit={handleSignIn} className="w-full space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-white/70 text-sm mb-1">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded p-2 text-white placeholder-white/40 focus:outline-none focus:border-[#e50914] text-base"
                placeholder="you@example.com"
                autoComplete="email"
                disabled={isSigningIn}
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-white/70 text-sm mb-1">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded p-2 text-white placeholder-white/40 focus:outline-none focus:border-[#e50914] text-base"
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={isSigningIn}
              />
            </div>
            {loginError && (
              <div className="text-[#e50914] text-sm select-text" role="alert">
                {loginError}
              </div>
            )}
            <button
              type="submit"
              disabled={isSigningIn}
              className="w-full py-2 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold text-base"
            >
              {isSigningIn ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="absolute top-2 right-2 z-50 flex gap-2">
            {onToggleEditor && (
              <button
                onClick={onToggleEditor}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  showEditor
                    ? 'bg-[#e50914] text-white hover:bg-[#e50914]/80'
                    : 'bg-white/10 text-white hover:bg-white/20 border border-white/20'
                }`}
                title={showEditor ? 'Switch to Meaning Mode' : 'Switch to Editor Mode'}
              >
                {showEditor ? 'Meaning Mode' : 'Editor Mode'}
              </button>
            )}
            {onToggleUserMode && (
              <button
                onClick={onToggleUserMode}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  showUserMode
                    ? 'bg-[#e50914] text-white hover:bg-[#e50914]/80'
                    : 'bg-white/10 text-white hover:bg-white/20 border border-white/20'
                }`}
                title={showUserMode ? 'Switch to Meaning Mode' : 'Switch to User Mode'}
              >
                {showUserMode ? 'Meaning Mode' : 'User Mode'}
              </button>
            )}
            <button
              onClick={handleExtractEpisodeMetadata}
              disabled={isExtractingEpisode}
              className="px-4 py-2 rounded text-sm font-medium bg-white/10 text-white hover:bg-white/20 border border-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Extract episode metadata, VTT, save to DB, and show seed object"
            >
              {isExtractingEpisode ? 'Extracting...' : 'Extract Episode'}
            </button>
            <ProfileButton
              userName={userName}
              userEmail={userEmail}
              userAvatarUrl={userAvatarUrl}
              onSignOut={handleSignOut}
            />
          </div>

          {episodeDebug && (
            <div className="absolute top-14 right-2 z-40 w-96 max-h-64 overflow-auto bg-black/95 border border-white/20 rounded p-3 text-left">
              <div className="text-white/70 text-xs font-semibold mb-2">Seed object for episodes table</div>
              {episodeDebug.error && (
                <div className="text-[#e50914] text-sm mb-2">{episodeDebug.error}</div>
              )}
              {episodeDebug.subtitleCount !== undefined && (
                <div className="text-green-400 text-sm mb-2">Saved {episodeDebug.subtitleCount} subtitles</div>
              )}
              <pre className="text-white text-xs whitespace-pre-wrap break-words font-mono select-text">
                {JSON.stringify(episodeDebug.seed, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}
              </pre>
              <button
                onClick={() => setEpisodeDebug(null)}
                className="mt-2 text-white/60 hover:text-white text-xs"
              >
                Close
              </button>
            </div>
          )}

          {showEditor ? (
        <SubtitleEditor
          currentSubtitle={currentSubtitle}
          onSubtitleUpdate={onSubtitleUpdate}
        />
      ) : showUserMode ? (
        selectedToken ? (
          wordLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-[#e50914] border-t-transparent"></div>
                <div className="text-white select-text" style={{ fontSize: '32px' }}>Loading word...</div>
              </div>
            </div>
          ) : (
            <div
              className="space-y-4"
              style={{
                fontFamily: 'system-ui, sans-serif',
                fontSize: '32px',
                lineHeight: 1.5,
              }}
            >
              <div className="mb-6 pb-4 border-b border-white/10">
                <div className="text-white font-semibold mb-2 select-text" style={{ fontSize: '28px' }}>
                  Word
                </div>
                <div className="text-[#e50914] font-bold select-text" style={{ fontSize: '48px' }}>
                  {selectedToken}
                </div>
              </div>
              {wordData?.phonetic_en && (
                <div className="mb-4">
                  <div className="text-white/70 select-text mb-1" style={{ fontSize: '24px' }}>Phonetic</div>
                  <div className="text-white select-text" style={{ fontSize: '36px' }}>{wordData.phonetic_en}</div>
                </div>
              )}
              {wordData?.g2p && (
                <div className="mb-4">
                  <div className="text-white/70 select-text mb-1" style={{ fontSize: '24px' }}>G2P</div>
                  <div className="text-white select-text" style={{ fontSize: '36px' }}>{wordData.g2p}</div>
                </div>
              )}
              {!wordData?.phonetic_en && !wordData?.g2p && (
                <div className="text-white/60 select-text mb-4" style={{ fontSize: '28px' }}>
                  No word metadata in database
                </div>
              )}
              {userModeMeanings.length > 0 && (
                <div className="mt-6">
                  <div className="text-white/70 select-text mb-3" style={{ fontSize: '24px' }}>
                    Meanings ({userModeMeanings.length})
                  </div>
                  <div className="space-y-4">
                    {userModeMeanings.map((m, i) => (
                      <div
                        key={m.id.toString()}
                        className="bg-white/5 border border-white/10 rounded-lg p-4"
                        style={{ fontSize: '28px' }}
                      >
                        <div className="text-[#e50914] font-semibold select-text mb-2">
                          {m.label_eng || `${i + 1}`}
                        </div>
                        <div className="text-white select-text mb-1">{m.definition_th}</div>
                        <div className="text-white/80 select-text mb-1">{m.definition_eng}</div>
                        <div className="text-white/60 select-text" style={{ fontSize: '22px' }}>
                          {m.pos_th} / {m.pos_eng}
                          {m.source && ` · ${m.source}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={handleSaveWord}
                disabled={!userId || isSavingWord}
                className="mt-6 px-8 py-3 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
                style={{ fontSize: '28px' }}
              >
                {wordSaved ? 'Saved' : isSavingWord ? 'Saving...' : 'Save to my words'}
              </button>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-white/40 mb-3" style={{ fontSize: '64px' }}>👆</div>
              <div className="text-white/60 select-text" style={{ fontSize: '32px' }}>
                Click a token to see word metadata and save
              </div>
            </div>
          </div>
        )
      ) : selectedToken ? (
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
                const meaningIdType = typeof meaning.id;
                const selectedMeaningIdType = typeof selectedMeaningId;
                const directComparison = meaning.id === selectedMeaningId;
                const isSelected = selectedMeaningId !== null && 
                  selectedMeaningId !== undefined && 
                  directComparison;
                
                // #region agent log
                if (index === 0 || isSelected) {
                  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea.tsx:render',message:'TOKENAREA_HIGHLIGHT_CHECK',data:{index,selectedMeaningId:selectedMeaningId?.toString() || null,meaningId:meaning.id.toString(),meaningIdType,selectedMeaningIdType,directComparison,isSelected,meaningCount:meanings.length},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                }
                // #endregion
                
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
                    onMeaningSelect={tokenIndex !== null && tokenIndex !== undefined ? (idx, meaningId) => {
                      handleMeaningSelectInternal(idx, meaningId);
                    } : undefined}
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
                    <div>
                      <div className="block text-white/70 text-sm mb-1">Definition (Thai)</div>
                      <textarea
                        ref={newTextareaRef}
                        value={newDefinition}
                        onChange={(e) => setNewDefinition(e.target.value)}
                        onKeyDown={handleNewKeyDown}
                        className="w-full bg-white/10 border border-white/20 rounded p-3 text-white/90 leading-loose focus:outline-none focus:border-[#e50914] resize-y min-h-[120px]"
                        placeholder="Enter Thai definition..."
                      />
                    </div>
                    <div>
                      <div className="block text-white/70 text-sm mb-1">Definition (English)</div>
                      <textarea
                        value={newDefinitionEng}
                        onChange={(e) => setNewDefinitionEng(e.target.value)}
                        onKeyDown={handleNewKeyDown}
                        className="w-full bg-white/10 border border-white/20 rounded p-3 text-white/90 leading-loose focus:outline-none focus:border-[#e50914] resize-y min-h-[120px]"
                        placeholder="Enter English definition..."
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="block text-white/70 text-sm mb-1">POS (Thai)</div>
                        <input
                          type="text"
                          value={newPosTh}
                          onChange={(e) => setNewPosTh(e.target.value)}
                          onKeyDown={handleNewKeyDown}
                          className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                          placeholder="Part of speech (Thai)"
                        />
                      </div>
                      <div>
                        <div className="block text-white/70 text-sm mb-1">POS (English)</div>
                        <input
                          type="text"
                          value={newPosEng}
                          onChange={(e) => setNewPosEng(e.target.value)}
                          onKeyDown={handleNewKeyDown}
                          className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                          placeholder="Part of speech (English)"
                        />
                      </div>
                    </div>
                    <div>
                      <div className="block text-white/70 text-sm mb-1">Label (English) (optional)</div>
                      <input
                        type="text"
                        value={newLabelEng}
                        onChange={(e) => setNewLabelEng(e.target.value)}
                        onKeyDown={handleNewKeyDown}
                        className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                        placeholder="English label (optional)"
                      />
                    </div>
                    <div>
                      <div className="block text-white/70 text-sm mb-1">Source (optional)</div>
                      <input
                        type="text"
                        value={newSource}
                        onChange={(e) => setNewSource(e.target.value)}
                        onKeyDown={handleNewKeyDown}
                        className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                        placeholder="Source (optional)"
                      />
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleSaveNew}
                        disabled={isSavingNew || !newDefinition.trim() || !newDefinitionEng.trim() || !newPosEng.trim() || !newPosTh.trim()}
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
          <div>
            <div className="mb-6 pb-4 border-b border-white/10">
              <div className="text-white font-semibold mb-2 select-text">
                Meanings for:{' '}
                <span className="text-[#e50914] font-bold">{selectedToken}</span>
              </div>
              <div className="text-white/60 select-text">
                No meanings found
              </div>
            </div>
            
            {/* Add New Meaning Form - shown when no meanings exist */}
            {isCreating ? (
              <div className="bg-white/5 border-2 border-dashed border-[#e50914]/50 rounded-lg p-6">
                <div className="space-y-4">
                  <div className="text-white font-semibold mb-4">Add New Meaning</div>
                  <div>
                    <div className="block text-white/70 text-sm mb-1">Definition (Thai)</div>
                    <textarea
                      ref={newTextareaRef}
                      value={newDefinition}
                      onChange={(e) => setNewDefinition(e.target.value)}
                      onKeyDown={handleNewKeyDown}
                      className="w-full bg-white/10 border border-white/20 rounded p-3 text-white/90 leading-loose focus:outline-none focus:border-[#e50914] resize-y min-h-[120px]"
                      placeholder="Enter Thai definition..."
                    />
                  </div>
                  <div>
                    <div className="block text-white/70 text-sm mb-1">Definition (English)</div>
                    <textarea
                      value={newDefinitionEng}
                      onChange={(e) => setNewDefinitionEng(e.target.value)}
                      onKeyDown={handleNewKeyDown}
                      className="w-full bg-white/10 border border-white/20 rounded p-3 text-white/90 leading-loose focus:outline-none focus:border-[#e50914] resize-y min-h-[120px]"
                      placeholder="Enter English definition..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="block text-white/70 text-sm mb-1">POS (Thai)</div>
                      <input
                        type="text"
                        value={newPosTh}
                        onChange={(e) => setNewPosTh(e.target.value)}
                        onKeyDown={handleNewKeyDown}
                        className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                        placeholder="Part of speech (Thai)"
                      />
                    </div>
                    <div>
                      <div className="block text-white/70 text-sm mb-1">POS (English)</div>
                      <input
                        type="text"
                        value={newPosEng}
                        onChange={(e) => setNewPosEng(e.target.value)}
                        onKeyDown={handleNewKeyDown}
                        className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                        placeholder="Part of speech (English)"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="block text-white/70 text-sm mb-1">Label (English) (optional)</div>
                    <input
                      type="text"
                      value={newLabelEng}
                      onChange={(e) => setNewLabelEng(e.target.value)}
                      onKeyDown={handleNewKeyDown}
                      className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                      placeholder="English label (optional)"
                    />
                  </div>
                  <div>
                    <div className="block text-white/70 text-sm mb-1">Source (optional)</div>
                    <input
                      type="text"
                      value={newSource}
                      onChange={(e) => setNewSource(e.target.value)}
                      onKeyDown={handleNewKeyDown}
                      className="w-full bg-white/10 border border-white/20 rounded p-2 text-white/90 focus:outline-none focus:border-[#e50914]"
                      placeholder="Source (optional)"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleSaveNew}
                      disabled={isSavingNew || !newDefinition.trim() || !newDefinitionEng.trim() || !newPosEng.trim() || !newPosTh.trim()}
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
        )
      ) : (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-white/40 text-7xl mb-3">👆</div>
            <div className="text-white/60 select-text">Click a token to see its meanings</div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
