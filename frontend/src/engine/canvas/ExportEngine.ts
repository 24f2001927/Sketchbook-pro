import { TiledLayer } from '../../state/document';
import type { DocumentModel, LayerNode, BlendMode } from '../../state/document';

export class ExportEngine {
  // Combine all layer tiles into a single flat Canvas
  public static flattenDocument(
    layers: LayerNode[],
    width: number,
    height: number
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Compositing layers from bottom to top
    for (const layer of layers) {
      if (!layer.visible || !layer.tileMap) {
        continue;
      }

      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = this.blendModeToCompositeOp(layer.blendMode);

      // Draw all tiles for this layer
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
      ctx.restore();
    }

    return canvas;
  }

  // Export to Blob
  public static async exportToBlob(
    layers: LayerNode[],
    width: number,
    height: number,
    format: 'image/png' | 'image/jpeg' | 'image/webp',
    quality = 0.95
  ): Promise<Blob> {
    const flatCanvas = this.flattenDocument(layers, width, height);
    return new Promise((resolve, reject) => {
      flatCanvas.toBlob(
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
    const serializedLayers = doc.layers.map((layer) => {
      const tiledLayer = layerTiles.get(layer.id);
      const serializedTiles: { key: string; dataUrl: string }[] = [];

      if (tiledLayer) {
        for (const [key, tile] of tiledLayer.tiles.entries()) {
          // Check if tile has any content to optimize size (not fully transparent)
          if (!this.isTileTransparent(tile.canvas)) {
            serializedTiles.push({
              key,
              dataUrl: tile.canvas.toDataURL('image/png'),
            });
          }
        }
      }

      return {
        id: layer.id,
        name: layer.name,
        type: layer.type,
        visible: layer.visible,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        clipping: layer.clipping,
        parentId: layer.parentId,
        tiles: serializedTiles,
      };
    });

    const projectData = {
      id: doc.id,
      metadata: {
        ...doc.metadata,
        updatedAt: Date.now(),
      },
      canvas: doc.canvas,
      activeLayerId: doc.activeLayerId,
      layers: serializedLayers,
    };

    return JSON.stringify(projectData);
  }

  // Deserialize JSON project string back to layer records
  public static deserializeDocument(
    jsonStr: string
  ): { document: DocumentModel; layerTiles: Map<string, TiledLayer> } {
    const data = JSON.parse(jsonStr);
    const layerTiles = new Map<string, TiledLayer>();

    const docLayers: LayerNode[] = data.layers.map((l: any) => {
      const tiledLayer = new TiledLayer(data.canvas.width, data.canvas.height);
      const tileMap = new Map<string, HTMLCanvasElement>();

      if (l.tiles) {
        l.tiles.forEach((t: { key: string; dataUrl: string }) => {
          const [txStr, tyStr] = t.key.split(',');
          const tx = parseInt(txStr);
          const ty = parseInt(tyStr);

          // We load image asynchronously, but for structural representation we pre-initialize the canvas tile
          const tile = tiledLayer.getOrCreateTile(tx, ty);
          const img = new Image();
          img.onload = () => {
            tile.ctx.clearRect(0, 0, TiledLayer.TILE_SIZE, TiledLayer.TILE_SIZE);
            tile.ctx.drawImage(img, 0, 0);
          };
          img.src = t.dataUrl;

          tileMap.set(t.key, tile.canvas);
        });
      }

      layerTiles.set(l.id, tiledLayer);

      return {
        id: l.id,
        name: l.name,
        type: l.type,
        visible: l.visible,
        opacity: l.opacity,
        blendMode: l.blendMode,
        clipping: l.clipping,
        parentId: l.parentId,
        tileMap,
      };
    });

    const document: DocumentModel = {
      id: data.id,
      metadata: data.metadata,
      canvas: data.canvas,
      layers: docLayers,
      activeLayerId: data.activeLayerId,
    };

    return { document, layerTiles };
  }

  private static isTileTransparent(canvas: HTMLCanvasElement): boolean {
    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < imgData.length; i += 4) {
      if (imgData[i] > 0) return false;
    }
    return true;
  }

  private static blendModeToCompositeOp(mode: BlendMode): GlobalCompositeOperation {
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
}
