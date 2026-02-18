/**
 * Subtitle Editor Component
 * 
 * Displays editable inputs for subtitle Thai text and tokens array
 * Allows editing individual tokens by clicking on them
 */

import React, { useState, useEffect } from 'react';
import type { SubtitleTh, TokenObject } from '@/schemas/subtitleThSchema';
import type { WordTh } from '@/schemas/wordThSchema';
import { updateSubtitleThaiText, updateTokenText, updateTokensArray, updateSubtitleTiming } from '../subarea/helpers/subtitleEditor';
import { fetchWord, saveWordOnly } from '../../supabase';

export interface SubtitleEditorProps {
  currentSubtitle: SubtitleTh | null;
  onSubtitleUpdate?: (updatedSubtitle: SubtitleTh) => void;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({
  currentSubtitle,
  onSubtitleUpdate,
}) => {
  const [editedThai, setEditedThai] = useState('');
  const [isEditingThai, setIsEditingThai] = useState(false);
  const [isSavingThai, setIsSavingThai] = useState(false);
  
  const [editingTokenIndex, setEditingTokenIndex] = useState<number | null>(null);
  const [editedTokenText, setEditedTokenText] = useState('');
  const [isSavingToken, setIsSavingToken] = useState(false);
  const [tokenWordData, setTokenWordData] = useState<WordTh | null>(null);
  const [isLoadingWordData, setIsLoadingWordData] = useState(false);
  
  // Tokens array editing state
  const [editedTokensString, setEditedTokensString] = useState('');
  const [isEditingTokensArray, setIsEditingTokensArray] = useState(false);
  const [isSavingTokensArray, setIsSavingTokensArray] = useState(false);
  
  // Timing editing state
  const [editedStartSecTh, setEditedStartSecTh] = useState<string>('');
  const [editedEndSecTh, setEditedEndSecTh] = useState<string>('');
  const [isEditingTiming, setIsEditingTiming] = useState(false);
  const [isSavingTiming, setIsSavingTiming] = useState(false);
  
  // Editing state for word information fields
  const [editingG2P, setEditingG2P] = useState(false);
  const [editedG2P, setEditedG2P] = useState('');
  const [editingPhonetic, setEditingPhonetic] = useState(false);
  const [editedPhonetic, setEditedPhonetic] = useState('');
  const [isSavingWordData, setIsSavingWordData] = useState(false);
  
  // Track previous subtitle ID to detect when subtitle changes (not just updates)
  const prevSubtitleIdRef = React.useRef<string | null>(null);
  
  // Initialize when subtitle ID changes (different subtitle)
  useEffect(() => {
    if (currentSubtitle) {
      const subtitleIdChanged = prevSubtitleIdRef.current !== currentSubtitle.id;
      
      if (subtitleIdChanged) {
        // Different subtitle - reset everything
        prevSubtitleIdRef.current = currentSubtitle.id;
        setEditedThai(currentSubtitle.thai || '');
        setIsEditingThai(false);
        setEditingTokenIndex(null);
        setEditedTokenText('');
        setTokenWordData(null);
        setEditingG2P(false);
        setEditedG2P('');
        setEditingPhonetic(false);
        setEditedPhonetic('');
        setIsEditingTokensArray(false);
        // Initialize tokens string
        const tokens = currentSubtitle.tokens_th?.tokens || [];
        const tokensString = tokens.map(t => typeof t === 'string' ? t : t.t).join(' ');
        setEditedTokensString(tokensString);
        // Initialize timing fields
        setEditedStartSecTh(currentSubtitle.start_sec_th?.toString() || '');
        setEditedEndSecTh(currentSubtitle.end_sec_th?.toString() || '');
        setIsEditingTiming(false);
      } else {
        // Same subtitle ID - refresh Thai text and tokens string (subtitle was updated)
        // ONLY update if NOT currently editing those fields
        if (!isEditingThai) {
          setEditedThai(currentSubtitle.thai || '');
        }
        if (!isEditingTokensArray) {
          const tokens = currentSubtitle.tokens_th?.tokens || [];
          const tokensString = tokens.map(t => typeof t === 'string' ? t : t.t).join(' ');
          setEditedTokensString(tokensString);
        }
        if (!isEditingTiming) {
          setEditedStartSecTh(currentSubtitle.start_sec_th?.toString() || '');
          setEditedEndSecTh(currentSubtitle.end_sec_th?.toString() || '');
        }
      }
    }
  }, [currentSubtitle?.id, isEditingThai, isEditingTokensArray, isEditingTiming]);
  
  // Refresh tokens display when tokens array changes (for token buttons and string display)
  // This ensures individual token buttons update when tokens array changes via space-separated editor
  // CRITICAL: Only update when subtitle ID changes or when NOT editing - never during keystrokes
  const tokensStringRef = React.useRef<string>('');
  useEffect(() => {
    if (currentSubtitle && !isEditingTokensArray) {
      const tokens = currentSubtitle.tokens_th?.tokens || [];
      const tokensString = tokens.map(t => typeof t === 'string' ? t : t.t).join(' ');
      // Only update if the string actually changed
      if (tokensString !== tokensStringRef.current) {
        tokensStringRef.current = tokensString;
        setEditedTokensString(tokensString);
      }
    }
  }, [currentSubtitle?.id, isEditingTokensArray]); // Only depend on ID, not the whole object
  
  // Refresh word data when subtitle updates (same ID) and we're editing a token
  // This ensures we have latest word data after subtitle is updated via onSubtitleUpdate
  // CRITICAL: Only run when currentSubtitle ID changes, NOT on every keystroke
  const prevSubtitleForRefreshRef = React.useRef<SubtitleTh | null>(null);
  useEffect(() => {
    if (currentSubtitle && editingTokenIndex !== null && editedTokenText) {
      const subtitleIdChanged = prevSubtitleForRefreshRef.current?.id !== currentSubtitle.id;
      const subtitleWasUpdated = !subtitleIdChanged && prevSubtitleForRefreshRef.current !== null;
      
      if (subtitleWasUpdated) {
        // Subtitle was updated (same ID) - refresh word data ONLY after save
        setIsLoadingWordData(true);
        fetchWord(editedTokenText).then(wordData => {
          setTokenWordData(wordData);
        }).catch(error => {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SubtitleEditor.tsx:useEffect',message:'Failed to refresh word data',data:{tokenText:editedTokenText,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
          // #endregion
          setTokenWordData(null);
        }).finally(() => {
          setIsLoadingWordData(false);
        });
      }
      
      prevSubtitleForRefreshRef.current = currentSubtitle;
    }
  }, [currentSubtitle?.id, editingTokenIndex]); // Removed editedTokenText - only update on subtitle ID change or token selection change
  
  // Initialize edited word data when tokenWordData changes
  useEffect(() => {
    if (tokenWordData) {
      setEditedG2P(tokenWordData.g2p || '');
      setEditedPhonetic(tokenWordData.phonetic_en || '');
      setEditingG2P(false);
      setEditingPhonetic(false);
    }
  }, [tokenWordData]);
  
  if (!currentSubtitle) {
    return (
      <div className="p-6 text-white/60" style={{ fontSize: '48px' }}>
        No subtitle selected for editing
      </div>
    );
  }
  
  const tokens = currentSubtitle.tokens_th?.tokens || [];
  
  const handleThaiEdit = () => {
    // Defocus any token editing
    setEditingTokenIndex(null);
    setEditedTokenText('');
    setTokenWordData(null);
    setIsEditingThai(true);
  };
  
  const handleThaiSave = async () => {
    if (!editedThai.trim()) {
      alert('Thai text cannot be empty');
      return;
    }
    
    setIsSavingThai(true);
    try {
      const updatedSubtitle = await updateSubtitleThaiText(currentSubtitle.id, editedThai);
      setIsEditingThai(false);
      onSubtitleUpdate?.(updatedSubtitle);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SubtitleEditor.tsx:handleThaiSave',message:'Failed to update subtitle Thai text',data:{subtitleId:currentSubtitle.id,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      alert(`Failed to update subtitle: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSavingThai(false);
    }
  };
  
  const handleThaiCancel = () => {
    setEditedThai(currentSubtitle.thai || '');
    setIsEditingThai(false);
  };
  
  const handleTokenClick = async (index: number) => {
    // Defocus Thai editing if active
    if (isEditingThai) {
      setIsEditingThai(false);
      setEditedThai(currentSubtitle.thai || '');
    }
    
    const token = tokens[index];
    const tokenText = typeof token === 'string' ? token : token.t;
    setEditingTokenIndex(index);
    setEditedTokenText(tokenText);
    
    // Fetch word data (g2p, phonetic_en) from words_th table
    setIsLoadingWordData(true);
    setTokenWordData(null);
    try {
      const wordData = await fetchWord(tokenText);
      setTokenWordData(wordData);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SubtitleEditor.tsx:handleTokenClick',message:'Failed to fetch word data',data:{tokenText,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      // Don't show error to user - word might not exist in words_th table
    } finally {
      setIsLoadingWordData(false);
    }
  };
  
  const handleTokenSave = async () => {
    if (!editedTokenText.trim()) {
      alert('Token text cannot be empty');
      return;
    }
    
    if (editingTokenIndex === null) {
      return;
    }
    
    const oldTokenText = typeof tokens[editingTokenIndex] === 'string' 
      ? tokens[editingTokenIndex] 
      : tokens[editingTokenIndex].t;
    const tokenTextChanged = oldTokenText !== editedTokenText.trim();
    
    setIsSavingToken(true);
    try {
      const updatedSubtitle = await updateTokenText(
        currentSubtitle.id,
        editingTokenIndex,
        editedTokenText
      );
      
      // If token text changed, refetch word data for the new token text
      if (tokenTextChanged) {
        setIsLoadingWordData(true);
        setTokenWordData(null);
        setEditingG2P(false);
        setEditingPhonetic(false);
        try {
          const wordData = await fetchWord(editedTokenText.trim());
          setTokenWordData(wordData);
        } catch (error) {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SubtitleEditor.tsx:handleTokenSave',message:'Failed to fetch word data for new token',data:{tokenText:editedTokenText.trim(),error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
          // #endregion
          // Word might not exist - that's okay
        } finally {
          setIsLoadingWordData(false);
        }
      }
      
      setEditingTokenIndex(null);
      setEditedTokenText('');
      onSubtitleUpdate?.(updatedSubtitle);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SubtitleEditor.tsx:handleTokenSave',message:'Failed to update token text',data:{subtitleId:currentSubtitle.id,tokenIndex:editingTokenIndex,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      alert(`Failed to update token: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSavingToken(false);
    }
  };
  
  const handleTokenCancel = () => {
    setEditingTokenIndex(null);
    setEditedTokenText('');
    setTokenWordData(null);
    setEditingG2P(false);
    setEditingPhonetic(false);
  };
  
  const handleSaveWordData = async () => {
    if (editingTokenIndex === null) {
      return;
    }
    
    const token = tokens[editingTokenIndex];
    const tokenText = typeof token === 'string' ? token : token.t;
    
    setIsSavingWordData(true);
    try {
      const updatedWord = await saveWordOnly({
        word_th: tokenText,
        g2p: editedG2P.trim() || undefined,
        phonetic_en: editedPhonetic.trim() || undefined,
      });
      // Update local state with fresh data from DB
      setTokenWordData(updatedWord);
      setEditingG2P(false);
      setEditingPhonetic(false);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SubtitleEditor.tsx:handleSaveWordData',message:'Failed to save word data',data:{wordTh:editedTokenText,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      alert(`Failed to save word data: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSavingWordData(false);
    }
  };
  
  const handleCancelWordData = () => {
    if (tokenWordData) {
      setEditedG2P(tokenWordData.g2p || '');
      setEditedPhonetic(tokenWordData.phonetic_en || '');
    }
    setEditingG2P(false);
    setEditingPhonetic(false);
  };
  
  const handleTokensArrayEdit = () => {
    // Defocus any other editing
    setIsEditingThai(false);
    setEditingTokenIndex(null);
    setEditedTokenText('');
    setTokenWordData(null);
    setIsEditingTokensArray(true);
  };
  
  const handleTokensArraySave = async () => {
    if (!editedTokensString.trim()) {
      alert('Tokens array cannot be empty');
      return;
    }
    
    setIsSavingTokensArray(true);
    try {
      const updatedSubtitle = await updateTokensArray(currentSubtitle.id, editedTokensString);
      setIsEditingTokensArray(false);
      // Update local tokens string to match what was saved
      const savedTokens = updatedSubtitle.tokens_th?.tokens || [];
      const savedTokensString = savedTokens.map(t => typeof t === 'string' ? t : t.t).join(' ');
      setEditedTokensString(savedTokensString);
      // Notify parent to update currentSubtitle prop
      onSubtitleUpdate?.(updatedSubtitle);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SubtitleEditor.tsx:handleTokensArraySave',message:'Failed to update tokens array',data:{subtitleId:currentSubtitle.id,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      alert(`Failed to update tokens array: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSavingTokensArray(false);
    }
  };
  
  const handleTokensArrayCancel = () => {
    const tokens = currentSubtitle.tokens_th?.tokens || [];
    const tokensString = tokens.map(t => typeof t === 'string' ? t : t.t).join(' ');
    setEditedTokensString(tokensString);
    setIsEditingTokensArray(false);
  };
  
  const handleTimingEdit = () => {
    // Defocus any other editing
    setIsEditingThai(false);
    setEditingTokenIndex(null);
    setEditedTokenText('');
    setTokenWordData(null);
    setIsEditingTokensArray(false);
    setIsEditingTiming(true);
  };
  
  const handleTimingSave = async () => {
    const startSecTh = editedStartSecTh.trim() ? parseFloat(editedStartSecTh.trim()) : undefined;
    const endSecTh = editedEndSecTh.trim() ? parseFloat(editedEndSecTh.trim()) : undefined;
    
    if (startSecTh !== undefined && (isNaN(startSecTh) || startSecTh < 0)) {
      alert('Start time must be a non-negative number');
      return;
    }
    if (endSecTh !== undefined && (isNaN(endSecTh) || endSecTh < 0)) {
      alert('End time must be a non-negative number');
      return;
    }
    if (startSecTh !== undefined && endSecTh !== undefined && endSecTh < startSecTh) {
      alert('End time must be >= start time');
      return;
    }
    
    setIsSavingTiming(true);
    try {
      const updatedSubtitle = await updateSubtitleTiming(
        currentSubtitle.id,
        startSecTh,
        endSecTh
      );
      setIsEditingTiming(false);
      onSubtitleUpdate?.(updatedSubtitle);
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SubtitleEditor.tsx:handleTimingSave',message:'Failed to update subtitle timing',data:{subtitleId:currentSubtitle.id,startSecTh,endSecTh,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
      // #endregion
      alert(`Failed to update timing: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSavingTiming(false);
    }
  };
  
  const handleTimingCancel = () => {
    setEditedStartSecTh(currentSubtitle.start_sec_th?.toString() || '');
    setEditedEndSecTh(currentSubtitle.end_sec_th?.toString() || '');
    setIsEditingTiming(false);
  };
  
  return (
    <div className="p-6 space-y-8">
      <div className="text-white font-bold mb-4" style={{ fontSize: '56px' }}>
        Edit Subtitle
      </div>
      
      {/* Timing fields */}
      <div>
        <div className="block text-white/70 mb-3" style={{ fontSize: '48px' }}>Timing</div>
        {isEditingTiming ? (
          <div className="space-y-3 bg-[#e50914]/10 border-2 border-[#e50914] rounded-lg p-4 shadow-lg shadow-[#e50914]/30">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="block text-white/70 mb-2" style={{ fontSize: '40px' }}>Start Time (seconds)</div>
                <input
                  type="number"
                  step="0.001"
                  value={editedStartSecTh}
                  onChange={(e) => setEditedStartSecTh(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      handleTimingCancel();
                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleTimingSave();
                    }
                  }}
                  className="w-full bg-white/10 border-2 border-[#e50914] rounded p-3 text-white focus:outline-none focus:border-[#e50914] focus:ring-2 focus:ring-[#e50914]/50"
                  placeholder="0.000"
                  autoFocus
                  style={{ fontSize: '48px', pointerEvents: 'auto' }}
                />
              </div>
              <div>
                <div className="block text-white/70 mb-2" style={{ fontSize: '40px' }}>End Time (seconds)</div>
                <input
                  type="number"
                  step="0.001"
                  value={editedEndSecTh}
                  onChange={(e) => setEditedEndSecTh(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      handleTimingCancel();
                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleTimingSave();
                    }
                  }}
                  className="w-full bg-white/10 border-2 border-[#e50914] rounded p-3 text-white focus:outline-none focus:border-[#e50914] focus:ring-2 focus:ring-[#e50914]/50"
                  placeholder="0.000"
                  style={{ fontSize: '48px', pointerEvents: 'auto' }}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleTimingSave}
                disabled={isSavingTiming}
                className="px-4 py-2 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                style={{ fontSize: '40px' }}
              >
                {isSavingTiming ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleTimingCancel}
                disabled={isSavingTiming}
                className="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                style={{ fontSize: '40px' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={handleTimingEdit}
            className="bg-white/10 border border-white/20 rounded p-4 text-white cursor-pointer hover:bg-white/20 hover:border-[#e50914] transition-all"
            style={{ fontSize: '48px' }}
          >
            Start: {currentSubtitle.start_sec_th?.toFixed(3) || '(not set)'} | End: {currentSubtitle.end_sec_th?.toFixed(3) || '(not set)'}
          </div>
        )}
      </div>
      
      {/* Thai text input */}
      <div>
        <div className="block text-white/70 mb-3" style={{ fontSize: '48px' }}>Thai Text</div>
        {isEditingThai ? (
          <div className="space-y-3 bg-[#e50914]/10 border-2 border-[#e50914] rounded-lg p-4 shadow-lg shadow-[#e50914]/30">
            <textarea
              value={editedThai}
              onChange={(e) => setEditedThai(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  handleThaiCancel();
                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleThaiSave();
                }
              }}
              className="w-full bg-white/10 border-2 border-[#e50914] rounded p-3 text-white leading-loose focus:outline-none focus:border-[#e50914] focus:ring-2 focus:ring-[#e50914]/50 resize-y min-h-[120px]"
              style={{ fontSize: '48px', pointerEvents: 'auto' }}
              placeholder="Enter Thai text..."
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handleThaiSave}
                disabled={isSavingThai || !editedThai.trim()}
                className="px-4 py-2 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                style={{ fontSize: '40px' }}
              >
                {isSavingThai ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleThaiCancel}
                disabled={isSavingThai}
                className="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                style={{ fontSize: '40px' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={handleThaiEdit}
            className="bg-white/10 border border-white/20 rounded p-4 text-white min-h-[120px] cursor-pointer hover:bg-white/20 hover:border-[#e50914] transition-all"
            style={{ fontSize: '48px' }}
          >
            {currentSubtitle.thai || '(empty)'}
          </div>
        )}
      </div>
      
      {/* Tokens array */}
      <div>
        <div className="block text-white/70 mb-3" style={{ fontSize: '20px' }}>
          Tokens Array
          {editingTokenIndex !== null && (
            <span className="ml-3 text-[#e50914]" style={{ fontSize: '40px' }}>(Editing token {editingTokenIndex})</span>
          )}
        </div>
        
        {/* Tokens array editor - space-separated input */}
        <div className="mb-4">
          {isEditingTokensArray ? (
            <div className="space-y-3 bg-[#e50914]/10 border-2 border-[#e50914] rounded-lg p-4 shadow-lg shadow-[#e50914]/30">
              <div>
                <div className="block text-white/70 mb-2" style={{ fontSize: '40px' }}>Tokens (space-separated)</div>
                <input
                  type="text"
                  value={editedTokensString}
                  onChange={(e) => setEditedTokensString(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      handleTokensArrayCancel();
                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleTokensArraySave();
                    }
                  }}
                  className="w-full bg-white/10 border-2 border-[#e50914] rounded p-3 text-white focus:outline-none focus:border-[#e50914] focus:ring-2 focus:ring-[#e50914]/50"
                  placeholder="token1 token2 token3..."
                  autoFocus
                  style={{ fontSize: '48px', pointerEvents: 'auto' }}
                />
                <div className="text-white/50 mt-2" style={{ fontSize: '32px' }}>
                  Edit by adding or removing spaces. Changes will update the tokens array.
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleTokensArraySave}
                  disabled={isSavingTokensArray || !editedTokensString.trim()}
                  className="px-4 py-2 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{ fontSize: '40px' }}
                >
                  {isSavingTokensArray ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleTokensArrayCancel}
                  disabled={isSavingTokensArray}
                  className="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{ fontSize: '40px' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={handleTokensArrayEdit}
              className="bg-white/10 border border-white/20 rounded p-4 text-white cursor-pointer hover:bg-white/20 hover:border-[#e50914] transition-all mb-3"
              style={{ fontSize: '48px' }}
            >
              {editedTokensString || '(click to edit tokens array)'}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          {tokens.map((token, index) => {
            const tokenText = typeof token === 'string' ? token : token.t;
            const isEditing = editingTokenIndex === index;
            // Use subtitle ID + token index as key to force re-render when subtitle updates
            const tokenKey = `${currentSubtitle.id}-${index}-${tokenText}`;
            
            return (
              <div key={tokenKey} className="flex flex-col items-center">
                {isEditing ? (
                  <div className="bg-[#e50914]/10 border-2 border-[#e50914] rounded-lg p-4 shadow-lg shadow-[#e50914]/30">
                    <div className="space-y-3">
                      <div>
                        <div className="block text-white/70 mb-2" style={{ fontSize: '40px' }}>Token Text</div>
                        <input
                          type="text"
                          value={editedTokenText}
                          onChange={(e) => setEditedTokenText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              handleTokenCancel();
                            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              handleTokenSave();
                            }
                          }}
                          className="w-full bg-white/10 border-2 border-[#e50914] rounded p-3 text-white focus:outline-none focus:border-[#e50914] focus:ring-2 focus:ring-[#e50914]/50"
                          autoFocus
                          style={{ fontSize: '48px', pointerEvents: 'auto' }}
                        />
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={handleTokenSave}
                          disabled={isSavingToken || !editedTokenText.trim()}
                          className="px-4 py-2 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          style={{ fontSize: '40px' }}
                        >
                          {isSavingToken ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={handleTokenCancel}
                          disabled={isSavingToken}
                          className="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          style={{ fontSize: '40px' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => handleTokenClick(index)}
                    className={`px-4 py-3 rounded text-white transition-all cursor-pointer ${
                      editingTokenIndex === index
                        ? 'bg-[#e50914]/30 border-2 border-[#e50914] shadow-lg shadow-[#e50914]/50'
                        : 'bg-white/10 border border-white/20 hover:bg-white/20 hover:border-[#e50914]'
                    }`}
                    title={`Click to edit token ${index}`}
                    style={{ fontSize: '40px' }}
                  >
                    {tokenText}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {tokens.length === 0 && (
          <div className="text-white/60" style={{ fontSize: '48px' }}>No tokens available</div>
        )}
      </div>
      
      {/* Token Information Display Section - Separate, Large Display */}
      {editingTokenIndex !== null && (
        <div className="border-t-2 border-white/20 pt-6 mt-6">
          <div className="text-white/70 font-semibold mb-4" style={{ fontSize: '64px' }}>
            Token Information
          </div>
          
          {isLoadingWordData ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#e50914] border-t-transparent"></div>
                <div className="text-white/70" style={{ fontSize: '48px' }}>Loading word data...</div>
              </div>
            </div>
          ) : tokenWordData ? (
            <div className="space-y-6">
              {/* Token Text Display - Editable */}
              <div className="bg-white/5 border border-white/20 rounded-lg p-6">
                <div className="text-white/60 mb-3" style={{ fontSize: '48px' }}>Token</div>
                <div className="text-white font-bold" style={{ fontSize: '72px' }}>{editedTokenText || tokens[editingTokenIndex] ? (typeof tokens[editingTokenIndex] === 'string' ? tokens[editingTokenIndex] : tokens[editingTokenIndex].t) : ''}</div>
              </div>
              
              {/* G2P Display - Editable */}
              <div className="bg-white/5 border border-white/20 rounded-lg p-6">
                <div className="text-white/60 mb-3" style={{ fontSize: '48px' }}>G2P (Grapheme-to-Phoneme)</div>
                {editingG2P ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editedG2P}
                      onChange={(e) => setEditedG2P(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          handleCancelWordData();
                        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          handleSaveWordData();
                        }
                      }}
                      className="w-full bg-white/10 border-2 border-[#e50914] rounded p-3 text-white focus:outline-none focus:border-[#e50914] focus:ring-2 focus:ring-[#e50914]/50"
                      autoFocus
                      style={{ fontSize: '56px', pointerEvents: 'auto' }}
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={handleSaveWordData}
                        disabled={isSavingWordData}
                        className="px-4 py-2 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        style={{ fontSize: '40px' }}
                      >
                        {isSavingWordData ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={handleCancelWordData}
                        disabled={isSavingWordData}
                        className="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        style={{ fontSize: '40px' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => {
                      setEditingG2P(true);
                      setEditingPhonetic(false);
                    }}
                    className="text-white font-medium cursor-pointer hover:bg-white/10 rounded p-2 -m-2 transition-colors min-h-[60px] flex items-center"
                    style={{ fontSize: '64px' }}
                  >
                    {tokenWordData.g2p || '(click to add G2P)'}
                  </div>
                )}
              </div>
              
              {/* Phonetic EN Display - Editable */}
              <div className="bg-white/5 border border-white/20 rounded-lg p-6">
                <div className="text-white/60 mb-3" style={{ fontSize: '48px' }}>Phonetic (English)</div>
                {editingPhonetic ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editedPhonetic}
                      onChange={(e) => setEditedPhonetic(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          handleCancelWordData();
                        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          handleSaveWordData();
                        }
                      }}
                      className="w-full bg-white/10 border-2 border-[#e50914] rounded p-3 text-white focus:outline-none focus:border-[#e50914] focus:ring-2 focus:ring-[#e50914]/50"
                      autoFocus
                      style={{ fontSize: '56px', pointerEvents: 'auto' }}
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={handleSaveWordData}
                        disabled={isSavingWordData}
                        className="px-4 py-2 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        style={{ fontSize: '40px' }}
                      >
                        {isSavingWordData ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={handleCancelWordData}
                        disabled={isSavingWordData}
                        className="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        style={{ fontSize: '40px' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => {
                      setEditingPhonetic(true);
                      setEditingG2P(false);
                    }}
                    className="text-white font-medium cursor-pointer hover:bg-white/10 rounded p-2 -m-2 transition-colors min-h-[60px] flex items-center"
                    style={{ fontSize: '64px' }}
                  >
                    {tokenWordData.phonetic_en || '(click to add Phonetic)'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white/5 border border-white/20 rounded-lg p-6">
              <div className="text-white/60 mb-4" style={{ fontSize: '48px' }}>Word not found in words_th table</div>
              <button
                onClick={async () => {
                  const token = tokens[editingTokenIndex];
                  const tokenText = typeof token === 'string' ? token : token.t;
                  setIsLoadingWordData(true);
                  try {
                    // Create word entry
                    const newWord = await saveWordOnly({
                      word_th: tokenText,
                    });
                    setTokenWordData(newWord);
                  } catch (error) {
                    // #region agent log
                    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SubtitleEditor.tsx:Create Word Entry',message:'Failed to create word',data:{wordTh:tokenText,error:error instanceof Error ? error.message : String(error)},timestamp:Date.now(),runId:'run1',hypothesisId:'DB_UPDATE'})}).catch(()=>{});
                    // #endregion
                    alert(`Failed to create word: ${error instanceof Error ? error.message : String(error)}`);
                  } finally {
                    setIsLoadingWordData(false);
                  }
                }}
                className="px-4 py-2 bg-[#e50914] text-white rounded hover:bg-[#e50914]/80 transition-colors"
                style={{ fontSize: '40px' }}
              >
                Create Word Entry
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
