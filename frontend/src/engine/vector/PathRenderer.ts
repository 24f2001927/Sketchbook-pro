import type { VectorPath } from '../../state/document';
import type { ViewportTransform } from '../canvas/ViewportRenderer';

export class PathRenderer {
  static renderPaths(ctx: CanvasRenderingContext2D, paths: VectorPath[]): void {
    for (const path of paths) {
      this.renderPath(ctx, path);
    }
  }

  static renderPath(ctx: CanvasRenderingContext2D, path: VectorPath): void {
    if (path.anchors.length === 0) return;

    ctx.beginPath();
    const first = path.anchors[0];
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < path.anchors.length; i++) {
      const prev = path.anchors[i - 1];
      const curr = path.anchors[i];
      ctx.bezierCurveTo(
        prev.x + prev.handleOut.x, prev.y + prev.handleOut.y,
        curr.x + curr.handleIn.x, curr.y + curr.handleIn.y,
        curr.x, curr.y
      );
    }

    if (path.closed) {
      const prev = path.anchors[path.anchors.length - 1];
      const curr = path.anchors[0];
      ctx.bezierCurveTo(
        prev.x + prev.handleOut.x, prev.y + prev.handleOut.y,
        curr.x + curr.handleIn.x, curr.y + curr.handleIn.y,
        curr.x, curr.y
      );
      ctx.closePath();
    }

    if (path.fillColor) {
      ctx.fillStyle = path.fillColor;
      ctx.fill(path.fillRule);
    }

    if (path.strokeWidth > 0 && path.strokeColor) {
      ctx.strokeStyle = path.strokeColor;
      ctx.lineWidth = path.strokeWidth;
      ctx.stroke();
    }
  }

  static renderPathOutline(ctx: CanvasRenderingContext2D, path: VectorPath, transform: ViewportTransform): void {
    if (path.anchors.length === 0) return;
    
    ctx.beginPath();
    const first = path.anchors[0];
    ctx.moveTo(first.x, first.y);
    
    for (let i = 1; i < path.anchors.length; i++) {
      const prev = path.anchors[i - 1];
      const curr = path.anchors[i];
      ctx.bezierCurveTo(
        prev.x + prev.handleOut.x, prev.y + prev.handleOut.y,
        curr.x + curr.handleIn.x, curr.y + curr.handleIn.y,
        curr.x, curr.y
      );
    }
    
    if (path.closed) {
      const prev = path.anchors[path.anchors.length - 1];
      const curr = path.anchors[0];
      ctx.bezierCurveTo(
        prev.x + prev.handleOut.x, prev.y + prev.handleOut.y,
        curr.x + curr.handleIn.x, curr.y + curr.handleIn.y,
        curr.x, curr.y
      );
    }
    
    ctx.strokeStyle = '#0066ff';
    ctx.lineWidth = 1 / transform.zoom;
    ctx.stroke();

    const anchorSize = 8 / transform.zoom;
    const handleSize = 6 / transform.zoom;

    for (const anchor of path.anchors) {
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(anchor.x + anchor.handleIn.x, anchor.y + anchor.handleIn.y);
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(anchor.x + anchor.handleOut.x, anchor.y + anchor.handleOut.y);
      ctx.strokeStyle = '#0066ff';
      ctx.lineWidth = 1 / transform.zoom;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#0066ff';
      
      if (anchor.handleIn.x !== 0 || anchor.handleIn.y !== 0) {
        ctx.beginPath();
        ctx.arc(anchor.x + anchor.handleIn.x, anchor.y + anchor.handleIn.y, handleSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      
      if (anchor.handleOut.x !== 0 || anchor.handleOut.y !== 0) {
        ctx.beginPath();
        ctx.arc(anchor.x + anchor.handleOut.x, anchor.y + anchor.handleOut.y, handleSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(anchor.x - anchorSize / 2, anchor.y - anchorSize / 2, anchorSize, anchorSize);
      ctx.strokeRect(anchor.x - anchorSize / 2, anchor.y - anchorSize / 2, anchorSize, anchorSize);
    }
  }

  static pathToSVGString(path: VectorPath): string {
    if (path.anchors.length === 0) return '';
    let d = `M ${path.anchors[0].x} ${path.anchors[0].y} `;
    
    for (let i = 1; i < path.anchors.length; i++) {
      const prev = path.anchors[i - 1];
      const curr = path.anchors[i];
      d += `C ${prev.x + prev.handleOut.x} ${prev.y + prev.handleOut.y}, ${curr.x + curr.handleIn.x} ${curr.y + curr.handleIn.y}, ${curr.x} ${curr.y} `;
    }

    if (path.closed) {
      const prev = path.anchors[path.anchors.length - 1];
      const curr = path.anchors[0];
      d += `C ${prev.x + prev.handleOut.x} ${prev.y + prev.handleOut.y}, ${curr.x + curr.handleIn.x} ${curr.y + curr.handleIn.y}, ${curr.x} ${curr.y} Z`;
    }

    return d.trim();
  }

  static svgStringToPath(_svg: string, id: string): VectorPath {
    return {
      id,
      anchors: [],
      closed: false,
      strokeColor: '#000000',
      strokeWidth: 1,
      fillColor: null,
      fillRule: 'nonzero'
    };
  }
}
