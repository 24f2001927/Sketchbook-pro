import React, { useEffect, useRef, useState } from 'react';

export interface TextToolOverlayProps {
  screenX: number;
  screenY: number;
  zoom: number;
  initialText?: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
  onChangeText?: (text: string) => void;
}

export const TextToolOverlay: React.FC<TextToolOverlayProps> = ({
  screenX,
  screenY,
  zoom,
  initialText = '',
  fontSize,
  fontFamily,
  color,
  onCommit,
  onCancel,
  onChangeText,
}) => {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(initialText);
  }, [initialText]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(fontSize * zoom * 1.3, textareaRef.current.scrollHeight)}px`;
      textareaRef.current.style.width = 'auto';
      textareaRef.current.style.width = `${Math.max(120, textareaRef.current.scrollWidth)}px`;
    }
  }, [screenX, screenY, zoom, fontSize]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    if (onChangeText) {
      onChangeText(val);
    }
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.max(fontSize * zoom * 1.3, e.target.scrollHeight)}px`;
    e.target.style.width = 'auto';
    e.target.style.width = `${Math.max(120, e.target.scrollWidth)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onCommit(text);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    onCommit(text);
  };

  const scaledFontSize = Math.max(12, fontSize * zoom);

  return (
    <textarea
      ref={textareaRef}
      className="text-overlay"
      value={text}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      placeholder="Start typing..."
      style={{
        position: 'absolute',
        left: `${screenX}px`,
        top: `${screenY}px`,
        fontSize: `${scaledFontSize}px`,
        fontFamily,
        color,
        background: 'rgba(88, 101, 242, 0.04)',
        border: '1.5px dashed var(--accent)',
        borderRadius: '4px',
        outline: 'none',
        minWidth: '120px',
        minHeight: `${scaledFontSize * 1.3}px`,
        resize: 'none',
        whiteSpace: 'pre-wrap',
        zIndex: 100,
        caretColor: color || 'var(--accent)',
        boxShadow: '0 0 12px rgba(88, 101, 242, 0.4)',
        padding: '2px 6px',
        lineHeight: 1.3,
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    />
  );
};

