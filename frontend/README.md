# Sketchbook Pro — Frontend Client Application

A professional-grade, web-based creative software platform combining digital painting, vector illustration, 2D animation, 3D scene composition, and image editing into a unified browser studio application.

Built with **React 19**, **TypeScript**, **Vite**, and an independent **Vanilla TypeScript Document Engine**.

---

## 🎨 Architectural Overview

To deliver high performance (60+ FPS during stylus drawing) while maintaining rich UI controls, the frontend is built using a decoupled dual-architecture:

1. **UI Shell & Layout Layer (React 19 + Vanilla CSS)**
   - Manages responsive workspace windows, dockable resizable panels, dialogs, sub-menus, and tool overlays.
   - Built with modern dark-mode CSS tokens, micro-animations, glassmorphism aesthetics, and keyboard shortcuts.

2. **Document Model & Rendering Engine (Vanilla TypeScript)**
   - Runs outside of React's render loop to avoid re-rendering React components on high-frequency pointer movements.
   - **Tiled Viewport Renderer**: 256x256 pixel tiles, dirty region bounding box calculation, and LRU texture caching.
   - **Stylus Input Normalizer**: Normalizes pressure, tilt X/Y, twist, and applies pointer stabilization (Lazy Mouse rope & exponential moving average filters).
   - **Procedural Brush Engine**: Computes stamp spacing, pressure dynamics, tilt mapping, and flow rate.
   - **Vector Subsystem**: Pen tool with cubic Bezier curve evaluation, interactive control handle editing, vector path rendering, and geometry Boolean operations (Union, Difference, Intersection, XOR).
   - **Export Engine**: Exporting to PNG, WebP, JPEG, JSON, and native compressed `.artstudio` document archives.

---

## 📁 Directory Structure

```text
frontend/
├── public/                 # Static public assets & favicons
├── src/
│   ├── assets/             # Fonts and static media
│   ├── components/         # React UI Studio components
│   │   ├── ResizablePanel.tsx      # Dockable, collapsible panel container
│   │   ├── VectorToolbar.tsx       # Vector selection & boolean tool parameters
│   │   ├── TextToolOverlay.tsx     # On-canvas typography editing overlay
│   │   └── CollapsibleSection.tsx  # UI Accordion section
│   ├── engine/             # High-performance drawing & vector engine
│   │   ├── input/
│   │   │   └── StylusInput.ts      # Pointer & Stylus normalization & stabilization
│   │   ├── brush/
│   │   │   └── BrushEngine.ts      # Stamp brush engine & dynamic pressure mapping
│   │   ├── canvas/
│   │   │   ├── ViewportRenderer.ts # Tiled 2D canvas, WebGL fallback & dirty rects
│   │   │   └── ExportEngine.ts     # Save/Export engine (PNG, WebP, JPEG, .artstudio)
│   │   └── vector/
│   │       ├── PenTool.ts          # Pen tool state & node editing
│   │       ├── BezierMath.ts       # Cubic Bezier math & path flattening
│   │       ├── PathRenderer.ts     # Vector rendering & control handle previews
│   │       └── BooleanOps.ts       # Boolean geometry operations (Union, Diff, etc.)
│   ├── state/
│   │   └── document.ts             # Vanilla TS document model store
│   ├── App.tsx             # Studio UI Shell & main workspace controller
│   ├── App.css             # Main application styles
│   ├── index.css           # Design tokens, variables & glassmorphism theme
│   └── main.tsx            # Vite entry point
├── package.json            # Frontend package configuration
├── tsconfig.json           # TypeScript project references
└── vite.config.ts          # Vite build & plugin settings
```

---

## 🛠️ Engine & Module Specification

### 1. Stylus Input & Stabilization (`src/engine/input/StylusInput.ts`)
- Normalizes browser `PointerEvent` data into unified `StylusInput` coordinates.
- Implements two stabilization algorithms:
  - **Lazy Mouse / Rope**: Smooth offset dragging for hand tremor suppression.
  - **Exponential Moving Average**: Smooth interpolation over pointer history.

### 2. Viewport & Rendering Pipeline (`src/engine/canvas/ViewportRenderer.ts`)
- Manages high-resolution canvas tiling (256x256 tiles).
- Tracks dirty rectangles during brush strokes to only redraw changed canvas regions.
- Maintains an LRU cache for offscreen tile textures.

### 3. Procedural Brush Engine (`src/engine/brush/BrushEngine.ts`)
- Computes stamp interpolations along stylus paths.
- Mapped properties: Size, Opacity, Flow, Scatter, Jitter, Wetness, and Color Mixing based on stylus pressure and tilt angles.

### 4. Vector Subsystem (`src/engine/vector/`)
- **Pen Tool** (`PenTool.ts`): Interactive path creation, adding/removing anchors, adjusting handle angles.
- **Bezier Math** (`BezierMath.ts`): Evaluates cubic Bezier curves, computes bounding boxes, and flattens paths to polygon approximations.
- **Boolean Geometry** (`BooleanOps.ts`): Calculates Union, Difference, Intersection, and XOR operations on vector shapes.

### 5. Document Model Store (`src/state/document.ts`)
- Reactive vanilla TypeScript store managing layer trees (Raster, Vector, Group, Adjustment), animation keyframes, 3D scene nodes, and active tool states.

---

## 💻 Local Development Commands

Run these commands inside the root workspace directory or within `frontend/`:

- **Start Dev Server**:
  ```bash
  # From root directory:
  npm run dev:frontend

  # Or inside /frontend:
  npm run dev
  ```
  App will start at `http://localhost:5173`.

- **Type Check & Build**:
  ```bash
  # From root directory:
  npm run build:frontend

  # Or inside /frontend:
  npm run build
  ```
  Generates production assets in `dist/`.

- **Preview Build**:
  ```bash
  npm run preview
  ```

- **Run Linter**:
  ```bash
  npm run lint
  ```

---

## ☁️ Deployment

Deployed automatically to **Render.com** via the root [`render.yaml`](file:///home/tahmeed/Desktop/Sketchbook-pro/Sketchbook-pro/render.yaml) Blueprint configuration:
- **Build Command**: `npm install && npm run build:frontend`
- **Publish Directory**: `./frontend/dist`
- **Routing**: Single Page Application rewrite rules (`/* -> /index.html`).
