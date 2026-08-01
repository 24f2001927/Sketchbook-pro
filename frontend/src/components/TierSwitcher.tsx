import React from 'react';

export type TierLevel = 'common' | 'animation' | 'rare' | 'legendary';

interface TierSwitcherProps {
  currentTier: TierLevel;
  onTierChange: (tier: TierLevel) => void;
}

export const TierSwitcher: React.FC<TierSwitcherProps> = ({ currentTier, onTierChange }) => {
  return (
    <div className="tier-switcher-container">
      <button
        className={`tier-pill-btn tier-common ${currentTier === 'common' ? 'active' : ''}`}
        onClick={() => onTierChange('common')}
        title="Common Level: Digital Painting, Vector Pen/Shapes, Text & Canvas Studio"
      >
        <span className="tier-label">Common</span>
        <span className="tier-badge">Core</span>
      </button>

      <button
        className={`tier-pill-btn tier-animation ${currentTier === 'animation' ? 'active' : ''}`}
        onClick={() => onTierChange('animation')}
        title="Animation Level: Frame Management, Onion Skin, Keyframes, Rigging & Dope Sheet"
      >
        <span className="tier-label">Animation</span>
        <span className="tier-badge">2D Stage</span>
      </button>

      <button
        className={`tier-pill-btn tier-rare ${currentTier === 'rare' ? 'active' : ''}`}
        onClick={() => onTierChange('rare')}
        title="Rare Level: 3D Scene Viewport Engine & Procedural Shader Nodes"
      >
        <span className="tier-label">Rare</span>
        <span className="tier-badge">3D & Shaders</span>
      </button>

      <button
        className={`tier-pill-btn tier-legendary ${currentTier === 'legendary' ? 'active' : ''}`}
        onClick={() => onTierChange('legendary')}
        title="Legendary Level: AI Model Studio, Realtime Collab Room & Sandboxed Plugins"
      >
        <span className="tier-label">Legendary</span>
        <span className="tier-badge">AI Suite</span>
      </button>
    </div>
  );
};
