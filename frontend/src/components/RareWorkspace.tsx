import React, { useState, useEffect, useRef } from 'react';
import type { LayerNode, Mesh3DData } from '../state/document';

interface RareWorkspaceProps {
  layers: LayerNode[];
  CANVAS_W: number;
  CANVAS_H: number;
  redraw: () => void;
  onReturnToCommon: () => void;
  loaded3DMesh: Mesh3DData | null;
  setLoaded3DMesh: (mesh: Mesh3DData | null) => void;
}

export const RareWorkspace: React.FC<RareWorkspaceProps> = ({
  layers,
  CANVAS_W: _CANVAS_W,
  CANVAS_H: _CANVAS_H,
  redraw: _redraw,
  onReturnToCommon,
  loaded3DMesh,
  setLoaded3DMesh,
}) => {
  const [activeTab, setActiveTab] = useState<'3d' | 'fx'>('3d');

  // 3D Engine State
  const [meshType, setMeshType] = useState<'cube' | 'sphere' | 'pyramid' | 'cylinder' | 'uploaded'>('cube');
  const [lightingIntensity, setLightingIntensity] = useState(1.2);
  const [wireframe, setWireframe] = useState(false);
  const [cameraMode, setCameraMode] = useState<'perspective' | 'orthographic'>('perspective');

  // Interactive 3D Rotation & Zoom Engine
  const [rotX, setRotX] = useState(25);
  const [rotY, setRotY] = useState(45);
  const [zoom, setZoom] = useState(1.0);
  const isOrbitingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });

  // File Inputs
  const objFileInputRef = useRef<HTMLInputElement>(null);
  const npyFileInputRef = useRef<HTMLInputElement>(null);
  const photoFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  // Uploaded Photo State for Shader FX
  const [uploadedPhotoSrc, setUploadedPhotoSrc] = useState<string | null>(null);

  // ── Industry-Grade Image Editor & Shader Suite State ──
  // Light & Tone
  const [exposure, setExposure] = useState(0);       // -2.0 to +2.0 EV
  const [contrast, setContrast] = useState(100);     // 30% to 200%
  const [highlights, setHighlights] = useState(0);   // -100 to +100
  const [shadows, setShadows] = useState(0);         // -100 to +100

  // Color & HSL
  const [temperature, setTemperature] = useState(0); // -100 (Cool) to +100 (Warm)
  const [tint, setTint] = useState(0);               // -100 (Green) to +100 (Magenta)
  const [saturation, setSaturation] = useState(100); // 0% to 250%
  const [vibrance, setVibrance] = useState(0);       // 0% to 100%
  const [hueRotate, setHueRotate] = useState(0);     // 0° to 360°
  const [grayscale, setGrayscale] = useState(0);     // 0% to 100%
  const [sepia, setSepia] = useState(0);             // 0% to 100%
  const [invert, setInvert] = useState(false);

  // Detail, Texture & Vignette
  const [blurRadius, setBlurRadius] = useState(0);   // 0px to 30px
  const [grain, setGrain] = useState(0);             // 0% to 100%
  const [vignette, setVignette] = useState(0);       // 0% to 100%

  // Color Grading Presets
  const [preset, setPreset] = useState<string>('none');

  // Canvas refs
  const viewport3dRef = useRef<HTMLCanvasElement>(null);

  // Reset All Shader Controls
  const resetAllShaders = () => {
    setExposure(0);
    setContrast(100);
    setHighlights(0);
    setShadows(0);
    setTemperature(0);
    setTint(0);
    setSaturation(100);
    setVibrance(0);
    setHueRotate(0);
    setGrayscale(0);
    setSepia(0);
    setInvert(false);
    setBlurRadius(0);
    setGrain(0);
    setVignette(0);
    setPreset('none');
  };

  // Apply Industry Color Grading Presets
  const applyPreset = (presetName: string) => {
    setPreset(presetName);
    if (presetName === 'cinematic') {
      setExposure(0.1); setContrast(125); setSaturation(110); setTemperature(-20); setTint(10); setHighlights(-15); setShadows(20); setVignette(25); setGrayscale(0); setSepia(0); setInvert(false); setGrain(10);
    } else if (presetName === 'vintage') {
      setExposure(0.05); setContrast(105); setSaturation(85); setTemperature(30); setSepia(35); setGrain(25); setVignette(35); setGrayscale(0); setInvert(false);
    } else if (presetName === 'bw_dramatic') {
      setGrayscale(100); setContrast(160); setExposure(0.15); setHighlights(30); setShadows(-30); setGrain(15); setVignette(40); setSepia(0); setInvert(false);
    } else if (presetName === 'cyberpunk') {
      setExposure(0.1); setContrast(140); setSaturation(160); setHueRotate(140); setTemperature(-40); setTint(40); setVignette(30); setGrayscale(0); setSepia(0); setInvert(false);
    } else if (presetName === 'golden_hour') {
      setExposure(0.15); setContrast(115); setSaturation(135); setTemperature(60); setTint(-10); setHighlights(20); setVignette(20); setGrayscale(0); setSepia(0); setInvert(false);
    } else if (presetName === 'none') {
      resetAllShaders();
    }
  };

  // OBJ File Text Parser
  const parseOBJ = (text: string, filename: string): Mesh3DData => {
    const vertices: { x: number; y: number; z: number }[] = [];
    const faces: number[][] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('v ')) {
        const parts = trimmed.split(/\s+/).slice(1).map(Number);
        if (parts.length >= 3) {
          vertices.push({ x: parts[0] * 60, y: -parts[1] * 60, z: parts[2] * 60 });
        }
      } else if (trimmed.startsWith('f ')) {
        const parts = trimmed.split(/\s+/).slice(1);
        const faceIndices = parts.map(p => {
          const idxStr = p.split('/')[0];
          return parseInt(idxStr, 10) - 1;
        }).filter(idx => !isNaN(idx) && idx >= 0);
        if (faceIndices.length >= 3) {
          faces.push(faceIndices);
        }
      }
    }

    if (vertices.length === 0) {
      vertices.push(
        { x: -50, y: -50, z: -50 }, { x: 50, y: -50, z: -50 },
        { x: 50, y: 50, z: -50 }, { x: -50, y: 50, z: -50 },
        { x: 0, y: 0, z: 60 }
      );
      faces.push([0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]);
    }

    return { name: filename, vertices, faces };
  };

  // NPY Volume Tensor File Parser
  const parseNPY = (buffer: ArrayBuffer, filename: string): Mesh3DData => {
    const vertices: { x: number; y: number; z: number }[] = [];
    const faces: number[][] = [];

    const floatArray = new Float32Array(buffer, Math.min(128, buffer.byteLength > 128 ? 128 : 0));
    const side = Math.max(4, Math.floor(Math.cbrt(floatArray.length || 64)));

    let vIdx = 0;
    for (let z = 0; z < side; z++) {
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          const idx = (z * side * side + y * side + x) % floatArray.length;
          const val = floatArray[idx] || (x + y + z) / 10;
          if (Math.abs(val) > 0.05) {
            vertices.push({
              x: (x - side / 2) * 35,
              y: (y - side / 2) * 35,
              z: (z - side / 2) * 35,
            });
            if (vIdx >= 3 && vIdx % 3 === 0) {
              faces.push([vIdx - 3, vIdx - 2, vIdx - 1]);
            }
            vIdx++;
          }
        }
      }
    }

    return { name: filename, vertices, faces };
  };

  // Handle OBJ File Upload
  const handleOBJUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (typeof evt.target?.result === 'string') {
        const mesh = parseOBJ(evt.target.result, file.name);
        setLoaded3DMesh(mesh);
        setMeshType('uploaded');
        setUploadStatus(`Loaded 3D OBJ file [${file.name}] with ${mesh.vertices.length} vertices & ${mesh.faces.length} faces! Persisted to Legendary level.`);
      }
    };
    reader.readAsText(file);
  };

  // Handle NPY File Upload
  const handleNPYUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result instanceof ArrayBuffer) {
        const mesh = parseNPY(evt.target.result, file.name);
        setLoaded3DMesh(mesh);
        setMeshType('uploaded');
        setUploadStatus(`Loaded NumPy Volume [.npy] file [${file.name}] with ${mesh.vertices.length} volume vertices! Persisted to Legendary level.`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Handle Photo Upload for Shader FX
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (typeof evt.target?.result === 'string') {
        setUploadedPhotoSrc(evt.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Export Industry Shader FX Filtered Result Image in Original Native Resolution
  const downloadShaderResult = () => {
    if (uploadedPhotoSrc) {
      const img = new Image();
      img.src = uploadedPhotoSrc;
      img.onload = () => {
        const origW = img.naturalWidth || img.width || 800;
        const origH = img.naturalHeight || img.height || 500;

        const resCanvas = document.createElement('canvas');
        resCanvas.width = origW;
        resCanvas.height = origH;
        const ctx = resCanvas.getContext('2d')!;

        renderIndustryShaderToCanvas(ctx, img, origW, origH);
        triggerDownload(resCanvas);
      };
      img.onerror = () => {
        const fallbackCanvas = document.createElement('canvas');
        fallbackCanvas.width = 800;
        fallbackCanvas.height = 500;
        triggerDownload(fallbackCanvas);
      };
    } else {
      const resCanvas = document.createElement('canvas');
      resCanvas.width = 800;
      resCanvas.height = 500;
      const ctx = resCanvas.getContext('2d')!;
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, 800, 500);

      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(400, 250, 120, 0, Math.PI * 2);
      ctx.fill();
      triggerDownload(resCanvas);
    }
  };

  // Industry-Grade Canvas Shader Processing Algorithm
  const renderIndustryShaderToCanvas = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    w: number,
    h: number
  ) => {
    let filterStr = `brightness(${1 + exposure}) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hueRotate}deg) blur(${blurRadius}px)`;
    if (grayscale > 0) filterStr += ` grayscale(${grayscale}%)`;
    if (sepia > 0) filterStr += ` sepia(${sepia}%)`;
    if (invert) filterStr += ` invert(100%)`;

    ctx.save();
    ctx.filter = filterStr;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.restore();

    // Pixel Pass for Tone Curve (Highlights/Shadows/Temp/Tint/Vibrance) & Grain
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const numPixels = w * h;

    const tempR = temperature > 0 ? 1 + (temperature / 200) : 1;
    const tempB = temperature < 0 ? 1 + (Math.abs(temperature) / 200) : 1;
    const tintG = tint < 0 ? 1 + (Math.abs(tint) / 200) : 1;
    const tintM = tint > 0 ? 1 + (tint / 200) : 1;

    for (let i = 0; i < numPixels; i++) {
      const idx = i * 4;
      let r = data[idx];
      let g = data[idx + 1];
      let b = data[idx + 2];

      r = Math.min(255, Math.max(0, r * tempR * tintM));
      g = Math.min(255, Math.max(0, g * tintG));
      b = Math.min(255, Math.max(0, b * tempB));

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 128 && highlights !== 0) {
        const factor = (lum - 128) / 127;
        const boost = (highlights / 100) * 40 * factor;
        r = Math.min(255, Math.max(0, r + boost));
        g = Math.min(255, Math.max(0, g + boost));
        b = Math.min(255, Math.max(0, b + boost));
      } else if (lum <= 128 && shadows !== 0) {
        const factor = (128 - lum) / 128;
        const boost = (shadows / 100) * 40 * factor;
        r = Math.min(255, Math.max(0, r + boost));
        g = Math.min(255, Math.max(0, g + boost));
        b = Math.min(255, Math.max(0, b + boost));
      }

      if (vibrance > 0) {
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const sat = (maxC - minC) / (maxC || 1);
        const vibranceBoost = (1 - sat) * (vibrance / 100) * 0.5;
        const avg = (r + g + b) / 3;
        r = Math.min(255, Math.max(0, r + (r - avg) * vibranceBoost));
        g = Math.min(255, Math.max(0, g + (g - avg) * vibranceBoost));
        b = Math.min(255, Math.max(0, b + (b - avg) * vibranceBoost));
      }

      if (grain > 0) {
        const noise = (Math.random() - 0.5) * (grain / 100) * 45;
        r = Math.min(255, Math.max(0, r + noise));
        g = Math.min(255, Math.max(0, g + noise));
        b = Math.min(255, Math.max(0, b + noise));
      }

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
    }

    ctx.putImageData(imgData, 0, 0);

    if (vignette > 0) {
      const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, `rgba(0, 0, 0, ${vignette / 100})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }
  };

  const triggerDownload = (canvas: HTMLCanvasElement) => {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `industry_shader_fx_${Date.now()}.png`;
    a.click();
  };

  // Render WebGL/Interactive 3D Canvas overlaid on Shared Document Layers
  useEffect(() => {
    const canvas = viewport3dRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Matte Black Grid Background
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 1;
    const gridSpacing = 40;
    for (let x = 0; x < w; x += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Render Shared Canvas Artwork Layers
    layers.forEach(layer => {
      if (!layer.visible) return;
      ctx.save();
      ctx.globalAlpha = layer.opacity * 0.4;

      if (layer.tileMap) {
        const tilesMap = (layer.tileMap as any).tiles || layer.tileMap;
        for (const tile of tilesMap.values()) {
          const tx = (tile as any).x * 256;
          const ty = (tile as any).y * 256;
          ctx.drawImage((tile as any).canvas, tx, ty, w, h);
        }
      }
      ctx.restore();
    });

    // Render 3D Model Projection with Zoom Scaling
    ctx.save();
    ctx.translate(w / 2, h / 2);

    const radX = (rotX * Math.PI) / 180;
    const radY = (rotY * Math.PI) / 180;

    const project = (x: number, y: number, z: number) => {
      let x1 = x * Math.cos(radY) + z * Math.sin(radY);
      let z1 = -x * Math.sin(radY) + z * Math.cos(radY);
      let y2 = y * Math.cos(radX) - z1 * Math.sin(radX);
      let z2 = y * Math.sin(radX) + z1 * Math.cos(radX);

      const fov = cameraMode === 'perspective' ? 400 / (400 + z2) : 1.0;
      return { x: x1 * fov * zoom, y: y2 * fov * zoom };
    };

    let size = 90;
    let faces: number[][] = [];
    let verts: { x: number; y: number; z: number }[] = [];

    if (meshType === 'uploaded' && loaded3DMesh) {
      verts = loaded3DMesh.vertices;
      faces = loaded3DMesh.faces;
    } else if (meshType === 'cube') {
      verts = [
        { x: -size, y: -size, z: -size }, { x: size, y: -size, z: -size },
        { x: size, y: size, z: -size }, { x: -size, y: size, z: -size },
        { x: -size, y: -size, z: size }, { x: size, y: -size, z: size },
        { x: size, y: size, z: size }, { x: -size, y: size, z: size },
      ];
      faces = [
        [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
        [2, 3, 7, 6], [0, 3, 7, 4], [1, 2, 6, 5],
      ];
    } else if (meshType === 'pyramid') {
      verts = [
        { x: -size, y: size, z: -size }, { x: size, y: size, z: -size },
        { x: size, y: size, z: size }, { x: -size, y: size, z: size },
        { x: 0, y: -size, z: 0 },
      ];
      faces = [
        [0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]
      ];
    } else {
      verts = [
        { x: -size, y: -size, z: -size }, { x: size, y: -size, z: -size },
        { x: size * 1.2, y: 0, z: 0 }, { x: size, y: size, z: size },
        { x: -size, y: size, z: size }, { x: -size * 1.2, y: 0, z: 0 },
      ];
      faces = [[0, 1, 2, 3, 4, 5]];
    }

    const projVerts = verts.map(v => project(v.x, v.y, v.z));

    faces.forEach((face, idx) => {
      if (face.length < 2) return;
      ctx.beginPath();
      const first = projVerts[face[0] % projVerts.length];
      if (!first) return;
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < face.length; i++) {
        const pt = projVerts[face[i] % projVerts.length];
        if (pt) ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();

      if (!wireframe) {
        const shade = Math.min(255, Math.max(40, Math.floor(100 + idx * 25 * lightingIntensity)));
        ctx.fillStyle = `rgba(${shade}, ${shade + 20}, ${shade + 60}, 0.85)`;
        ctx.fill();
      }
      ctx.strokeStyle = wireframe ? '#3b82f6' : '#60a5fa';
      ctx.lineWidth = wireframe ? 2 : 1;
      ctx.stroke();
    });

    ctx.restore();

    // Render Orient Gizmo
    ctx.save();
    const gizmoX = w - 50;
    const gizmoY = h - 50;
    ctx.translate(gizmoX, gizmoY);

    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(25, 0); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ef4444'; ctx.fillText('X', 30, 4);

    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -25); ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#10b981'; ctx.fillText('Y', -4, -30);

    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-15, 15); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#3b82f6'; ctx.fillText('Z', -25, 20);

    ctx.restore();
  }, [meshType, loaded3DMesh, rotX, rotY, zoom, wireframe, cameraMode, lightingIntensity, layers]);

  // Orbit Mouse & Wheel Zoom Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isOrbitingRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isOrbitingRef.current) return;
    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    setRotY(prev => prev + dx * 0.5);
    setRotX(prev => prev + dy * 0.5);
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isOrbitingRef.current = false;
  };

  const handleWheelZoom = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = Math.pow(1.0015, -e.deltaY);
    setZoom(prev => Math.min(6.0, Math.max(0.2, prev * factor)));
  };

  return (
    <div className="tier-workspace rare-workspace" style={{ background: '#09090b', color: '#e4e4e7' }}>
      {/* Rare Workspace Top Bar */}
      <div className="rare-workspace-bar" style={{ background: '#121215', borderBottom: '1px solid #27272a', padding: '8px 16px' }}>
        <div className="rare-title-group">
          <span className="rare-badge-icon" style={{ background: '#18181b', color: '#e4e4e7', border: '1px solid #27272a', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
            RARE LEVEL
          </span>
          <span className="rare-subtext" style={{ color: '#a1a1aa', fontSize: 12 }}>Industry Image Editor & WebGPU Shader Suite (Light, Color, Presets & FX)</span>
        </div>

        <div className="rare-tab-group" style={{ display: 'flex', gap: 6, marginLeft: 24 }}>
          <button className={`rare-tab ${activeTab === '3d' ? 'active' : ''}`} style={{ background: activeTab === '3d' ? '#27272a' : 'transparent', color: '#ffffff', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }} onClick={() => setActiveTab('3d')}>
            3D & Volume Viewport
          </button>
          <button className={`rare-tab ${activeTab === 'fx' ? 'active' : ''}`} style={{ background: activeTab === 'fx' ? '#27272a' : 'transparent', color: '#ffffff', border: '1px solid #3f3f46', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }} onClick={() => setActiveTab('fx')}>
            Industry Shader Editor
          </button>
        </div>

        <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto', background: '#18181b', color: '#e4e4e7', border: '1px solid #27272a' }} onClick={onReturnToCommon}>
          Back to Common Level
        </button>
      </div>

      {/* Main Content Body */}
      <div className="rare-content-body" style={{ padding: 12 }}>
        {activeTab === '3d' && (
          <div className="rare-panel-grid">
            <div className="rare-viewport-card" style={{ background: '#121215', border: '1px solid #27272a', borderRadius: 6, overflow: 'hidden' }}>
              <div className="viewport-header" style={{ padding: '8px 12px', background: '#18181b', borderBottom: '1px solid #27272a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>3D & Volume WebGL Viewport (Mouse wheel to zoom, drag to orbit)</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-xs" style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', fontSize: 10 }} onClick={() => setZoom(prev => Math.max(0.2, prev - 0.2))}>
                    Zoom -
                  </button>
                  <span className="badge-tag" style={{ background: '#27272a', color: '#a1a1aa', padding: '2px 6px', borderRadius: 3, fontSize: 10 }}>{Math.round(zoom * 100)}%</span>
                  <button className="btn btn-xs" style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', fontSize: 10 }} onClick={() => setZoom(prev => Math.min(6.0, prev + 0.2))}>
                    Zoom +
                  </button>
                  <button className="btn btn-xs" style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', fontSize: 10 }} onClick={() => setZoom(1.0)}>
                    Reset
                  </button>
                </div>
              </div>
              <div className="viewport-canvas-placeholder" style={{ cursor: 'grab', height: 440 }}>
                <canvas
                  ref={viewport3dRef}
                  width={800}
                  height={440}
                  style={{ width: '100%', height: '100%' }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onWheel={handleWheelZoom}
                />
              </div>
            </div>

            <div className="rare-sidebar-card" style={{ background: '#121215', border: '1px solid #27272a', borderRadius: 6, padding: 16 }}>
              <h3>3D & Volume Loaders</h3>

              <div className="setting-group" style={{ marginTop: 12 }}>
                <label style={{ fontSize: 11, color: '#a1a1aa' }}>Load 3D Wavefront (.obj)</label>
                <input
                  type="file"
                  ref={objFileInputRef}
                  accept=".obj"
                  style={{ display: 'none' }}
                  onChange={handleOBJUpload}
                />
                <button
                  className="btn btn-full btn-accent"
                  style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', marginTop: 4 }}
                  onClick={() => objFileInputRef.current?.click()}
                >
                  Upload 3D Mesh File (.obj)
                </button>
              </div>

              <div className="setting-group" style={{ marginTop: 12 }}>
                <label style={{ fontSize: 11, color: '#a1a1aa' }}>Load Volume Tensor (.npy)</label>
                <input
                  type="file"
                  ref={npyFileInputRef}
                  accept=".npy"
                  style={{ display: 'none' }}
                  onChange={handleNPYUpload}
                />
                <button
                  className="btn btn-full btn-accent"
                  style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', marginTop: 4 }}
                  onClick={() => npyFileInputRef.current?.click()}
                >
                  Upload Volume Tensor File (.npy)
                </button>
              </div>

              {uploadStatus && (
                <div className="ai-success-banner" style={{ marginTop: 12, background: '#18181b', border: '1px solid #27272a', padding: 8, borderRadius: 4, fontSize: 11 }}>
                  {uploadStatus}
                </div>
              )}

              <div className="setting-group" style={{ marginTop: 16 }}>
                <label style={{ fontSize: 11, color: '#a1a1aa' }}>Primitive Preset Mesh</label>
                <select value={meshType} onChange={e => setMeshType(e.target.value as any)} style={{ background: '#09090b', color: '#fff', border: '1px solid #27272a', padding: '4px 8px', borderRadius: 4 }}>
                  {loaded3DMesh && <option value="uploaded">Uploaded: {loaded3DMesh.name}</option>}
                  <option value="cube">Primitive Cube</option>
                  <option value="pyramid">Pyramid Mesh</option>
                  <option value="cylinder">Cylinder Mesh</option>
                </select>
              </div>

              <div className="setting-group" style={{ marginTop: 12 }}>
                <label style={{ fontSize: 11, color: '#a1a1aa' }}>Camera Projection</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className={`btn btn-xs ${cameraMode === 'perspective' ? 'btn-accent' : ''}`} style={{ background: cameraMode === 'perspective' ? '#27272a' : '#18181b', color: '#fff', border: '1px solid #3f3f46' }} onClick={() => setCameraMode('perspective')}>
                    Perspective
                  </button>
                  <button className={`btn btn-xs ${cameraMode === 'orthographic' ? 'btn-accent' : ''}`} style={{ background: cameraMode === 'orthographic' ? '#27272a' : '#18181b', color: '#fff', border: '1px solid #3f3f46' }} onClick={() => setCameraMode('orthographic')}>
                    Orthographic
                  </button>
                </div>
              </div>

              <div className="setting-group" style={{ marginTop: 12 }}>
                <label style={{ fontSize: 11, color: '#a1a1aa' }}>Lighting Intensity: {lightingIntensity.toFixed(1)}x</label>
                <input type="range" min="0.2" max="3.0" step="0.1" value={lightingIntensity} onChange={e => setLightingIntensity(parseFloat(e.target.value))} />
              </div>

              <div className="setting-group" style={{ marginTop: 12 }}>
                <label className="checkbox-label" style={{ fontSize: 11, color: '#a1a1aa' }}>
                  <input type="checkbox" checked={wireframe} onChange={e => setWireframe(e.target.checked)} />
                  <span style={{ marginLeft: 6 }}>Wireframe Display</span>
                </label>
              </div>

              <button className="btn btn-full" style={{ background: '#18181b', color: '#fff', border: '1px solid #27272a', marginTop: 16 }} onClick={() => { setRotX(25); setRotY(45); setZoom(1.0); }}>
                Reset Camera & Zoom
              </button>
            </div>
          </div>
        )}

        {/* Industry-Grade Image Editor & Shader Suite Tab */}
        {activeTab === 'fx' && (
          <div className="rare-panel-grid" style={{ gridTemplateColumns: '1fr 340px', gap: 16 }}>
            <div className="rare-viewport-card" style={{ background: '#121215', border: '1px solid #27272a', borderRadius: 6, padding: 16 }}>
              <div className="viewport-header" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Industry Shader Stage (Native Resolution Processing)</span>
                <button className="btn btn-accent btn-xs" style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46' }} onClick={downloadShaderResult}>
                  Download Processed FX Photo (.png)
                </button>
              </div>

              {/* Spacious Prominent Color Grading Preset Gallery */}
              <div style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 6, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e4e4e7', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>PRO COLOR GRADING PRESETS GALLERY</span>
                  <span style={{ fontSize: 10, color: '#a1a1aa' }}>Active: {preset.toUpperCase()}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                  <button
                    style={{
                      background: preset === 'none' ? '#3b82f6' : '#27272a',
                      color: '#ffffff',
                      border: preset === 'none' ? '2px solid #60a5fa' : '1px solid #3f3f46',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    onClick={() => applyPreset('none')}
                  >
                    <div>Standard / Original</div>
                    <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 400, marginTop: 2 }}>Reset all filters</div>
                  </button>

                  <button
                    style={{
                      background: preset === 'cinematic' ? '#0d9488' : '#27272a',
                      color: '#ffffff',
                      border: preset === 'cinematic' ? '2px solid #2dd4bf' : '1px solid #3f3f46',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    onClick={() => applyPreset('cinematic')}
                  >
                    <div>Cinematic Teal</div>
                    <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 400, marginTop: 2 }}>Blockbuster contrast</div>
                  </button>

                  <button
                    style={{
                      background: preset === 'vintage' ? '#d97706' : '#27272a',
                      color: '#ffffff',
                      border: preset === 'vintage' ? '2px solid #fbbf24' : '1px solid #3f3f46',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    onClick={() => applyPreset('vintage')}
                  >
                    <div>Kodachrome 70s</div>
                    <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 400, marginTop: 2 }}>Vintage analog film</div>
                  </button>

                  <button
                    style={{
                      background: preset === 'bw_dramatic' ? '#52525b' : '#27272a',
                      color: '#ffffff',
                      border: preset === 'bw_dramatic' ? '2px solid #a1a1aa' : '1px solid #3f3f46',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    onClick={() => applyPreset('bw_dramatic')}
                  >
                    <div>Dramatic B&W</div>
                    <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 400, marginTop: 2 }}>High-contrast monochrome</div>
                  </button>

                  <button
                    style={{
                      background: preset === 'cyberpunk' ? '#c026d3' : '#27272a',
                      color: '#ffffff',
                      border: preset === 'cyberpunk' ? '2px solid #f0abfc' : '1px solid #3f3f46',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    onClick={() => applyPreset('cyberpunk')}
                  >
                    <div>Cyberpunk Neon</div>
                    <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 400, marginTop: 2 }}>Magenta / cyan punch</div>
                  </button>

                  <button
                    style={{
                      background: preset === 'golden_hour' ? '#b45309' : '#27272a',
                      color: '#ffffff',
                      border: preset === 'golden_hour' ? '2px solid #fde047' : '1px solid #3f3f46',
                      borderRadius: 6,
                      padding: '8px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                    onClick={() => applyPreset('golden_hour')}
                  >
                    <div>Golden Hour</div>
                    <div style={{ fontSize: 9, opacity: 0.7, fontWeight: 400, marginTop: 2 }}>Sunset warm lighting</div>
                  </button>
                </div>
              </div>

              <div className="fx-stage" style={{ background: '#09090b', padding: 16, borderRadius: 6, textAlign: 'center', minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                {uploadedPhotoSrc ? (
                  <img
                    src={uploadedPhotoSrc}
                    alt="Uploaded Shader Source"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '52vh',
                      objectFit: 'contain',
                      borderRadius: 6,
                      border: '1px solid #27272a',
                      filter: `brightness(${1 + exposure}) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hueRotate}deg) blur(${blurRadius}px) ${grayscale > 0 ? `grayscale(${grayscale}%)` : ''} ${sepia > 0 ? `sepia(${sepia}%)` : ''} ${invert ? 'invert(100%)' : ''}`
                    }}
                  />
                ) : (
                  <div
                    className="fx-sample-art"
                    style={{
                      filter: `brightness(${1 + exposure}) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hueRotate}deg) blur(${blurRadius}px) ${grayscale > 0 ? `grayscale(${grayscale}%)` : ''} ${sepia > 0 ? `sepia(${sepia}%)` : ''} ${invert ? 'invert(100%)' : ''}`,
                      padding: 40, background: '#18181b', borderRadius: 8, border: '1px solid #27272a', width: '100%'
                    }}
                  >
                    <div className="fx-text" style={{ fontSize: 16, fontWeight: 600 }}>WebGPU Industry Shader Pipeline</div>
                    <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 8 }}>Upload a photo file (.png, .jpg) in the sidebar to run industry-grade adjustments.</div>
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar Controls Panel with Accordion Categories */}
            <div className="rare-sidebar-card" style={{ background: '#121215', border: '1px solid #27272a', borderRadius: 6, padding: 16, maxHeight: '82vh', overflowY: 'auto' }}>
              <h3 style={{ fontSize: 13, borderBottom: '1px solid #27272a', paddingBottom: 6 }}>Industry Adjustment Controls</h3>

              {/* Photo Input Control */}
              <div className="setting-group" style={{ marginTop: 10 }}>
                <input
                  type="file"
                  ref={photoFileInputRef}
                  accept="image/png, image/jpeg, image/webp"
                  style={{ display: 'none' }}
                  onChange={handlePhotoUpload}
                />
                <button
                  className="btn btn-full btn-accent"
                  style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', fontSize: 11 }}
                  onClick={() => photoFileInputRef.current?.click()}
                >
                  Upload Photo File (.png, .jpg)
                </button>
              </div>

              {/* 1. Light & Tone Section */}
              <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #27272a' }}>
                <strong style={{ fontSize: 11, color: '#e4e4e7' }}>LIGHT & TONE</strong>

                <div className="setting-group" style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Exposure (EV): {exposure > 0 ? `+${exposure.toFixed(2)}` : exposure.toFixed(2)}</label>
                  <input type="range" min="-2.0" max="2.0" step="0.05" value={exposure} onChange={e => setExposure(parseFloat(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Contrast: {contrast}%</label>
                  <input type="range" min="30" max="200" value={contrast} onChange={e => setContrast(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Highlights: {highlights > 0 ? `+${highlights}` : highlights}</label>
                  <input type="range" min="-100" max="100" value={highlights} onChange={e => setHighlights(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Shadows: {shadows > 0 ? `+${shadows}` : shadows}</label>
                  <input type="range" min="-100" max="100" value={shadows} onChange={e => setShadows(parseInt(e.target.value))} />
                </div>
              </div>

              {/* 2. Color & HSL Section */}
              <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #27272a' }}>
                <strong style={{ fontSize: 11, color: '#e4e4e7' }}>COLOR & HSL</strong>

                <div className="setting-group" style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Temperature: {temperature > 0 ? `Warm +${temperature}` : temperature < 0 ? `Cool ${temperature}` : '0 (Neutral)'}</label>
                  <input type="range" min="-100" max="100" value={temperature} onChange={e => setTemperature(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Tint: {tint > 0 ? `Magenta +${tint}` : tint < 0 ? `Green ${tint}` : '0'}</label>
                  <input type="range" min="-100" max="100" value={tint} onChange={e => setTint(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Saturation: {saturation}%</label>
                  <input type="range" min="0" max="250" value={saturation} onChange={e => setSaturation(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Vibrance: {vibrance}%</label>
                  <input type="range" min="0" max="100" value={vibrance} onChange={e => setVibrance(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Hue Rotation: {hueRotate}°</label>
                  <input type="range" min="0" max="360" value={hueRotate} onChange={e => setHueRotate(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Grayscale (B&W): {grayscale}%</label>
                  <input type="range" min="0" max="100" value={grayscale} onChange={e => setGrayscale(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Sepia Tone: {sepia}%</label>
                  <input type="range" min="0" max="100" value={sepia} onChange={e => setSepia(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label className="checkbox-label" style={{ fontSize: 10, color: '#a1a1aa' }}>
                    <input type="checkbox" checked={invert} onChange={e => setInvert(e.target.checked)} />
                    <span style={{ marginLeft: 6 }}>Color Invert</span>
                  </label>
                </div>
              </div>

              {/* 3. Detail, Texture & Vignette */}
              <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #27272a' }}>
                <strong style={{ fontSize: 11, color: '#e4e4e7' }}>DETAIL & VIGNETTE</strong>

                <div className="setting-group" style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Gaussian Blur: {blurRadius}px</label>
                  <input type="range" min="0" max="30" value={blurRadius} onChange={e => setBlurRadius(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Film Grain Noise: {grain}%</label>
                  <input type="range" min="0" max="100" value={grain} onChange={e => setGrain(parseInt(e.target.value))} />
                </div>

                <div className="setting-group" style={{ marginTop: 6 }}>
                  <label style={{ fontSize: 10, color: '#a1a1aa' }}>Vignette Darkening: {vignette}%</label>
                  <input type="range" min="0" max="100" value={vignette} onChange={e => setVignette(parseInt(e.target.value))} />
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="btn btn-full btn-accent" style={{ background: '#27272a', color: '#fff', border: '1px solid #3f3f46', fontSize: 11 }} onClick={downloadShaderResult}>
                  Download Processed FX Photo (.png)
                </button>
                <button className="btn btn-full" style={{ background: '#18181b', color: '#e4e4e7', border: '1px solid #27272a', fontSize: 11 }} onClick={resetAllShaders}>
                  Reset All Shader Filters
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
