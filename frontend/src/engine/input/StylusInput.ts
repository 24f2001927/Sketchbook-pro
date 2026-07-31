export interface StylusInput {
  x: number;
  y: number;
  pressure: number;     // Normalized 0.0 - 1.0
  tiltX: number;        // Radians/degrees tilt of stylus relative to screen
  tiltY: number;
  twist: number;        // Rotation of stylus around its own axis (in degrees, if supported)
  pointerType: 'pen' | 'mouse' | 'touch';
  timestamp: number;
  velocity: number;     // Pixels per millisecond
}

export type StabilizationMode = 'none' | 'smooth' | 'lazy';

export interface StabilizerSettings {
  mode: StabilizationMode;
  smoothFactor: number; // For 'smooth' (0 to 1, higher = smoother/more delay)
  lazyRadius: number;   // For 'lazy' (radius in pixels of the lazy rope)
}

export class InputNormalizer {
  private lastPosition: { x: number; y: number; time: number } | null = null;

  public normalize(e: PointerEvent, targetElement: HTMLElement): StylusInput {
    const rect = targetElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const timestamp = e.timeStamp;

    // Calculate velocity
    let velocity = 0;
    if (this.lastPosition) {
      const dx = x - this.lastPosition.x;
      const dy = y - this.lastPosition.y;
      const dt = timestamp - this.lastPosition.time;
      if (dt > 0) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        velocity = dist / dt; // Pixels per millisecond
      }
    }

    this.lastPosition = { x, y, time: timestamp };

    // Default values if API doesn't support them
    let pressure = 0.5; // fallback
    if (e.pointerType === 'mouse') {
      pressure = e.buttons > 0 ? 0.5 : 0.0;
    } else if (e.pressure !== undefined && e.pressure !== 0) {
      // Chrome/Firefox send pressure for stylus
      pressure = e.pressure;
    }

    // Twist is supported by few styluses, fallback to 0
    // @ts-ignore - twist is a non-standard property on some events but exists on PointerEvent sometimes
    const twist = e.twist || 0;

    return {
      x,
      y,
      pressure,
      tiltX: e.tiltX || 0,
      tiltY: e.tiltY || 0,
      twist,
      pointerType: e.pointerType as 'pen' | 'mouse' | 'touch',
      timestamp,
      velocity,
    };
  }

  public reset(): void {
    this.lastPosition = null;
  }
}

export class StrokeStabilizer {
  private history: StylusInput[] = [];
  private lazyPivot: { x: number; y: number } | null = null;

  public stabilize(input: StylusInput, settings: StabilizerSettings): StylusInput {
    if (settings.mode === 'none') {
      return input;
    }

    if (settings.mode === 'smooth') {
      this.history.push(input);
      // Keep only last N inputs
      const maxHistory = Math.max(2, Math.floor(settings.smoothFactor * 20));
      if (this.history.length > maxHistory) {
        this.history.shift();
      }

      // Simple exponential moving average
      const count = this.history.length;
      let sumX = 0;
      let sumY = 0;
      let sumPressure = 0;
      let sumTiltX = 0;
      let sumTiltY = 0;
      let sumTwist = 0;
      let weightSum = 0;

      // Give more weight to more recent points
      for (let i = 0; i < count; i++) {
        const weight = Math.pow(1 - settings.smoothFactor, count - 1 - i);
        sumX += this.history[i].x * weight;
        sumY += this.history[i].y * weight;
        sumPressure += this.history[i].pressure * weight;
        sumTiltX += this.history[i].tiltX * weight;
        sumTiltY += this.history[i].tiltY * weight;
        sumTwist += this.history[i].twist * weight;
        weightSum += weight;
      }

      return {
        ...input,
        x: sumX / weightSum,
        y: sumY / weightSum,
        pressure: sumPressure / weightSum,
        tiltX: sumTiltX / weightSum,
        tiltY: sumTiltY / weightSum,
        twist: sumTwist / weightSum,
      };
    }

    if (settings.mode === 'lazy') {
      if (!this.lazyPivot) {
        this.lazyPivot = { x: input.x, y: input.y };
        return input;
      }

      const dx = input.x - this.lazyPivot.x;
      const dy = input.y - this.lazyPivot.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= settings.lazyRadius) {
        // Pointer is inside the active lazy zone boundary, don't move pivot
        return {
          ...input,
          x: this.lazyPivot.x,
          y: this.lazyPivot.y,
        };
      }

      // Pull the pivot towards the cursor along the vector by (distance - lazyRadius)
      const ratio = (distance - settings.lazyRadius) / distance;
      const newX = this.lazyPivot.x + dx * ratio;
      const newY = this.lazyPivot.y + dy * ratio;

      this.lazyPivot = { x: newX, y: newY };

      return {
        ...input,
        x: newX,
        y: newY,
      };
    }

    return input;
  }

  public reset(): void {
    this.history = [];
    this.lazyPivot = null;
  }
}
