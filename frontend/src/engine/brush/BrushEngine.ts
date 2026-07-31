import { TiledLayer } from '../../state/document';
import type { StylusInput } from '../input/StylusInput';

export interface BrushPreset {
  id: string;
  name: string;
  size: number;          // Base size in pixels
  opacity: number;       // Base opacity (0 - 1)
  flow: number;          // Paint flow (0 - 1)
  hardness: number;      // Edge hardness (0 - 1, 1 = sharp, 0 = soft radial gradient)
  spacing: number;       // Stamp spacing as fraction of size (0.02 - 1.0)
  color: string;         // CSS color (rgb/hex)
  pressureSize: boolean; // Map pressure to size
  pressureOpacity: boolean; // Map pressure to opacity
}

export class BrushEngine {
  private spacingDistanceLeft = 0; // Remainder spacing distance carried from last move

  public startStroke(_input: StylusInput): void {
    this.spacingDistanceLeft = 0;
  }

  public paintStroke(
    from: StylusInput,
    to: StylusInput,
    layer: TiledLayer,
    preset: BrushPreset
  ): { x: number; y: number; w: number; h: number }[] {
    const affectedRects: { x: number; y: number; w: number; h: number }[] = [];

    // Distance between points
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Brush size and spacing calculations
    const currentSize = preset.pressureSize ? preset.size * to.pressure : preset.size;
    const spacingPx = Math.max(1, currentSize * preset.spacing);

    let traveled = this.spacingDistanceLeft;

    if (distance === 0) {
      // Just stamp once if we started drawing but haven't moved
      if (traveled === 0) {
        const rect = this.drawStamp(to.x, to.y, to.pressure, layer, preset);
        affectedRects.push(rect);
      }
    } else {
      while (traveled <= distance) {
        // Interpolate point
        const t = traveled / distance;
        const interpX = from.x + dx * t;
        const interpY = from.y + dy * t;
        // Interpolate pressure
        const interpPressure = from.pressure + (to.pressure - from.pressure) * t;

        const rect = this.drawStamp(interpX, interpY, interpPressure, layer, preset);
        affectedRects.push(rect);

        traveled += spacingPx;
      }
      // Save remaining distance for next segment
      this.spacingDistanceLeft = traveled - distance;
    }

    return affectedRects;
  }

  public endStroke(): void {
    this.spacingDistanceLeft = 0;
  }

  private drawStamp(
    cx: number,
    cy: number,
    pressure: number,
    layer: TiledLayer,
    preset: BrushPreset
  ): { x: number; y: number; w: number; h: number } {
    // Determine dynamic size and opacity
    const size = preset.pressureSize ? preset.size * pressure : preset.size;
    const opacity = preset.pressureOpacity ? preset.opacity * pressure : preset.opacity;
    const radius = size / 2;

    const stampMinX = cx - radius;
    const stampMinY = cy - radius;
    const stampW = size;
    const stampH = size;

    // Create the stamp cache canvas offscreen
    const stampCanvas = document.createElement('canvas');
    stampCanvas.width = Math.ceil(size);
    stampCanvas.height = Math.ceil(size);
    const sCtx = stampCanvas.getContext('2d')!;

    // Create radial gradient for brush hardness
    const center = size / 2;
    const grad = sCtx.createRadialGradient(center, center, radius * preset.hardness, center, center, radius);
    
    // Parse preset color to construct RGBA values
    const rgb = this.hexToRgb(preset.color) || { r: 0, g: 0, b: 0 };
    const flowAlpha = preset.flow * opacity;

    grad.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${flowAlpha})`);
    grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

    sCtx.fillStyle = grad;
    sCtx.beginPath();
    sCtx.arc(center, center, radius, 0, Math.PI * 2);
    sCtx.fill();

    // Render this stamp to all overlapping tiles in the tiled layer
    layer.forEachTileInRect(stampMinX, stampMinY, stampW, stampH, (tile, localX, localY, overlapW, overlapH) => {
      tile.ctx.save();
      // Only composite over overlap region
      tile.ctx.beginPath();
      tile.ctx.rect(localX, localY, overlapW, overlapH);
      tile.ctx.clip();

      if (preset.name === 'Eraser') {
        tile.ctx.globalCompositeOperation = 'destination-out';
      }

      // Draw stamp onto tile context
      // Calculate drawing offsets relative to tile top-left
      const tileCanvasX = tile.x * TiledLayer.TILE_SIZE;
      const tileCanvasY = tile.y * TiledLayer.TILE_SIZE;
      const drawX = stampMinX - tileCanvasX;
      const drawY = stampMinY - tileCanvasY;

      tile.ctx.drawImage(stampCanvas, drawX, drawY);
      tile.ctx.restore();
    });

    return { x: stampMinX, y: stampMinY, w: stampW, h: stampH };
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    // Supports #fff, #ffffff, rgb(x,y,z)
    if (hex.startsWith('rgb')) {
      const match = hex.match(/\d+/g);
      if (match && match.length >= 3) {
        return { r: parseInt(match[0]), g: parseInt(match[1]), b: parseInt(match[2]) };
      }
    }
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const fullHex = hex.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  }
}

// Built-in presets for artists
export const DEFAULT_BRUSH_PRESETS: BrushPreset[] = [
  {
    id: 'pencil-h',
    name: 'Graphite Pencil',
    size: 4,
    opacity: 0.7,
    flow: 0.6,
    hardness: 0.8,
    spacing: 0.08,
    color: '#333333',
    pressureSize: true,
    pressureOpacity: true,
  },
  {
    id: 'ink-gpen',
    name: 'G-Pen (Inking)',
    size: 8,
    opacity: 1.0,
    flow: 1.0,
    hardness: 0.95,
    spacing: 0.02,
    color: '#000000',
    pressureSize: true,
    pressureOpacity: false,
  },
  {
    id: 'airbrush-soft',
    name: 'Soft Airbrush',
    size: 120,
    opacity: 0.4,
    flow: 0.15,
    hardness: 0.0,
    spacing: 0.05,
    color: '#e53e3e',
    pressureSize: false,
    pressureOpacity: true,
  },
  {
    id: 'paint-acrylic',
    name: 'Flat Acrylic',
    size: 32,
    opacity: 0.9,
    flow: 0.8,
    hardness: 0.7,
    spacing: 0.04,
    color: '#3182ce',
    pressureSize: true,
    pressureOpacity: true,
  }
];
