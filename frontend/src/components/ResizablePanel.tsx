import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface ResizablePanelProps {
  side: 'left' | 'right';
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  children: React.ReactNode;
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  side,
  defaultWidth,
  minWidth,
  maxWidth,
  children
}) => {
  const [width, setWidth] = useState(defaultWidth);
  const isResizing = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    
    if (side === 'left') {
      setWidth(Math.min(Math.max(e.clientX, minWidth), maxWidth));
    } else {
      setWidth(Math.min(Math.max(window.innerWidth - e.clientX, minWidth), maxWidth));
    }
  }, [side, minWidth, maxWidth]);

  const handleMouseUp = useCallback(() => {
    isResizing.current = false;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div 
      className="resizable-panel" 
      style={{ 
        width: `${width}px`,
        position: 'relative',
        flexShrink: 0
      }}
    >
      {side === 'right' && (
        <div 
          className="resize-handle" 
          onMouseDown={handleMouseDown}
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', cursor: 'col-resize', zIndex: 10 }}
        />
      )}
      {children}
      {side === 'left' && (
        <div 
          className="resize-handle" 
          onMouseDown={handleMouseDown}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '4px', cursor: 'col-resize', zIndex: 10 }}
        />
      )}
    </div>
  );
};
