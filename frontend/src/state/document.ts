export type LayerType = 'raster' | 'vector' | 'group' | 'text' | 'image';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'difference';

export interface CanvasSettings {
  width: number;
  height: number;
  dpi: number;
  colorSpace: 'srgb' | 'display-p3';
}

export interface ImageNode {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface LayerNode {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  clipping: boolean;
  parentId: string | null;
  tileMap?: Map<string, HTMLCanvasElement>; // raster only
  vectorPaths?: VectorPath[];               // vector only
  textNode?: TextNode;                      // text only
  imageNode?: ImageNode;                    // image only
}

export interface VectorAnchor {
  id: string;
  x: number;
  y: number;
  handleIn: { x: number; y: number };
  handleOut: { x: number; y: number };
  smooth: boolean;
}

export interface VectorPath {
  id: string;
  anchors: VectorAnchor[];
  closed: boolean;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string | null;
  fillRule: 'nonzero' | 'evenodd';
}

export interface TextNode {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  color: string;
  tracking: number;
  leading: number;
  align: 'left' | 'center' | 'right';
}

export interface Mesh3DData {
  name: string;
  vertices: { x: number; y: number; z: number }[];
  faces: number[][];
}

export interface DocumentMetadata {
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentModel {
  id: string;
  metadata: DocumentMetadata;
  canvas: CanvasSettings;
  layers: LayerNode[];
  activeLayerId: string | null;
}

export interface CanvasTile {
  x: number; // tile index x
  y: number; // tile index y
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export class TiledLayer {
  public static TILE_SIZE = 256;
  public tiles: Map<string, CanvasTile> = new Map();
  public width: number;
  public height: number;

  constructor(
    width: number,
    height: number
  ) {
    this.width = width;
    this.height = height;
  }

  private getTileKey(tx: number, ty: number): string {
    return `${tx},${ty}`;
  }

  public getOrCreateTile(tx: number, ty: number): CanvasTile {
    const key = this.getTileKey(tx, ty);
    let tile = this.tiles.get(key);
    if (!tile) {
      const canvas = document.createElement('canvas');
      canvas.width = TiledLayer.TILE_SIZE;
      canvas.height = TiledLayer.TILE_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      // Initialize transparent
      ctx.clearRect(0, 0, TiledLayer.TILE_SIZE, TiledLayer.TILE_SIZE);
      tile = { x: tx, y: ty, canvas, ctx };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  public getTileForPixel(px: number, py: number): CanvasTile {
    const tx = Math.floor(px / TiledLayer.TILE_SIZE);
    const ty = Math.floor(py / TiledLayer.TILE_SIZE);
    return this.getOrCreateTile(tx, ty);
  }

  public forEachTileInRect(
    x: number,
    y: number,
    w: number,
    h: number,
    callback: (tile: CanvasTile, localX: number, localY: number, localW: number, localH: number) => void
  ): void {
    const startTx = Math.floor(x / TiledLayer.TILE_SIZE);
    const startTy = Math.floor(y / TiledLayer.TILE_SIZE);
    const endTx = Math.ceil((x + w) / TiledLayer.TILE_SIZE) - 1;
    const endTy = Math.ceil((y + h) / TiledLayer.TILE_SIZE) - 1;

    for (let ty = startTy; ty <= endTy; ty++) {
      for (let tx = startTx; tx <= endTx; tx++) {
        const tile = this.getOrCreateTile(tx, ty);
        // Calculate overlap region in canvas coords
        const tileCanvasX = tx * TiledLayer.TILE_SIZE;
        const tileCanvasY = ty * TiledLayer.TILE_SIZE;

        const overlapX = Math.max(x, tileCanvasX);
        const overlapY = Math.max(y, tileCanvasY);
        const overlapW = Math.min(x + w, tileCanvasX + TiledLayer.TILE_SIZE) - overlapX;
        const overlapH = Math.min(y + h, tileCanvasY + TiledLayer.TILE_SIZE) - overlapY;

        if (overlapW > 0 && overlapH > 0) {
          // Local offset inside this specific tile (0 - 255)
          const localX = overlapX - tileCanvasX;
          const localY = overlapY - tileCanvasY;
          callback(tile, localX, localY, overlapW, overlapH);
        }
      }
    }
  }

  // Clone active tiles (for undo/redo states)
  public clone(): TiledLayer {
    const cloned = new TiledLayer(this.width, this.height);
    for (const [key, tile] of this.tiles.entries()) {
      const newCanvas = document.createElement('canvas');
      newCanvas.width = TiledLayer.TILE_SIZE;
      newCanvas.height = TiledLayer.TILE_SIZE;
      const newCtx = newCanvas.getContext('2d')!;
      newCtx.drawImage(tile.canvas, 0, 0);
      cloned.tiles.set(key, {
        x: tile.x,
        y: tile.y,
        canvas: newCanvas,
        ctx: newCtx
      });
    }
    return cloned;
  }
}

// Command Pattern for undo/redo
export interface Command {
  name: string;
  execute(): void;
  undo(): void;
}

export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private onHistoryChangeCallbacks: (() => void)[] = [];

  public execute(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = []; // Clear redo stack on new operation
    this.notify();
  }

  public undo(): void {
    const command = this.undoStack.pop();
    if (command) {
      command.undo();
      this.redoStack.push(command);
      this.notify();
    }
  }

  public redo(): void {
    const command = this.redoStack.pop();
    if (command) {
      command.execute();
      this.undoStack.push(command);
      this.notify();
    }
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getUndoStack(): Command[] {
    return [...this.undoStack];
  }

  public getRedoStack(): Command[] {
    return [...this.redoStack];
  }

  public addListener(callback: () => void): () => void {
    this.onHistoryChangeCallbacks.push(callback);
    return () => {
      this.onHistoryChangeCallbacks = this.onHistoryChangeCallbacks.filter((c) => c !== callback);
    };
  }

  private notify(): void {
    this.onHistoryChangeCallbacks.forEach((cb) => cb());
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}
