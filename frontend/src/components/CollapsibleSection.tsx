import React, { useState } from 'react';

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string | number;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  defaultOpen = true,
  children,
  badge
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="collapsible-section">
      <div 
        className="collapsible-header panel-section-title"
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>{title}</span>
          {badge !== undefined && (
            <span style={{ 
              background: 'var(--color-accent)', 
              color: 'white', 
              borderRadius: '12px', 
              padding: '2px 8px', 
              fontSize: '0.7rem' 
            }}>
              {badge}
            </span>
          )}
        </div>
        <span>{isOpen ? '▼' : '▶'}</span>
      </div>
      <div 
        className="collapsible-content"
        style={{ 
          maxHeight: isOpen ? '1000px' : '0',
          overflow: 'hidden',
          opacity: isOpen ? 1 : 0
        }}
      >
        {children}
      </div>
    </div>
  );
};
