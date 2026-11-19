/**
 * src/tracking/LandmarkSmoother.ts
 *
 * Exponential Moving Average (EMA) smoother applied independently to every
 * landmark coordinate (x, y, z, visibility).
 *
 * Why EMA instead of a simple window average?
 *   - O(1) memory per landmark — no history buffer required.
 *   - Naturally weights recent frames more heavily.
 *   - Single tunable parameter (alpha) makes it easy to understand.
 *
 * Alpha tuning guide:
 *   alpha = 1.0  → no smoothing (raw output)
 *   alpha = 0.5  → medium smoothing (~2-3 frame effective lag)
 *   alpha = 0.2  → heavy smoothing (~5 frame effective lag)
 *
 * For garment fitting we use alpha ≈ 0.4 by default: responsive enough to
 * follow natural movement but stable enough to avoid jittery garment edges.
 */

import type { PoseLandmarks } from "../core/types.js";

export class LandmarkSmoother {
  private readonly _alpha: number;
  private _smoothed: PoseLandmarks | null = null;

  /**
   * @param alpha EMA weight for the current frame [0,1].
   *              Higher = more responsive, lower = smoother.
   */
  constructor(alpha = 0.4) {
    if (alpha <= 0 || alpha > 1) {
      throw new RangeError(`LandmarkSmoother alpha must be in (0, 1], got ${alpha}`);
    }
    this._alpha = alpha;
  }

  /**
   * Apply EMA to a new frame of raw landmarks.
   * Returns the smoothed landmarks (same length array as input).
   *
   * On the first call there is no history, so the raw values are returned
   * unchanged and stored as the initial EMA state.
   */
  smooth(raw: PoseLandmarks): PoseLandmarks {
    if (this._smoothed === null || this._smoothed.length !== raw.length) {
      // First frame or landmark count changed — initialise with raw values.
      this._smoothed = raw.map((lm) => ({ ...lm }));
      return this._smoothed;
    }

    const alpha = this._alpha;
    const beta = 1 - alpha;

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const s = this._smoothed[i];

      s.x = alpha * r.x + beta * s.x;
      s.y = alpha * r.y + beta * s.y;
      s.z = alpha * r.z + beta * s.z;

      if (r.visibility !== undefined && s.visibility !== undefined) {
        s.visibility = alpha * r.visibility + beta * s.visibility;
      } else {
        s.visibility = r.visibility;
      }
    }

    return this._smoothed;
  }

  /** Reset internal state (e.g., when tracking is lost and re-acquired). */
  reset(): void {
    this._smoothed = null;
  }

  get alpha(): number {
    return this._alpha;
  }
}

