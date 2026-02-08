/**
 * Meaning Selection Hotkeys
 * 
 * RESPONSIBILITY: Captures meaning selection keys at document level
 * 
 * HOTKEY PATTERNS:
 * - 0-9 → selects meaning for current token
 */

import { getMeaningsForToken } from '../../../services/cache/subtitleMeaningsCache';
import type { MeaningTh } from '@/schemas/meaningThSchema';

interface MeaningHotkeyStateAccessors {
  getSelectedSubtitleId: () => string | null;
  getSelectedTokenIndex: () => number | null;
  getMeaningsByToken: () => Map<string, MeaningTh[]>;
  handleMeaningSelect: (tokenIndex: number, meaningId: bigint) => Promise<void>;
}

let isEnabled = false;
let stateAccessors: MeaningHotkeyStateAccessors | null = null;
let numberKeyHandler: ((e: KeyboardEvent) => void) | null = null;

/**
 * Initialize meaning selection hotkeys with state accessors
 * Sets up number key handlers (0-9) for meaning selection
 */
export function initializeMeaningHotkeys(accessors: MeaningHotkeyStateAccessors): void {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:initializeMeaningHotkeys',message:'Function entry',data:{isEnabled,hasAccessors:!!accessors,hasGetSelectedSubtitleId:!!accessors?.getSelectedSubtitleId,hasGetSelectedTokenIndex:!!accessors?.getSelectedTokenIndex,hasGetMeaningsByToken:!!accessors?.getMeaningsByToken,hasHandleMeaningSelect:!!accessors?.handleMeaningSelect},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  if (isEnabled) {
    cleanupMeaningHotkeys();
  }
  
  stateAccessors = accessors;
  
  // Setup number key handler
  numberKeyHandler = (e: KeyboardEvent) => {
    handleNumberKeyPress(e);
  };
  document.addEventListener('keydown', numberKeyHandler, true);
  
  isEnabled = true;
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:initializeMeaningHotkeys',message:'Function exit',data:{isEnabled,hasNumberKeyHandler:!!numberKeyHandler,hasStateAccessors:!!stateAccessors},timestamp:Date.now(),runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
}

/**
 * Cleanup meaning selection hotkey handlers
 */
export function cleanupMeaningHotkeys(): void {
  if (!isEnabled) return;
  
  if (numberKeyHandler) {
    document.removeEventListener('keydown', numberKeyHandler, true);
    numberKeyHandler = null;
  }
  
  stateAccessors = null;
  isEnabled = false;
}

/**
 * Handle number key press for meaning selection (0-9)
 */
async function handleNumberKeyPress(e: KeyboardEvent): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'Function entry',data:{key:e.key,keyCode:e.keyCode,hasStateAccessors:!!stateAccessors,isEnabled},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  
  if (!stateAccessors) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'Early return - no state accessors',data:{key:e.key},timestamp:Date.now(),runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  // Only handle number keys 0-9
  const key = e.key;
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'Key validation check',data:{key,keyType:typeof key,isNumberKey:key >= '0' && key <= '9',keyLessThan0:key < '0',keyGreaterThan9:key > '9'},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  if (key < '0' || key > '9') {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'Early return - not number key',data:{key},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  // Ignore if input/textarea is focused
  const activeElement = document.activeElement;
  const isInputFocused = activeElement && 
    (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA');
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'Input focus check',data:{key,hasActiveElement:!!activeElement,activeElementTag:activeElement?.tagName,isInputFocused},timestamp:Date.now(),runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion
  if (isInputFocused) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'Early return - input focused',data:{key,activeElementTag:activeElement?.tagName},timestamp:Date.now(),runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  // Prevent default behavior
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  
  // Get current state
  const subtitleId = stateAccessors.getSelectedSubtitleId();
  const tokenIndex = stateAccessors.getSelectedTokenIndex();
  const meaningsByToken = stateAccessors.getMeaningsByToken();
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'State retrieved',data:{key,subtitleId,tokenIndex,meaningsByTokenSize:meaningsByToken?.size || 0},timestamp:Date.now(),runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  
  // Validate state
  if (subtitleId === null || tokenIndex === null) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'Early return - invalid state',data:{key,subtitleId,tokenIndex,subtitleIdNull:subtitleId === null,tokenIndexNull:tokenIndex === null},timestamp:Date.now(),runId:'run1',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  // Convert key to meaning index
  // User-friendly mapping: "1" = first meaning (index 0), "2" = second meaning (index 1), etc.
  // "0" maps to 10th meaning (index 9) if it exists
  const keyNum = parseInt(key, 10);
  const meaningIndex = keyNum === 0 ? 9 : keyNum - 1; // "0" → index 9, "1" → index 0, "2" → index 1, etc.
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'Before meaning selection',data:{key,keyNum,meaningIndex,subtitleId,tokenIndex},timestamp:Date.now(),runId:'run1',hypothesisId:'F'})}).catch(()=>{});
  // #endregion
  
  // Look up meanings and validate selection
  // Look up meanings for current token
  const meanings = getMeaningsForToken(meaningsByToken, subtitleId, tokenIndex);
  
  // Validate meaning selection by index
  if (!meanings || meanings.length === 0 || meaningIndex < 0 || meaningIndex >= meanings.length) {
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'Invalid meaning selection',data:{key,meaningIndex,tokenIndex,meaningsCount:meanings?.length || 0},timestamp:Date.now(),runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    return;
  }
  
  const selectedMeaning = meanings[meaningIndex];
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'Calling handleMeaningSelect',data:{key,meaningIndex,tokenIndex,meaningId:selectedMeaning.id.toString(),hasHandleMeaningSelect:!!stateAccessors.handleMeaningSelect},timestamp:Date.now(),runId:'run1',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
  
  // Call handleMeaningSelect - TokenArea component will handle the save internally
  if (stateAccessors.handleMeaningSelect) {
    await stateAccessors.handleMeaningSelect(tokenIndex, selectedMeaning.id);
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/329a6b2f-a75f-4055-8230-3e65a0e37f19',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'tokenarea/helpers/hotkeys-meaning.ts:handleNumberKeyPress',message:'After handleMeaningSelect call',data:{key,meaningIndex,tokenIndex,meaningId:selectedMeaning.id.toString()},timestamp:Date.now(),runId:'run1',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
}
