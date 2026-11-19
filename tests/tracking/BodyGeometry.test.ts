/**
 * tests/tracking/BodyGeometry.test.ts
 *
 * Unit tests for BodyGeometry derivation and coordinate conversion.
 */

import { describe, it, expect } from "vitest";
import { computeBodyGeometry, normToPixel } from "../../src/tracking/BodyGeometry";
import { LANDMARK_INDEX, type PoseLandmarks } from "../../src/core/types";

function createMockLandmarks(overrides: Partial<Record<number, { x: number; y: number; z?: number; visibility?: number }>> = {}): PoseLandmarks {
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

describe("BodyGeometry", () => {
  it("returns null if landmark count is less than 33", () => {
    const incomplete = Array.from({ length: 20 }, () => ({ x: 0, y: 0, z: 0 }));
    expect(computeBodyGeometry(incomplete)).toBeNull();
  });

  it("returns null if any key landmark has low visibility", () => {
    const lms = createMockLandmarks({
      [LANDMARK_INDEX.LEFT_SHOULDER]: { x: 0.6, y: 0.3, visibility: 0.2 }, // below 0.3 threshold
    });
    expect(computeBodyGeometry(lms)).toBeNull();
  });

  it("calculates correct geometry for standard posture", () => {
    const lms = createMockLandmarks({
      [LANDMARK_INDEX.LEFT_SHOULDER]: { x: 0.6, y: 0.3, visibility: 1.0 },
      [LANDMARK_INDEX.RIGHT_SHOULDER]: { x: 0.4, y: 0.3, visibility: 1.0 },
      [LANDMARK_INDEX.LEFT_HIP]: { x: 0.55, y: 0.7, visibility: 1.0 },
      [LANDMARK_INDEX.RIGHT_HIP]: { x: 0.45, y: 0.7, visibility: 1.0 },
    });

    const geo = computeBodyGeometry(lms);
    expect(geo).not.toBeNull();
    if (!geo) return;

    // Shoulder midpoint
    expect(geo.shoulderMidpoint.x).toBeCloseTo(0.5);
    expect(geo.shoulderMidpoint.y).toBeCloseTo(0.3);

    // Hip midpoint
    expect(geo.hipMidpoint.x).toBeCloseTo(0.5);
    expect(geo.hipMidpoint.y).toBeCloseTo(0.7);

    // Torso height = 0.7 - 0.3 = 0.4
    expect(geo.torsoHeight).toBeCloseTo(0.4);

    // Shoulder width = |0.4 - 0.6| = 0.2
    expect(geo.shoulderWidth).toBeCloseTo(0.2);

    // Hip width = |0.45 - 0.55| = 0.1
    expect(geo.hipWidth).toBeCloseTo(0.1);

    // Torso centre
    expect(geo.torsoCentre.x).toBeCloseTo(0.5);
    expect(geo.torsoCentre.y).toBeCloseTo(0.5);

    // Level shoulders: rs.y - ls.y = 0.3 - 0.3 = 0 => 0 rad rotation
    expect(Math.abs(geo.torsoRotation)).toBeLessThan(1e-5);
  });

  it("calculates correct in-plane rotation when tilted", () => {
    // Right shoulder higher (smaller y in image space)
    const lms = createMockLandmarks({
      [LANDMARK_INDEX.LEFT_SHOULDER]: { x: 0.6, y: 0.35, visibility: 1.0 },
      [LANDMARK_INDEX.RIGHT_SHOULDER]: { x: 0.4, y: 0.25, visibility: 1.0 },
      [LANDMARK_INDEX.LEFT_HIP]: { x: 0.55, y: 0.7, visibility: 1.0 },
      [LANDMARK_INDEX.RIGHT_HIP]: { x: 0.45, y: 0.7, visibility: 1.0 },
    });

    const geo = computeBodyGeometry(lms);
    expect(geo).not.toBeNull();
    if (!geo) return;

    // dy = 0.35 - 0.25 = 0.1, dx = 0.6 - 0.4 = 0.2
    expect(geo.torsoRotation).toBeCloseTo(Math.atan2(0.1, 0.2));
  });

  describe("normToPixel", () => {
    it("converts normalized coordinates to pixel space", () => {
      const pt = { x: 0.25, y: 0.5 };
      const pixel = normToPixel(pt, 1280, 720);
      expect(pixel.x).toBe(320);
      expect(pixel.y).toBe(360);
    });
  });
});
