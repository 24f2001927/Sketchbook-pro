/**
 * Auto-saving & Caching Engine using IndexedDB with localStorage fallback.
 * Ensures all drawing strokes, vector paths, layers, pages, and application
 * settings persist locally across sessions and offline connection drops.
 */

const DB_NAME = 'SketchbookProCache';
const DB_VERSION = 1;
const STORE_NAME = 'document_cache';

export interface CachedLayerData {
  id: string;
  name: string;
  type: 'raster' | 'vector' | 'group' | 'text' | 'image';
  visible: boolean;
  opacity: number;
  blendMode: string;
  clipping: boolean;
  parentId: string | null;
  vectorPaths?: any[];
  textNode?: any;
  imageNode?: any;
  tilesBase64?: Record<string, string>; // Tile key -> Base64 data URL
}

export interface CachedDocumentData {
  id: string;
  updatedAt: number;
  activeTier: 'common' | 'animation' | 'rare' | 'legendary';
  activePageId: string;
  pages: any[];
  layers: CachedLayerData[];
  activeLayerId: string | null;
}

class StorageEngine {
  private db: IDBDatabase | null = null;
  private isReady = false;

  constructor() {
    this.initDB();
  }

  private initDB(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        this.isReady = true;
        resolve();
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e: any) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (e: any) => {
        this.db = e.target.result;
        this.isReady = true;
        resolve();
      };

      request.onerror = () => {
        this.isReady = true;
        resolve();
      };
    });
  }

  public async saveDocumentCache(data: CachedDocumentData): Promise<void> {
    if (!this.isReady) await this.initDB();

    try {
      if (this.db) {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(data);
      } else {
        // Fallback to localStorage
        localStorage.setItem(DB_NAME, JSON.stringify(data));
      }
    } catch (err) {
      console.warn('StorageEngine auto-save warning:', err);
    }
  }

  public async loadDocumentCache(): Promise<CachedDocumentData | null> {
    if (!this.isReady) await this.initDB();

    try {
      if (this.db) {
        return new Promise((resolve) => {
          const tx = this.db!.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const req = store.get('current-auto-save');

          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
      } else {
        const item = localStorage.getItem(DB_NAME);
        return item ? JSON.parse(item) : null;
      }
    } catch (err) {
      console.warn('StorageEngine load cache warning:', err);
      return null;
    }
  }

  public async clearCache(): Promise<void> {
    if (!this.isReady) await this.initDB();

    if (this.db) {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
    } else {
      localStorage.removeItem(DB_NAME);
    }
  }
}

export const storageEngine = new StorageEngine();
