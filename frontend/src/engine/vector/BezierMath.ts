import type { VectorPath } from '../../state/document';

export class BezierMath {
  static getBezierPoint(p0: {x:number, y:number}, p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}, t: number): {x:number, y:number} {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const p = { x: 0, y: 0 };
    p.x = uuu * p0.x;
    p.y = uuu * p0.y;

    p.x += 3 * uu * t * p1.x;
    p.y += 3 * uu * t * p1.y;

    p.x += 3 * u * tt * p2.x;
    p.y += 3 * u * tt * p2.y;

    p.x += ttt * p3.x;
    p.y += ttt * p3.y;

    return p;
  }

  static getBezierTangent(p0: {x:number, y:number}, p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}, t: number): {x:number, y:number} {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    
    const tx = 3 * uu * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * tt * (p3.x - p2.x);
    const ty = 3 * uu * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * tt * (p3.y - p2.y);
    
    const len = Math.sqrt(tx * tx + ty * ty);
    if (len === 0) return { x: 0, y: 0 };
    return { x: tx / len, y: ty / len };
  }

  static splitBezierAt(p0: {x:number, y:number}, p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}, t: number): [{x:number, y:number}[], {x:number, y:number}[]] {
    const u = 1 - t;
    
    const p01 = { x: u * p0.x + t * p1.x, y: u * p0.y + t * p1.y };
    const p12 = { x: u * p1.x + t * p2.x, y: u * p1.y + t * p2.y };
    const p23 = { x: u * p2.x + t * p3.x, y: u * p2.y + t * p3.y };
    
    const p012 = { x: u * p01.x + t * p12.x, y: u * p01.y + t * p12.y };
    const p123 = { x: u * p12.x + t * p23.x, y: u * p12.y + t * p23.y };
    
    const p0123 = { x: u * p012.x + t * p123.x, y: u * p012.y + t * p123.y };
    
    return [
      [p0, p01, p012, p0123],
      [p0123, p123, p23, p3]
    ];
  }

  static getBezierBounds(p0: {x:number, y:number}, p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}): {minX:number, minY:number, maxX:number, maxY:number} {
    let minX = Math.min(p0.x, p3.x);
    let maxX = Math.max(p0.x, p3.x);
    let minY = Math.min(p0.y, p3.y);
    let maxY = Math.max(p0.y, p3.y);
    
    const solveExtremes = (v0: number, v1: number, v2: number, v3: number) => {
      const a = 3 * (-v0 + 3 * v1 - 3 * v2 + v3);
      const b = 6 * (v0 - 2 * v1 + v2);
      const c = 3 * (v1 - v0);
      
      const roots = [];
      if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) > 1e-12) roots.push(-c / b);
      } else {
        const desc = b * b - 4 * a * c;
        if (desc >= 0) {
          roots.push((-b + Math.sqrt(desc)) / (2 * a));
          roots.push((-b - Math.sqrt(desc)) / (2 * a));
        }
      }
      return roots.filter(t => t > 0 && t < 1);
    };
    
    const tx = solveExtremes(p0.x, p1.x, p2.x, p3.x);
    const ty = solveExtremes(p0.y, p1.y, p2.y, p3.y);
    
    for (const t of tx) {
      const p = this.getBezierPoint(p0, p1, p2, p3, t);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
    }
    for (const t of ty) {
      const p = this.getBezierPoint(p0, p1, p2, p3, t);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    
    return { minX, minY, maxX, maxY };
  }

  static getBezierLength(p0: {x:number, y:number}, p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}, steps: number = 20): number {
    let len = 0;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
      const curr = this.getBezierPoint(p0, p1, p2, p3, i / steps);
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      len += Math.sqrt(dx * dx + dy * dy);
      prev = curr;
    }
    return len;
  }

  static flattenBezierToPolyline(p0: {x:number, y:number}, p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}, tolerance: number = 1.0): {x:number, y:number}[] {
    const points: {x:number, y:number}[] = [p0];
    
    const flatten = (a0: {x:number,y:number}, a1: {x:number,y:number}, a2: {x:number,y:number}, a3: {x:number,y:number}) => {
      const dx = a3.x - a0.x;
      const dy = a3.y - a0.y;
      
      let dev = 0;
      if (dx === 0 && dy === 0) {
        dev = Math.max(
          Math.pow(a1.x - a0.x, 2) + Math.pow(a1.y - a0.y, 2),
          Math.pow(a2.x - a0.x, 2) + Math.pow(a2.y - a0.y, 2)
        );
      } else {
        const d = dx * dx + dy * dy;
        const d1 = Math.abs(dx * (a0.y - a1.y) - dy * (a0.x - a1.x));
        const d2 = Math.abs(dx * (a0.y - a2.y) - dy * (a0.x - a2.x));
        dev = Math.max((d1 * d1) / d, (d2 * d2) / d);
      }
      
      if (dev <= tolerance * tolerance) {
        points.push(a3);
      } else {
        const halves = this.splitBezierAt(a0, a1, a2, a3, 0.5);
        flatten(halves[0][0], halves[0][1], halves[0][2], halves[0][3]);
        flatten(halves[1][0], halves[1][1], halves[1][2], halves[1][3]);
      }
    };
    
    flatten(p0, p1, p2, p3);
    return points;
  }

  static closestPointOnBezier(p0: {x:number, y:number}, p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}, px: number, py: number): {t: number, point: {x:number, y:number}, distance: number} {
    const polyline = this.flattenBezierToPolyline(p0, p1, p2, p3, 0.5);
    let minDist = Infinity;
    let minPoint = p0;
    let minT = 0;
    
    const totalLen = this.getBezierLength(p0, p1, p2, p3);
    let lenSoFar = 0;
    
    for (let i = 0; i < polyline.length - 1; i++) {
      const a = polyline[i];
      const b = polyline[i+1];
      
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      
      if (segLen === 0) continue;
      
      const px_a = px - a.x;
      const py_a = py - a.y;
      
      let t_proj = (px_a * dx + py_a * dy) / (segLen * segLen);
      t_proj = Math.max(0, Math.min(1, t_proj));
      
      const projX = a.x + t_proj * dx;
      const projY = a.y + t_proj * dy;
      
      const dist = Math.sqrt((px - projX)**2 + (py - projY)**2);
      if (dist < minDist) {
        minDist = dist;
        minPoint = { x: projX, y: projY };
        const localLen = lenSoFar + t_proj * segLen;
        minT = totalLen === 0 ? 0 : localLen / totalLen;
      }
      
      lenSoFar += segLen;
    }
    
    return { t: minT, point: minPoint, distance: minDist };
  }

  static hitTestPath(path: {x:number,y:number}[], x: number, y: number, threshold: number): boolean {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i+1];
      
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      
      if (segLen === 0) {
        if (Math.sqrt((x - a.x)**2 + (y - a.y)**2) <= threshold) return true;
        continue;
      }
      
      let t = ((x - a.x) * dx + (y - a.y) * dy) / (segLen * segLen);
      t = Math.max(0, Math.min(1, t));
      
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      
      if (Math.sqrt((x - px)**2 + (y - py)**2) <= threshold) return true;
    }
    return false;
  }

  static hitTestVectorPath(path: VectorPath, x: number, y: number, threshold: number = 8): boolean {
    const poly = this.flattenVectorPath(path);
    if (path.fillColor && path.anchors.length > 2) {
      if (this.pointInPolygon({x, y}, poly)) return true;
    }
    return this.hitTestPath(poly, x, y, threshold);
  }

  static flattenVectorPath(path: VectorPath): {x:number, y:number}[] {
    const points: {x:number, y:number}[] = [];
    if (path.anchors.length === 0) return points;
    for (let i = 0; i < path.anchors.length; i++) {
      const p0 = path.anchors[i];
      const p3 = path.anchors[(i + 1) % path.anchors.length];
      if (i === path.anchors.length - 1 && !path.closed) break;
      const p1 = { x: p0.x + p0.handleOut.x, y: p0.y + p0.handleOut.y };
      const p2 = { x: p3.x + p3.handleIn.x, y: p3.y + p3.handleIn.y };
      const segment = this.flattenBezierToPolyline(p0, p1, p2, p3, 1.0);
      if (i === 0) {
        points.push(...segment);
      } else {
        points.push(...segment.slice(1));
      }
    }
    return points;
  }

  static pointInPolygon(point: {x:number, y:number}, polygon: {x:number, y:number}[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      const intersect = ((yi > point.y) !== (yj > point.y))
          && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
}
