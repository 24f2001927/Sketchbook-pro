import React from 'react';

export interface VectorToolbarProps {
  selectedTool: 'brush' | 'pen' | 'text' | 'select';
  onToolChange: (tool: 'brush' | 'pen' | 'text' | 'select') => void;
  onBooleanOp: (op: 'union' | 'subtract' | 'intersect' | 'exclude') => void;
  hasVectorSelection: boolean;
}

export const VectorToolbar: React.FC<VectorToolbarProps> = ({
  selectedTool,
  onToolChange,
  onBooleanOp,
  hasVectorSelection
}) => {
  return (
    <div className="vector-toolbar" style={{ gap: '8px', padding: '8px' }}>
      <button 
        className={`tool-btn ${selectedTool === 'brush' ? 'active' : ''}`}
        title="Brush (B)"
        onClick={() => onToolChange('brush')}
      >
        🖌️
      </button>
      <button 
        className={`tool-btn ${selectedTool === 'pen' ? 'active' : ''}`}
        title="Pen (P)"
        onClick={() => onToolChange('pen')}
      >
        ✒️
      </button>
      <button 
        className={`tool-btn ${selectedTool === 'text' ? 'active' : ''}`}
        title="Text (T)"
        onClick={() => onToolChange('text')}
      >
        T
      </button>
      <button 
        className={`tool-btn ${selectedTool === 'select' ? 'active' : ''}`}
        title="Select (V)"
        onClick={() => onToolChange('select')}
      >
        ↖️
      </button>
      
      <hr className="bool-divider" style={{ width: '100%', margin: '8px 0' }} />
      
      <button 
        className="tool-btn"
        title="Union"
        disabled={!hasVectorSelection}
        onClick={() => onBooleanOp('union')}
        style={{ opacity: hasVectorSelection ? 1 : 0.5 }}
      >
        ∪
      </button>
      <button 
        className="tool-btn"
        title="Subtract"
        disabled={!hasVectorSelection}
        onClick={() => onBooleanOp('subtract')}
        style={{ opacity: hasVectorSelection ? 1 : 0.5 }}
      >
        −
      </button>
      <button 
        className="tool-btn"
        title="Intersect"
        disabled={!hasVectorSelection}
        onClick={() => onBooleanOp('intersect')}
        style={{ opacity: hasVectorSelection ? 1 : 0.5 }}
      >
        ∩
      </button>
      <button 
        className="tool-btn"
        title="Exclude"
        disabled={!hasVectorSelection}
        onClick={() => onBooleanOp('exclude')}
        style={{ opacity: hasVectorSelection ? 1 : 0.5 }}
      >
        ⊕
      </button>
    </div>
  );
};
