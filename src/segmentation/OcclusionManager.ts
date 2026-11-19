/**
 * src/segmentation/OcclusionManager.ts
 *
 * Analyzes body-part occlusion to determine when foreground body parts (arms, hands)
 * cross in front of the torso and should be layered above the virtual garment.
 *
 * Responsibilities:
 *   - Construct geometric boundary polygons for the torso, left arm, and right arm.
 *   - Perform geometric intersection and point-in-polygon tests.
 *   - Calculate overlap ratios when arms cross over the chest/torso.
 *   - Generate occlusion clipping paths and masks for downstream compositing.
 */

import { LANDMARK_INDEX } from "../core/types.js";
import type {
  PoseLandmarks,
  NormalisedPoint2D,
  NormalisedPolygon,
  OcclusionState,
} from "../core/types.js";

export class OcclusionManager {
  /**
   * Analyzes the current pose landmarks and estimates the occlusion state.
   * Returns null if key torso landmarks are missing or below visibility threshold.
   */
  analyzeOcclusion(landmarks: PoseLandmarks): OcclusionState | null {
    if (landmarks.length < 25) return null;

    const ls = landmarks[LANDMARK_INDEX.LEFT_SHOULDER];
    const rs = landmarks[LANDMARK_INDEX.RIGHT_SHOULDER];
    const lh = landmarks[LANDMARK_INDEX.LEFT_HIP];
    const rh = landmarks[LANDMARK_INDEX.RIGHT_HIP];

    const le = landmarks[LANDMARK_INDEX.LEFT_ELBOW];
    const re = landmarks[LANDMARK_INDEX.RIGHT_ELBOW];
    const lw = landmarks[LANDMARK_INDEX.LEFT_WRIST];
    const rw = landmarks[LANDMARK_INDEX.RIGHT_WRIST];

    // Ensure torso anchors are visible
    if (
      (ls.visibility ?? 1) < 0.3 ||
      (rs.visibility ?? 1) < 0.3 ||
      (lh.visibility ?? 1) < 0.3 ||
      (rh.visibility ?? 1) < 0.3
    ) {
      return null;
    }

    const shoulderDist = Math.hypot(rs.x - ls.x, rs.y - ls.y);
    const armThickness = Math.max(shoulderDist * 0.14, 0.025);

    // 1. Estimate Torso Polygon (expanded slightly to account for ribcage & clothing)
    const torsoPolygon = this.computeTorsoPolygon(ls, rs, rh, lh, shoulderDist);

    // 2. Estimate Arm Polygons (shoulder -> elbow -> wrist capsule)
    const leftArmPolygon = this.computeArmPolygon(ls, le, lw, armThickness);
    const rightArmPolygon = this.computeArmPolygon(rs, re, rw, armThickness);

    // 3. Occlusion & overlap analysis for left and right arms
    const leftHandVisible = (lw.visibility ?? 1) >= 0.3;
    const rightHandVisible = (rw.visibility ?? 1) >= 0.3;

    const isLeftHandOverTorso = leftHandVisible && this.isPointInPolygon(lw, torsoPolygon);
    const isRightHandOverTorso = rightHandVisible && this.isPointInPolygon(rw, torsoPolygon);

    // Sample points along forearm (elbow to wrist) to measure overlap with torso
    const leftOverlap = leftHandVisible
      ? this.calculateSegmentOverlap(le, lw, torsoPolygon, 10)
      : 0;

    const rightOverlap = rightHandVisible
      ? this.calculateSegmentOverlap(re, rw, torsoPolygon, 10)
      : 0;

    // Consider arm occluding if overlap ratio > 10% or hand is placed over the torso
    const isLeftArmOccludingTorso = leftOverlap > 0.1 || isLeftHandOverTorso;
    const isRightArmOccludingTorso = rightOverlap > 0.1 || isRightHandOverTorso;

    return {
      isLeftArmOccludingTorso,
      isRightArmOccludingTorso,
      isLeftHandOverTorso,
      isRightHandOverTorso,
      leftArmOverlapRatio: leftOverlap,
      rightArmOverlapRatio: rightOverlap,
      torsoPolygon,
      leftArmPolygon,
      rightArmPolygon,
    };
  }

  // =========================================================================
  // Geometry Construction Helpers
  // =========================================================================

  /**
   * Computes an expanded 4-point torso polygon.
   */
  computeTorsoPolygon(
    ls: NormalisedPoint2D,
    rs: NormalisedPoint2D,
    rh: NormalisedPoint2D,
    lh: NormalisedPoint2D,
    shoulderWidth: number
  ): NormalisedPolygon {
    // Normal vector perpendicular to shoulders for slight upward/outward padding
    const expandX = shoulderWidth * 0.1;
    const expandY = shoulderWidth * 0.05;

    return [
      // Top-Left (near left shoulder)
      { x: ls.x + expandX, y: ls.y - expandY },
      // Top-Right (near right shoulder)
      { x: rs.x - expandX, y: rs.y - expandY },
      // Bottom-Right (near right hip)
      { x: rh.x - expandX, y: rh.y + expandY },
      // Bottom-Left (near left hip)
      { x: lh.x + expandX, y: lh.y + expandY },
    ];
  }

  /**
   * Computes an enclosing polygon around an arm chain (shoulder -> elbow -> wrist).
   */
  computeArmPolygon(
    shoulder: NormalisedPoint2D,
    elbow: NormalisedPoint2D,
    wrist: NormalisedPoint2D,
    thickness: number
  ): NormalisedPolygon {
    // Perpendicular vector for upper arm (shoulder -> elbow)
    const upperDx = elbow.x - shoulder.x;
    const upperDy = elbow.y - shoulder.y;
    const upperLen = Math.hypot(upperDx, upperDy) || 1;
    const upperNx = (-upperDy / upperLen) * thickness;
    const upperNy = (upperDx / upperLen) * thickness;

    // Perpendicular vector for forearm (elbow -> wrist)
    const foreDx = wrist.x - elbow.x;
    const foreDy = wrist.y - elbow.y;
    const foreLen = Math.hypot(foreDx, foreDy) || 1;
    const foreNx = (-foreDy / foreLen) * thickness;
    const foreNy = (foreDx / foreLen) * thickness;

    return [
      { x: shoulder.x + upperNx, y: shoulder.y + upperNy },
      { x: elbow.x + upperNx, y: elbow.y + upperNy },
      { x: wrist.x + foreNx * 1.2, y: wrist.y + foreNy * 1.2 }, // wrist/hand cap
      { x: wrist.x - foreNx * 1.2, y: wrist.y - foreNy * 1.2 },
      { x: elbow.x - upperNx, y: elbow.y - upperNy },
      { x: shoulder.x - upperNx, y: shoulder.y - upperNy },
    ];
  }

  // =========================================================================
  // Geometric Intersection Tests
  // =========================================================================

  /**
   * Ray-casting point-in-polygon algorithm.
   * Returns true if point (x, y) is inside the polygon.
   */
  isPointInPolygon(point: NormalisedPoint2D, polygon: NormalisedPolygon): boolean {
    if (polygon.length < 3) return false;

    let inside = false;
    const x = point.x;
    const y = point.y;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

      if (intersect) inside = !inside;
    }

    return inside;
  }

  /**
   * Samples N points uniformly along the line segment (p1 -> p2)
   * and returns the fraction of points that fall inside the polygon [0.0, 1.0].
   */
  calculateSegmentOverlap(
    p1: NormalisedPoint2D,
    p2: NormalisedPoint2D,
    polygon: NormalisedPolygon,
    sampleCount = 10
  ): number {
    if (sampleCount <= 0) return 0;

    let insideCount = 0;
    for (let i = 0; i <= sampleCount; i++) {
      const t = i / sampleCount;
      const samplePoint: NormalisedPoint2D = {
        x: p1.x + t * (p2.x - p1.x),
        y: p1.y + t * (p2.y - p1.y),
      };

      if (this.isPointInPolygon(samplePoint, polygon)) {
        insideCount++;
      }
    }

    return insideCount / (sampleCount + 1);
  }
}

