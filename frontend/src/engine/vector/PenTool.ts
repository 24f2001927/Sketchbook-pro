import type { VectorPath, VectorAnchor } from '../../state/document';

export type PenToolState = 'idle' | 'placing-first' | 'drawing' | 'closing' | 'editing-node' | 'editing-handle-in' | 'editing-handle-out';

export type PenToolAction =
  | { type: 'add-anchor'; pathId: string; anchor: VectorAnchor }
  | { type: 'update-handle'; pathId: string; anchorIndex: number; handleType: 'in' | 'out'; handle: {x:number,y:number} }
  | { type: 'move-anchor'; pathId: string; anchorIndex: number; x: number; y: number }
  | { type: 'close-path'; pathId: string }
  | { type: 'start-path'; path: VectorPath }
  | { type: 'select-anchor'; pathId: string; anchorIndex: number }
  | { type: 'none' };

export class PenTool {
  public state: PenToolState = 'idle';
  public activePath: VectorPath | null = null;
  public selectedAnchorIndex: number = -1;
  public selectedPathId: string | null = null;
  public hoveredAnchorIndex: number = -1;

  private generateId(): string {
    return Math.random().toString(36).substring(2, 11);
  }

  private hitTestAnchor(path: VectorPath, x: number, y: number, radius: number = 8): number {
    for (let i = 0; i < path.anchors.length; i++) {
      const a = path.anchors[i];
      if (Math.hypot(a.x - x, a.y - y) <= radius) {
        return i;
      }
    }
    return -1;
  }

  private hitTestHandle(path: VectorPath, anchorIndex: number, x: number, y: number, radius: number = 6): 'in' | 'out' | null {
    if (anchorIndex < 0 || anchorIndex >= path.anchors.length) return null;
    const a = path.anchors[anchorIndex];
    
    if (Math.hypot((a.x + a.handleIn.x) - x, (a.y + a.handleIn.y) - y) <= radius) return 'in';
    if (Math.hypot((a.x + a.handleOut.x) - x, (a.y + a.handleOut.y) - y) <= radius) return 'out';
    
    return null;
  }

  public onPointerDown(x: number, y: number, _pressure: number, _paths: VectorPath[]): PenToolAction {
    if (this.activePath) {
      const hitHandle = this.selectedAnchorIndex !== -1 ? this.hitTestHandle(this.activePath, this.selectedAnchorIndex, x, y) : null;
      if (hitHandle === 'in') {
        this.state = 'editing-handle-in';
        return { type: 'none' };
      } else if (hitHandle === 'out') {
        this.state = 'editing-handle-out';
        return { type: 'none' };
      }
      
      const hitAnchor = this.hitTestAnchor(this.activePath, x, y);
      if (hitAnchor !== -1) {
        if (hitAnchor === 0 && this.state === 'drawing' && this.activePath.anchors.length > 2) {
          this.state = 'closing';
          return { type: 'close-path', pathId: this.activePath.id };
        } else {
          this.state = 'editing-node';
          this.selectedAnchorIndex = hitAnchor;
          return { type: 'select-anchor', pathId: this.activePath.id, anchorIndex: hitAnchor };
        }
      }
    }

    if (this.state === 'idle' || this.state === 'closing' || this.state === 'editing-node') {
      const newPath: VectorPath = {
        id: this.generateId(),
        anchors: [],
        closed: false,
        strokeColor: '#000000',
        strokeWidth: 2,
        fillColor: null,
        fillRule: 'nonzero'
      };
      
      const anchor: VectorAnchor = {
        id: this.generateId(),
        x, y,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
        smooth: false
      };
      
      newPath.anchors.push(anchor);
      this.activePath = newPath;
      this.state = 'placing-first';
      this.selectedPathId = newPath.id;
      this.selectedAnchorIndex = 0;
      
      return { type: 'start-path', path: newPath };
    }
    
    if (this.state === 'drawing') {
      if (this.activePath) {
        const anchor: VectorAnchor = {
          id: this.generateId(),
          x, y,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 },
          smooth: true
        };
        this.activePath.anchors.push(anchor);
        this.selectedAnchorIndex = this.activePath.anchors.length - 1;
        this.state = 'placing-first';
        return { type: 'add-anchor', pathId: this.activePath.id, anchor };
      }
    }

    return { type: 'none' };
  }

  public onPointerMove(x: number, y: number, _paths: VectorPath[]): PenToolAction {
    if (!this.activePath) return { type: 'none' };

    if (this.state === 'placing-first' && this.selectedAnchorIndex !== -1) {
      const a = this.activePath.anchors[this.selectedAnchorIndex];
      const hx = x - a.x;
      const hy = y - a.y;
      
      a.handleOut = { x: hx, y: hy };
      a.handleIn = { x: -hx, y: -hy };
      
      return { type: 'update-handle', pathId: this.activePath.id, anchorIndex: this.selectedAnchorIndex, handleType: 'out', handle: a.handleOut };
    }

    if (this.state === 'editing-node' && this.selectedAnchorIndex !== -1) {
      const a = this.activePath.anchors[this.selectedAnchorIndex];
      a.x = x;
      a.y = y;
      return { type: 'move-anchor', pathId: this.activePath.id, anchorIndex: this.selectedAnchorIndex, x, y };
    }

    if (this.state === 'editing-handle-in' && this.selectedAnchorIndex !== -1) {
      const a = this.activePath.anchors[this.selectedAnchorIndex];
      a.handleIn = { x: x - a.x, y: y - a.y };
      if (a.smooth) {
        a.handleOut = { x: -a.handleIn.x, y: -a.handleIn.y };
      }
      return { type: 'update-handle', pathId: this.activePath.id, anchorIndex: this.selectedAnchorIndex, handleType: 'in', handle: a.handleIn };
    }

    if (this.state === 'editing-handle-out' && this.selectedAnchorIndex !== -1) {
      const a = this.activePath.anchors[this.selectedAnchorIndex];
      a.handleOut = { x: x - a.x, y: y - a.y };
      if (a.smooth) {
        a.handleIn = { x: -a.handleOut.x, y: -a.handleOut.y };
      }
      return { type: 'update-handle', pathId: this.activePath.id, anchorIndex: this.selectedAnchorIndex, handleType: 'out', handle: a.handleOut };
    }

    if (this.state === 'drawing') {
      const hitAnchor = this.hitTestAnchor(this.activePath, x, y);
      this.hoveredAnchorIndex = hitAnchor;
    }

    return { type: 'none' };
  }

  public onPointerUp(_x: number, _y: number): PenToolAction {
    if (this.state === 'placing-first') {
      this.state = 'drawing';
    } else if (this.state === 'editing-node' || this.state === 'editing-handle-in' || this.state === 'editing-handle-out') {
      this.state = 'editing-node';
    } else if (this.state === 'closing') {
      this.state = 'idle';
      this.activePath = null;
      this.selectedAnchorIndex = -1;
    }
    return { type: 'none' };
  }

  public finishPath(): void {
    if (this.state === 'drawing' || this.state === 'placing-first' || this.state === 'editing-node') {
      this.state = 'idle';
      this.activePath = null;
      this.selectedAnchorIndex = -1;
    }
  }
}
