import React, { useState, useRef, useEffect } from 'react';
import type { DisplayMode } from '../services/subtitleDisplayLogic';

export interface SubtitleDisplayModeDropdownProps {
  currentMode: DisplayMode;
  onModeChange: (mode: DisplayMode) => void;
  hasTokens: boolean;
  fontSize?: string; // e.g., 'text-sm', 'text-base', 'text-lg', or custom like 'text-[14px]'
}

const MODE_OPTIONS: Array<{ value: DisplayMode; label: string; requiresTokens: boolean }> = [
  { value: 'thai', label: 'Thai', requiresTokens: false },
  { value: 'tokens', label: 'Tokens', requiresTokens: true },
  { value: 'phonetics', label: 'Phonetics', requiresTokens: true },
];

export const SubtitleDisplayModeDropdown: React.FC<SubtitleDisplayModeDropdownProps> = ({
  currentMode,
  onModeChange,
  hasTokens,
  fontSize = 'text-base',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const currentLabel = MODE_OPTIONS.find(opt => opt.value === currentMode)?.label || 'Thai';

  return (
    <div ref={dropdownRef} className={`absolute top-2 right-2 z-50 ${fontSize}`}>
      <button
        className={`bg-black/80 text-white ${fontSize} px-4 py-2 rounded border border-white/20 hover:bg-black/90 cursor-pointer`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {currentLabel} ▼
      </button>
      
      {isOpen && (
        <div className={`absolute top-full right-0 mt-1 bg-black/90 border border-white/20 rounded shadow-lg min-w-[100px] ${fontSize}`}>
          {MODE_OPTIONS.map(option => {
            const isDisabled = option.requiresTokens && !hasTokens;
            const isSelected = currentMode === option.value;
            
            return (
              <button
                key={option.value}
                className={`block w-full text-left px-2 py-1 ${fontSize} text-white hover:bg-white/10 ${
                  isSelected ? 'bg-white/20' : ''
                } ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                onClick={() => {
                  if (!isDisabled) {
                    onModeChange(option.value);
                    setIsOpen(false);
                  }
                }}
                disabled={isDisabled}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
