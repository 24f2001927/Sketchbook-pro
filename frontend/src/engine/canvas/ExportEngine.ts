import { TiledLayer } from '../../state/document';
import type { DocumentModel, LayerNode, BlendMode } from '../../state/document';
import { PathRenderer } from '../vector/PathRenderer';

export class ExportEngine {
  // Combine ALL layer types (Raster, Vector, Image, Text) into a single flat Canvas
  public static flattenDocument(
    layers: LayerNode[],
    width: number,
    height: number,
    scaleFactor = 1.0
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scaleFactor);
    canvas.height = Math.round(height * scaleFactor);
    const ctx = canvas.getContext('2d')!;

    if (scaleFactor !== 1.0) {
      ctx.scale(scaleFactor, scaleFactor);
    }

    // Compositing layers from bottom to top
    for (const layer of layers) {
      if (!layer.visible) {
        continue;
      }

      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = this.blendModeToCompositeOp(layer.blendMode);

      // 1. Tiled Raster Layer
      if (layer.tileMap) {
        const cols = Math.ceil(width / TiledLayer.TILE_SIZE);
        const rows = Math.ceil(height / TiledLayer.TILE_SIZE);

        for (let ty = 0; ty < rows; ty++) {
          for (let tx = 0; tx < cols; tx++) {
            const tileKey = `${tx},${ty}`;
            const tileCanvas = layer.tileMap.get(tileKey);
            if (tileCanvas) {
              ctx.drawImage(tileCanvas, tx * TiledLayer.TILE_SIZE, ty * TiledLayer.TILE_SIZE);
            }
          }
        }
      }

      // 2. Vector Layer
      if (layer.type === 'vector' && layer.vectorPaths) {
        PathRenderer.renderPaths(ctx, layer.vectorPaths);
      }

      // 3. Text Layer
      if (layer.type === 'text' && layer.textNode) {
        const tn = layer.textNode;
        ctx.font = `${tn.fontWeight} ${tn.fontSize}px ${tn.fontFamily}`;
        ctx.fillStyle = tn.color;
        ctx.textAlign = tn.align;
        ctx.textBaseline = 'top';
        tn.text.split('\n').forEach((line, i) => {
          ctx.fillText(line, tn.x, tn.y + i * tn.fontSize * (tn.leading / 100));
        });
      }

      // 4. Image Layer (AI cutouts, photos, graphics)
      if (layer.type === 'image' && layer.imageNode) {
        const node = layer.imageNode;
        const img = new Image();
        img.src = node.src;
        if (img.complete) {
          ctx.save();
          ctx.translate(node.x + node.width / 2, node.y + node.height / 2);
          ctx.rotate((node.rotation * Math.PI) / 180);
          ctx.drawImage(img, -node.width / 2, -node.height / 2, node.width, node.height);
          ctx.restore();
        }
      }

      ctx.restore();
    }

    return canvas;
  }

  // Compute tight bounding box of all artwork content across all visible layers
  public static getContentBoundingBox(
    layers: LayerNode[],
    canvasWidth: number,
    canvasHeight: number,
    padding = 16
  ): { x: number; y: number; w: number; h: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const layer of layers) {
      if (!layer.visible) continue;

      // 1. Tiled Raster Layers
      if (layer.tileMap) {
        for (const [key, tileCanvas] of layer.tileMap.entries()) {
          const [tx, ty] = key.split(',').map(Number);
          const tileX0 = tx * TiledLayer.TILE_SIZE;
          const tileY0 = ty * TiledLayer.TILE_SIZE;

          const ctx = tileCanvas.getContext('2d');
          if (ctx) {
            const imgData = ctx.getImageData(0, 0, tileCanvas.width, tileCanvas.height);
            const data = imgData.data;
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] > 5) { // non-transparent pixel
                const pixelIndex = (i - 3) / 4;
                const px = pixelIndex % tileCanvas.width;
                const py = Math.floor(pixelIndex / tileCanvas.width);
                const absX = tileX0 + px;
                const absY = tileY0 + py;
                if (absX < minX) minX = absX;
                if (absY < minY) minY = absY;
                if (absX > maxX) maxX = absX;
                if (absY > maxY) maxY = absY;
              }
            }
          }
        }
      }

      // 2. Vector Paths
      if (layer.type === 'vector' && layer.vectorPaths) {
        for (const path of layer.vectorPaths) {
          for (const a of path.anchors) {
            const sw = path.strokeWidth || 4;
            if (a.x - sw < minX) minX = a.x - sw;
            if (a.y - sw < minY) minY = a.y - sw;
            if (a.x + sw > maxX) maxX = a.x + sw;
            if (a.y + sw > maxY) maxY = a.y + sw;
          }
        }
      }

      // 3. Image Nodes
      if (layer.type === 'image' && layer.imageNode) {
        const node = layer.imageNode;
        if (node.x < minX) minX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.x + node.width > maxX) maxX = node.x + node.width;
        if (node.y + node.height > maxY) maxY = node.y + node.height;
      }

      // 4. Text Nodes
      if (layer.type === 'text' && layer.textNode) {
        const tn = layer.textNode;
        const textWidth = Math.max(80, tn.text.length * tn.fontSize * 0.6);
        const textHeight = Math.max(tn.fontSize, tn.text.split('\n').length * tn.fontSize * 1.3);
        if (tn.x < minX) minX = tn.x;
        if (tn.y < minY) minY = tn.y;
        if (tn.x + textWidth > maxX) maxX = tn.x + textWidth;
        if (tn.y + textHeight > maxY) maxY = tn.y + textHeight;
      }
    }

    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return { x: 0, y: 0, w: canvasWidth, h: canvasHeight };
    }

    // Add padding and constrain within canvas bounds
    const paddedMinX = Math.max(0, Math.floor(minX - padding));
    const paddedMinY = Math.max(0, Math.floor(minY - padding));
    const paddedMaxX = Math.min(canvasWidth, Math.ceil(maxX + padding));
    const paddedMaxY = Math.min(canvasHeight, Math.ceil(maxY + padding));

    const w = Math.max(10, paddedMaxX - paddedMinX);
    const h = Math.max(10, paddedMaxY - paddedMinY);

    return { x: paddedMinX, y: paddedMinY, w, h };
  }

  // Export to Blob (Exports ONLY the active content area size, auto-cropped to content bounds)
  public static async exportToBlob(
    layers: LayerNode[],
    width: number,
    height: number,
    format: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png',
    quality = 0.95,
    cropToContent = true,
    scaleFactor = 1.0
  ): Promise<Blob> {
    // Pre-load all image layer sources to guarantee complete flattening
    const imagePromises: Promise<void>[] = [];
    for (const layer of layers) {
      if (layer.visible && layer.type === 'image' && layer.imageNode) {
        const node = layer.imageNode;
        imagePromises.push(new Promise(resolve => {
          const img = new Image();
          img.src = node.src;
          if (img.complete) resolve();
          else {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }
        }));
      }
    }
    await Promise.all(imagePromises);

    const flatCanvas = this.flattenDocument(layers, width, height, scaleFactor);

    let exportCanvas = flatCanvas;

    if (cropToContent) {
      const bbox = this.getContentBoundingBox(layers, width, height, 16);
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.round(bbox.w * scaleFactor);
      cropCanvas.height = Math.round(bbox.h * scaleFactor);
      const cropCtx = cropCanvas.getContext('2d')!;
      cropCtx.drawImage(
        flatCanvas,
        bbox.x * scaleFactor,
        bbox.y * scaleFactor,
        bbox.w * scaleFactor,
        bbox.h * scaleFactor,
        0, 0,
        cropCanvas.width,
        cropCanvas.height
      );
      exportCanvas = cropCanvas;
    }

    return new Promise((resolve, reject) => {
      exportCanvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Export failed: blob generation returned null'));
        },
        format,
        quality
      );
    });
  }

  // Serialize Document Model to JSON file format
  public static serializeDocument(
    doc: DocumentModel,
    layerTiles: Map<string, TiledLayer>
  ): string {
    const tileData: Record<string, Record<string, string>> = {};

    for (const [layerId, tiledLayer] of layerTiles) {
      tileData[layerId] = {};
      for (const [key, tile] of tiledLayer.tiles) {
        tileData[layerId][key] = tile.canvas.toDataURL();
      }
    }

    return JSON.stringify({
      version: 1,
      document: doc,
      tiles: tileData,
    }, null, 2);
  }

  // Deserialize JSON to Document Model
  public static deserializeDocument(jsonStr: string): {
    document: DocumentModel;
    layerTiles: Map<string, TiledLayer>;
  } {
    const data = JSON.parse(jsonStr);
    const doc: DocumentModel = data.document;
    const layerTiles = new Map<string, TiledLayer>();

    if (data.tiles) {
      for (const [layerId, tilesRecord] of Object.entries(data.tiles)) {
        const tl = new TiledLayer(doc.canvas.width, doc.canvas.height);
        for (const [key, dataUrl] of Object.entries(tilesRecord as Record<string, string>)) {
          const img = new Image();
          img.src = dataUrl;
          const [tx, ty] = key.split(',').map(Number);
          const tile = tl.getOrCreateTile(tx, ty);
          img.onload = () => { tile.ctx.drawImage(img, 0, 0); };
        }
        layerTiles.set(layerId, tl);
      }
    }

    return { document: doc, layerTiles };
  }

  private static blendModeToCompositeOp(blendMode: BlendMode): GlobalCompositeOperation {
    switch (blendMode) {
      case 'multiply': return 'multiply';
      case 'screen': return 'screen';
      case 'overlay': return 'overlay';
      case 'darken': return 'darken';
      case 'lighten': return 'lighten';
      case 'color-dodge': return 'color-dodge';
      case 'color-burn': return 'color-burn';
      case 'difference': return 'difference';
      default: return 'source-over';
    }
  }
}
