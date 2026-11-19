/**
 * tests/segmentation/OcclusionManager.test.ts
 *
 * Unit tests for body-part occlusion analysis and geometry algorithms.
 */

import { describe, it, expect } from "vitest";
import { OcclusionManager } from "../../src/segmentation/OcclusionManager";
import { LANDMARK_INDEX, type PoseLandmarks } from "../../src/core/types";

function createMockPose(overrides: Partial<Record<number, { x: number; y: number; visibility?: number }>> = {}): PoseLandmarks {
  const lms: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.9,
  }));

  for (const [idxStr, val] of Object.entries(overrides)) {
    const idx = Number(idxStr);
    lms[idx] = { ...lms[idx], ...val };
  }

  return lms;
}

describe("OcclusionManager", () => {
  const manager = new OcclusionManager();

  describe("isPointInPolygon", () => {
    // Simple square polygon: (0.2, 0.2) to (0.8, 0.8)
    const square = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];

    it("returns true for point strictly inside", () => {
      expect(manager.isPointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
      expect(manager.isPointInPolygon({ x: 0.3, y: 0.7 }, square)).toBe(true);
    });

    it("returns false for points outside", () => {
      expect(manager.isPointInPolygon({ x: 0.1, y: 0.5 }, square)).toBe(false);
      expect(manager.isPointInPolygon({ x: 0.9, y: 0.5 }, square)).toBe(false);
      expect(manager.isPointInPolygon({ x: 0.5, y: 0.1 }, square)).toBe(false);
      expect(manager.isPointInPolygon({ x: 0.5, y: 0.9 }, square)).toBe(false);
    });

    it("returns false for degenerate polygon with < 3 vertices", () => {
      expect(manager.isPointInPolygon({ x: 0.5, y: 0.5 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    });
  });

  describe("calculateSegmentOverlap", () => {
    const square = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];

    it("returns 1.0 when entire segment is inside", () => {
      const overlap = manager.calculateSegmentOverlap(
        { x: 0.3, y: 0.5 },
        { x: 0.7, y: 0.5 },
        square,
        10
      );
      expect(overlap).toBeCloseTo(1.0);
    });

    it("returns 0.0 when segment is completely outside", () => {
      const overlap = manager.calculateSegmentOverlap(
        { x: 0.0, y: 0.5 },
        { x: 0.1, y: 0.5 },
        square,
        10
      );
      expect(overlap).toBe(0.0);
    });

    it("returns ~0.5 when half of the segment is inside", () => {
      // From x=0.5 (center) to x=1.1 (outside, boundary at 0.8)
      const overlap = manager.calculateSegmentOverlap(
        { x: 0.5, y: 0.5 },
        { x: 1.1, y: 0.5 },
        square,
        10
      );
      expect(overlap).toBeGreaterThan(0.35);
      expect(overlap).toBeLessThan(0.65);
    });
  });

  describe("analyzeOcclusion", () => {
    it("returns null if key landmarks are not visible", () => {
      const lms = createMockPose({
        [LANDMARK_INDEX.LEFT_SHOULDER]: { x: 0.6, y: 0.3, visibility: 0.1 }, // invisible
      });
      expect(manager.analyzeOcclusion(lms)).toBeNull();
    });

    it("detects no occlusion when arms are down at sides", () => {
      // Body: shoulders at x=0.4, 0.6, hips at x=0.45, 0.55
      // Left arm at x=0.75, 0.8 (outside body to the right in image space)
      // Right arm at x=0.25, 0.2 (outside body to the left in image space)
      const lms = createMockPose({
        [LANDMARK_INDEX.LEFT_SHOULDER]: { x: 0.6, y: 0.3, visibility: 1.0 },
        [LANDMARK_INDEX.RIGHT_SHOULDER]: { x: 0.4, y: 0.3, visibility: 1.0 },
        [LANDMARK_INDEX.LEFT_HIP]: { x: 0.55, y: 0.7, visibility: 1.0 },
        [LANDMARK_INDEX.RIGHT_HIP]: { x: 0.45, y: 0.7, visibility: 1.0 },

        // Left arm straight down at side
        [LANDMARK_INDEX.LEFT_ELBOW]: { x: 0.72, y: 0.5, visibility: 1.0 },
        [LANDMARK_INDEX.LEFT_WRIST]: { x: 0.75, y: 0.7, visibility: 1.0 },

        // Right arm straight down at side
        [LANDMARK_INDEX.RIGHT_ELBOW]: { x: 0.28, y: 0.5, visibility: 1.0 },
        [LANDMARK_INDEX.RIGHT_WRIST]: { x: 0.25, y: 0.7, visibility: 1.0 },
      });

      const occlusion = manager.analyzeOcclusion(lms);
      expect(occlusion).not.toBeNull();
      if (!occlusion) return;

      expect(occlusion.isLeftArmOccludingTorso).toBe(false);
      expect(occlusion.isRightArmOccludingTorso).toBe(false);
      expect(occlusion.isLeftHandOverTorso).toBe(false);
      expect(occlusion.isRightHandOverTorso).toBe(false);
      expect(occlusion.leftArmOverlapRatio).toBe(0);
      expect(occlusion.rightArmOverlapRatio).toBe(0);
    });

    it("detects occlusion when left arm crosses over the torso", () => {
      // Left wrist placed on chest center (x=0.5, y=0.45)
      const lms = createMockPose({
        [LANDMARK_INDEX.LEFT_SHOULDER]: { x: 0.6, y: 0.3, visibility: 1.0 },
        [LANDMARK_INDEX.RIGHT_SHOULDER]: { x: 0.4, y: 0.3, visibility: 1.0 },
        [LANDMARK_INDEX.LEFT_HIP]: { x: 0.55, y: 0.7, visibility: 1.0 },
        [LANDMARK_INDEX.RIGHT_HIP]: { x: 0.45, y: 0.7, visibility: 1.0 },

        // Left arm crossing torso: elbow at 0.62, wrist resting on center of chest
        [LANDMARK_INDEX.LEFT_ELBOW]: { x: 0.62, y: 0.45, visibility: 1.0 },
        [LANDMARK_INDEX.LEFT_WRIST]: { x: 0.48, y: 0.45, visibility: 1.0 },

        // Right arm at side
        [LANDMARK_INDEX.RIGHT_ELBOW]: { x: 0.28, y: 0.5, visibility: 1.0 },
        [LANDMARK_INDEX.RIGHT_WRIST]: { x: 0.25, y: 0.7, visibility: 1.0 },
      });

      const occlusion = manager.analyzeOcclusion(lms);
      expect(occlusion).not.toBeNull();
      if (!occlusion) return;

      expect(occlusion.isLeftArmOccludingTorso).toBe(true);
      expect(occlusion.isLeftHandOverTorso).toBe(true);
      expect(occlusion.leftArmOverlapRatio).toBeGreaterThan(0.3);

      // Right arm remains free of occlusion
      expect(occlusion.isRightArmOccludingTorso).toBe(false);
      expect(occlusion.isRightHandOverTorso).toBe(false);
    });

    it("detects occlusion when both arms cross chest (folded arms)", () => {
      const lms = createMockPose({
        [LANDMARK_INDEX.LEFT_SHOULDER]: { x: 0.6, y: 0.3, visibility: 1.0 },
        [LANDMARK_INDEX.RIGHT_SHOULDER]: { x: 0.4, y: 0.3, visibility: 1.0 },
        [LANDMARK_INDEX.LEFT_HIP]: { x: 0.55, y: 0.7, visibility: 1.0 },
        [LANDMARK_INDEX.RIGHT_HIP]: { x: 0.45, y: 0.7, visibility: 1.0 },

        // Left wrist crossing over to right ribcage
        [LANDMARK_INDEX.LEFT_ELBOW]: { x: 0.65, y: 0.45, visibility: 1.0 },
        [LANDMARK_INDEX.LEFT_WRIST]: { x: 0.42, y: 0.48, visibility: 1.0 },

        // Right wrist crossing over to left ribcage
        [LANDMARK_INDEX.RIGHT_ELBOW]: { x: 0.35, y: 0.45, visibility: 1.0 },
        [LANDMARK_INDEX.RIGHT_WRIST]: { x: 0.58, y: 0.50, visibility: 1.0 },
      });

      const occlusion = manager.analyzeOcclusion(lms);
      expect(occlusion).not.toBeNull();
      if (!occlusion) return;

      expect(occlusion.isLeftArmOccludingTorso).toBe(true);
      expect(occlusion.isRightArmOccludingTorso).toBe(true);
      expect(occlusion.isLeftHandOverTorso).toBe(true);
      expect(occlusion.isRightHandOverTorso).toBe(true);
    });
  });
});

