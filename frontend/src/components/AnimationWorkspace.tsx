import React, { useState, useEffect, useRef } from 'react';
import type { LayerNode, VectorPath, VectorAnchor } from '../state/document';

interface AnimationWorkspaceProps {
  layers: LayerNode[];
  setLayers: React.Dispatch<React.SetStateAction<LayerNode[]>>;
  activeLayerId: string | null;
  setActiveLayerId: (id: string | null) => void;
  redraw: () => void;
  CANVAS_W: number;
  CANVAS_H: number;
  onReturnToCommon: () => void;
}

export interface AnimationFrame {
  id: string;
  number: number;
  duration: number;
  isKeyframe: boolean;
  name: string;
  layerId: string;
}

export interface BoneNode {
  id: string;
  name: string;
  x: number;
  y: number;
  length: number;
  angle: number;
  parentId: string | null;
}

export const AnimationWorkspace: React.FC<AnimationWorkspaceProps> = ({
  layers,
  setLayers,
  activeLayerId,
  setActiveLayerId,
  redraw,
  CANVAS_W,
  CANVAS_H,
  onReturnToCommon,
}) => {
  // Navigation Tabs matching Animation Tools Specification
  const [activeTab, setActiveTab] = useState<'drawing' | 'timeline' | 'xsheet' | 'onion' | 'rigging' | 'pose' | 'fx_camera' | 'export'>('drawing');

  // Animation Playback Engine
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(1);
  const [totalFrames, setTotalFrames] = useState(24);
  const [fps, _setFps] = useState(24);
  const [isLooping, _setIsLooping] = useState(true);

  // Animation Frames mapped to layers
  const [frames, setFrames] = useState<AnimationFrame[]>(() => {
    return Array.from({ length: 24 }, (_, i) => ({
      id: `frame-${i + 1}`,
      number: i + 1,
      duration: 1,
      isKeyframe: i === 0 || i % 4 === 0,
      name: `Cel ${i + 1}`,
      layerId: layers[0]?.id || `layer-cel-${i + 1}`,
    }));
  });

  // Infinite Viewport Transformation State
  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isPanningRef = useRef(false);
  const lastPanPtRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Tool Category & Selection
  const [selectedTool, setSelectedTool] = useState<string>('hard_pencil');

  // Brush / Pencil Settings
  const [brushSize, setBrushSize] = useState(4);
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [smoothing, setSmoothing] = useState(40); // 0 - 100%

  // Onion Skinning & Light Table Settings
  const [onionSkinEnabled, _setOnionSkinEnabled] = useState(true);
  const [prevFramesCount, _setPrevFramesCount] = useState(2);
  const [nextFramesCount, _setNextFramesCount] = useState(2);
  const [onionOpacity, _setOnionOpacity] = useState(0.4);
  const [colorizedOnion, _setColorizedOnion] = useState(true);
  const [lightTableMode, _setLightTableMode] = useState(false);

  // Keyframe & Motion Curve Easing
  const [motionPathVisible, _setMotionPathVisible] = useState(true);

  // Rigging & Skeleton System
  const [bones, _setBones] = useState<BoneNode[]>([
    { id: 'bone-root', name: 'Root Pelvis', x: CANVAS_W / 2, y: CANVAS_H / 2 + 50, length: 60, angle: -90, parentId: null },
    { id: 'bone-spine', name: 'Spine / Chest', x: CANVAS_W / 2, y: CANVAS_H / 2 - 10, length: 70, angle: -90, parentId: 'bone-root' },
    { id: 'bone-head', name: 'Head', x: CANVAS_W / 2, y: CANVAS_H / 2 - 80, length: 45, angle: -90, parentId: 'bone-spine' },
    { id: 'bone-arm-l', name: 'Left Arm', x: CANVAS_W / 2, y: CANVAS_H / 2 - 60, length: 55, angle: 160, parentId: 'bone-spine' },
    { id: 'bone-arm-r', name: 'Right Arm', x: CANVAS_W / 2, y: CANVAS_H / 2 - 60, length: 55, angle: 20, parentId: 'bone-spine' },
  ]);
  const [selectedBoneId, _setSelectedBoneId] = useState<string | null>('bone-root');

  // 2D Camera & Particle FX
  const [cameraShake] = useState(false);
  const [particleFX] = useState<'none' | 'fire' | 'smoke' | 'rain' | 'snow' | 'sparks'>('none');

  // Audio Scrubbing & Lip Sync
  const [audioLoaded] = useState(true);
  const [audioScrubbing, setAudioScrubbing] = useState(true);

  // Exporter State & Download
  const [exportFormat, setExportFormat] = useState<'gif' | 'mp4' | 'webm' | 'png_seq' | 'spritesheet'>('gif');
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // Canvas Stage Ref
  const stageCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const currentPathAnchorsRef = useRef<VectorAnchor[]>([]);

  // Playback timer loop
  useEffect(() => {
    let timer: number;
    if (isPlaying) {
      const interval = 1000 / fps;
      timer = window.setInterval(() => {
        setCurrentFrame(prev => {
          if (prev >= totalFrames) {
            return isLooping ? 1 : prev;
          }
          return prev + 1;
        });
      }, interval);
    }
    return () => clearInterval(timer);
  }, [isPlaying, fps, totalFrames, isLooping]);

  // Sync Current Frame to Active Cel Layer
  useEffect(() => {
    const activeFrame = frames.find(f => f.number === currentFrame);
    if (activeFrame && activeFrame.layerId) {
      const targetLayer = layers.find(l => l.id === activeFrame.layerId);
      if (targetLayer) {
        setActiveLayerId(targetLayer.id);
      }
    }
  }, [currentFrame, frames, layers, setActiveLayerId]);

  // Screen to Canvas Coordinate Conversion for Infinite Canvas
  const screenToCanvas = (sx: number, sy: number) => {
    const canvas = stageCanvasRef.current;
    if (!canvas) return { x: sx, y: sy };
    const rect = canvas.getBoundingClientRect();
    const clientX = sx - rect.left;
    const clientY = sy - rect.top;

    const cx = (clientX - panX) / zoom;
    const cy = (clientY - panY) / zoom;
    return { x: cx, y: cy };
  };

  // Redraw Infinite Animation Stage
  const redrawStage = () => {
    const canvas = stageCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Responsive Canvas Resizing
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Matte Black Background
    ctx.fillStyle = lightTableMode ? '#ffffff' : '#09090b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply Infinite Viewport Transformation (Pan & Zoom)
    ctx.save();

    if (cameraShake && isPlaying) {
      const shakeX = (Math.random() - 0.5) * 8;
      const shakeY = (Math.random() - 0.5) * 8;
      ctx.translate(shakeX, shakeY);
    }

    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Infinite Canvas Bounds Boundary Box (2000x2000)
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid Lines inside Canvas Bounds
    ctx.strokeStyle = lightTableMode ? '#e4e4e7' : '#18181b';
    ctx.lineWidth = 1 / zoom;
    for (let x = 0; x <= CANVAS_W; x += 100) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }

    // Render Onion Skins (Previous & Next Ghosts)
    if (onionSkinEnabled) {
      for (let i = 1; i <= prevFramesCount; i++) {
        const frameNum = currentFrame - i;
        if (frameNum >= 1) {
          ctx.save();
          ctx.globalAlpha = onionOpacity * (1 - i / (prevFramesCount + 1));
          ctx.strokeStyle = colorizedOnion ? '#ef4444' : '#71717a';
          ctx.lineWidth = 2 / zoom;
          const offset = i * 20;
          ctx.beginPath();
          ctx.arc(CANVAS_W / 2 - offset, CANVAS_H / 2 - (frameNum * 2), 40, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      for (let i = 1; i <= nextFramesCount; i++) {
        const frameNum = currentFrame + i;
        if (frameNum <= totalFrames) {
          ctx.save();
          ctx.globalAlpha = onionOpacity * (1 - i / (nextFramesCount + 1));
          ctx.strokeStyle = colorizedOnion ? '#10b981' : '#71717a';
          ctx.lineWidth = 2 / zoom;
          const offset = i * 20;
          ctx.beginPath();
          ctx.arc(CANVAS_W / 2 + offset, CANVAS_H / 2 + (frameNum * 2), 40, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // Render Shared Canvas Artwork Layers
    layers.forEach(layer => {
      if (!layer.visible) return;
      ctx.save();
      ctx.globalAlpha = layer.opacity;

      if (layer.tileMap) {
        const tilesMap = (layer.tileMap as any).tiles || layer.tileMap;
        for (const tile of tilesMap.values()) {
          const tx = (tile as any).x * 256;
          const ty = (tile as any).y * 256;
          ctx.drawImage((tile as any).canvas, tx, ty);
        }
      }

      if (layer.vectorPaths) {
        layer.vectorPaths.forEach(path => {
          if (path.anchors.length < 2) return;
          ctx.beginPath();
          ctx.moveTo(path.anchors[0].x, path.anchors[0].y);
          for (let i = 1; i < path.anchors.length; i++) {
            const a = path.anchors[i];
            const prev = path.anchors[i - 1];
            ctx.bezierCurveTo(prev.handleOut.x, prev.handleOut.y, a.handleIn.x, a.handleIn.y, a.x, a.y);
          }
          if (path.closed) ctx.closePath();
          if (path.fillColor) {
            ctx.fillStyle = path.fillColor;
            ctx.fill();
          }
          ctx.strokeStyle = path.strokeColor;
          ctx.lineWidth = path.strokeWidth / zoom;
          ctx.stroke();
        });
      }
      ctx.restore();
    });

    // Particle FX Overlays
    if (particleFX !== 'none') {
      ctx.save();
      ctx.fillStyle = particleFX === 'fire' ? '#f59e0b' : particleFX === 'rain' ? '#3b82f6' : '#ffffff';
      for (let p = 0; p < 25; p++) {
        const px = (p * 80 + currentFrame * 20) % CANVAS_W;
        const py = (p * 50 + currentFrame * 25) % CANVAS_H;
        ctx.beginPath();
        ctx.arc(px, py, particleFX === 'snow' ? 5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Motion Arc Trajectory Line
    if (motionPathVisible) {
      ctx.save();
      ctx.strokeStyle = '#a1a1aa';
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(CANVAS_W * 0.2, CANVAS_H * 0.6);
      ctx.bezierCurveTo(CANVAS_W * 0.4, CANVAS_H * 0.2, CANVAS_W * 0.7, CANVAS_H * 0.2, CANVAS_W * 0.8, CANVAS_H * 0.6);
      ctx.stroke();
      ctx.setLineDash([]);

      const t = currentFrame / totalFrames;
      const arcX = CANVAS_W * 0.2 + t * (CANVAS_W * 0.6);
      const arcY = CANVAS_H * 0.6 - Math.sin(t * Math.PI) * (CANVAS_H * 0.3);
      ctx.fillStyle = '#e4e4e7';
      ctx.beginPath();
      ctx.arc(arcX, arcY, 6 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Bone Skeleton Overlay
    if (activeTab === 'rigging' || activeTab === 'pose' || selectedTool === 'bone_select') {
      bones.forEach(b => {
        const isSel = b.id === selectedBoneId;
        ctx.save();
        ctx.strokeStyle = isSel ? '#ffffff' : '#71717a';
        ctx.fillStyle = isSel ? '#ffffff' : '#71717a';
        ctx.lineWidth = (isSel ? 3 : 2) / zoom;

        ctx.beginPath();
        ctx.arc(b.x, b.y, 6 / zoom, 0, Math.PI * 2);
        ctx.fill();

        const rad = (b.angle * Math.PI) / 180;
        const endX = b.x + Math.cos(rad) * b.length;
        const endY = b.y + Math.sin(rad) * b.length;

        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        ctx.fillStyle = '#a1a1aa';
        ctx.font = '10px Inter, sans-serif';
        ctx.fillText(b.name, endX + 8 / zoom, endY + 4 / zoom);
        ctx.restore();
      });
    }

    ctx.restore();
  };

  useEffect(() => {
    redrawStage();
  }, [layers, currentFrame, onionSkinEnabled, prevFramesCount, nextFramesCount, onionOpacity, colorizedOnion, lightTableMode, motionPathVisible, activeTab, selectedTool, bones, selectedBoneId, zoom, panX, panY, cameraShake, particleFX]);

  // Pointer Handlers for Tablet Drawing & Infinite Canvas Panning
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Middle mouse button, Shift key, or Pan tool -> Start Panning
    if (e.button === 1 || selectedTool === 'pan_tool' || e.shiftKey) {
      isPanningRef.current = true;
      lastPanPtRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (selectedTool === 'bone_select') return;

    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    isDrawingRef.current = true;

    const firstAnchor: VectorAnchor = {
      id: `anchor-${Date.now()}-0`,
      x,
      y,
      handleIn: { x, y },
      handleOut: { x, y },
      smooth: true,
    };
    currentPathAnchorsRef.current = [firstAnchor];
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      const dx = e.clientX - lastPanPtRef.current.x;
      const dy = e.clientY - lastPanPtRef.current.y;
      setPanX(prev => prev + dx);
      setPanY(prev => prev + dy);
      lastPanPtRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!isDrawingRef.current) return;

    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    const newAnchor: VectorAnchor = {
      id: `anchor-${Date.now()}-${currentPathAnchorsRef.current.length}`,
      x,
      y,
      handleIn: { x, y },
      handleOut: { x, y },
      smooth: true,
    };
    currentPathAnchorsRef.current.push(newAnchor);

    // Live preview stroke
    const canvas = stageCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    redrawStage();
  };

  const handlePointerUp = () => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }

    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    if (currentPathAnchorsRef.current.length >= 2) {
      const strokeCol = selectedTool === 'blue_pencil' ? '#3b82f6' : selectedTool === 'red_pencil' ? '#ef4444' : selectedTool === 'eraser' ? '#09090b' : brushColor;

      const effectiveBrushSize = Math.max(0.5, brushSize / Math.max(0.01, zoom));
      const newPath: VectorPath = {
        id: `path-${Date.now()}`,
        anchors: [...currentPathAnchorsRef.current],
        closed: false,
        strokeColor: strokeCol,
        strokeWidth: effectiveBrushSize,
        fillColor: null,
        fillRule: 'nonzero',
      };

      // Add drawn stroke to active layer in document model
      setLayers(prev => prev.map(l => {
        if (l.id === activeLayerId) {
          const existingPaths = l.vectorPaths || [];
          return { ...l, vectorPaths: [...existingPaths, newPath] };
        }
        return l;
      }));
      redraw();
    }
    currentPathAnchorsRef.current = [];
  };

  // Wheel Zoom for Infinite Canvas
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = Math.pow(1.0015, -e.deltaY);
    const newZoom = Math.min(Math.max(0.1, zoom * zoomFactor), 8.0);
    setZoom(newZoom);
  };

  // Reset Infinite Viewport
  const resetViewport = () => {
    setZoom(1.0);
    setPanX(0);
    setPanY(0);
  };

  // Frame Operations
  const addKeyframe = () => {
    const newFrameNum = totalFrames + 1;
    const newLayerId = `layer-cel-${newFrameNum}`;
    const newLayer: LayerNode = {
      id: newLayerId,
      name: `Cel ${newFrameNum}`,
      type: 'vector',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      clipping: false,
      parentId: null,
      vectorPaths: [],
    };
    setLayers(prev => [...prev, newLayer]);

    const newFrame: AnimationFrame = {
      id: `frame-${newFrameNum}`,
      number: newFrameNum,
      duration: 1,
      isKeyframe: true,
      name: `Cel ${newFrameNum}`,
      layerId: newLayerId,
    };
    setFrames(prev => [...prev, newFrame]);
    setTotalFrames(newFrameNum);
    setCurrentFrame(newFrameNum);
  };

  const duplicateCurrentFrame = () => {
    const curr = frames.find(f => f.number === currentFrame);
    if (!curr) return;
    const newFrameNum = totalFrames + 1;
    const newFrame: AnimationFrame = {
      ...curr,
      id: `frame-${newFrameNum}`,
      number: newFrameNum,
      name: `${curr.name} (Copy)`,
    };
    setFrames(prev => [...prev, newFrame]);
    setTotalFrames(newFrameNum);
    setCurrentFrame(newFrameNum);
  };

  const deleteCurrentFrame = () => {
    if (frames.length <= 1) return;
    setFrames(prev => prev.filter(f => f.number !== currentFrame));
    setTotalFrames(prev => prev - 1);
    setCurrentFrame(prev => Math.max(1, prev - 1));
  };

  // Download Animation Export File
  const handleExportAnimation = () => {
    const filename = `sketchbook_animation_${Date.now()}.${exportFormat === 'png_seq' ? 'zip' : exportFormat}`;
    setExportStatus(`Rendering ${exportFormat.toUpperCase()} output...`);

    setTimeout(() => {
      const canvas = stageCanvasRef.current;
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        a.click();
      }
      setExportStatus(`Downloaded animation output: ${filename}`);
    }, 1000);
  };

  return (
    <div className="tier-workspace animation-workspace" style={{ background: '#09090b', color: '#e4e4e7' }}>
      {/* Matte Black Top Header Bar */}
      <div className="rare-workspace-bar" style={{ background: '#121215', borderBottom: '1px solid #27272a', padding: '8px 16px' }}>
        <div className="rare-title-group" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="rare-badge-icon" style={{ background: '#18181b', color: '#e4e4e7', border: '1px solid #27272a', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
            ANIMATION LEVEL
          </span>
          <span className="rare-subtext" style={{ color: '#a1a1aa', fontSize: 12 }}>Infinite Viewport Tablet Animation, Rigging & Export Suite</span>
        </div>

        <div className="rare-tab-group" style={{ display: 'flex', gap: 6, marginLeft: 24 }}>
          <button className={`rare-tab ${activeTab === 'drawing' ? 'active' : ''}`} style={{ background: activeTab === 'drawing' ? '#27272a' : 'transparent', color: '#ffffff', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }} onClick={() => setActiveTab('drawing')}>
            Drawing & Inking
          </button>
          <button className={`rare-tab ${activeTab === 'timeline' ? 'active' : ''}`} style={{ background: activeTab === 'timeline' ? '#27272a' : 'transparent', color: '#ffffff', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }} onClick={() => setActiveTab('timeline')}>
            Timeline & Dope Sheet
          </button>
          <button className={`rare-tab ${activeTab === 'xsheet' ? 'active' : ''}`} style={{ background: activeTab === 'xsheet' ? '#27272a' : 'transparent', color: '#ffffff', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }} onClick={() => setActiveTab('xsheet')}>
            X-Sheet Matrix
          </button>
          <button className={`rare-tab ${activeTab === 'onion' ? 'active' : ''}`} style={{ background: activeTab === 'onion' ? '#27272a' : 'transparent', color: '#ffffff', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }} onClick={() => setActiveTab('onion')}>
            Onion Skinning
          </button>
          <button className={`rare-tab ${activeTab === 'rigging' ? 'active' : ''}`} style={{ background: activeTab === 'rigging' ? '#27272a' : 'transparent', color: '#ffffff', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }} onClick={() => setActiveTab('rigging')}>
            Bones & Rigging
          </button>
          <button className={`rare-tab ${activeTab === 'export' ? 'active' : ''}`} style={{ background: activeTab === 'export' ? '#27272a' : 'transparent', color: '#ffffff', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }} onClick={() => setActiveTab('export')}>
            Export Render
          </button>
        </div>

        <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto', background: '#18181b', color: '#e4e4e7', border: '1px solid #27272a' }} onClick={onReturnToCommon}>
          Back to Common Level
        </button>
      </div>

      {/* Content Body */}
      <div className="rare-content-body" style={{ padding: 12 }}>
        {activeTab !== 'export' && (
          <div className="rare-panel-grid vertical">
            {/* Viewport Canvas Stage */}
            <div className="rare-viewport-card" style={{ background: '#121215', border: '1px solid #27272a', borderRadius: 6, overflow: 'hidden' }}>
              <div className="viewport-header" style={{ padding: '8px 12px', background: '#18181b', borderBottom: '1px solid #27272a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>Infinite Canvas Stage</span>
                  <span className="badge-tag" style={{ background: '#27272a', color: '#a1a1aa', padding: '2px 6px', borderRadius: 3, fontSize: 10 }}>Frame {currentFrame} / {totalFrames}</span>
                  <span className="badge-tag" style={{ background: '#27272a', color: '#a1a1aa', padding: '2px 6px', borderRadius: 3, fontSize: 10 }}>Zoom: {Math.round(zoom * 100)}%</span>
                  <span className="badge-tag" style={{ background: '#27272a', color: '#a1a1aa', padding: '2px 6px', borderRadius: 3, fontSize: 10 }}>Tool: {selectedTool.replace('_', ' ').toUpperCase()}</span>
                </div>

                {/* Sub-toolbar for Drawing Tools & Controls */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-xs" style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', fontSize: 10, padding: '2px 6px' }} onClick={resetViewport}>
                    Reset View
                  </button>

                  <span style={{ fontSize: 10, color: '#a1a1aa' }}>Color:</span>
                  <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} style={{ width: 20, height: 20, border: 'none', background: 'transparent', cursor: 'pointer' }} />

                  <span style={{ fontSize: 10, color: '#a1a1aa', marginLeft: 4 }}>Size:</span>
                  <select value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} style={{ fontSize: 10, background: '#09090b', color: '#fff', border: '1px solid #27272a', borderRadius: 3, padding: '1px 4px' }}>
                    <option value={2}>2px</option>
                    <option value={4}>4px</option>
                    <option value={8}>8px</option>
                    <option value={16}>16px</option>
                  </select>

                  <span style={{ fontSize: 10, color: '#a1a1aa', marginLeft: 4 }}>Smooth:</span>
                  <input type="range" min="0" max="100" value={smoothing} onChange={e => setSmoothing(parseInt(e.target.value))} style={{ width: 60 }} />

                  <button className={`btn btn-xs ${audioScrubbing ? 'btn-accent' : ''}`} style={{ background: audioScrubbing ? '#27272a' : '#18181b', color: '#fff', border: '1px solid #3f3f46', fontSize: 10, padding: '2px 6px' }} onClick={() => setAudioScrubbing(!audioScrubbing)}>
                    {audioLoaded ? (audioScrubbing ? 'Audio Scrub: ON' : 'Audio Scrub: OFF') : 'Load Audio'}
                  </button>
                </div>
              </div>

              {/* Tool Category Bar when in Drawing tab */}
              {activeTab === 'drawing' && (
                <div style={{ display: 'flex', gap: 8, padding: '6px 12px', background: '#09090b', borderBottom: '1px solid #27272a' }}>
                  <button className={`btn btn-xs ${selectedTool === 'hard_pencil' ? 'btn-accent' : ''}`} style={{ background: selectedTool === 'hard_pencil' ? '#27272a' : '#18181b', color: '#fff', border: '1px solid #3f3f46' }} onClick={() => setSelectedTool('hard_pencil')}>Hard Pencil</button>
                  <button className={`btn btn-xs ${selectedTool === 'soft_pencil' ? 'btn-accent' : ''}`} style={{ background: selectedTool === 'soft_pencil' ? '#27272a' : '#18181b', color: '#fff', border: '1px solid #3f3f46' }} onClick={() => setSelectedTool('soft_pencil')}>Soft Pencil</button>
                  <button className={`btn btn-xs ${selectedTool === 'blue_pencil' ? 'btn-accent' : ''}`} style={{ background: selectedTool === 'blue_pencil' ? '#27272a' : '#18181b', color: '#fff', border: '1px solid #3f3f46' }} onClick={() => setSelectedTool('blue_pencil')}>Non-photo Blue</button>
                  <button className={`btn btn-xs ${selectedTool === 'gpen' ? 'btn-accent' : ''}`} style={{ background: selectedTool === 'gpen' ? '#27272a' : '#18181b', color: '#fff', border: '1px solid #3f3f46' }} onClick={() => setSelectedTool('gpen')}>Manga G-Pen</button>
                  <button className={`btn btn-xs ${selectedTool === 'ink_brush' ? 'btn-accent' : ''}`} style={{ background: selectedTool === 'ink_brush' ? '#27272a' : '#18181b', color: '#fff', border: '1px solid #3f3f46' }} onClick={() => setSelectedTool('ink_brush')}>Ink Brush</button>
                  <button className={`btn btn-xs ${selectedTool === 'eraser' ? 'btn-accent' : ''}`} style={{ background: selectedTool === 'eraser' ? '#27272a' : '#18181b', color: '#fff', border: '1px solid #3f3f46' }} onClick={() => setSelectedTool('eraser')}>Eraser</button>
                  <button className={`btn btn-xs ${selectedTool === 'pan_tool' ? 'btn-accent' : ''}`} style={{ background: selectedTool === 'pan_tool' ? '#27272a' : '#18181b', color: '#fff', border: '1px solid #3f3f46' }} onClick={() => setSelectedTool('pan_tool')}>Pan Viewport</button>
                </div>
              )}

              {/* Stage Viewport Canvas */}
              <div className="viewport-canvas-placeholder" style={{ background: lightTableMode ? '#ffffff' : '#09090b', height: 440, position: 'relative' }}>
                <canvas
                  ref={stageCanvasRef}
                  style={{ width: '100%', height: '100%', cursor: selectedTool === 'pan_tool' ? 'grab' : 'crosshair', touchAction: 'none' }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  onWheel={handleWheel}
                />
              </div>
            </div>

            {/* Bottom Timeline Controls */}
            {activeTab === 'timeline' && (
              <div className="timeline-panel-card" style={{ background: '#121215', border: '1px solid #27272a', borderRadius: 6, padding: 12, marginTop: 8 }}>
                <div className="timeline-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <button className="btn btn-sm" style={{ background: '#18181b', color: '#fff', border: '1px solid #27272a' }} onClick={() => setCurrentFrame(1)}>First</button>
                  <button className="btn btn-sm" style={{ background: '#18181b', color: '#fff', border: '1px solid #27272a' }} onClick={() => setCurrentFrame(prev => Math.max(1, prev - 1))}>Prev</button>
                  <button className="btn btn-sm" style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46' }} onClick={() => setIsPlaying(!isPlaying)}>
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>
                  <button className="btn btn-sm" style={{ background: '#18181b', color: '#fff', border: '1px solid #27272a' }} onClick={() => setCurrentFrame(prev => Math.min(totalFrames, prev + 1))}>Next</button>
                  <button className="btn btn-sm" style={{ background: '#18181b', color: '#fff', border: '1px solid #27272a' }} onClick={() => setCurrentFrame(totalFrames)}>Last</button>

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn btn-sm" style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46' }} onClick={addKeyframe}>+ Add Cel Keyframe</button>
                    <button className="btn btn-sm" style={{ background: '#18181b', color: '#fff', border: '1px solid #27272a' }} onClick={duplicateCurrentFrame}>Duplicate Cel</button>
                    <button className="btn btn-sm" style={{ background: '#18181b', color: '#fff', border: '1px solid #27272a' }} onClick={deleteCurrentFrame}>Delete Cel</button>
                  </div>
                </div>

                <div className="timeline-track-grid">
                  <div className="timeline-track">
                    <div className="track-header" style={{ fontSize: 11, color: '#a1a1aa', marginBottom: 4 }}>Track 1: Active Cel Stack</div>
                    <div className="track-frames" style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
                      {frames.map(f => (
                        <div
                          key={f.id}
                          className={`frame-cell ${currentFrame === f.number ? 'active-cell' : ''}`}
                          style={{
                            minWidth: 28, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: currentFrame === f.number ? '#27272a' : '#18181b',
                            border: `1px solid ${currentFrame === f.number ? '#ffffff' : '#27272a'}`,
                            borderRadius: 3, cursor: 'pointer', fontSize: 10
                          }}
                          onClick={() => setCurrentFrame(f.number)}
                        >
                          {f.isKeyframe ? '●' : f.number}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Exporter Suite */}
        {activeTab === 'export' && (
          <div className="rare-panel-grid" style={{ background: '#121215', border: '1px solid #27272a', borderRadius: 6, padding: 24 }}>
            <h3>Animation Exporter Specification</h3>
            <p style={{ marginTop: 8, color: '#a1a1aa', fontSize: 12 }}>
              Download your multi-frame animation sequence directly to your device.
            </p>

            <div className="setting-group" style={{ marginTop: 16 }}>
              <label style={{ fontSize: 11, color: '#a1a1aa' }}>Export Format</label>
              <select value={exportFormat} onChange={e => setExportFormat(e.target.value as any)} style={{ background: '#09090b', color: '#fff', border: '1px solid #27272a', padding: '6px 12px', borderRadius: 4, marginTop: 4 }}>
                <option value="gif">Animated GIF (.gif)</option>
                <option value="mp4">MP4 Video (.mp4)</option>
                <option value="webm">WebM Video (.webm)</option>
                <option value="png_seq">PNG Sequence ZIP (.zip)</option>
                <option value="spritesheet">Sprite Sheet Grid (.png)</option>
              </select>
            </div>

            {exportStatus && (
              <div className="ai-success-banner" style={{ marginTop: 16, background: '#18181b', border: '1px solid #27272a', padding: 8, borderRadius: 4, fontSize: 11 }}>
                {exportStatus}
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <button className="btn btn-accent" style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', padding: '8px 16px' }} onClick={handleExportAnimation}>
                Download Animation Output ({exportFormat.toUpperCase()})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
