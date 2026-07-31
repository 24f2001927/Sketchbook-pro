import type { VectorPath, VectorAnchor } from '../../state/document';
import { BezierMath } from './BezierMath';

export class BooleanOps {
  private static flattenPath(path: VectorPath): {x:number, y:number}[] {
    const points: {x:number, y:number}[] = [];
    if (path.anchors.length === 0) return points;
    
    for (let i = 0; i < path.anchors.length; i++) {
      const p0 = path.anchors[i];
      const p3 = path.anchors[(i + 1) % path.anchors.length];
      if (i === path.anchors.length - 1 && !path.closed) break;
      
      const p1 = { x: p0.x + p0.handleOut.x, y: p0.y + p0.handleOut.y };
      const p2 = { x: p3.x + p3.handleIn.x, y: p3.y + p3.handleIn.y };
      
      const segment = BezierMath.flattenBezierToPolyline(p0, p1, p2, p3, 1.0);
      if (i === 0) {
        points.push(...segment);
      } else {
        points.push(...segment.slice(1));
      }
    }
    return points;
  }

  private static toVectorPath(points: {x:number,y:number}[], sourcePath: VectorPath, closed: boolean): VectorPath {
    const anchors: VectorAnchor[] = points.map(p => ({
      id: Math.random().toString(36).substring(2, 11),
      x: p.x,
      y: p.y,
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
      smooth: false
    }));

    if (closed && anchors.length > 1) {
      const first = anchors[0];
      const last = anchors[anchors.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-4) {
        anchors.pop();
      }
    }

    return {
      id: Math.random().toString(36).substring(2, 11),
      anchors,
      closed,
      strokeColor: sourcePath.strokeColor,
      strokeWidth: sourcePath.strokeWidth,
      fillColor: sourcePath.fillColor,
      fillRule: sourcePath.fillRule
    };
  }

  private static pointInPolygon(point: {x:number, y:number}, polygon: {x:number, y:number}[]): boolean {
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

  private static isInside(edgeP1: {x:number, y:number}, edgeP2: {x:number, y:number}, testPoint: {x:number, y:number}): boolean {
    return (edgeP2.x - edgeP1.x) * (testPoint.y - edgeP1.y) - (edgeP2.y - edgeP1.y) * (testPoint.x - edgeP1.x) >= 0;
  }

  private static computeIntersection(p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}, p4: {x:number, y:number}): {x:number, y:number} | null {
    const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
    if (denom === 0) return null;
    
    const t = ((p1.x * p2.y - p1.y * p2.x) * (p3.x - p4.x) - (p1.x - p2.x) * (p3.x * p4.y - p3.y * p4.x)) / denom;
    const u = ((p1.x * p2.y - p1.y * p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x * p4.y - p3.y * p4.x)) / denom;
    
    return { x: t, y: u };
  }
  
  static intersect(pathA: VectorPath, pathB: VectorPath): VectorPath {
    const subjectPolygon = this.flattenPath(pathA);
    const clipPolygon = this.flattenPath(pathB);
    
    let outputList = subjectPolygon;
    
    for (let i = 0; i < clipPolygon.length; i++) {
      const clipEdgeP1 = clipPolygon[i];
      const clipEdgeP2 = clipPolygon[(i + 1) % clipPolygon.length];
      
      const inputList = outputList;
      outputList = [];
      
      if (inputList.length === 0) break;

      for (let j = 0; j < inputList.length; j++) {
        const currentPoint = inputList[j];
        const prevPoint = inputList[(j - 1 + inputList.length) % inputList.length];
        
        const isCurrentInside = this.isInside(clipEdgeP1, clipEdgeP2, currentPoint);
        const isPrevInside = this.isInside(clipEdgeP1, clipEdgeP2, prevPoint);
        
        if (isCurrentInside) {
          if (!isPrevInside) {
            const intersection = this.computeIntersection(prevPoint, currentPoint, clipEdgeP1, clipEdgeP2);
            if (intersection) outputList.push(intersection);
          }
          outputList.push(currentPoint);
        } else if (isPrevInside) {
          const intersection = this.computeIntersection(prevPoint, currentPoint, clipEdgeP1, clipEdgeP2);
          if (intersection) outputList.push(intersection);
        }
      }
    }
    
    return this.toVectorPath(outputList, pathA, true);
  }

  static union(pathA: VectorPath, pathB: VectorPath): VectorPath {
    const polyA = this.flattenPath(pathA);
    const polyB = this.flattenPath(pathB);
    
    const resA = polyA.filter(p => !this.pointInPolygon(p, polyB));
    const resB = polyB.filter(p => !this.pointInPolygon(p, polyA));
    
    return this.toVectorPath([...resA, ...resB], pathA, true);
  }

  static subtract(pathA: VectorPath, pathB: VectorPath): VectorPath {
    const polyA = this.flattenPath(pathA);
    const polyB = this.flattenPath(pathB);
    
    const resultPoly = polyA.filter(p => !this.pointInPolygon(p, polyB));
    
    return this.toVectorPath(resultPoly, pathA, true);
  }

  static exclude(pathA: VectorPath, pathB: VectorPath): VectorPath[] {
    const polyA = this.flattenPath(pathA);
    const polyB = this.flattenPath(pathB);
    
    const resA = polyA.filter(p => !this.pointInPolygon(p, polyB));
    const resB = polyB.filter(p => !this.pointInPolygon(p, polyA));
    
    return [
      this.toVectorPath(resA, pathA, true),
      this.toVectorPath(resB, pathB, true)
    ];
  }
}
