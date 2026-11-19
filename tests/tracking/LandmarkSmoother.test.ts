/**
 * tests/tracking/LandmarkSmoother.test.ts
 *
 * Unit tests for the EMA landmark smoother.
 * Pure function logic — no DOM, no MediaPipe.
 */

import { describe, it, expect } from "vitest";
import { LandmarkSmoother } from "../../src/tracking/LandmarkSmoother";
import type { PoseLandmarks } from "../../src/core/types";

function makeLandmarks(x: number, y: number, z = 0, n = 33): PoseLandmarks {
  return Array.from({ length: n }, () => ({ x, y, z, visibility: 1.0 }));
}

describe("LandmarkSmoother", () => {
  it("throws if alpha is out of range", () => {
    expect(() => new LandmarkSmoother(0)).toThrow(RangeError);
    expect(() => new LandmarkSmoother(1.1)).toThrow(RangeError);
    expect(() => new LandmarkSmoother(-0.1)).toThrow(RangeError);
  });

  it("accepts alpha = 1.0 (no smoothing)", () => {
    expect(() => new LandmarkSmoother(1.0)).not.toThrow();
  });

  it("returns raw values on the first call", () => {
    const smoother = new LandmarkSmoother(0.5);
    const raw = makeLandmarks(0.3, 0.7);
    const result = smoother.smooth(raw);
    expect(result[0].x).toBeCloseTo(0.3);
    expect(result[0].y).toBeCloseTo(0.7);
  });

  it("applies EMA on the second call", () => {
    const smoother = new LandmarkSmoother(0.5);
    smoother.smooth(makeLandmarks(0.0, 0.0));       // initialise at 0
    const result = smoother.smooth(makeLandmarks(1.0, 1.0)); // EMA: 0.5*1 + 0.5*0 = 0.5
    expect(result[0].x).toBeCloseTo(0.5);
    expect(result[0].y).toBeCloseTo(0.5);
  });

  it("with alpha=1.0 output equals raw input every frame", () => {
    const smoother = new LandmarkSmoother(1.0);
    smoother.smooth(makeLandmarks(0.0, 0.0));
    const result = smoother.smooth(makeLandmarks(0.9, 0.2));
    expect(result[0].x).toBeCloseTo(0.9);
    expect(result[0].y).toBeCloseTo(0.2);
  });

  it("reset() clears state so next call returns raw values", () => {
    const smoother = new LandmarkSmoother(0.5);
    smoother.smooth(makeLandmarks(1.0, 1.0));
    smoother.reset();
    const result = smoother.smooth(makeLandmarks(0.2, 0.8));
    expect(result[0].x).toBeCloseTo(0.2);
    expect(result[0].y).toBeCloseTo(0.8);
  });

  it("re-initialises when landmark count changes", () => {
    const smoother = new LandmarkSmoother(0.5);
    smoother.smooth(makeLandmarks(0.5, 0.5, 0, 33));
    const result = smoother.smooth(makeLandmarks(0.9, 0.1, 0, 17));
    // After count change, treated as first frame → raw values returned
    expect(result).toHaveLength(17);
    expect(result[0].x).toBeCloseTo(0.9);
  });

  it("smooths visibility channel when present", () => {
    const smoother = new LandmarkSmoother(0.5);
    smoother.smooth(makeLandmarks(0, 0, 0, 1));  // vis=1.0 at frame 0
    const raw2 = [{ x: 0, y: 0, z: 0, visibility: 0.0 }];
    const result = smoother.smooth(raw2);
    expect(result[0].visibility).toBeCloseTo(0.5); // 0.5*0 + 0.5*1 = 0.5
  });
});

