import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  type DocumentModel,
  type LayerNode,
  type VectorPath,
  type TextNode,
  TiledLayer,
  type BlendMode,
  HistoryManager,
  type Command,
  type VectorAnchor,
  type ImageNode,
  type Mesh3DData,
} from './state/document';
import {
  InputNormalizer,
  type StylusInput,
  type StabilizerSettings,
} from './engine/input/StylusInput';
import { StrokeStabilizer } from './engine/input/StylusInput';
import { BrushEngine, DEFAULT_BRUSH_PRESETS } from './engine/brush/BrushEngine';
import { ViewportRenderer, type ViewportTransform } from './engine/canvas/ViewportRenderer';
import { ExportEngine } from './engine/canvas/ExportEngine';
import { PathRenderer } from './engine/vector/PathRenderer';
import { PenTool } from './engine/vector/PenTool';
import type { PenToolAction } from './engine/vector/PenTool';
import { BooleanOps } from './engine/vector/BooleanOps';
import { BezierMath } from './engine/vector/BezierMath';
import { TextToolOverlay } from './components/TextToolOverlay';
import { TierSwitcher, type TierLevel } from './components/TierSwitcher';
import { AnimationWorkspace } from './components/AnimationWorkspace';
import { RareWorkspace } from './components/RareWorkspace';
import { LegendaryWorkspace } from './components/LegendaryWorkspace';
import { storageEngine } from './state/storage';
import { PDFEngine, type PDFExportOptions } from './engine/pdf/PDFEngine';




export const FONT_OPTIONS = [
  { name: 'Inter', family: 'Inter, sans-serif' },
  { name: 'Montserrat', family: 'Montserrat, sans-serif' },
  { name: 'Outfit', family: 'Outfit, sans-serif' },
  { name: 'Playfair Display', family: 'Playfair Display, serif' },
  { name: 'Lora', family: 'Lora, serif' },
  { name: 'Bebas Neue', family: '"Bebas Neue", cursive' },
  { name: 'Fira Code', family: '"Fira Code", monospace' },
  { name: 'Caveat', family: 'Caveat, cursive' },
  { name: 'Pacifico', family: 'Pacifico, cursive' },
  { name: 'Cinzel', family: 'Cinzel, serif' },
  { name: 'Comfortaa', family: 'Comfortaa, cursive' },
  { name: 'Shadows Into Light', family: '"Shadows Into Light", cursive' },
  { name: 'Georgia', family: 'Georgia, serif' },
  { name: 'Monospace', family: 'monospace' },
];

// ─────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────

class DrawStrokeCommand implements Command {
  public name = 'Brush Stroke';
  private oldSnaps: Map<string, HTMLCanvasElement> = new Map();
  private newSnaps: Map<string, HTMLCanvasElement> = new Map();
  private layer: TiledLayer;
  private keys: Set<string>;
  private replayFn: () => void;

  constructor(layer: TiledLayer, keys: Set<string>, replayFn: () => void) {
    this.layer = layer;
    this.keys = new Set(keys);
    this.replayFn = replayFn;
    for (const k of this.keys) {
      const tile = layer.tiles.get(k);
      if (!tile) continue;
      const s = document.createElement('canvas');
      s.width = s.height = TiledLayer.TILE_SIZE;
      s.getContext('2d')!.drawImage(tile.canvas, 0, 0);
      this.oldSnaps.set(k, s);
    }
  }

  savePost(): void {
    for (const k of this.keys) {
      const tile = this.layer.tiles.get(k);
      if (!tile) continue;
      const s = document.createElement('canvas');
      s.width = s.height = TiledLayer.TILE_SIZE;
      s.getContext('2d')!.drawImage(tile.canvas, 0, 0);
      this.newSnaps.set(k, s);
    }
  }

  execute(): void {
    for (const [k, s] of this.newSnaps) {
      const [tx, ty] = k.split(',').map(Number);
      const t = this.layer.getOrCreateTile(tx, ty);
      t.ctx.clearRect(0, 0, TiledLayer.TILE_SIZE, TiledLayer.TILE_SIZE);
      t.ctx.drawImage(s, 0, 0);
    }
    this.replayFn();
  }

  undo(): void {
    for (const [k, s] of this.oldSnaps) {
      const t = this.layer.tiles.get(k);
      if (!t) continue;
      t.ctx.clearRect(0, 0, TiledLayer.TILE_SIZE, TiledLayer.TILE_SIZE);
      t.ctx.drawImage(s, 0, 0);
    }
  }
}

class AddVectorPathCommand implements Command {
  public name = 'Add Path';
  private layerId: string;
  private path: VectorPath;
  private setLayers: React.Dispatch<React.SetStateAction<LayerNode[]>>;

  constructor(
    layerId: string,
    path: VectorPath,
    setLayers: React.Dispatch<React.SetStateAction<LayerNode[]>>
  ) {
    this.layerId = layerId;
    this.path = path;
    this.setLayers = setLayers;
  }

  execute() {
    this.setLayers(prev => prev.map(l =>
      l.id === this.layerId ? { ...l, vectorPaths: [...(l.vectorPaths ?? []), this.path] } : l
    ));
  }
  undo() {
    this.setLayers(prev => prev.map(l =>
      l.id === this.layerId ? { ...l, vectorPaths: (l.vectorPaths ?? []).filter(p => p.id !== this.path.id) } : l
    ));
  }
}

class AddTextNodeCommand implements Command {
  public name = 'Add Text';
  private layerId: string;
  private node: TextNode;
  private setLayers: React.Dispatch<React.SetStateAction<LayerNode[]>>;

  constructor(
    layerId: string,
    node: TextNode,
    setLayers: React.Dispatch<React.SetStateAction<LayerNode[]>>
  ) {
    this.layerId = layerId;
    this.node = node;
    this.setLayers = setLayers;
  }

  execute() {
    this.setLayers(prev => prev.map(l => l.id === this.layerId ? { ...l, textNode: this.node } : l));
  }
  undo() {
    this.setLayers(prev => prev.map(l => l.id === this.layerId ? { ...l, textNode: undefined } : l));
  }
}

// ─────────────────────────────────────────────────────────────
// Small UI helpers
// ─────────────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <div className="section-header" onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span className={`section-chevron ${open ? 'open' : ''}`}>›</span>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

function Row({ label, value, children }: { label: string; value?: string | number; children: React.ReactNode }) {
  return (
    <div className="ctrl-row">
      <span className="ctrl-label">{label}</span>
      {children}
      {value !== undefined && <span className="ctrl-value">{value}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Resizable panel
// ─────────────────────────────────────────────────────────────
function ResizablePanel({ side, defaultW, minW = 140, maxW = 400, children }: {
  side: 'left' | 'right'; defaultW: number; minW?: number; maxW?: number; children: React.ReactNode;
}) {
  const [w, setW] = useState(defaultW);
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      if (side === 'left') setW(Math.min(Math.max(e.clientX - 44, minW), maxW));
      else setW(Math.min(Math.max(window.innerWidth - e.clientX, minW), maxW));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [side, minW, maxW]);

  return (
    <div className={`panel ${side === 'right' ? 'right' : ''}`} style={{ width: w }}>
      <div
        className={`resize-grip ${side === 'left' ? 'right-side' : 'left-side'}`}
        onMouseDown={() => { dragging.current = true; }}
      />
      <div className="panel-scroll">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Lorien Vector Helpers
// ─────────────────────────────────────────────────────────────
const COLOR_SWATCHES = [
  '#000000', // Black
  '#ffffff', // White
  '#4a5568', // Dark grey
  '#718096', // Medium grey
  '#e53e3e', // Red
  '#dd6b20', // Orange
  '#ecc94b', // Yellow
  '#38a169', // Green
  '#3182ce', // Blue
  '#805ad5', // Purple
  '#d53f8c', // Pink
];

function smoothVectorPath(path: VectorPath) {
  const len = path.anchors.length;
  if (len < 3) return;

  for (let i = 0; i < len; i++) {
    const curr = path.anchors[i];
    const prev = path.anchors[Math.max(0, i - 1)];
    const next = path.anchors[Math.min(len - 1, i + 1)];

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;

    const k = 0.16;
    curr.handleIn = { x: -dx * k, y: -dy * k };
    curr.handleOut = { x: dx * k, y: dy * k };
    curr.smooth = true;
  }
  path.anchors[0].handleIn = { x: 0, y: 0 };
  path.anchors[len - 1].handleOut = { x: 0, y: 0 };
}

function createEllipsePath(x0: number, y0: number, x1: number, y1: number, strokeColor: string, strokeWidth: number, fillColor: string | null): VectorPath {
  const xc = (x0 + x1) / 2;
  const yc = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  const kappa = 0.5522847498307935;
  const ox = rx * kappa;
  const oy = ry * kappa;

  const anchors: VectorAnchor[] = [
    { id: `a-c1-${Math.random()}`, x: xc, y: yc - ry, handleIn: { x: -ox, y: 0 }, handleOut: { x: ox, y: 0 }, smooth: true },
    { id: `a-c2-${Math.random()}`, x: xc + rx, y: yc, handleIn: { x: 0, y: -oy }, handleOut: { x: 0, y: oy }, smooth: true },
    { id: `a-c3-${Math.random()}`, x: xc, y: yc + ry, handleIn: { x: ox, y: 0 }, handleOut: { x: -ox, y: 0 }, smooth: true },
    { id: `a-c4-${Math.random()}`, x: xc - rx, y: yc, handleIn: { x: 0, y: oy }, handleOut: { x: 0, y: -oy }, smooth: true },
  ];

  return {
    id: `ellipse-${Date.now()}-${Math.random()}`,
    anchors,
    closed: true,
    strokeColor,
    strokeWidth,
    fillColor,
    fillRule: 'nonzero'
  };
}

function createRectPath(x0: number, y0: number, x1: number, y1: number, strokeColor: string, strokeWidth: number, fillColor: string | null): VectorPath {
  const anchors: VectorAnchor[] = [
    { id: `a-r1-${Math.random()}`, x: x0, y: y0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
    { id: `a-r2-${Math.random()}`, x: x1, y: y0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
    { id: `a-r3-${Math.random()}`, x: x1, y: y1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
    { id: `a-r4-${Math.random()}`, x: x0, y: y1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
  ];

  return {
    id: `rect-${Date.now()}-${Math.random()}`,
    anchors,
    closed: true,
    strokeColor,
    strokeWidth,
    fillColor,
    fillRule: 'nonzero'
  };
}

function createLinePath(x0: number, y0: number, x1: number, y1: number, strokeColor: string, strokeWidth: number): VectorPath {
  const anchors: VectorAnchor[] = [
    { id: `a-l1-${Math.random()}`, x: x0, y: y0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
    { id: `a-l2-${Math.random()}`, x: x1, y: y1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, smooth: false },
  ];

  return {
    id: `line-${Date.now()}-${Math.random()}`,
    anchors,
    closed: false,
    strokeColor,
    strokeWidth,
    fillColor: null,
    fillRule: 'nonzero'
  };
}

function getPathBoundingBox(path: VectorPath): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const a of path.anchors) {
    minX = Math.min(minX, a.x);
    minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x);
    maxY = Math.max(maxY, a.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function drawBBox(ctx: CanvasRenderingContext2D, bbox: { x: number; y: number; w: number; h: number }, zoom: number) {
  ctx.save();
  ctx.strokeStyle = '#0066ff';
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
  ctx.setLineDash([]);

  // Draw 4 corner handles
  const handleSize = 8 / zoom;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0066ff';
  ctx.lineWidth = 1.5 / zoom;

  const corners = [
    { x: bbox.x, y: bbox.y }, // TL
    { x: bbox.x + bbox.w, y: bbox.y }, // TR
    { x: bbox.x + bbox.w, y: bbox.y + bbox.h }, // BR
    { x: bbox.x, y: bbox.y + bbox.h }, // BL
  ];

  for (const c of corners) {
    ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
  }
  ctx.restore();
}

function getHitHandle(bbox: { x: number; y: number; w: number; h: number }, x: number, y: number, zoom: number): 'TL' | 'TR' | 'BR' | 'BL' | null {
  const radius = 8 / zoom;
  if (Math.hypot(bbox.x - x, bbox.y - y) <= radius) return 'TL';
  if (Math.hypot(bbox.x + bbox.w - x, bbox.y - y) <= radius) return 'TR';
  if (Math.hypot(bbox.x + bbox.w - x, bbox.y + bbox.h - y) <= radius) return 'BR';
  if (Math.hypot(bbox.x - x, bbox.y + bbox.h - y) <= radius) return 'BL';
  return null;
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type ActiveTool = 'brush' | 'eraser' | 'pen' | 'text' | 'select' | 'crop' | 'pan';
type ShapeMode = 'freehand' | 'line' | 'rect' | 'circle';

interface Bookmark {
  id: string;
  name: string;
  transform: ViewportTransform;
}

interface DrawingPage {
  id: string;
  name: string;
  layers: LayerNode[];
  activeLayerId: string | null;
  transform: ViewportTransform;
  parentId: string | null;
  format: 'blank' | 'lined' | 'grid' | 'dotted' | 'checklist';
  checkedLines?: Record<number, boolean>;
}

interface TutorialStep {
  title: string;
  badge: string;
  description: string;
  details: string[];
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Tier Workspace Router',
    badge: 'Step 1 of 10 · Workspace Level Switcher',
    description: 'Sketchbook Pro features 4 specialized level workspaces that share a unified document & layer stack.',
    details: [
      'Common Level: 2D Vector/Raster drawing, PDF import/inking & active area export.',
      'Animation Level: 2D Timeline, frame-by-frame onion skinning & stylus pressure.',
      'Rare Level: WebGL 3D Wavefront OBJ mesh viewer, NumPy volume tensors & Industry Shader Suite.',
      'Legendary Level: PyTorch AI Models (SAM Segmentation, U2-Net, Real-ESRGAN) & Y.js Collab.'
    ]
  },
  {
    title: 'Import PDF & Page Photos',
    badge: 'Step 2 of 10 · Document Importer',
    description: 'Import multi-page PDF files or page photos directly onto your drawing canvas.',
    details: [
      'Converts PDF pages into document background layers using client-side PDF.js.',
      'Automatically activates drawing tools so you can draw, paint, write text notes, and annotate directly on top of the PDF!'
    ]
  },
  {
    title: 'Interactive PDF Exporter',
    badge: 'Step 3 of 10 · PDF Export Options',
    description: 'Export your artwork, drawings, and annotations into a clean binary PDF document.',
    details: [
      'Layer Selection: Filter visible layers (All Visible, Vector Only, Text Only, Raster Only).',
      'Page Bounds: Export Active Content Area or Full Canvas Workspace.',
      'Print Quality: Select 300 DPI HD or 150 DPI Standard resolution.'
    ]
  },
  {
    title: 'Active Content Area PNG Export',
    badge: 'Step 4 of 10 · PNG Image Export',
    description: 'Export your multi-layer drawing as a high-resolution PNG image.',
    details: [
      'Automatically trims away empty space around drawn content.',
      'Exports at exact content pixel dimensions without forced upscaling caps.'
    ]
  },
  {
    title: 'Smart Canvas & Camera Tour Loop',
    badge: 'Step 5 of 10 · Telemetry & Inspection',
    description: 'Real-time spatial telemetry scanner & dynamic hands-free camera inspection tour loop.',
    details: [
      'Tracks active content bounds, pixel dimensions, layer counts, and text notes.',
      'Click "Focus & Tour Content Camera" to run a hands-free tour looping through all your worked regions!'
    ]
  },
  {
    title: 'Studio Drawing Tools',
    badge: 'Step 6 of 10 · Left Toolbar',
    description: 'Choose your active drawing mode from the left toolbar.',
    details: [
      'Brush (B): Freehand raster painting & stylus inking.',
      'Eraser (E): Pixel-perfect raster erasing.',
      'Pen (P): Vector Bezier curve path drawing.',
      'Text (T): Interactive text notes & annotations.',
      'Select (V): Move, scale, & transform elements across layers.',
      'Crop (C): High-contrast canvas cropping box.'
    ]
  },
  {
    title: 'Absolute Screen-Space Brush Sizing',
    badge: 'Step 7 of 10 · Brush Controls',
    description: 'Customize brush size, color, opacity, and brush presets.',
    details: [
      'Absolute Sizing: Whether canvas zoom is 5%, 50%, 100%, or 200%, your brush stroke maintains the exact same visual pixel width selected on the sidebar slider!',
      'Presets: Pencil, Airbrush, Technical Pen, Ink Marker, Chalk.'
    ]
  },
  {
    title: 'Layer Manager & Blend Modes',
    badge: 'Step 8 of 10 · Right Layer Panel',
    description: 'Manage raster paint, vector line art, text notes, and imported PDF layers.',
    details: [
      'Organize layer hierarchy, toggle visibility, and adjust opacity.',
      'Apply blend modes (Normal, Multiply, Screen, Overlay, Darken, Lighten).',
      'Add new raster paint layers or vector illustration layers.'
    ]
  },
  {
    title: 'Unrestricted Infinite Canvas',
    badge: 'Step 9 of 10 · Canvas Stage',
    description: 'Drawing canvas with infinite expansion in all directions.',
    details: [
      'Pan: Middle-mouse click & drag, or hold Spacebar + drag.',
      'Zoom: Mouse wheel scroll (0.1x to 8.0x zoom).',
      'Graphics Tablet Support: Pressure-sensitive stylus input (Wacom, iPad/Pencil, Surface).'
    ]
  },
  {
    title: '500ms Debounced Auto-Save',
    badge: 'Step 10 of 10 · Offline Storage',
    description: 'Your creative work is automatically protected.',
    details: [
      'Every stroke, vector curve, text edit, and PDF layer is saved to IndexedDB within 500ms.',
      'Restores your document state automatically if you reload or switch tier workspaces.'
    ]
  }
];

// ─────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────
export default function App() {
  // Interactive Onboarding Tutorial State
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  // Use Case Tier Level ('common' | 'rare' | 'legendary')
  const [tierLevel, setTierLevel] = useState<TierLevel>('common');

  // Viewport
  const [transform, setTransform] = useState<ViewportTransform>({ zoom: 1, panX: 0, panY: 0, rotation: 0 });
  const [vpSize, setVpSize] = useState({ w: 800, h: 600 });
  const CANVAS_W = 2000, CANVAS_H = 2000;

  // Canvas Settings (OkSo style infinite mode support)
  const [showPageBorder, setShowPageBorder] = useState(false); // default false for infinite canvas
  const [bgTheme, setBgTheme] = useState<'dark' | 'light'>('light');

  // Drawing Pages (OkSo style nested pages structure)
  const [pages, setPages] = useState<DrawingPage[]>([]);
  const [activePageId, setActivePageId] = useState<string>('default-page');
  const [pageFormat, setPageFormat] = useState<'blank' | 'lined' | 'grid' | 'dotted' | 'checklist'>('dotted');
  const [checkedLines, setCheckedLines] = useState<Record<number, boolean>>({});

  // Add Page Modal
  const [addPageModal, setAddPageModal] = useState<{ parentId: string | null } | null>(null);
  const [addPageName, setAddPageName] = useState('');
  const [addPageFormat, setAddPageFormat] = useState<'blank' | 'lined' | 'grid' | 'dotted' | 'checklist'>('blank');

  // Document (active page's local layers)
  const [layers, setLayers] = useState<LayerNode[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [histStats, setHistStats] = useState({ undo: 0, redo: 0 });

  // Tool / Shape / Zen
  const [tool, setTool] = useState<ActiveTool>('brush');
  const [shapeMode, setShapeMode] = useState<ShapeMode>('freehand');
  const [zenMode, setZenMode] = useState(false);

  // Bookmarks & Shortcuts display
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [shortcutKey, setShortcutKey] = useState<string | null>(null);

  // Brush / Palette
  const brushPresets = DEFAULT_BRUSH_PRESETS;
  const [presetId, setPresetId] = useState(DEFAULT_BRUSH_PRESETS[1].id);
  const [color, setColor] = useState('#1a1a1a');
  const [size, setSize] = useState(10);
  const [opacity, setOpacity] = useState(1.0);
  const [stabSettings, setStabSettings] = useState<StabilizerSettings>({
    mode: 'smooth', smoothFactor: 0.5, lazyRadius: 12,
  });

  // Vector styling
  const [vStroke, setVStroke] = useState('#1a1a1a');
  const [vFill, setVFill] = useState<string | null>(null);
  const [vWidth, setVWidth] = useState(4);
  const [selPaths, setSelPaths] = useState<Set<string>>(new Set());
  const penRef = useRef(new PenTool());
  const [penState, setPenState] = useState(penRef.current.state);

  // Crop / Transform
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'TL' | 'TR' | 'BR' | 'BL' | null>(null);
  const [draggingPath, setDraggingPath] = useState(false);
  const [draggingText, setDraggingText] = useState(false);
  const [draggingImage, setDraggingImage] = useState(false);

  // Selection states
  const [selAnchor, setSelAnchor] = useState<{ pathId: string; index: number } | null>(null);
  const [selHandleType, setSelHandleType] = useState<'in' | 'out' | null>(null);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const pathSnapRef = useRef<Record<string, VectorAnchor[]>>({});
  const historyPathSnapRef = useRef<Record<string, VectorPath[]>>({});
  const historyImageSnapRef = useRef<Record<string, ImageNode>>({});
  const initialBBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const textSnapRef = useRef<TextNode | null>(null);
  const imageSnapRef = useRef<ImageNode | null>(null);
  const lastBrushInputRef = useRef<StylusInput | null>(null);
  const hoverPosRef = useRef<{ x: number; y: number } | null>(null);
  const cropStartRef = useRef({ x: 0, y: 0 });
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // 3D Mesh & Volume Tensor persistence across tiers
  const [loaded3DMesh, setLoaded3DMesh] = useState<Mesh3DData | null>(null);

  // PDF Import & Interactive Export State
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfExportOptions, setPdfExportOptions] = useState<PDFExportOptions>({
    layerSelection: 'all',
    pageArea: 'active_content',
    orientation: 'auto',
    resolutionDPI: 300,
    pdfTitle: 'Sketchbook_Pro_Artwork',
    author: 'Artist',
  });
  const [pdfStatusMsg, setPdfStatusMsg] = useState<string | null>(null);

  // Content Camera Tour Loop State
  const [isTouringCamera, setIsTouringCamera] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const initialViewportRef = useRef<ViewportTransform | null>(null);

  const importPDFFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { newLayer } = await PDFEngine.importPDFPageToLayer(file, CANVAS_W, CANVAS_H);
      setLayers(prev => [...prev, newLayer]);
      setActiveLayerId(newLayer.id);
      setTool('brush');
      redraw();
      setPdfStatusMsg(`Imported PDF (${file.name}) as layer! You can draw, paint & annotate on top.`);
    } catch {
      alert('Failed to import PDF document page.');
    }
  };

  const executePDFExport = async () => {
    try {
      const blob = await PDFEngine.exportPDFWithOptions(layers, CANVAS_W, CANVAS_H, pdfExportOptions);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pdfExportOptions.pdfTitle.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setPdfModalOpen(false);
    } catch {
      alert('Failed to generate PDF document.');
    }
  };
  const [textOv, setTextOv] = useState<{ x: number; y: number; layerId: string; text?: string } | null>(null);
  const [tSize, setTSize] = useState(28);
  const [tColor, setTColor] = useState('#1a1a1a');
  const [tFont, setTFont] = useState('Inter, sans-serif');

  // Stats
  const [ptrStats, setPtrStats] = useState<StylusInput | null>(null);

  // Refs
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const overlayRef  = useRef<HTMLCanvasElement>(null);
  const vpRef       = useRef<HTMLDivElement>(null);
  const rendererRef = useRef(new ViewportRenderer());
  const normRef     = useRef(new InputNormalizer());
  const stabRef     = useRef(new StrokeStabilizer());
  const brushRef    = useRef(new BrushEngine());
  const histRef     = useRef(new HistoryManager());
  const tilesRef    = useRef<Map<string, TiledLayer>>(new Map());

  const drawingRef  = useRef(false);
  const panningRef  = useRef(false);
  const lastPosRef  = useRef({ x: 0, y: 0 });
  const strokeCmdRef = useRef<DrawStrokeCommand | null>(null);
  const dirtyTilesRef = useRef<Set<string>>(new Set());
  const livePathRef = useRef<VectorPath | null>(null);
  const needsRecompositeRef = useRef(true);

  // ── Color switcher sync ───────────────────────────────────
  const updateActiveColor = (hex: string) => {
    setColor(hex);
    setVStroke(hex);
    if (vFill !== null) setVFill(hex);
    setTColor(hex);
  };

  // ── Coordinate helpers ─────────────────────────────────────
  const toCanvas = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = canvasRef.current!;
    const rect = el.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return rendererRef.current.screenToCanvas(sx, sy, transform, vpSize.w, vpSize.h, CANVAS_W, CANVAS_H);
  }, [transform, vpSize]);

  // ── Overlay canvas (pen tool live path & selection) ────────
  const drawOverlay = useCallback(() => {
    const oc = overlayRef.current;
    if (!oc) return;
    const ctx = oc.getContext('2d')!;
    ctx.clearRect(0, 0, oc.width, oc.height);

    ctx.save();
    ctx.translate(vpSize.w / 2, vpSize.h / 2);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.translate(transform.panX, transform.panY);
    ctx.scale(transform.zoom, transform.zoom);
    ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);

    // Render live shape preview or pen tool path
    const lp = livePathRef.current;
    if (lp && lp.anchors.length > 0) {
      PathRenderer.renderPath(ctx, lp);
      PathRenderer.renderPathOutline(ctx, lp, transform);

      // Render pen rubber-band line preview
      if (penState === 'drawing' && hoverPosRef.current) {
        const lastAnchor = lp.anchors[lp.anchors.length - 1];
        ctx.beginPath();
        ctx.moveTo(lastAnchor.x, lastAnchor.y);
        if (lastAnchor.handleOut.x !== 0 || lastAnchor.handleOut.y !== 0) {
          ctx.bezierCurveTo(
            lastAnchor.x + lastAnchor.handleOut.x, lastAnchor.y + lastAnchor.handleOut.y,
            hoverPosRef.current.x, hoverPosRef.current.y,
            hoverPosRef.current.x, hoverPosRef.current.y
          );
        } else {
          ctx.lineTo(hoverPosRef.current.x, hoverPosRef.current.y);
        }
        ctx.strokeStyle = 'rgba(88, 101, 242, 0.65)';
        ctx.lineWidth = 1.5 / transform.zoom;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }, [transform, vpSize, penState]);

  // ── Main canvas redraw ─────────────────────────────────────
  const redraw = useCallback((dirtyTiles?: Set<string>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    // Construct up-to-date layer list with current tile maps
    const activeLayersWithTiles = layers.map(l => {
      const tl = tilesRef.current.get(l.id);
      if (!tl) return l;
      const m = new Map<string, HTMLCanvasElement>();
      for (const [k, t] of tl.tiles) m.set(k, t.canvas);
      return { ...l, tileMap: m };
    });

    // Recomposite if needed
    if (needsRecompositeRef.current || dirtyTiles) {
      rendererRef.current.composite(
        activeLayersWithTiles,
        CANVAS_W,
        CANVAS_H,
        needsRecompositeRef.current ? undefined : dirtyTiles
      );
      needsRecompositeRef.current = false;
    }

    rendererRef.current.drawToScreen(ctx, transform, vpSize.w, vpSize.h, CANVAS_W, CANVAS_H, showPageBorder, bgTheme, pageFormat, checkedLines);

    // Draw vector / text / image layers on top
    ctx.save();
    ctx.translate(vpSize.w / 2, vpSize.h / 2);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.translate(transform.panX, transform.panY);
    ctx.scale(transform.zoom, transform.zoom);
    ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);

    for (const layer of layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;

      if (layer.type === 'vector' && layer.vectorPaths) {
        for (const path of layer.vectorPaths) {
          PathRenderer.renderPath(ctx, path);
          if (selPaths.has(path.id)) {
            PathRenderer.renderPathOutline(ctx, path, transform);
          } else if (tool === 'select' || tool === 'pen' || tool === 'brush') {
            ctx.save();
            ctx.fillStyle = 'rgba(88, 101, 242, 0.4)';
            ctx.strokeStyle = 'rgba(88, 101, 242, 0.8)';
            ctx.lineWidth = 1 / transform.zoom;
            const size = 5 / transform.zoom;
            for (const a of path.anchors) {
              ctx.fillRect(a.x - size / 2, a.y - size / 2, size, size);
              ctx.strokeRect(a.x - size / 2, a.y - size / 2, size, size);
            }
            ctx.restore();
          }
        }
      }

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

      if (layer.type === 'image' && layer.imageNode) {
        const node = layer.imageNode;
        let img = imageCacheRef.current.get(node.id);
        if (!img) {
          img = new Image();
          img.src = node.src;
          img.onload = () => { redraw(); };
          imageCacheRef.current.set(node.id, img);
        }
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

    // Draw bounding box / transform overlay in Select tool
    if (tool === 'select' && activeLayerId) {
      const al = layers.find(l => l.id === activeLayerId);
      if (al) {
        if (al.type === 'vector' && al.vectorPaths && selPaths.size > 0) {
          for (const pathId of selPaths) {
            const path = al.vectorPaths.find(p => p.id === pathId);
            if (path) {
              const bbox = getPathBoundingBox(path);
              drawBBox(ctx, bbox, transform.zoom);
            }
          }
        }
        if (al.type === 'image' && al.imageNode) {
          const node = al.imageNode;
          const bbox = { x: node.x, y: node.y, w: node.width, h: node.height };
          drawBBox(ctx, bbox, transform.zoom);
        }
      }
    }

    // Draw crop box outline with high contrast for light/dark themes & corner handles
    if (tool === 'crop' && cropBox) {
      ctx.save();

      // 1. Semi-transparent mask outside crop area
      ctx.fillStyle = bgTheme === 'light' ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, CANVAS_W, cropBox.y);
      ctx.fillRect(0, cropBox.y + cropBox.h, CANVAS_W, CANVAS_H - (cropBox.y + cropBox.h));
      ctx.fillRect(0, cropBox.y, cropBox.x, cropBox.h);
      ctx.fillRect(cropBox.x + cropBox.w, cropBox.y, CANVAS_W - (cropBox.x + cropBox.w), cropBox.h);

      // 2. High-contrast crop outline
      const strokeColor = bgTheme === 'light' ? '#2563eb' : '#38bdf8';
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.5 / transform.zoom;
      ctx.strokeRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);

      // 3. Corner Handles
      const handleSize = 10 / transform.zoom;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2 / transform.zoom;

      const corners = [
        { x: cropBox.x, y: cropBox.y },
        { x: cropBox.x + cropBox.w, y: cropBox.y },
        { x: cropBox.x, y: cropBox.y + cropBox.h },
        { x: cropBox.x + cropBox.w, y: cropBox.y + cropBox.h },
      ];

      corners.forEach(c => {
        ctx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
        ctx.strokeRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
      });

      // 4. Dimension Badge
      ctx.fillStyle = bgTheme === 'light' ? '#1e293b' : '#0f172a';
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1 / transform.zoom;
      const badgeText = `${Math.round(cropBox.w)} × ${Math.round(cropBox.h)} px`;
      ctx.font = `600 ${Math.max(11, 13 / transform.zoom)}px Inter, sans-serif`;
      const textWidth = ctx.measureText(badgeText).width;
      const badgeW = textWidth + 16 / transform.zoom;
      const badgeH = 22 / transform.zoom;
      const badgeX = cropBox.x + cropBox.w / 2 - badgeW / 2;
      const badgeY = cropBox.y - badgeH - 6 / transform.zoom;

      ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, cropBox.x + cropBox.w / 2, badgeY + badgeH / 2);

      ctx.restore();
    }

    ctx.restore();
    drawOverlay();
  }, [layers, transform, vpSize, selPaths, drawOverlay, tool, cropBox, showPageBorder, bgTheme, pageFormat, checkedLines]);

  // ── Sync canvas/overlay size ───────────────────────────────
  useEffect(() => {
    const c = canvasRef.current;
    const o = overlayRef.current;
    if (c) { c.width = vpSize.w; c.height = vpSize.h; }
    if (o) { o.width = vpSize.w; o.height = vpSize.h; }
    redraw();
  }, [vpSize]);

  // Measure viewport container & calculate initial fit
  const initialFitDoneRef = useRef(false);
  useEffect(() => {
    const measure = () => {
      const el = vpRef.current;
      if (el && el.clientWidth > 0 && el.clientHeight > 0) {
        setVpSize({ w: el.clientWidth, h: el.clientHeight });
        if (!initialFitDoneRef.current) {
          initialFitDoneRef.current = true;
          const fitZoom = Math.min(el.clientWidth / CANVAS_W, el.clientHeight / CANVAS_H) * 0.88;
          setTransform({ zoom: Math.max(0.2, fitZoom), panX: 0, panY: 0, rotation: 0 });
        }
      }
    };
    const ro = new ResizeObserver(measure);
    if (vpRef.current) ro.observe(vpRef.current);
    measure();
    return () => ro.disconnect();
  }, []);

  // History listener
  useEffect(() => {
    return histRef.current.addListener(() => {
      setHistStats({ undo: histRef.current.getUndoStack().length, redo: histRef.current.getRedoStack().length });
      needsRecompositeRef.current = true;
      redraw();
    });
  }, [redraw]);

  // Redraw on change
  useEffect(() => { redraw(); }, [redraw]);

  // Auto-Save Document Cache to IndexedDB
  useEffect(() => {
    const timer = setTimeout(() => {
      if (layers.length > 0) {
        storageEngine.saveDocumentCache({
          id: 'current-auto-save',
          updatedAt: Date.now(),
          activeTier: tierLevel,
          activePageId: activePageId,
          pages: pages,
          layers: layers.map(l => ({
            id: l.id,
            name: l.name,
            type: l.type,
            visible: l.visible,
            opacity: l.opacity,
            blendMode: l.blendMode,
            clipping: l.clipping,
            parentId: l.parentId,
            vectorPaths: l.vectorPaths,
            textNode: l.textNode,
            imageNode: l.imageNode,
          })),
          activeLayerId: activeLayerId,
        });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [layers, activeLayerId, pages, activePageId, tierLevel]);

  // Load Auto-Saved Document Cache on Initial Mount
  useEffect(() => {
    storageEngine.loadDocumentCache().then(cache => {
      if (cache && cache.layers && cache.layers.length > 0) {
        setTierLevel(cache.activeTier || 'common');
        if (cache.pages && cache.pages.length > 0) setPages(cache.pages);
        if (cache.activePageId) setActivePageId(cache.activePageId);
      }
    });
  }, []);

  // Close Add Page Modal on Esc key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && addPageModal) {
        setAddPageModal(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [addPageModal]);

  // Update styling of selected paths when controls change
  useEffect(() => {
    if (selPaths.size === 0 || !activeLayerId) return;
    const al = layers.find(l => l.id === activeLayerId);
    if (!al || al.type !== 'vector' || !al.vectorPaths) return;

    let changed = false;
    const newPaths = al.vectorPaths.map(p => {
      if (selPaths.has(p.id)) {
        if (p.strokeColor !== vStroke || p.strokeWidth !== vWidth || p.fillColor !== vFill) {
          changed = true;
          return { ...p, strokeColor: vStroke, strokeWidth: vWidth, fillColor: vFill };
        }
      }
      return p;
    });

    if (changed) {
      setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, vectorPaths: newPaths } : l));
    }
  }, [vStroke, vWidth, vFill, selPaths, activeLayerId, layers]);

  // ── Init document ──────────────────────────────────────────
  useEffect(() => {
    const drawId = 'layer-draw';
    const draw = new TiledLayer(CANVAS_W, CANVAS_H);

    tilesRef.current.set(drawId, draw);

    const mkMap = (tl: TiledLayer) => {
      const m = new Map<string, HTMLCanvasElement>();
      for (const [k, t] of tl.tiles) m.set(k, t.canvas);
      return m;
    };

    const initialPageLayers = [
      { id: drawId, name: 'Drawing (Raster)', type: 'raster' as const, visible: true, opacity: 1, blendMode: 'normal' as const, clipping: false, parentId: null, tileMap: mkMap(draw) },
    ];

    setLayers(initialPageLayers);
    setActiveLayerId(drawId);

    const rootPage: DrawingPage = {
      id: 'default-page',
      name: 'Root Canvas',
      layers: initialPageLayers,
      activeLayerId: drawId,
      transform: { zoom: 1.0, panX: 0, panY: 0, rotation: 0 },
      parentId: null,
      format: 'blank',
      checkedLines: {},
    };
    setPages([rootPage]);

    setTimeout(() => {
      const el = vpRef.current;
      if (el) {
        const z = 1.0;
        const px = (el.clientWidth - CANVAS_W * z) / 2;
        const py = (el.clientHeight - CANVAS_H * z) / 2;
        setTransform({ zoom: z, panX: px, panY: py, rotation: 0 });
        setPages(prev => prev.map(p => p.id === 'default-page' ? { ...p, transform: { zoom: z, panX: px, panY: py, rotation: 0 } } : p));
      }
    }, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard ───────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT','SELECT','TEXTAREA'].includes(tag)) return;
      if (tool === 'text' || textOv !== null) return;

      const k = e.key.toLowerCase();
      setShortcutKey(k);
      setTimeout(() => setShortcutKey(null), 1500);

      if (e.ctrlKey && k === 'z') { e.preventDefault(); histRef.current.undo(); }
      else if (e.ctrlKey && k === 'y') { e.preventDefault(); histRef.current.redo(); }
      else if (k === 'b') switchTool('brush');
      else if (k === 'e') switchTool('eraser');
      else if (k === 'p') switchTool('pen');
      else if (k === 't') switchTool('text');
      else if (k === 'v') switchTool('select');
      else if (k === 'c') switchTool('crop');
      else if (k === 'h') switchTool('pan');
      else if (k === 'tab') { e.preventDefault(); setZenMode(z => !z); }
      else if (k === 'escape') {
        if (tool === 'pen') { commitPenPath(); }
        setTextOv(null);
        setCropBox(null);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [tool, drawOverlay, textOv]);

  // ── Layer management ───────────────────────────────────────
  const refreshTiles = useCallback(() => {
    setLayers(prev => prev.map(l => {
      const tl = tilesRef.current.get(l.id);
      if (!tl) return { ...l };
      const m = new Map<string, HTMLCanvasElement>();
      for (const [k, t] of tl.tiles) m.set(k, t.canvas);
      return { ...l, tileMap: m };
    }));
  }, []);

  const addRasterLayer = () => {
    const id = `r-${Date.now()}`;
    const tl = new TiledLayer(CANVAS_W, CANVAS_H);
    tilesRef.current.set(id, tl);
    const layer: LayerNode = { id, name: `Raster Layer ${layers.length + 1}`, type: 'raster', visible: true, opacity: 1, blendMode: 'normal', clipping: false, parentId: null };
    const snap = [...layers];
    histRef.current.execute({
      name: 'Add Layer',
      execute: () => { setLayers(p => [...p, layer]); setActiveLayerId(id); needsRecompositeRef.current = true; },
      undo: () => { setLayers(snap); setActiveLayerId(activeLayerId); tilesRef.current.delete(id); needsRecompositeRef.current = true; },
    });
  };

  const addVectorLayer = () => {
    const id = `v-${Date.now()}`;
    const layer: LayerNode = { id, name: `Vector Sketch ${layers.filter(l => l.type === 'vector').length + 1}`, type: 'vector', visible: true, opacity: 1, blendMode: 'normal', clipping: false, parentId: null, vectorPaths: [] };
    const snap = [...layers];
    histRef.current.execute({
      name: 'Add Vector Layer',
      execute: () => { setLayers(p => [...p, layer]); setActiveLayerId(id); needsRecompositeRef.current = true; },
      undo: () => { setLayers(snap); setActiveLayerId(activeLayerId); needsRecompositeRef.current = true; },
    });
  };

  const addTextLayer = () => {
    const id = `t-${Date.now()}`;
    const layer: LayerNode = { id, name: `Text ${layers.filter(l => l.type === 'text').length + 1}`, type: 'text', visible: true, opacity: 1, blendMode: 'normal', clipping: false, parentId: null };
    const snap = [...layers];
    histRef.current.execute({
      name: 'Add Text Layer',
      execute: () => { setLayers(p => [...p, layer]); setActiveLayerId(id); needsRecompositeRef.current = true; },
      undo: () => { setLayers(snap); setActiveLayerId(activeLayerId); needsRecompositeRef.current = true; },
    });
  };

  const deleteLayer = (id: string) => {
    if (layers.length <= 1) return;
    const snap = [...layers];
    const tl = tilesRef.current.get(id);
    const newList = layers.filter(l => l.id !== id);
    histRef.current.execute({
      name: 'Delete Layer',
      execute: () => { setLayers(newList); setActiveLayerId(newList.at(-1)?.id ?? null); tilesRef.current.delete(id); needsRecompositeRef.current = true; },
      undo: () => { setLayers(snap); setActiveLayerId(id); if (tl) tilesRef.current.set(id, tl); needsRecompositeRef.current = true; },
    });
  };

  // ── Hierarchical Nested Pages (OkSo feature) ─────────────
  const createNewPage = (
    name: string,
    format: 'blank' | 'lined' | 'grid' | 'dotted' | 'checklist',
    parentId: string | null
  ) => {
    const newPageId = `page-${Date.now()}`;
    const drawId = `r-draw-${newPageId}`;

    const draw = new TiledLayer(CANVAS_W, CANVAS_H);

    tilesRef.current.set(drawId, draw);

    const mkMap = (tl: TiledLayer) => {
      const m = new Map<string, HTMLCanvasElement>();
      for (const [k, t] of tl.tiles) m.set(k, t.canvas);
      return m;
    };

    const initialPageLayers = [
      { id: drawId, name: 'Drawing (Raster)', type: 'raster' as const, visible: true, opacity: 1, blendMode: 'normal' as const, clipping: false, parentId: null, tileMap: mkMap(draw) },
    ];

    const newPage: DrawingPage = {
      id: newPageId,
      name,
      layers: initialPageLayers,
      activeLayerId: drawId,
      transform: {
        zoom: 1.0,
        panX: vpSize.w > 0 ? (vpSize.w - CANVAS_W) / 2 : 0,
        panY: vpSize.h > 0 ? (vpSize.h - CANVAS_H) / 2 : 0,
        rotation: 0
      },
      parentId,
      format,
      checkedLines: {},
    };

    setPages(prev => [...prev, newPage]);
    
    // Switch to new page automatically
    setTimeout(() => {
      switchPage(newPageId);
    }, 50);
  };

  const switchPage = (targetId: string) => {
    if (targetId === activePageId) return;

    // 1. Save current page variables
    setPages(prev => prev.map(p => {
      if (p.id === activePageId) {
        return { ...p, layers, activeLayerId, transform, format: pageFormat, checkedLines };
      }
      return p;
    }));

    // 2. Load target page variables
    setPages(prev => {
      const target = prev.find(p => p.id === targetId);
      if (target) {
        setLayers(target.layers);
        setActiveLayerId(target.activeLayerId);
        setTransform(target.transform);
        setPageFormat(target.format || 'blank');
        setCheckedLines(target.checkedLines || {});
        setActivePageId(targetId);
        needsRecompositeRef.current = true;
      }
      return prev;
    });
  };

  const deletePage = (id: string) => {
    if (id === 'default-page') return;
    // Recursively delete subpages as well
    const toDeleteIds = new Set<string>([id]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      pages.forEach(p => {
        if (p.parentId && toDeleteIds.has(p.parentId) && !toDeleteIds.has(p.id)) {
          toDeleteIds.add(p.id);
          expanded = true;
        }
      });
    }

    if (toDeleteIds.has(activePageId)) {
      switchPage('default-page');
    }

    setPages(prev => prev.filter(p => !toDeleteIds.has(p.id)));
  };

  const renderPageTreeNodes = (parentId: string | null, depth: number) => {
    const list = pages.filter(p => p.parentId === parentId);
    return list.map(p => (
      <div key={p.id} style={{ paddingLeft: depth * 12 }}>
        <div
          className={`bookmark-item ${activePageId === p.id ? 'active' : ''}`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2, padding: '3px 6px' }}
          onClick={() => switchPage(p.id)}
        >
          <span style={{ fontWeight: activePageId === p.id ? 'bold' : 'normal', fontSize: 10, color: activePageId === p.id ? 'var(--accent)' : 'var(--text-2)' }}>
            {activePageId === p.id ? '• ' : '▪ '} {p.name}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ padding: '0 4px', height: 16, fontSize: 8 }}
              onClick={e => {
                e.stopPropagation();
                setAddPageModal({ parentId: p.id });
                setAddPageName(`Page ${pages.length + 1}`);
                setAddPageFormat('blank');
              }}
              title="Add nested sub-page"
            >
              +
            </button>
            {p.id !== 'default-page' && (
              <button
                className="btn btn-ghost btn-sm btn-danger"
                style={{ padding: '0 4px', height: 16, fontSize: 8 }}
                onClick={e => { e.stopPropagation(); deletePage(p.id); }}
              >
                ×
              </button>
            )}
          </div>
        </div>
        {renderPageTreeNodes(p.id, depth + 1)}
      </div>
    ));
  };

  // ── Import Image (InfiniPaint feature) ───────────────────
  const triggerImageImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const src = ev.target!.result as string;
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > 800) { h = (800 / w) * h; w = 800; }
        if (h > 600) { w = (600 / h) * w; h = 600; }

        const id = `img-${Date.now()}`;
        const node: ImageNode = { id, src, x: (CANVAS_W - w) / 2, y: (CANVAS_H - h) / 2, width: w, height: h, rotation: 0 };
        const layer: LayerNode = {
          id, name: `Image Layer ${layers.filter(l => l.type === 'image').length + 1}`,
          type: 'image', visible: true, opacity: 1, blendMode: 'normal', clipping: false, parentId: null,
          imageNode: node
        };
        const snap = [...layers];
        histRef.current.execute({
          name: 'Import Image',
          execute: () => { setLayers(prev => [...prev, layer]); setActiveLayerId(id); needsRecompositeRef.current = true; },
          undo: () => { setLayers(snap); setActiveLayerId(activeLayerId); needsRecompositeRef.current = true; }
        });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  // ── View Bookmarks (InfiniPaint feature) ─────────────────
  const addBookmark = () => {
    const name = prompt('Enter bookmark name:', `View ${bookmarks.length + 1}`);
    if (!name) return;
    setBookmarks(prev => [...prev, { id: `bm-${Date.now()}`, name, transform }]);
  };

  const jumpToBookmark = (bm: Bookmark) => {
    setTransform(bm.transform);
  };

  const deleteBookmark = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setBookmarks(prev => prev.filter(b => b.id !== id));
  };

  // ── Pen tool actions ───────────────────────────────────────
  const applyPen = (action: PenToolAction) => {
    if (action.type === 'none') return;
    if (action.type === 'start-path') {
      livePathRef.current = { ...action.path, strokeColor: vStroke, strokeWidth: vWidth, fillColor: vFill };
      drawOverlay();
    } else if (['add-anchor','update-handle','move-anchor'].includes(action.type)) {
      if (penRef.current.activePath) {
        livePathRef.current = { ...penRef.current.activePath };
        drawOverlay();
      }
    } else if (action.type === 'close-path') {
      if (livePathRef.current && activeLayerId) {
        const final: VectorPath = { ...livePathRef.current, closed: true };
        histRef.current.execute(new AddVectorPathCommand(activeLayerId, final, setLayers));
        livePathRef.current = null;
        penRef.current.finishPath();
        setPenState('idle');
        drawOverlay();
      }
    }
  };

  const commitPenPath = useCallback(() => {
    if (livePathRef.current && (livePathRef.current.anchors.length >= 2) && activeLayerId) {
      histRef.current.execute(new AddVectorPathCommand(activeLayerId, livePathRef.current, setLayers));
    }
    livePathRef.current = null;
    penRef.current.finishPath();
    setPenState('idle');
    drawOverlay();
  }, [activeLayerId, drawOverlay]);

  const switchTool = (t: ActiveTool) => {
    if (tool === 'pen' && t !== 'pen') commitPenPath();
    setTool(t);
    setTextOv(null);
    setCropBox(null);
  };

  // ── Pointer events ─────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;

    // Hand/Pan Tool directly triggers panning
    if (tool === 'pan' || e.button === 1 || e.shiftKey) {
      panningRef.current = true;
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    const { x, y } = toCanvas(e);

    // Interactive Checklist click handler
    if (pageFormat === 'checklist') {
      const spacing = 40;
      if (x >= 25 && x <= 65) {
        const approxLineY = Math.round((y + 20) / spacing) * spacing;
        const cy = approxLineY - 20;
        if (Math.abs(y - cy) <= 15) {
          setCheckedLines(prev => {
            const next = { ...prev, [approxLineY]: !prev[approxLineY] };
            setPages(pPrev => pPrev.map(p => p.id === activePageId ? { ...p, checkedLines: next } : p));
            return next;
          });
          return;
        }
      }
    }

    dragStartRef.current = { x, y };

    const al = layers.find(l => l.id === activeLayerId);

    // ── Export Crop box tool
    if (tool === 'crop') {
      drawingRef.current = true;
      cropStartRef.current = { x, y };
      setCropBox({ x, y, w: 0, h: 0 });
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // ── Vector Layer Stroke Eraser
    if (tool === 'eraser' && al && al.type === 'vector' && al.vectorPaths) {
      drawingRef.current = true;
      canvas.setPointerCapture(e.pointerId);
      
      const hitIndex = al.vectorPaths.findIndex(p => BezierMath.hitTestVectorPath(p, x, y, size / transform.zoom));
      if (hitIndex !== -1) {
        const hitPath = al.vectorPaths[hitIndex];
        const remainingPaths = al.vectorPaths.filter(p => p.id !== hitPath.id);
        const oldPaths = [...al.vectorPaths];
        histRef.current.execute({
          name: 'Erase Stroke',
          execute: () => {
            setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, vectorPaths: remainingPaths } : l));
          },
          undo: () => {
            setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, vectorPaths: oldPaths } : l));
          }
        });
      }
      return;
    }

    // ── Text tool
    if (tool === 'text') {
      if (e.detail === 2) {
        handleStartTextEdit(x, y);
        return;
      }
      const hitText = layers.find(l => {
        if (l.type === 'text' && l.textNode) {
          const tn = l.textNode;
          const textWidth = Math.max(100, tn.text.length * tn.fontSize * 0.6);
          const textHeight = Math.max(tn.fontSize, tn.text.split('\n').length * tn.fontSize * 1.3);
          return x >= tn.x - 15 && x <= tn.x + textWidth + 15 && y >= tn.y - 15 && y <= tn.y + textHeight + 15;
        }
        return false;
      });
      if (hitText) {
        setActiveLayerId(hitText.id);
        if (hitText.textNode) {
          setTFont(hitText.textNode.fontFamily);
          setTSize(hitText.textNode.fontSize);
          setTColor(hitText.textNode.color);
        }
      }
      return;
    }

    // ── Pen tool
    if (tool === 'pen') {
      if (!al || al.type !== 'vector') {
        const id = `v-${Date.now()}`;
        const nl: LayerNode = { id, name: 'Vector Sketch', type: 'vector', visible: true, opacity: 1, blendMode: 'normal', clipping: false, parentId: null, vectorPaths: [] };
        setLayers(p => [...p, nl]);
        setActiveLayerId(id);
        needsRecompositeRef.current = true;
        setTimeout(() => {
          const action = penRef.current.onPointerDown(x, y, e.pressure, []);
          setPenState(penRef.current.state);
          applyPen(action);
        }, 0);
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const action = penRef.current.onPointerDown(x, y, e.pressure, al.vectorPaths ?? []);
      setPenState(penRef.current.state);
      applyPen(action);
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // ── Select / Transform tool (Full Element Drag & Repositioning)
    if (tool === 'select') {
      const visibleLayers = [...layers].filter(l => l.visible).reverse();
      let hitFound = false;

      for (const l of visibleLayers) {
        // 1. Check Text Layer
        if (l.type === 'text' && l.textNode) {
          const tn = l.textNode;
          const textWidth = Math.max(100, tn.text.length * tn.fontSize * 0.6);
          const textHeight = Math.max(tn.fontSize, tn.text.split('\n').length * tn.fontSize * 1.3);
          if (x >= tn.x - 20 && x <= tn.x + textWidth + 20 && y >= tn.y - 20 && y <= tn.y + textHeight + 20) {
            setActiveLayerId(l.id);
            setDraggingText(true);
            dragStartRef.current = { x, y };
            textSnapRef.current = { ...tn };
            canvas.setPointerCapture(e.pointerId);
            hitFound = true;
            break;
          }
        }

        // 2. Check Image Layer
        if (l.type === 'image' && l.imageNode) {
          const node = l.imageNode;
          const bbox = { x: node.x, y: node.y, w: node.width, h: node.height };
          const hitHandle = getHitHandle(bbox, x, y, transform.zoom);
          if (hitHandle) {
            setActiveLayerId(l.id);
            setDraggingHandle(hitHandle);
            initialBBoxRef.current = bbox;
            imageSnapRef.current = { ...node };
            historyImageSnapRef.current = { [l.id]: { ...node } };
            canvas.setPointerCapture(e.pointerId);
            hitFound = true;
            break;
          }
          if (x >= node.x && x <= node.x + node.width && y >= node.y && y <= node.y + node.height) {
            setActiveLayerId(l.id);
            setDraggingImage(true);
            dragStartRef.current = { x, y };
            imageSnapRef.current = { ...node };
            historyImageSnapRef.current = { [l.id]: { ...node } };
            canvas.setPointerCapture(e.pointerId);
            hitFound = true;
            break;
          }
        }

        // 3. Check Vector Layer
        if (l.type === 'vector' && l.vectorPaths && l.vectorPaths.length > 0) {
          historyPathSnapRef.current = { [l.id]: JSON.parse(JSON.stringify(l.vectorPaths)) };

          // Check if clicking inside bounding box of previously selected path(s) to scale or move
          if (l.id === activeLayerId && selPaths.size > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let count = 0;
            for (const pathId of selPaths) {
              const p = l.vectorPaths.find(xx => xx.id === pathId);
              if (p) {
                count++;
                const b = getPathBoundingBox(p);
                minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
              }
            }
            if (count > 0) {
              const unionBBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
              const hitHandle = getHitHandle(unionBBox, x, y, transform.zoom);
              if (hitHandle) {
                setDraggingHandle(hitHandle);
                initialBBoxRef.current = unionBBox;
                const snap: Record<string, VectorAnchor[]> = {};
                l.vectorPaths.forEach(p => {
                  if (selPaths.has(p.id)) snap[p.id] = JSON.parse(JSON.stringify(p.anchors));
                });
                pathSnapRef.current = snap;
                canvas.setPointerCapture(e.pointerId);
                hitFound = true;
                break;
              }

              // Drag whole selected vector path group
              if (x >= unionBBox.x - 10 && x <= unionBBox.x + unionBBox.w + 10 && y >= unionBBox.y - 10 && y <= unionBBox.y + unionBBox.h + 10) {
                setDraggingPath(true);
                dragStartRef.current = { x, y };
                const snap: Record<string, VectorAnchor[]> = {};
                l.vectorPaths.forEach(p => {
                  if (selPaths.has(p.id)) snap[p.id] = JSON.parse(JSON.stringify(p.anchors));
                });
                pathSnapRef.current = snap;
                canvas.setPointerCapture(e.pointerId);
                hitFound = true;
                break;
              }
            }
          }

          // Check anchor hit testing on selected paths
          if (l.id === activeLayerId && selPaths.size > 0) {
            let anchorHit = false;
            for (const pathId of selPaths) {
              const path = l.vectorPaths.find(p => p.id === pathId);
              if (path) {
                const hitRadius = 10 / transform.zoom;
                for (let i = 0; i < path.anchors.length; i++) {
                  const a = path.anchors[i];
                  if (Math.hypot(a.x - x, a.y - y) <= hitRadius) {
                    setSelAnchor({ pathId, index: i });
                    setSelHandleType(null);
                    setDraggingPath(false);
                    dragStartRef.current = { x, y };
                    canvas.setPointerCapture(e.pointerId);
                    anchorHit = true;
                    hitFound = true;
                    break;
                  }
                  if (Math.hypot(a.x + a.handleIn.x - x, a.y + a.handleIn.y - y) <= hitRadius) {
                    setSelAnchor({ pathId, index: i });
                    setSelHandleType('in');
                    setDraggingPath(false);
                    dragStartRef.current = { x, y };
                    canvas.setPointerCapture(e.pointerId);
                    anchorHit = true;
                    hitFound = true;
                    break;
                  }
                  if (Math.hypot(a.x + a.handleOut.x - x, a.y + a.handleOut.y - y) <= hitRadius) {
                    setSelAnchor({ pathId, index: i });
                    setSelHandleType('out');
                    setDraggingPath(false);
                    dragStartRef.current = { x, y };
                    canvas.setPointerCapture(e.pointerId);
                    anchorHit = true;
                    hitFound = true;
                    break;
                  }
                }
                if (anchorHit) break;
              }
            }
            if (anchorHit) break;
          }

          // Hit test vector path stroke or fill to select and drag
          const hitPath = [...l.vectorPaths].reverse().find(p => BezierMath.hitTestVectorPath(p, x, y, 12 / transform.zoom));
          if (hitPath) {
            setActiveLayerId(l.id);
            const newSel = new Set(e.shiftKey ? selPaths : [hitPath.id]);
            setSelPaths(newSel);
            setSelAnchor(null);
            setSelHandleType(null);
            setDraggingPath(true);
            dragStartRef.current = { x, y };

            const snap: Record<string, VectorAnchor[]> = {};
            l.vectorPaths.forEach(p => {
              if (newSel.has(p.id)) snap[p.id] = JSON.parse(JSON.stringify(p.anchors));
            });
            pathSnapRef.current = snap;
            canvas.setPointerCapture(e.pointerId);
            hitFound = true;
            break;
          }
        }
      }

      if (!hitFound && !e.shiftKey) {
        setSelPaths(new Set());
        setSelAnchor(null);
        setSelHandleType(null);
      }
      return;
    }

    // ── Brush / Shape Tools
    if (tool === 'brush') {
      drawingRef.current = true;
      canvas.setPointerCapture(e.pointerId);

      if (!al) {
        addVectorLayer();
        return;
      }

      const effectiveBrushSize = Math.max(0.5, size / Math.max(0.01, transform.zoom));

      if (al.type === 'vector') {
        if (shapeMode === 'freehand') {
          const pathId = `stroke-${Date.now()}`;
          const newPath: VectorPath = {
            id: pathId,
            anchors: [{
              id: `a-${Date.now()}-${Math.random()}`,
              x, y,
              handleIn: { x: 0, y: 0 },
              handleOut: { x: 0, y: 0 },
              smooth: false
            }],
            closed: false,
            strokeColor: color,
            strokeWidth: effectiveBrushSize,
            fillColor: null,
            fillRule: 'nonzero'
          };
          livePathRef.current = newPath;
          drawOverlay();
        } else if (shapeMode === 'line') {
          livePathRef.current = createLinePath(x, y, x, y, color, effectiveBrushSize);
          drawOverlay();
        } else if (shapeMode === 'rect') {
          livePathRef.current = createRectPath(x, y, x, y, color, effectiveBrushSize, vFill);
          drawOverlay();
        } else if (shapeMode === 'circle') {
          livePathRef.current = createEllipsePath(x, y, x, y, color, effectiveBrushSize, vFill);
          drawOverlay();
        }
      } else if (al.type === 'raster') {
        const tl = tilesRef.current.get(activeLayerId!);
        if (!tl) return;

        dirtyTilesRef.current.clear();
        const preset = brushPresets.find(p => p.id === presetId)!;
        const activePreset = { ...preset, color, size: effectiveBrushSize, opacity };

        const normIn = normRef.current.normalize(e.nativeEvent, canvas);
        const stabIn = stabRef.current.stabilize(normIn, stabSettings);
        const { x: cx, y: cy } = rendererRef.current.screenToCanvas(stabIn.x, stabIn.y, transform, vpSize.w, vpSize.h, CANVAS_W, CANVAS_H);
        const inp = { ...stabIn, x: cx, y: cy };
        setPtrStats(inp);

        const tx0 = Math.floor(cx / TiledLayer.TILE_SIZE);
        const ty0 = Math.floor(cy / TiledLayer.TILE_SIZE);
        dirtyTilesRef.current.add(`${tx0},${ty0}`);

        if (shapeMode === 'freehand') {
          strokeCmdRef.current = new DrawStrokeCommand(tl, dirtyTilesRef.current, () => {});
          brushRef.current.startStroke(inp);
          brushRef.current.paintStroke(inp, inp, tl, activePreset);
          lastBrushInputRef.current = inp;
          redraw(dirtyTilesRef.current);
        } else if (shapeMode === 'line') {
          livePathRef.current = createLinePath(cx, cy, cx, cy, color, effectiveBrushSize);
          drawOverlay();
        } else if (shapeMode === 'rect') {
          livePathRef.current = createRectPath(cx, cy, cx, cy, color, effectiveBrushSize, vFill);
          drawOverlay();
        } else if (shapeMode === 'circle') {
          livePathRef.current = createEllipsePath(cx, cy, cx, cy, color, effectiveBrushSize, vFill);
          drawOverlay();
        }
      }
    }

    // ── Raster Eraser
    if (tool === 'eraser' && al && al.type === 'raster') {
      const tl = tilesRef.current.get(activeLayerId!);
      if (!tl) return;

      drawingRef.current = true;
      canvas.setPointerCapture(e.pointerId);
      dirtyTilesRef.current.clear();

      const effectiveBrushSize = Math.max(0.5, size / Math.max(0.01, transform.zoom));
      const preset = brushPresets.find(p => p.id === presetId)!;
      const activePreset = { ...preset, name: 'Eraser', color: '#000000', opacity: 1, size: effectiveBrushSize };

      const normIn = normRef.current.normalize(e.nativeEvent, canvas);
      const stabIn = stabRef.current.stabilize(normIn, stabSettings);
      const { x: cx, y: cy } = rendererRef.current.screenToCanvas(stabIn.x, stabIn.y, transform, vpSize.w, vpSize.h, CANVAS_W, CANVAS_H);
      const inp = { ...stabIn, x: cx, y: cy };
      setPtrStats(inp);

      const tx0 = Math.floor(cx / TiledLayer.TILE_SIZE);
      const ty0 = Math.floor(cy / TiledLayer.TILE_SIZE);
      dirtyTilesRef.current.add(`${tx0},${ty0}`);

      strokeCmdRef.current = new DrawStrokeCommand(tl, dirtyTilesRef.current, () => {});
      brushRef.current.startStroke(inp);
      brushRef.current.paintStroke(inp, inp, tl, activePreset);
      lastBrushInputRef.current = inp;

      redraw(dirtyTilesRef.current);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;

    if (panningRef.current) {
      const dx = e.clientX - lastPosRef.current.x;
      const dy = e.clientY - lastPosRef.current.y;
      setTransform(p => ({ ...p, panX: p.panX + dx, panY: p.panY + dy }));
      lastPosRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const { x, y } = toCanvas(e);
    const al = layers.find(l => l.id === activeLayerId);

    // ── Export Crop box tool drag
    if (tool === 'crop' && drawingRef.current && cropBox) {
      const x0 = Math.min(cropStartRef.current.x, x);
      const y0 = Math.min(cropStartRef.current.y, y);
      const w0 = Math.abs(x - cropStartRef.current.x);
      const h0 = Math.abs(y - cropStartRef.current.y);
      setCropBox({ x: x0, y: y0, w: w0, h: h0 });
      return;
    }

    // ── Lorien Vector Stroke Eraser Drag
    if (tool === 'eraser' && drawingRef.current) {
      if (al && al.type === 'vector' && al.vectorPaths) {
        const hitIndex = al.vectorPaths.findIndex(p => BezierMath.hitTestVectorPath(p, x, y, size / transform.zoom));
        if (hitIndex !== -1) {
          const hitPath = al.vectorPaths[hitIndex];
          const remainingPaths = al.vectorPaths.filter(p => p.id !== hitPath.id);
          const oldPaths = [...al.vectorPaths];
          histRef.current.execute({
            name: 'Erase Stroke',
            execute: () => {
              setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, vectorPaths: remainingPaths } : l));
            },
            undo: () => {
              setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, vectorPaths: oldPaths } : l));
            }
          });
        }
      }
      return;
    }

    if (tool === 'pen') {
      hoverPosRef.current = { x, y };
      const action = penRef.current.onPointerMove(x, y, al?.vectorPaths ?? []);
      setPenState(penRef.current.state);
      applyPen(action);
      drawOverlay();
      return;
    }

    if (tool === 'select') {
      if (!al) return;

      const dx = x - dragStartRef.current.x;
      const dy = y - dragStartRef.current.y;

      // Handle scale transform of paths / images (InfiniPaint feature)
      if (draggingHandle && initialBBoxRef.current) {
        const bbox = initialBBoxRef.current;
        let scaleX = 1;
        let scaleY = 1;
        let origin = { x: bbox.x, y: bbox.y };

        if (draggingHandle === 'BR') {
          scaleX = (bbox.w + dx) / bbox.w;
          scaleY = (bbox.h + dy) / bbox.h;
          origin = { x: bbox.x, y: bbox.y };
        } else if (draggingHandle === 'BL') {
          scaleX = (bbox.w - dx) / bbox.w;
          scaleY = (bbox.h + dy) / bbox.h;
          origin = { x: bbox.x + bbox.w, y: bbox.y };
        } else if (draggingHandle === 'TR') {
          scaleX = (bbox.w + dx) / bbox.w;
          scaleY = (bbox.h - dy) / bbox.h;
          origin = { x: bbox.x, y: bbox.y + bbox.h };
        } else if (draggingHandle === 'TL') {
          scaleX = (bbox.w - dx) / bbox.w;
          scaleY = (bbox.h - dy) / bbox.h;
          origin = { x: bbox.x + bbox.w, y: bbox.y + bbox.h };
        }

        if (isNaN(scaleX) || !isFinite(scaleX)) scaleX = 1;
        if (isNaN(scaleY) || !isFinite(scaleY)) scaleY = 1;

        if (al.type === 'vector' && al.vectorPaths && pathSnapRef.current) {
          const newPaths = al.vectorPaths.map(p => {
            if (!selPaths.has(p.id)) return p;
            const origAnchors = pathSnapRef.current[p.id];
            if (!origAnchors) return p;
            const anchors = origAnchors.map(a => ({
              ...a,
              x: origin.x + (a.x - origin.x) * scaleX,
              y: origin.y + (a.y - origin.y) * scaleY,
              handleIn: { x: a.handleIn.x * scaleX, y: a.handleIn.y * scaleY },
              handleOut: { x: a.handleOut.x * scaleX, y: a.handleOut.y * scaleY }
            }));
            return { ...p, anchors };
          });
          setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, vectorPaths: newPaths } : l));
        }

        if (al.type === 'image' && al.imageNode && imageSnapRef.current) {
          const orig = imageSnapRef.current;
          let newW = orig.width;
          let newH = orig.height;
          let newX = orig.x;
          let newY = orig.y;

          if (draggingHandle === 'BR') {
            newW = Math.max(10, orig.width + dx);
            newH = Math.max(10, orig.height + dy);
          } else if (draggingHandle === 'BL') {
            newW = Math.max(10, orig.width - dx);
            newH = Math.max(10, orig.height + dy);
            newX = bbox.x + bbox.w - newW;
          } else if (draggingHandle === 'TR') {
            newW = Math.max(10, orig.width + dx);
            newH = Math.max(10, orig.height - dy);
            newY = bbox.y + bbox.h - newH;
          } else if (draggingHandle === 'TL') {
            newW = Math.max(10, orig.width - dx);
            newH = Math.max(10, orig.height - dy);
            newX = bbox.x + bbox.w - newW;
            newY = bbox.y + bbox.h - newH;
          }

          const updated = { ...orig, x: newX, y: newY, width: newW, height: newH };
          setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, imageNode: updated } : l));
        }
        return;
      }

      if (selAnchor && al.type === 'vector' && al.vectorPaths) {
        const newPaths = al.vectorPaths.map(p => {
          if (p.id !== selAnchor.pathId) return p;
          const anchors = p.anchors.map((a, idx) => {
            if (idx !== selAnchor.index) return a;
            const updated = { ...a };
            if (selHandleType === 'in') {
              updated.handleIn = { x: updated.handleIn.x + dx, y: updated.handleIn.y + dy };
              if (updated.smooth) updated.handleOut = { x: -updated.handleIn.x, y: -updated.handleIn.y };
            } else if (selHandleType === 'out') {
              updated.handleOut = { x: updated.handleOut.x + dx, y: updated.handleOut.y + dy };
              if (updated.smooth) updated.handleIn = { x: -updated.handleOut.x, y: -updated.handleOut.y };
            } else {
              updated.x += dx;
              updated.y += dy;
            }
            return updated;
          });
          return { ...p, anchors };
        });
        setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, vectorPaths: newPaths } : l));
        dragStartRef.current = { x, y };
      } else if (draggingPath && al.type === 'vector' && al.vectorPaths) {
        const newPaths = al.vectorPaths.map(p => {
          if (!selPaths.has(p.id)) return p;
          const origAnchors = pathSnapRef.current[p.id];
          if (!origAnchors) return p;
          const anchors = origAnchors.map(a => ({
            ...a,
            x: a.x + dx,
            y: a.y + dy,
          }));
          return { ...p, anchors };
        });
        setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, vectorPaths: newPaths } : l));
      } else if (draggingText && al.type === 'text' && al.textNode && textSnapRef.current) {
        const orig = textSnapRef.current;
        const updated = {
          ...orig,
          x: orig.x + dx,
          y: orig.y + dy,
        };
        setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, textNode: updated } : l));
      } else if (draggingImage && al.type === 'image' && al.imageNode && imageSnapRef.current) {
        const orig = imageSnapRef.current;
        const updated = {
          ...orig,
          x: orig.x + dx,
          y: orig.y + dy,
        };
        setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, imageNode: updated } : l));
      }
      return;
    }

    if (!drawingRef.current || !activeLayerId) return;
    const tl = tilesRef.current.get(activeLayerId);
    if (!tl) return;

    const effectiveBrushSize = Math.max(0.5, size / Math.max(0.01, transform.zoom));

    if (al && al.type === 'vector' && livePathRef.current) {
      if (shapeMode === 'freehand') {
        const lp = livePathRef.current;
        const last = lp.anchors[lp.anchors.length - 1];
        if (Math.hypot(x - last.x, y - last.y) >= 2) {
          lp.anchors.push({
            id: `a-${Date.now()}-${Math.random()}`,
            x, y,
            handleIn: { x: 0, y: 0 },
            handleOut: { x: 0, y: 0 },
            smooth: false
          });
        }
      } else if (shapeMode === 'line') {
        livePathRef.current = createLinePath(dragStartRef.current.x, dragStartRef.current.y, x, y, color, effectiveBrushSize);
      } else if (shapeMode === 'rect') {
        livePathRef.current = createRectPath(dragStartRef.current.x, dragStartRef.current.y, x, y, color, effectiveBrushSize, vFill);
      } else if (shapeMode === 'circle') {
        livePathRef.current = createEllipsePath(dragStartRef.current.x, dragStartRef.current.y, x, y, color, effectiveBrushSize, vFill);
      }
      drawOverlay();
      return;
    }

    if (al && al.type === 'raster' && shapeMode !== 'freehand' && livePathRef.current) {
      if (shapeMode === 'line') {
        livePathRef.current = createLinePath(dragStartRef.current.x, dragStartRef.current.y, x, y, color, effectiveBrushSize);
      } else if (shapeMode === 'rect') {
        livePathRef.current = createRectPath(dragStartRef.current.x, dragStartRef.current.y, x, y, color, effectiveBrushSize, vFill);
      } else if (shapeMode === 'circle') {
        livePathRef.current = createEllipsePath(dragStartRef.current.x, dragStartRef.current.y, x, y, color, effectiveBrushSize, vFill);
      }
      drawOverlay();
      return;
    }

    const normIn = normRef.current.normalize(e.nativeEvent, canvas);
    const stabIn = stabRef.current.stabilize(normIn, stabSettings);
    const { x: cx, y: cy } = rendererRef.current.screenToCanvas(stabIn.x, stabIn.y, transform, vpSize.w, vpSize.h, CANVAS_W, CANVAS_H);
    const inp = { ...stabIn, x: cx, y: cy };
    setPtrStats(inp);

    const preset = brushPresets.find(p => p.id === presetId)!;
    const activePreset = tool === 'eraser'
      ? { ...preset, name: 'Eraser', color: '#000000', opacity: 1, size: effectiveBrushSize }
      : { ...preset, color, size: effectiveBrushSize, opacity };

    const r = activePreset.size;
    const sx = Math.max(0, Math.floor((cx - r) / TiledLayer.TILE_SIZE));
    const sy = Math.max(0, Math.floor((cy - r) / TiledLayer.TILE_SIZE));
    const ex = Math.min(Math.floor((cx + r) / TiledLayer.TILE_SIZE), Math.floor((CANVAS_W - 1) / TiledLayer.TILE_SIZE));
    const ey = Math.min(Math.floor((cy + r) / TiledLayer.TILE_SIZE), Math.floor((CANVAS_H - 1) / TiledLayer.TILE_SIZE));
    for (let ty = sy; ty <= ey; ty++)
      for (let tx = sx; tx <= ex; tx++)
        dirtyTilesRef.current.add(`${tx},${ty}`);

    if (lastBrushInputRef.current) {
      brushRef.current.paintStroke(lastBrushInputRef.current, inp, tl, activePreset);
    }
    lastBrushInputRef.current = inp;
    redraw(dirtyTilesRef.current);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;

    if (panningRef.current) {
      panningRef.current = false;
      canvas.releasePointerCapture(e.pointerId);
      return;
    }

    if (tool === 'crop') {
      drawingRef.current = false;
      canvas.releasePointerCapture(e.pointerId);
      return;
    }

    if (tool === 'pen') {
      const { x, y } = toCanvas(e);
      applyPen(penRef.current.onPointerUp(x, y));
      setPenState(penRef.current.state);
      canvas.releasePointerCapture(e.pointerId);
      return;
    }

    if (tool === 'select') {
      canvas.releasePointerCapture(e.pointerId);

      // Record image scale/move undo
      if (draggingHandle || draggingImage) {
        if (historyImageSnapRef.current && activeLayerId) {
          const origNode = historyImageSnapRef.current[activeLayerId];
          const al = layers.find(l => l.id === activeLayerId);
          if (origNode && al && al.type === 'image' && al.imageNode) {
            const currentNode = al.imageNode;
            histRef.current.execute({
              name: 'Transform Image',
              execute: () => { setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, imageNode: currentNode } : l)); },
              undo: () => { setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, imageNode: origNode } : l)); }
            });
          }
        }
      }

      if ((draggingPath || draggingHandle) && historyPathSnapRef.current && activeLayerId) {
        const origPaths = historyPathSnapRef.current[activeLayerId];
        const al = layers.find(l => l.id === activeLayerId);
        if (origPaths && al && al.type === 'vector' && al.vectorPaths) {
          const currentPaths = al.vectorPaths;
          histRef.current.execute({
            name: 'Transform Paths',
            execute: () => {
              setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, vectorPaths: currentPaths } : l));
            },
            undo: () => {
              setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, vectorPaths: origPaths } : l));
            }
          });
        }
      }

      if (draggingText && textSnapRef.current && activeLayerId) {
        const origNode = textSnapRef.current;
        const al = layers.find(l => l.id === activeLayerId);
        if (origNode && al && al.type === 'text' && al.textNode) {
          const currentNode = al.textNode;
          histRef.current.execute({
            name: 'Move Text',
            execute: () => {
              setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, textNode: currentNode } : l));
            },
            undo: () => {
              setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, textNode: origNode } : l));
            }
          });
        }
      }

      setDraggingPath(false);
      setDraggingText(false);
      setDraggingImage(false);
      setDraggingHandle(null);
      setSelAnchor(null);
      setSelHandleType(null);
      textSnapRef.current = null;
      imageSnapRef.current = null;
      initialBBoxRef.current = null;
      return;
    }

    if (drawingRef.current) {
      drawingRef.current = false;
      canvas.releasePointerCapture(e.pointerId);

      const al = layers.find(l => l.id === activeLayerId);

      if (al && al.type === 'vector' && livePathRef.current) {
        if (shapeMode === 'freehand') {
          smoothVectorPath(livePathRef.current);
        }
        histRef.current.execute(new AddVectorPathCommand(activeLayerId!, livePathRef.current, setLayers));
        livePathRef.current = null;
        drawOverlay();
        return;
      }

      if (al && al.type === 'raster' && livePathRef.current && shapeMode !== 'freehand') {
        const tl = tilesRef.current.get(activeLayerId!);
        if (tl) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const a of livePathRef.current.anchors) {
            minX = Math.min(minX, a.x);
            minY = Math.min(minY, a.y);
            maxX = Math.max(maxX, a.x);
            maxY = Math.max(maxY, a.y);
          }
          const strokeBuffer = livePathRef.current.strokeWidth / 2 + 10;
          minX -= strokeBuffer; minY -= strokeBuffer;
          maxX += strokeBuffer; maxY += strokeBuffer;

          dirtyTilesRef.current.clear();
          const sx = Math.max(0, Math.floor(minX / TiledLayer.TILE_SIZE));
          const sy = Math.max(0, Math.floor(minY / TiledLayer.TILE_SIZE));
          const ex = Math.min(Math.floor(maxX / TiledLayer.TILE_SIZE), Math.floor((CANVAS_W - 1) / TiledLayer.TILE_SIZE));
          const ey = Math.min(Math.floor(maxY / TiledLayer.TILE_SIZE), Math.floor((CANVAS_H - 1) / TiledLayer.TILE_SIZE));
          for (let ty = sy; ty <= ey; ty++)
            for (let tx = sx; tx <= ex; tx++)
              dirtyTilesRef.current.add(`${tx},${ty}`);

          const cmd = new DrawStrokeCommand(tl, dirtyTilesRef.current, () => {});
          const path = livePathRef.current;
          tl.forEachTileInRect(minX, minY, maxX - minX, maxY - minY, (tile) => {
            tile.ctx.save();
            const tileCanvasX = tile.x * TiledLayer.TILE_SIZE;
            const tileCanvasY = tile.y * TiledLayer.TILE_SIZE;
            tile.ctx.translate(-tileCanvasX, -tileCanvasY);
            PathRenderer.renderPath(tile.ctx, path);
            tile.ctx.restore();
          });

          cmd.savePost();
          histRef.current.execute(cmd);
          livePathRef.current = null;
          drawOverlay();
          refreshTiles();
          return;
        }
      }

      if (strokeCmdRef.current) {
        strokeCmdRef.current.savePost();
        histRef.current.execute(strokeCmdRef.current);
        strokeCmdRef.current = null;
      }

      normRef.current.reset();
      stabRef.current.reset();
      brushRef.current.endStroke();
      lastBrushInputRef.current = null;
      refreshTiles();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x, y } = rendererRef.current.screenToCanvas(
      sx, sy, transform, vpSize.w, vpSize.h, CANVAS_W, CANVAS_H
    );

    if (tool === 'text' || tool === 'select') {
      handleStartTextEdit(x, y);
    }
  };

  const handleStartTextEdit = (x: number, y: number) => {
    const existingTextLayer = layers.find(l => {
      if (l.type === 'text' && l.textNode) {
        const tn = l.textNode;
        const textWidth = Math.max(100, tn.text.length * tn.fontSize * 0.6);
        const textHeight = Math.max(tn.fontSize, tn.text.split('\n').length * tn.fontSize * 1.3);
        return x >= tn.x - 15 && x <= tn.x + textWidth + 15 && y >= tn.y - 15 && y <= tn.y + textHeight + 15;
      }
      return false;
    });

    if (existingTextLayer && existingTextLayer.textNode) {
      setActiveLayerId(existingTextLayer.id);
      setTFont(existingTextLayer.textNode.fontFamily);
      setTSize(existingTextLayer.textNode.fontSize);
      setTColor(existingTextLayer.textNode.color);
      setTextOv({
        x: existingTextLayer.textNode.x,
        y: existingTextLayer.textNode.y,
        layerId: existingTextLayer.id,
        text: existingTextLayer.textNode.text
      });
      redraw();
      return;
    }

    let targetId = activeLayerId;
    const al = layers.find(l => l.id === activeLayerId);

    if (!al || al.type !== 'text') {
      const id = `t-${Date.now()}`;
      const newTextNode: TextNode = {
        id: `tn-${Date.now()}`,
        text: '',
        x,
        y,
        fontSize: tSize,
        fontFamily: tFont,
        fontWeight: '400',
        color: tColor,
        tracking: 0,
        leading: 130,
        align: 'left'
      };
      const nl: LayerNode = {
        id,
        name: `Text ${layers.filter(l => l.type === 'text').length + 1}`,
        type: 'text',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        clipping: false,
        parentId: null,
        textNode: newTextNode
      };
      setLayers(p => [...p, nl]);
      setActiveLayerId(id);
      targetId = id;
      needsRecompositeRef.current = true;
    } else {
      setLayers(p => p.map(l => l.id === targetId ? {
        ...l,
        textNode: {
          id: l.textNode?.id || `tn-${Date.now()}`,
          text: l.textNode?.text || '',
          x,
          y,
          fontSize: tSize,
          fontFamily: tFont,
          fontWeight: '400',
          color: tColor,
          tracking: 0,
          leading: 130,
          align: 'left'
        }
      } : l));
    }

    const currentLayerText = layers.find(l => l.id === targetId)?.textNode?.text || '';
    setTextOv({
      x,
      y,
      layerId: targetId!,
      text: currentLayerText
    });
    redraw();
  };

  const handleTextChange = (newText: string) => {
    if (!textOv) return;
    const targetLayerId = textOv.layerId;
    setTextOv(prev => prev ? { ...prev, text: newText } : null);
    setLayers(prev => prev.map(l => {
      if (l.id === targetLayerId) {
        return {
          ...l,
          textNode: {
            id: l.textNode?.id || `tn-${Date.now()}`,
            text: newText,
            x: textOv.x,
            y: textOv.y,
            fontSize: tSize,
            fontFamily: tFont,
            fontWeight: '400',
            color: tColor,
            tracking: 0,
            leading: 130,
            align: 'left'
          }
        };
      }
      return l;
    }));
    redraw();
  };

  const updateFontFamily = (font: string) => {
    setTFont(font);
    if (activeLayerId) {
      setLayers(prev => prev.map(l => l.id === activeLayerId && l.type === 'text' && l.textNode ? {
        ...l,
        textNode: { ...l.textNode, fontFamily: font }
      } : l));
      redraw();
    }
  };

  const updateFontSize = (fontSize: number) => {
    setTSize(fontSize);
    if (activeLayerId) {
      setLayers(prev => prev.map(l => l.id === activeLayerId && l.type === 'text' && l.textNode ? {
        ...l,
        textNode: { ...l.textNode, fontSize }
      } : l));
      redraw();
    }
  };

  const commitText = (text: string) => {
    if (!textOv) return;
    const targetLayerId = textOv.layerId;
    if (!text.trim()) {
      setLayers(prev => prev.filter(l => !(l.id === targetLayerId && (!l.textNode || !l.textNode.text.trim()))));
      setTextOv(null);
      redraw();
      return;
    }
    const node: TextNode = {
      id: `tn-${Date.now()}`, text: text,
      x: textOv.x, y: textOv.y,
      fontSize: tSize, fontFamily: tFont, fontWeight: '400',
      color: tColor, tracking: 0, leading: 130, align: 'left',
    };
    histRef.current.execute(new AddTextNodeCommand(targetLayerId, node, setLayers));
    setTextOv(null);
    redraw();
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.1 : 0.9;
    setTransform(p => ({ ...p, zoom: Math.max(0.05, Math.min(20, p.zoom * f)) }));
  };

  // ── Export / Crop Export ──────────────────────────────────
  const exportPNG = async () => {
    const blob = await ExportEngine.exportToBlob([...layers], CANVAS_W, CANVAS_H, 'image/png', 0.95, true, 1.0);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `active_artwork_${Date.now()}.png`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCroppedPNG = async () => {
    if (!cropBox) return;
    const fullCanvas = ExportEngine.flattenDocument(layers, CANVAS_W, CANVAS_H);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropBox.w;
    cropCanvas.height = cropBox.h;
    const ctx = cropCanvas.getContext('2d')!;
    ctx.drawImage(fullCanvas, cropBox.x, cropBox.y, cropBox.w, cropBox.h, 0, 0, cropBox.w, cropBox.h);
    cropCanvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'cropped.png'; a.click();
      URL.revokeObjectURL(url);
      setCropBox(null);
    }, 'image/png');
  };

  const saveProject = () => {
    if (!activeLayerId) return;
    const doc: DocumentModel = {
      id: 'p1', metadata: { title: 'Sketchbook Pro', createdAt: Date.now(), updatedAt: Date.now() },
      canvas: { width: CANVAS_W, height: CANVAS_H, dpi: 300, colorSpace: 'srgb' },
      layers, activeLayerId,
    };
    const blob = new Blob([ExportEngine.serializeDocument(doc, tilesRef.current)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'project.artstudio'; a.click();
    URL.revokeObjectURL(url);
  };

  const loadProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const { document: doc, layerTiles } = ExportEngine.deserializeDocument(ev.target!.result as string);
        tilesRef.current = layerTiles;
        setLayers(doc.layers);
        setActiveLayerId(doc.activeLayerId);
        histRef.current.clear();
        refreshTiles();
      } catch { alert('Failed to load project.'); }
    };
    r.readAsText(f);
  };

  // ── Boolean ops ────────────────────────────────────────────
  const boolOp = (op: 'union' | 'subtract' | 'intersect' | 'exclude') => {
    const al = layers.find(l => l.id === activeLayerId && l.type === 'vector');
    if (!al?.vectorPaths) return;
    const sel = al.vectorPaths.filter(p => selPaths.has(p.id));
    if (sel.length < 2) return;
    const [a, b] = sel;
    const results = op === 'union' ? [BooleanOps.union(a, b)]
      : op === 'subtract' ? [BooleanOps.subtract(a, b)]
      : op === 'intersect' ? [BooleanOps.intersect(a, b)]
      : BooleanOps.exclude(a, b);
    const remaining = al.vectorPaths.filter(p => !selPaths.has(p.id));
    const newPaths = [...remaining, ...results];
    const oldPaths = [...al.vectorPaths];
    histRef.current.execute({
      name: `Boolean ${op}`,
      execute: () => { setLayers(p => p.map(l => l.id === activeLayerId ? { ...l, vectorPaths: newPaths } : l)); setSelPaths(new Set(results.map(r => r.id))); },
      undo: () => { setLayers(p => p.map(l => l.id === activeLayerId ? { ...l, vectorPaths: oldPaths } : l)); setSelPaths(new Set(sel.map(s => s.id))); },
    });
  };

  // ── Smart Canvas Intelligence Telemetry & Focus Camera ──
  const smartContentBounds = useMemo(() => {
    return ExportEngine.getContentBoundingBox(layers, CANVAS_W, CANVAS_H, 20);
  }, [layers]);

  const smartTelemetry = useMemo(() => {
    let rasterCount = 0, vectorCount = 0, textCount = 0, imageCount = 0;
    const textSnippets: string[] = [];
    layers.forEach(l => {
      if (!l.visible) return;
      if (l.type === 'raster') rasterCount++;
      if (l.type === 'vector') vectorCount++;
      if (l.type === 'text') {
        textCount++;
        if (l.textNode?.text) textSnippets.push(`"${l.textNode.text.slice(0, 20)}..."`);
      }
      if (l.type === 'image') imageCount++;
    });
    return { rasterCount, vectorCount, textCount, imageCount, textSnippets };
  }, [layers]);

  // ── Smart Canvas Intelligence Work History Regions & Camera Tour ──
  const workHistoryRegions = useMemo(() => {
    const list: { name: string; bounds: { x: number; y: number; w: number; h: number } }[] = [];

    // 1. Overall Active Artwork Bounding Box Overview
    const overall = ExportEngine.getContentBoundingBox(layers, CANVAS_W, CANVAS_H, 20);
    if (overall.w > 0 && overall.h > 0 && isFinite(overall.w)) {
      list.push({ name: 'Active Content Bounding Area', bounds: overall });
    }

    // 2. Individual Worked Layer Regions
    layers.forEach(l => {
      if (!l.visible) return;

      if (l.type === 'vector' && l.vectorPaths && l.vectorPaths.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        l.vectorPaths.forEach(p => {
          p.anchors.forEach(a => {
            if (a.x < minX) minX = a.x;
            if (a.y < minY) minY = a.y;
            if (a.x > maxX) maxX = a.x;
            if (a.y > maxY) maxY = a.y;
          });
        });
        if (minX !== Infinity && isFinite(minX)) {
          const w = Math.max(60, maxX - minX);
          const h = Math.max(60, maxY - minY);
          list.push({ name: `Vector Artwork (${l.name})`, bounds: { x: minX - 20, y: minY - 20, w: w + 40, h: h + 40 } });
        }
      }

      if (l.type === 'text' && l.textNode) {
        list.push({
          name: `Text Note ("${l.textNode.text.slice(0, 15)}...")`,
          bounds: { x: l.textNode.x - 20, y: l.textNode.y - 20, w: 240, h: (l.textNode.fontSize || 24) * 2 + 40 }
        });
      }

      if (l.type === 'image' && l.imageNode) {
        list.push({
          name: `Imported Media (${l.name})`,
          bounds: { x: l.imageNode.x - 20, y: l.imageNode.y - 20, w: l.imageNode.width + 40, h: l.imageNode.height + 40 }
        });
      }

      if (l.type === 'raster') {
        const tl = tilesRef.current.get(l.id);
        if (tl && tl.tiles.size > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          tl.tiles.forEach((_, key) => {
            const [tx, ty] = key.split(',').map(Number);
            minX = Math.min(minX, tx * TiledLayer.TILE_SIZE);
            minY = Math.min(minY, ty * TiledLayer.TILE_SIZE);
            maxX = Math.max(maxX, (tx + 1) * TiledLayer.TILE_SIZE);
            maxY = Math.max(maxY, (ty + 1) * TiledLayer.TILE_SIZE);
          });
          if (minX !== Infinity && isFinite(minX)) {
            list.push({
              name: `Paint Strokes (${l.name})`,
              bounds: { x: minX - 20, y: minY - 20, w: (maxX - minX) + 40, h: (maxY - minY) + 40 }
            });
          }
        }
      }
    });

    return list;
  }, [layers]);

  // Toggle or Focus Camera Tour Loop
  const toggleContentCameraTour = () => {
    if (isTouringCamera) {
      // Stop Camera Tour & return directly to active working position
      setIsTouringCamera(false);
      if (initialViewportRef.current) {
        setTransform(initialViewportRef.current);
      }
    } else {
      // Start Camera Tour Loop
      initialViewportRef.current = { ...transform };
      setTourIndex(0);
      setIsTouringCamera(true);
    }
  };

  // Camera Tour Step Interval Loop
  useEffect(() => {
    if (!isTouringCamera || workHistoryRegions.length === 0) return;

    // Tour targets include all worked regions, followed by returning to active working position!
    const targets = [
      ...workHistoryRegions,
      { name: 'Active Working Location', bounds: null }
    ];

    const currentTarget = targets[tourIndex % targets.length];
    if (currentTarget) {
      if (currentTarget.name === 'Active Working Location' && initialViewportRef.current) {
        setTransform(initialViewportRef.current);
      } else if (currentTarget.bounds) {
        const bounds = currentTarget.bounds;
        const zoomX = vpSize.w / (bounds.w + 140);
        const zoomY = vpSize.h / (bounds.h + 140);
        const newZoom = Math.min(2.5, Math.max(0.2, Math.min(zoomX, zoomY)));
        const centerX = bounds.x + bounds.w / 2;
        const centerY = bounds.y + bounds.h / 2;
        setTransform({
          zoom: newZoom,
          panX: (vpSize.w / 2) - centerX * newZoom,
          panY: (vpSize.h / 2) - centerY * newZoom,
          rotation: 0
        });
      }
    }

    const timer = setTimeout(() => {
      setTourIndex(prev => (prev + 1) % targets.length);
    }, 2800);

    return () => clearTimeout(timer);
  }, [isTouringCamera, tourIndex, workHistoryRegions, vpSize]);

  // Derived
  const activeLayer = layers.find(l => l.id === activeLayerId) ?? null;
  const cursorStyle = tool === 'pan' ? 'grab' : tool === 'text' ? 'text' : (tool === 'select' || tool === 'crop') ? 'default' : 'crosshair';
  const toolLabel = (t: ActiveTool) => ({ brush: 'B', eraser: 'E', pen: 'P', text: 'T', select: 'V', crop: 'C', pan: 'H' })[t];

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* ── Top Bar ── */}
      {!zenMode && (
        <header className="topbar">
          <div className="topbar-brand">Sketch<span>Pro</span></div>

          {/* Use Case Tier Level Switcher (Common, Rare, Legendary) */}
          <TierSwitcher currentTier={tierLevel} onTierChange={setTierLevel} />

          <div className="topbar-center">
            <span>{Math.round(transform.zoom * 100)}%</span>
            <span className="text-dim">·</span>
            <span>{activeLayer?.name ?? '—'}</span>
            <span className="text-dim">·</span>
            <span>{tool.toUpperCase()}</span>
            {tool === 'pen' && <span className="text-dim">({penState})</span>}
          </div>

          <div className="topbar-right">
            <button className="btn btn-ghost" onClick={() => setZenMode(true)} style={{ marginRight: 8 }}>Zen Mode</button>

            {/* Import PDF or Photo Page to Draw On */}
            <label className="btn" style={{ background: '#2563eb', color: '#ffffff', marginRight: 6 }}>
              Import PDF / Photo
              <input type="file" accept=".pdf, image/*" style={{ display: 'none' }} onChange={importPDFFile} />
            </label>

            <label className="btn">
              Open
              <input type="file" accept=".artstudio" style={{ display: 'none' }} onChange={loadProject} />
            </label>

            <button className="btn" onClick={saveProject}>Save</button>
            <button className="btn btn-accent" onClick={exportPNG}>Export PNG</button>

            {/* Export PDF Document with Custom User Selection */}
            <button className="btn btn-accent" style={{ background: '#4f46e5', color: '#ffffff', marginLeft: 6 }} onClick={() => setPdfModalOpen(true)}>
              Export PDF
            </button>

            {/* Interactive Tutorial Onboarding Guide */}
            <button
              className="btn btn-accent"
              style={{ background: '#6366f1', color: '#ffffff', fontWeight: 600, marginLeft: 6 }}
              onClick={() => { setTutorialStep(0); setTutorialActive(true); }}
            >
              Tutorial
            </button>
          </div>
        </header>
      )}

      {/* Smart Canvas Intelligence Telemetry Banner */}
      {!zenMode && tierLevel === 'common' && (
        <div className="smart-canvas-bar" style={{ background: '#121215', borderBottom: '1px solid #27272a', padding: '6px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#a1a1aa' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ background: '#18181b', color: '#818cf8', border: '1px solid #27272a', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              SMART CANVAS INTELLIGENCE
            </span>
            <span>
              Active Area: <strong>{smartContentBounds.w}×{smartContentBounds.h}px</strong> @ ({smartContentBounds.x}, {smartContentBounds.y})
            </span>
            <span className="text-dim">·</span>
            <span>
              Layers: <strong>{smartTelemetry.rasterCount} Raster</strong>, <strong>{smartTelemetry.vectorCount} Vector</strong>, <strong>{smartTelemetry.textCount} Text</strong>, <strong>{smartTelemetry.imageCount} Image</strong>
            </span>
            {pdfStatusMsg && (
              <>
                <span className="text-dim">·</span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>{pdfStatusMsg}</span>
              </>
            )}
            {smartTelemetry.textSnippets.length > 0 && (
              <>
                <span className="text-dim">·</span>
                <span>Written: <em style={{ color: '#e4e4e7' }}>{smartTelemetry.textSnippets.join(', ')}</em></span>
              </>
            )}
            {isTouringCamera && (
              <>
                <span className="text-dim">·</span>
                <span style={{ color: '#818cf8', fontWeight: 600 }}>
                  CAMERA TOUR ({tourIndex % (workHistoryRegions.length + 1) + 1}/{workHistoryRegions.length + 1}): {workHistoryRegions[tourIndex % (workHistoryRegions.length + 1)]?.name || 'Active Working Position'}
                </span>
              </>
            )}
          </div>
          <button
            className="btn btn-xs btn-accent"
            style={{
              background: isTouringCamera ? '#ef4444' : '#27272a',
              color: '#fff',
              border: '1px solid #3f3f46',
              fontWeight: 600,
            }}
            onClick={toggleContentCameraTour}
          >
            {isTouringCamera ? 'Stop Camera Tour' : 'Focus & Tour Content Camera'}
          </button>
        </div>
      )}

      {/* ── Tier Level Workspace Router ── */}
      {tierLevel === 'animation' ? (
        <AnimationWorkspace
          layers={layers}
          setLayers={setLayers}
          activeLayerId={activeLayerId}
          setActiveLayerId={setActiveLayerId}
          redraw={redraw}
          CANVAS_W={CANVAS_W}
          CANVAS_H={CANVAS_H}
          onReturnToCommon={() => setTierLevel('common')}
        />
      ) : tierLevel === 'rare' ? (
        <RareWorkspace
          layers={layers}
          CANVAS_W={CANVAS_W}
          CANVAS_H={CANVAS_H}
          redraw={redraw}
          onReturnToCommon={() => setTierLevel('common')}
          loaded3DMesh={loaded3DMesh}
          setLoaded3DMesh={setLoaded3DMesh}
        />
      ) : tierLevel === 'legendary' ? (
        <LegendaryWorkspace
          layers={layers}
          setLayers={setLayers}
          redraw={redraw}
          CANVAS_W={CANVAS_W}
          CANVAS_H={CANVAS_H}
          onReturnToCommon={() => setTierLevel('common')}
          loaded3DMesh={loaded3DMesh}
        />
      ) : (
        /* ── Common Level Interface (Default Core Studio) ── */
        <>
          <div className="app-middle">
        {/* ── Tool Strip ── */}
        {!zenMode && (
          <div className="tool-strip">
            {(['brush','eraser','pen','text','select','crop','pan'] as ActiveTool[]).map(t => (
              <button
                key={t}
                className={`tool-btn ${tool === t ? 'active' : ''}`}
                onClick={() => switchTool(t)}
                data-tip={`${t === 'pan' ? 'Hand / Pan Canvas' : t[0].toUpperCase() + t.slice(1)} (${toolLabel(t)})`}
              >
                {toolLabel(t)}
              </button>
            ))}

            <div className="tool-strip-sep" />

            {/* Undo / Redo */}
            <button className="tool-btn" onClick={() => histRef.current.undo()} disabled={histStats.undo === 0} data-tip="Undo (Ctrl+Z)">⟲</button>
            <button className="tool-btn" onClick={() => histRef.current.redo()} disabled={histStats.redo === 0} data-tip="Redo (Ctrl+Y)">⟳</button>

            <div className="tool-strip-sep" />

            {/* Boolean ops — only when vector layer active */}
            {activeLayer?.type === 'vector' && (
              <>
                <button className="tool-btn" onClick={() => boolOp('union')} disabled={selPaths.size < 2} data-tip="Union">∪</button>
                <button className="tool-btn" onClick={() => boolOp('subtract')} disabled={selPaths.size < 2} data-tip="Subtract">−</button>
                <button className="tool-btn" onClick={() => boolOp('intersect')} disabled={selPaths.size < 2} data-tip="Intersect">∩</button>
              </>
            )}
          </div>
        )}

        {/* ── Left Panel ── */}
        {!zenMode && (
          <ResizablePanel side="left" defaultW={220}>
            {/* Pages Section (OkSo feature) */}
            <Section title="Pages Tree (Nested)">
              <button
                className="btn btn-full btn-accent btn-sm"
                onClick={() => {
                  setAddPageModal({ parentId: null });
                  setAddPageName(`Page ${pages.length + 1}`);
                  setAddPageFormat('blank');
                }}
              >
                + Add Page
              </button>
              <div style={{ marginTop: 6 }}>
                {renderPageTreeNodes(null, 0)}
              </div>
            </Section>

            {/* Canvas settings (OkSo feature) */}
            <Section title="Canvas Settings">
              <Row label="Grid Theme">
                <select value={bgTheme} onChange={e => setBgTheme(e.target.value as 'dark' | 'light')}>
                  <option value="dark">Dark Theme (Endless)</option>
                  <option value="light">Light Theme (Paper)</option>
                </select>
              </Row>
              <Row label="Page Format">
                <select value={pageFormat} onChange={e => {
                  const newF = e.target.value as any;
                  setPageFormat(newF);
                  setPages(prev => prev.map(p => p.id === activePageId ? { ...p, format: newF } : p));
                  needsRecompositeRef.current = true;
                }}>
                  <option value="blank">Blank Slate</option>
                  <option value="lined">Lined (Ruled)</option>
                  <option value="grid">Grid (Graph)</option>
                  <option value="dotted">Dotted Grid</option>
                  <option value="checklist">Checklist Format</option>
                </select>
              </Row>
              <Row label="Page Border">
                <input type="checkbox" checked={showPageBorder} onChange={e => setShowPageBorder(e.target.checked)} />
                <span style={{ fontSize: 9, color: 'var(--text-3)' }}>Show bounds</span>
              </Row>
            </Section>

            {/* Color Palette Grid */}
            <Section title="Color Swatches">
              <div className="swatch-grid">
                {COLOR_SWATCHES.map(sw => (
                  <div
                    key={sw}
                    className={`swatch-item ${color === sw ? 'active' : ''}`}
                    style={{ backgroundColor: sw }}
                    onClick={() => updateActiveColor(sw)}
                  />
                ))}
              </div>
            </Section>

            {/* View Bookmarks Section */}
            <Section title="Bookmarks">
              <button className="btn btn-full btn-accent btn-sm" onClick={addBookmark}>
                + Save View Bookmark
              </button>
              <div className="bookmark-list">
                {bookmarks.map(bm => (
                  <div key={bm.id} className="bookmark-item" onClick={() => jumpToBookmark(bm)}>
                    <span>{bm.name}</span>
                    <button className="btn btn-ghost btn-sm btn-danger" style={{ padding: 0 }}
                      onClick={e => deleteBookmark(bm.id, e)}
                    >×</button>
                  </div>
                ))}
                {bookmarks.length === 0 && <p style={{ fontSize: 9, color: 'var(--text-3)' }}>No bookmarks saved yet.</p>}
              </div>
            </Section>

            {/* Image Importer */}
            <Section title="Media">
              <label className="btn btn-full btn-sm">
                Insert Image File
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={triggerImageImport} />
              </label>
            </Section>

            {/* Brush / Shape settings */}
            {(tool === 'brush' || tool === 'eraser') && (
              <Section title="Brush / Shapes">
                {tool === 'brush' && (
                  <Row label="Mode">
                    <select value={shapeMode} onChange={e => setShapeMode(e.target.value as ShapeMode)}>
                      <option value="freehand">Freehand Brush</option>
                      <option value="line">Line Tool</option>
                      <option value="rect">Rectangle Tool</option>
                      <option value="circle">Circle Tool</option>
                    </select>
                  </Row>
                )}
                {tool === 'brush' && (
                  <Row label="Color">
                    <input type="color" value={color} onChange={e => updateActiveColor(e.target.value)} />
                  </Row>
                )}
                <Row label="Size" value={size}>
                  <input type="range" min={1} max={150} value={size} onChange={e => setSize(+e.target.value)} />
                </Row>
                <Row label="Opacity" value={`${Math.round(opacity * 100)}%`}>
                  <input type="range" min={1} max={100} value={opacity * 100} onChange={e => setOpacity(+e.target.value / 100)} />
                </Row>
                {tool === 'brush' && shapeMode === 'freehand' && (
                  <>
                    <div style={{ height: 4 }} />
                    <div className="preset-list">
                      {brushPresets.map(p => (
                        <div
                          key={p.id}
                          className={`preset-item ${presetId === p.id && tool === 'brush' ? 'active' : ''}`}
                          onClick={() => { setPresetId(p.id); switchTool('brush'); }}
                        >
                          <div style={{ flex: 1 }}>
                            <div className="preset-name">{p.name}</div>
                            <div className="preset-detail">{p.hardness}% hard</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {shapeMode !== 'freehand' && (
                  <Row label="Fill">
                    <input type="checkbox" checked={vFill !== null} onChange={e => setVFill(e.target.checked ? color : null)} />
                    {vFill !== null && <input type="color" value={vFill} onChange={e => setVFill(e.target.value)} />}
                  </Row>
                )}
              </Section>
            )}

            {/* Crop tool export settings */}
            {tool === 'crop' && (
              <Section title="Export Cropped Region">
                <button className="btn btn-full btn-accent" onClick={exportCroppedPNG} disabled={!cropBox}>
                  Export Selected Crop
                </button>
                <p style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 8 }}>
                  Click and drag to draw a crop box over the infinite canvas. Click button to download cropped PNG.
                </p>
              </Section>
            )}

            {/* Pen / vector settings */}
            {tool === 'pen' && (
              <Section title="Pen">
                <Row label="Stroke">
                  <input type="color" value={vStroke} onChange={e => updateActiveColor(e.target.value)} />
                </Row>
                <Row label="Width" value={vWidth}>
                  <input type="range" min={0.5} max={20} step={0.5} value={vWidth} onChange={e => setVWidth(+e.target.value)} />
                </Row>
                <Row label="Fill">
                  <input type="checkbox" checked={vFill !== null} onChange={e => setVFill(e.target.checked ? color : null)} />
                  {vFill !== null && <input type="color" value={vFill} onChange={e => setVFill(e.target.value)} />}
                </Row>
                <button className="btn btn-full btn-accent" onClick={commitPenPath} disabled={penState === 'idle'}>
                  Commit Path
                </button>
                <button className="btn btn-full" style={{ marginTop: 4 }} onClick={addVectorLayer}>New Vector Layer</button>
                <p style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 8 }}>
                  Click to place anchors. Drag to curve. Click first point to close. Esc/Commit button to finish open path.
                </p>
              </Section>
            )}

            {/* Select tool panel details */}
            {tool === 'select' && (
              <Section title="Selection Settings">
                {selPaths.size > 0 ? (
                  <>
                    <p style={{ fontSize: 11, color: 'var(--accent)', fontWeight: '600' }}>
                      {selPaths.size} Path(s) Selected
                    </p>
                    <div className="divider" style={{ margin: '8px 0' }} />
                    <Row label="Stroke">
                      <input type="color" value={vStroke} onChange={e => updateActiveColor(e.target.value)} />
                    </Row>
                    <Row label="Width" value={vWidth}>
                      <input type="range" min={0.5} max={20} step={0.5} value={vWidth} onChange={e => setVWidth(+e.target.value)} />
                    </Row>
                    <Row label="Fill">
                      <input type="checkbox" checked={vFill !== null} onChange={e => setVFill(e.target.checked ? color : null)} />
                      {vFill !== null && <input type="color" value={vFill} onChange={e => setVFill(e.target.value)} />}
                    </Row>
                  </>
                ) : activeLayer?.type === 'image' ? (
                  <>
                    <p style={{ fontSize: 11, color: 'var(--accent)', fontWeight: '600' }}>
                      Selected Image Layer
                    </p>
                    <div className="divider" style={{ margin: '8px 0' }} />
                    <Row label="Rotation" value={`${activeLayer.imageNode?.rotation || 0}°`}>
                      <input type="range" min={0} max={360} value={activeLayer.imageNode?.rotation || 0}
                        onChange={e => {
                          const val = +e.target.value;
                          setLayers(prev => prev.map(l => l.id === activeLayerId ? { ...l, imageNode: { ...l.imageNode!, rotation: val } } : l));
                        }}
                      />
                    </Row>
                  </>
                ) : (
                  <p style={{ fontSize: 10, color: 'var(--text-3)' }}>
                    Click on vector shapes, lines, anchor points, images, or text elements to select and drag them. Drag corner handles to scale.
                  </p>
                )}
              </Section>
            )}

            {/* Text settings */}
            {tool === 'text' && (
              <Section title="Text">
                <Row label="Color">
                  <input type="color" value={tColor} onChange={e => updateActiveColor(e.target.value)} />
                </Row>
                <Row label="Size" value={tSize}>
                  <input type="range" min={8} max={200} value={tSize} onChange={e => updateFontSize(+e.target.value)} />
                </Row>
                <Row label="Font">
                  <select value={tFont} onChange={e => updateFontFamily(e.target.value)}>
                    {FONT_OPTIONS.map(font => (
                      <option key={font.name} value={font.family} style={{ fontFamily: font.family }}>
                        {font.name}
                      </option>
                    ))}
                  </select>
                </Row>
                <button className="btn btn-full" onClick={addTextLayer}>New Text Layer</button>
                <p style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 8 }}>
                  Double-click anywhere on the canvas to start writing text. Enter to commit, Esc to cancel.
                </p>
              </Section>
            )}

            {/* Stabilizer */}
            <Section title="Stabilizer" defaultOpen={false}>
              <Row label="Mode">
                <select value={stabSettings.mode} onChange={e => setStabSettings(p => ({ ...p, mode: e.target.value as 'none' | 'smooth' | 'lazy' }))}>
                  <option value="none">None</option>
                  <option value="smooth">Smooth</option>
                  <option value="lazy">Lazy</option>
                </select>
              </Row>
              {stabSettings.mode === 'smooth' && (
                <Row label="Amount" value={`${Math.round(stabSettings.smoothFactor * 100)}%`}>
                  <input type="range" min={0} max={100} value={stabSettings.smoothFactor * 100}
                    onChange={e => setStabSettings(p => ({ ...p, smoothFactor: +e.target.value / 100 }))} />
                </Row>
              )}
              {stabSettings.mode === 'lazy' && (
                <Row label="Radius" value={stabSettings.lazyRadius}>
                  <input type="range" min={1} max={100} value={stabSettings.lazyRadius}
                    onChange={e => setStabSettings(p => ({ ...p, lazyRadius: +e.target.value }))} />
                </Row>
              )}
            </Section>

            {/* Keyboard Shortcuts */}
            <Section title="Shortcuts Sheet" defaultOpen={false}>
              <div className="shortcut-list">
                <div className="shortcut-row"><span>Freehand Brush</span><span className="shortcut-key">B</span></div>
                <div className="shortcut-row"><span>Sweeping Eraser</span><span className="shortcut-key">E</span></div>
                <div className="shortcut-row"><span>Pen Bezier Tool</span><span className="shortcut-key">P</span></div>
                <div className="shortcut-row"><span>Text Tool</span><span className="shortcut-key">T</span></div>
                <div className="shortcut-row"><span>Select & Scale</span><span className="shortcut-key">V</span></div>
                <div className="shortcut-row"><span>Export Crop Box</span><span className="shortcut-key">C</span></div>
                <div className="shortcut-row"><span>Hand / Pan Tool</span><span className="shortcut-key">H</span></div>
                <div className="shortcut-row"><span>Zen Screen Mode</span><span className="shortcut-key">Tab</span></div>
                <div className="shortcut-row"><span>Undo / Redo</span><span className="shortcut-key">Ctrl+Z / Y</span></div>
                <div className="shortcut-row"><span>Pan View</span><span className="shortcut-key">Shift+Drag</span></div>
              </div>
            </Section>
          </ResizablePanel>
        )}

        {/* ── Canvas Viewport ── */}
        <div className="viewport" ref={vpRef}>
          <canvas
            ref={canvasRef}
            className="viewport-canvas"
            style={{ cursor: cursorStyle }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
          />
          {/* Overlay for pen tool live path */}
          <canvas
            ref={overlayRef}
            className="viewport-canvas"
            style={{ pointerEvents: 'none', zIndex: 5 }}
          />

          {/* Text overlay */}
          {textOv && (() => {
            const screenPos = rendererRef.current.canvasToScreen(
              textOv.x,
              textOv.y,
              transform,
              vpSize.w,
              vpSize.h,
              CANVAS_W,
              CANVAS_H
            );
            return (
              <TextToolOverlay
                screenX={screenPos.x}
                screenY={screenPos.y}
                zoom={transform.zoom}
                initialText={textOv.text || ''}
                fontSize={tSize}
                fontFamily={tFont}
                color={tColor}
                onCommit={commitText}
                onCancel={() => {
                  const targetLayerId = textOv.layerId;
                  setLayers(prev => prev.filter(l => !(l.id === targetLayerId && (!l.textNode || !l.textNode.text.trim()))));
                  setTextOv(null);
                  redraw();
                }}
                onChangeText={handleTextChange}
              />
            );
          })()}


          {/* Keypress Toast HUD */}
          {shortcutKey && (
            <div className="hud" style={{ top: 24, left: '50%', transform: 'translateX(-50%)', bottom: 'auto' }}>
              <span className="hud-label" style={{ color: 'var(--accent)', fontWeight: 'bold' }}>
                Keybind: {shortcutKey.toUpperCase()}
              </span>
            </div>
          )}

          {/* HUD */}
          <div className="hud">
            <button className="btn btn-ghost btn-sm" onClick={() => setTransform(p => ({ ...p, zoom: Math.max(0.05, p.zoom * 0.85) }))}>−</button>
            <span className="hud-label">{Math.round(transform.zoom * 100)}%</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setTransform(p => ({ ...p, zoom: Math.min(20, p.zoom * 1.15) }))}>+</button>
            <div className="hud-sep" />
            <button className="btn btn-ghost btn-sm" onClick={() => setTransform(p => ({ ...p, rotation: (p.rotation - 15) % 360 }))}>↺</button>
            <span className="hud-label">{transform.rotation}°</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setTransform(p => ({ ...p, rotation: (p.rotation + 15) % 360 }))}>↻</button>
            <div className="hud-sep" />
            <button className="btn btn-ghost btn-sm" onClick={() => {
              const el = vpRef.current;
              if (el) setTransform({ zoom: Math.min(el.clientWidth / CANVAS_W, el.clientHeight / CANVAS_H) * 0.88, panX: 0, panY: 0, rotation: 0 });
            }}>Fit</button>
          </div>

          {/* Floating Zen Controls */}
          {zenMode && (
            <div className="zen-controls">
              <button className="btn btn-sm btn-ghost" onClick={() => setZenMode(false)}>Exit Zen</button>
              <div className="zen-sep" />
              {(['brush','eraser','pen','text','select','crop','pan'] as ActiveTool[]).map(t => (
                <button
                  key={t}
                  className={`btn btn-sm btn-ghost ${tool === t ? 'active' : ''}`}
                  onClick={() => switchTool(t)}
                >
                  {toolLabel(t)}
                </button>
              ))}
              <div className="zen-sep" />
              <div className="swatch-grid mini">
                {COLOR_SWATCHES.slice(0, 6).map(sw => (
                  <div
                    key={sw}
                    className={`swatch-item ${color === sw ? 'active' : ''}`}
                    style={{ backgroundColor: sw }}
                    onClick={() => updateActiveColor(sw)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right Panel ── */}
        {!zenMode && (
          <ResizablePanel side="right" defaultW={240}>
            {/* Layers */}
            <Section title="Layers">
              <div className="flex-row" style={{ marginBottom: 4 }}>
                <button className="btn btn-sm" onClick={addRasterLayer}>+ Raster</button>
                <button className="btn btn-sm" onClick={addVectorLayer}>+ Vector</button>
                <button className="btn btn-sm" onClick={addTextLayer}>+ Text</button>
              </div>
              <div className="layer-list">
                {[...layers].reverse().map(layer => (
                  <div
                    key={layer.id}
                    className={`layer-item ${activeLayerId === layer.id ? 'active' : ''}`}
                    onClick={() => setActiveLayerId(layer.id)}
                  >
                    <div className="layer-item-row">
                      <span className="layer-name">{layer.name}</span>
                      <span className="layer-type-badge">{layer.type.slice(0,3)}</span>
                      <div className="layer-actions">
                        <button className="btn btn-ghost btn-sm"
                          onClick={e => { e.stopPropagation(); setLayers(p => p.map(l => l.id === layer.id ? { ...l, visible: !l.visible } : l)); needsRecompositeRef.current = true; }}
                        >{layer.visible ? '●' : '○'}</button>
                        <button className="btn btn-ghost btn-sm btn-danger"
                          onClick={e => { e.stopPropagation(); deleteLayer(layer.id); }}
                        >×</button>
                      </div>
                    </div>
                    <div className="ctrl-row">
                      <span className="ctrl-label">Opacity</span>
                      <input type="range" min={0} max={100} value={layer.opacity * 100}
                        onChange={e => { e.stopPropagation(); setLayers(p => p.map(l => l.id === layer.id ? { ...l, opacity: +e.target.value / 100 } : l)); needsRecompositeRef.current = true; }}
                        onClick={e => e.stopPropagation()}
                      />
                      <span className="ctrl-value">{Math.round(layer.opacity * 100)}%</span>
                    </div>
                    <div className="ctrl-row">
                      <span className="ctrl-label">Blend</span>
                      <select value={layer.blendMode}
                        onChange={e => { e.stopPropagation(); setLayers(p => p.map(l => l.id === layer.id ? { ...l, blendMode: e.target.value as BlendMode } : l)); needsRecompositeRef.current = true; }}
                        onClick={e => e.stopPropagation()}
                      >
                        {['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','difference'].map(m => (
                          <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                        ))}
                      </select>
                    </div>

                    {/* Vector path sub-list */}
                    {layer.type === 'vector' && layer.vectorPaths && layer.vectorPaths.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {layer.vectorPaths.map(p => (
                          <div key={p.id}
                            className={`path-item ${selPaths.has(p.id) ? 'selected' : ''}`}
                            onClick={ev => {
                              ev.stopPropagation();
                              setSelPaths(prev => {
                                const n = new Set(prev);
                                n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                                return n;
                              });
                            }}
                          >
                            <span style={{ fontSize: 10, color: 'var(--text-3)' }}>path</span>
                            <span>{p.anchors.length} pts</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>

            {/* History */}
            <Section title={`History (${histStats.undo})`} defaultOpen={false}>
              <div className="flex-row" style={{ marginBottom: 4 }}>
                <button className="btn btn-sm btn-full" onClick={() => histRef.current.undo()} disabled={histStats.undo === 0}>Undo</button>
                <button className="btn btn-sm btn-full" onClick={() => histRef.current.redo()} disabled={histStats.redo === 0}>Redo</button>
              </div>
              <div className="history-list">
                {histRef.current.getUndoStack().slice().reverse().map((c, i) => (
                  <div key={i} className="history-item">{c.name}</div>
                ))}
                {histStats.undo === 0 && <div className="history-item" style={{ color: 'var(--text-3)' }}>Empty</div>}
              </div>
            </Section>
          </ResizablePanel>
        )}
      </div>

      {/* ── Status Bar ── */}
      {!zenMode && (
        <footer className="statusbar">
          <div className="flex-row" style={{ gap: 12 }}>
            <span>{CANVAS_W}×{CANVAS_H}</span>
            <span className="text-dim">·</span>
            <span>{ptrStats ? `${Math.round(ptrStats.x)}, ${Math.round(ptrStats.y)}` : '—, —'}</span>
            {ptrStats && <>
              <span className="text-dim">·</span>
              <span>{Math.round(ptrStats.pressure * 100)}% pressure</span>
            </>}
          </div>
          <div className="flex-row" style={{ gap: 12 }}>
            <span className="text-dim">Shift+drag to pan · Scroll to zoom · Tab to toggle Zen Mode</span>
          </div>
        </footer>
      )}
        </>
      )}

      {/* ── Custom Add Page Modal (Matte Black Design) ── */}
      {addPageModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            backgroundColor: '#16161a',
            border: '1px solid #27272a',
            borderRadius: 8,
            padding: 20,
            width: 320,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
            color: 'var(--text-1)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>
              Create New Page
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, color: 'var(--text-3)' }}>PAGE NAME</label>
                <input
                  type="text"
                  value={addPageName}
                  onChange={e => setAddPageName(e.target.value)}
                  style={{
                    backgroundColor: '#09090b',
                    border: '1px solid #27272a',
                    borderRadius: 4,
                    padding: '6px 8px',
                    color: 'var(--text-1)',
                    fontSize: 12
                  }}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      createNewPage(addPageName, addPageFormat, addPageModal.parentId);
                      setAddPageModal(null);
                    }
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, color: 'var(--text-3)' }}>PAGE FORMAT</label>
                <select
                  value={addPageFormat}
                  onChange={e => setAddPageFormat(e.target.value as any)}
                  style={{
                    backgroundColor: '#09090b',
                    border: '1px solid #27272a',
                    borderRadius: 4,
                    padding: '6px 8px',
                    color: 'var(--text-1)',
                    fontSize: 12,
                    cursor: 'pointer'
                  }}
                >
                  <option value="blank">Blank slate</option>
                  <option value="lined">Lined (Ruled)</option>
                  <option value="grid">Grid (Graph)</option>
                  <option value="dotted">Dotted Grid</option>
                  <option value="checklist">Interactive Checklist</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAddPageModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-accent btn-sm"
                  onClick={() => {
                    createNewPage(addPageName, addPageFormat, addPageModal.parentId);
                    setAddPageModal(null);
                  }}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive PDF Export Configuration Modal */}
      {pdfModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, padding: 24, width: 460, color: '#e4e4e7' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, borderBottom: '1px solid #27272a', paddingBottom: 10, margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📄 EXPORT PDF CONFIGURATION</span>
              <span style={{ fontSize: 10, color: '#a1a1aa' }}>Sketchbook Pro PDF Engine</span>
            </h3>

            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 600 }}>PDF Document Title</label>
              <input
                type="text"
                value={pdfExportOptions.pdfTitle}
                onChange={e => setPdfExportOptions(p => ({ ...p, pdfTitle: e.target.value }))}
                style={{ width: '100%', background: '#09090b', color: '#fff', border: '1px solid #27272a', borderRadius: 4, padding: '6px 10px', marginTop: 4, fontSize: 12 }}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 600 }}>What layers would you like to include?</label>
              <select
                value={pdfExportOptions.layerSelection}
                onChange={e => setPdfExportOptions(p => ({ ...p, layerSelection: e.target.value as any }))}
                style={{ width: '100%', background: '#09090b', color: '#fff', border: '1px solid #27272a', borderRadius: 4, padding: '6px 10px', marginTop: 4, fontSize: 12 }}
              >
                <option value="all">All Visible Layers (Raster Paint, Vector Lines, Images, Text)</option>
                <option value="vector_only">Vector Paths & Line Art Only</option>
                <option value="text_only">Text Notes & Annotations Only</option>
                <option value="raster_only">Raster Paint Strokes Only</option>
              </select>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 600 }}>Page Bounds Area</label>
              <select
                value={pdfExportOptions.pageArea}
                onChange={e => setPdfExportOptions(p => ({ ...p, pageArea: e.target.value as any }))}
                style={{ width: '100%', background: '#09090b', color: '#fff', border: '1px solid #27272a', borderRadius: 4, padding: '6px 10px', marginTop: 4, fontSize: 12 }}
              >
                <option value="active_content">Active Artwork Content Area (Trim empty space)</option>
                <option value="full_canvas">Full Canvas Workspace Area</option>
              </select>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 11, color: '#a1a1aa', fontWeight: 600 }}>Output Resolution & Quality</label>
              <select
                value={pdfExportOptions.resolutionDPI}
                onChange={e => setPdfExportOptions(p => ({ ...p, resolutionDPI: parseInt(e.target.value) as any }))}
                style={{ width: '100%', background: '#09090b', color: '#fff', border: '1px solid #27272a', borderRadius: 4, padding: '6px 10px', marginTop: 4, fontSize: 12 }}
              >
                <option value={300}>Print HD Quality (300 DPI)</option>
                <option value={150}>Standard Quality (150 DPI)</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24, borderTop: '1px solid #27272a', paddingTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => setPdfModalOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-accent" style={{ background: '#2563eb', color: '#fff', fontWeight: 600 }} onClick={executePDFExport}>
                Download PDF Document (.pdf)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ❓ Interactive Tutorial Onboarding Walkthrough Info Card Overlay */}
      {tutorialActive && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.70)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 20 }}>
          <div
            style={{
              background: '#18181b',
              border: '2px solid #eab308',
              borderRadius: 12,
              padding: 24,
              maxWidth: 540,
              width: '100%',
              color: '#e4e4e7',
              boxShadow: '0 20px 50px rgba(0,0,0,0.9), 0 0 25px rgba(234, 179, 8, 0.3)',
              position: 'relative'
            }}
          >
            {/* Header Badge & Close Button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ background: '#eab308', color: '#000000', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {TUTORIAL_STEPS[tutorialStep].badge}
              </span>
              <button
                onClick={() => setTutorialActive(false)}
                style={{ background: '#27272a', border: '1px solid #3f3f46', color: '#a1a1aa', borderRadius: 4, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14 }}
                title="Skip & Close Tutorial"
              >
                ✕
              </button>
            </div>

            {/* Title */}
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
              {TUTORIAL_STEPS[tutorialStep].title}
            </h2>

            {/* Description */}
            <p style={{ fontSize: 13, color: '#d4d4d8', lineHeight: 1.6, marginBottom: 16 }}>
              {TUTORIAL_STEPS[tutorialStep].description}
            </p>

            {/* Bullet Details Container */}
            <div style={{ background: '#09090b', border: '1px solid #27272a', borderRadius: 8, padding: 14, marginBottom: 22 }}>
              {TUTORIAL_STEPS[tutorialStep].details.map((detail, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 10, fontSize: 12, color: '#a1a1aa', marginBottom: idx === TUTORIAL_STEPS[tutorialStep].details.length - 1 ? 0 : 10, lineHeight: 1.5 }}>
                  <span style={{ color: '#eab308', fontWeight: 700 }}>▸</span>
                  <span>{detail}</span>
                </div>
              ))}
            </div>

            {/* Navigation Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #27272a', paddingTop: 16 }}>
              <button
                className="btn btn-ghost"
                style={{ color: '#a1a1aa', fontSize: 12 }}
                onClick={() => setTutorialActive(false)}
              >
                Skip / Cancel
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                {tutorialStep > 0 && (
                  <button
                    className="btn btn-ghost"
                    style={{ background: '#27272a', color: '#fff', fontSize: 12 }}
                    onClick={() => setTutorialStep(prev => prev - 1)}
                  >
                    ← Back
                  </button>
                )}

                {tutorialStep < TUTORIAL_STEPS.length - 1 ? (
                  <button
                    className="btn btn-accent"
                    style={{ background: '#eab308', color: '#000000', fontWeight: 700, fontSize: 12 }}
                    onClick={() => setTutorialStep(prev => prev + 1)}
                  >
                    Next ({tutorialStep + 1}/{TUTORIAL_STEPS.length}) →
                  </button>
                ) : (
                  <button
                    className="btn btn-accent"
                    style={{ background: '#10b981', color: '#ffffff', fontWeight: 700, fontSize: 12 }}
                    onClick={() => setTutorialActive(false)}
                  >
                    ✓ Finish Tutorial
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
