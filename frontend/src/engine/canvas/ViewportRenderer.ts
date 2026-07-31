import { TiledLayer } from '../../state/document';
import type { LayerNode, BlendMode } from '../../state/document';

export interface ViewportTransform {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number; // in degrees
}

export class ViewportRenderer {
  private compositeTiles: Map<string, HTMLCanvasElement> = new Map();

  // Convert screen coordinates to canvas space
  public screenToCanvas(
    sx: number,
    sy: number,
    transform: ViewportTransform,
    viewportWidth: number,
    viewportHeight: number,
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number } {
    // 1. Center offset
    let cx = sx - viewportWidth / 2;
    let cy = sy - viewportHeight / 2;

    // 2. Undo rotation
    const rad = (-transform.rotation * Math.PI) / 180;
    const rx = cx * Math.cos(rad) - cy * Math.sin(rad);
    const ry = cx * Math.sin(rad) + cy * Math.cos(rad);

    // 3. Undo zoom and pan
    const x = (rx - transform.panX) / transform.zoom;
    const y = (ry - transform.panY) / transform.zoom;

    // 4. Undo centering offset
    return {
      x: x + canvasWidth / 2,
      y: y + canvasHeight / 2
    };
  }

  // Convert canvas coordinates to screen space
  public canvasToScreen(
    cx: number,
    cy: number,
    transform: ViewportTransform,
    viewportWidth: number,
    viewportHeight: number,
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number } {
    // 1. Shift to center-relative
    const x = cx - canvasWidth / 2;
    const y = cy - canvasHeight / 2;

    // 2. Apply zoom and pan
    const zx = x * transform.zoom + transform.panX;
    const zy = y * transform.zoom + transform.panY;

    // 3. Apply rotation
    const rad = (transform.rotation * Math.PI) / 180;
    const rx = zx * Math.cos(rad) - zy * Math.sin(rad);
    const ry = zx * Math.sin(rad) + zy * Math.cos(rad);

    // 4. Apply center offset
    const sx = rx + viewportWidth / 2;
    const sy = ry + viewportHeight / 2;

    return { x: sx, y: sy };
  }

  // Composite all layers into a single tile map
  public composite(
    layers: LayerNode[],
    _canvasWidth: number,
    _canvasHeight: number,
    dirtyTiles?: Set<string> // Optional: only recomposite specific tile keys
  ): void {
    const allKeys = new Set<string>();
    for (const layer of layers) {
      if (layer.tileMap) {
        for (const k of layer.tileMap.keys()) {
          allKeys.add(k);
        }
      }
    }

    for (const tileKey of allKeys) {
      if (dirtyTiles && !dirtyTiles.has(tileKey)) {
        continue; // skip unmodified tiles
      }

      // Get or create composite tile canvas
      let compCanvas = this.compositeTiles.get(tileKey);
      if (!compCanvas) {
        compCanvas = document.createElement('canvas');
        compCanvas.width = TiledLayer.TILE_SIZE;
        compCanvas.height = TiledLayer.TILE_SIZE;
        this.compositeTiles.set(tileKey, compCanvas);
      }

      const compCtx = compCanvas.getContext('2d')!;
      compCtx.clearRect(0, 0, TiledLayer.TILE_SIZE, TiledLayer.TILE_SIZE);

      // Compositing layers from bottom to top (layers list is expected to be bottom at index 0)
      for (const layer of layers) {
        if (!layer.visible || !layer.tileMap) {
          continue;
        }

        const layerTile = layer.tileMap.get(tileKey);
        if (!layerTile) {
          continue; // No drawn contents in this tile for this layer
        }

        compCtx.save();
        compCtx.globalAlpha = layer.opacity;
        compCtx.globalCompositeOperation = this.blendModeToCompositeOp(layer.blendMode);
        compCtx.drawImage(layerTile, 0, 0);
        compCtx.restore();
      }
    }
  }

  // Render the final composite tiles onto the viewport screen canvas
  public drawToScreen(
    ctx: CanvasRenderingContext2D,
    transform: ViewportTransform,
    viewportWidth: number,
    viewportHeight: number,
    canvasWidth: number,
    canvasHeight: number,
    showPageBorder: boolean = false,
    theme: 'dark' | 'light' = 'dark',
    format: 'blank' | 'lined' | 'grid' | 'dotted' | 'checklist' = 'blank',
    checkedLines?: Record<number, boolean>
  ): void {
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    // 1. Draw viewport background base
    ctx.fillStyle = theme === 'dark' ? '#121212' : '#f1f5f9';
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    ctx.save();
    // Centering and viewport transform
    ctx.translate(viewportWidth / 2, viewportHeight / 2);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.translate(transform.panX, transform.panY);
    ctx.scale(transform.zoom, transform.zoom);
    ctx.translate(-canvasWidth / 2, -canvasHeight / 2);

    // Get screen-to-canvas corners for infinite drawing
    const tl = this.screenToCanvas(0, 0, transform, viewportWidth, viewportHeight, canvasWidth, canvasHeight);
    const tr = this.screenToCanvas(viewportWidth, 0, transform, viewportWidth, viewportHeight, canvasWidth, canvasHeight);
    const bl = this.screenToCanvas(0, viewportHeight, transform, viewportWidth, viewportHeight, canvasWidth, canvasHeight);
    const br = this.screenToCanvas(viewportWidth, viewportHeight, transform, viewportWidth, viewportHeight, canvasWidth, canvasHeight);

    const xMin = Math.min(tl.x, tr.x, bl.x, br.x);
    const xMax = Math.max(tl.x, tr.x, bl.x, br.x);
    const yMin = Math.min(tl.y, tr.y, bl.y, br.y);
    const yMax = Math.max(tl.y, tr.y, bl.y, br.y);

    const startX = showPageBorder ? Math.max(0, xMin) : xMin;
    const endX = showPageBorder ? Math.min(canvasWidth, xMax) : xMax;
    const startY = showPageBorder ? Math.max(0, yMin) : yMin;
    const endY = showPageBorder ? Math.min(canvasHeight, yMax) : yMax;

    if (showPageBorder) {
      // Draw white sheet
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.shadowColor = 'transparent'; // reset
    } else {
      // Fill canvas background infinitely
      ctx.fillStyle = theme === 'dark' ? '#1a1a1a' : '#ffffff';
      ctx.fillRect(startX, startY, endX - startX, endY - startY);
    }

    // Draw page format pattern (blank, lined, grid, dotted, checklist)
    if (format !== 'blank' && startX < endX && startY < endY) {
      ctx.save();
      ctx.strokeStyle = theme === 'dark' ? '#2e2e2e' : '#e2e8f0';
      if (showPageBorder) {
        // If sheet style is active, restrict drawing to the sheet box
        ctx.beginPath();
        ctx.rect(0, 0, canvasWidth, canvasHeight);
        ctx.clip();
      }

      let spacing = 40;
      // Prevent pattern freeze on tiny zoom levels
      while (spacing * transform.zoom < 8) {
        spacing *= 2;
      }

      if (format === 'grid') {
        const firstX = Math.floor(startX / spacing) * spacing;
        const firstY = Math.floor(startY / spacing) * spacing;
        ctx.beginPath();
        ctx.lineWidth = 0.75;
        for (let x = firstX; x <= endX; x += spacing) {
          ctx.moveTo(x, startY);
          ctx.lineTo(x, endY);
        }
        for (let y = firstY; y <= endY; y += spacing) {
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
        }
        ctx.stroke();
      } else if (format === 'lined') {
        const firstY = Math.floor(startY / spacing) * spacing;
        ctx.beginPath();
        ctx.lineWidth = 0.75;
        for (let y = firstY; y <= endY; y += spacing) {
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
        }
        ctx.stroke();

        // Draw vertical red margin line at x = 100
        ctx.beginPath();
        ctx.strokeStyle = theme === 'dark' ? '#5a2d2d' : '#fca5a5';
        ctx.lineWidth = 1.25;
        ctx.moveTo(100, startY);
        ctx.lineTo(100, endY);
        ctx.stroke();
      } else if (format === 'dotted') {
        const firstX = Math.floor(startX / spacing) * spacing;
        const firstY = Math.floor(startY / spacing) * spacing;
        ctx.fillStyle = theme === 'dark' ? '#3d3d3d' : '#cbd5e1';
        for (let x = firstX; x <= endX; x += spacing) {
          for (let y = firstY; y <= endY; y += spacing) {
            ctx.beginPath();
            ctx.arc(x, y, 1.25, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (format === 'checklist') {
        const firstY = Math.floor(startY / spacing) * spacing;
        ctx.beginPath();
        ctx.lineWidth = 0.75;
        for (let y = firstY; y <= endY; y += spacing) {
          ctx.moveTo(startX, y);
          ctx.lineTo(endX, y);
        }
        ctx.stroke();

        // Draw vertical margin line
        ctx.beginPath();
        ctx.strokeStyle = theme === 'dark' ? '#5a2d2d' : '#fca5a5';
        ctx.lineWidth = 1.25;
        ctx.moveTo(80, startY);
        ctx.lineTo(80, endY);
        ctx.stroke();

        // Draw interactive checkbox outlines + checked state
        ctx.lineWidth = 1.5;
        for (let y = firstY; y <= endY; y += spacing) {
          const cy = y - 20;
          
          // Draw box
          ctx.strokeStyle = theme === 'dark' ? '#555555' : '#94a3b8';
          ctx.strokeRect(42, cy - 8, 16, 16);

          // Fill/Draw checkmark if checked
          const isChecked = checkedLines && checkedLines[y];
          if (isChecked) {
            ctx.fillStyle = 'var(--accent, #3b82f6)';
            // Draw a neat filled square
            ctx.fillRect(45, cy - 5, 10, 10);
          }
        }
      }
      ctx.restore();
    }

    // Draw composite tiles
    for (const [tileKey, compCanvas] of this.compositeTiles.entries()) {
      const [tx, ty] = tileKey.split(',').map(Number);
      const dx = tx * TiledLayer.TILE_SIZE;
      const dy = ty * TiledLayer.TILE_SIZE;
      ctx.drawImage(compCanvas, dx, dy);
    }

    ctx.restore();
  }

  private blendModeToCompositeOp(mode: BlendMode): GlobalCompositeOperation {
    switch (mode) {
      case 'normal':
        return 'source-over';
      case 'multiply':
        return 'multiply';
      case 'screen':
        return 'screen';
      case 'overlay':
        return 'overlay';
      case 'darken':
        return 'darken';
      case 'lighten':
        return 'lighten';
      case 'color-dodge':
        return 'color-dodge';
      case 'color-burn':
        return 'color-burn';
      case 'difference':
        return 'difference';
      default:
        return 'source-over';
    }
  }

  public clearCache(): void {
    this.compositeTiles.clear();
  }
}
