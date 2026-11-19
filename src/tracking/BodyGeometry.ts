/**
 * src/tracking/BodyGeometry.ts
 *
 * Derives high-level body geometry from a set of smoothed pose landmarks.
 *
 * Raw landmarks from MediaPipe are 33 individual points.  Garment fitting
 * needs higher-level concepts: shoulder width, torso centre, torso height,
 * in-plane rotation, etc.  This module computes those derived quantities.
 *
 * All coordinates are in MediaPipe's normalised [0,1] image space unless
 * the method name explicitly includes "Pixel".
 *
 * Limitation: derived geometry is based on 2D projected landmark positions.
 * Large torso rotations (>45°) will cause shoulder-width estimates to shrink
 * as the body foreshortens. This is an inherent 2D limitation addressed in
 * Phase 8 / 3D transition.
 */

import { LANDMARK_INDEX } from "../core/types.js";
import type { PoseLandmarks, BodyGeometry, NormalisedPoint2D } from "../core/types.js";

// Minimum visibility threshold below which a landmark is considered unreliable.
const MIN_VISIBILITY = 0.3;

/**
 * Compute all derived body geometry from smoothed landmarks.
 * Returns null if critical landmarks (shoulders, hips) are not reliably visible.
 */
export function computeBodyGeometry(
  landmarks: PoseLandmarks
): BodyGeometry | null {
  if (landmarks.length < 33) return null;

  const ls = landmarks[LANDMARK_INDEX.LEFT_SHOULDER];
  const rs = landmarks[LANDMARK_INDEX.RIGHT_SHOULDER];
  const lh = landmarks[LANDMARK_INDEX.LEFT_HIP];
  const rh = landmarks[LANDMARK_INDEX.RIGHT_HIP];

  // Require all four anchor landmarks to be reliably visible
  if (
    (ls.visibility ?? 1) < MIN_VISIBILITY ||
    (rs.visibility ?? 1) < MIN_VISIBILITY ||
    (lh.visibility ?? 1) < MIN_VISIBILITY ||
    (rh.visibility ?? 1) < MIN_VISIBILITY
  ) {
    return null;
  }

  const shoulderMidpoint: NormalisedPoint2D = {
    x: (ls.x + rs.x) / 2,
    y: (ls.y + rs.y) / 2,
  };

  const hipMidpoint: NormalisedPoint2D = {
    x: (lh.x + rh.x) / 2,
    y: (lh.y + rh.y) / 2,
  };

  // Euclidean distance in normalised space
  const shoulderWidth = Math.hypot(rs.x - ls.x, rs.y - ls.y);
  const hipWidth = Math.hypot(rh.x - lh.x, rh.y - lh.y);

  const torsoHeight = Math.abs(hipMidpoint.y - shoulderMidpoint.y);

  const torsoCentre: NormalisedPoint2D = {
    x: (shoulderMidpoint.x + hipMidpoint.x) / 2,
    y: (shoulderMidpoint.y + hipMidpoint.y) / 2,
  };

  // In-plane torso rotation: angle of the shoulder line relative to horizontal.
  // Using vector from right shoulder to left shoulder (which points in positive X).
  // 0 radians = level shoulders. Positive = clockwise tilt (left shoulder dropped).
  const torsoRotation = Math.atan2(ls.y - rs.y, ls.x - rs.x);

  return {
    shoulderMidpoint,
    shoulderWidth,
    hipMidpoint,
    hipWidth,
    torsoHeight,
    torsoCentre,
    torsoRotation,
    landmarks,
  };
}

/**
 * Convert a normalised [0,1] point to pixel coordinates given canvas dimensions.
 */
export function normToPixel(
  point: NormalisedPoint2D,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  return {
    x: point.x * canvasWidth,
    y: point.y * canvasHeight,
  };
}

