/**
 * tests/fitting/GarmentFitter.test.ts
 *
 * Unit tests for GarmentFitter landmark-driven transform computation.
 */

import { describe, it, expect } from "vitest";
import { GarmentFitter } from "../../src/fitting/GarmentFitter";
import type { BodyGeometry, LoadedGarment } from "../../src/core/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBody(overrides: Partial<BodyGeometry> = {}): BodyGeometry {
  return {
    shoulderMidpoint: { x: 0.5, y: 0.3 },
    shoulderWidth: 0.3,
    hipMidpoint: { x: 0.5, y: 0.6 },
    hipWidth: 0.28,
    torsoHeight: 0.3,
    torsoCentre: { x: 0.5, y: 0.45 },
    torsoRotation: 0,
    landmarks: Array.from({ length: 33 }, (_, i) => {
      // Shoulder indices 11 (LEFT) and 12 (RIGHT)
      if (i === 11) return { x: 0.35, y: 0.3, z: 0, visibility: 0.9 };
      if (i === 12) return { x: 0.65, y: 0.3, z: 0, visibility: 0.9 };
      return { x: 0.5, y: 0.5, z: 0, visibility: 0.8 };
    }),
    ...overrides,
  };
}

function makeGarment(overrides: Partial<LoadedGarment> = {}): LoadedGarment {
  const img = document.createElement("img");
  return {
    metadata: {
      id: "test-tee",
      name: "Test Tee",
      category: "TSHIRT",
      assetUrl: "/garments/test-tee.svg",
      naturalWidth: 600,
      naturalHeight: 800,
      shoulderToWidthRatio: 0.5,
      anchors: {
        leftShoulder: { x: 0.25, y: 0.15 },
        rightShoulder: { x: 0.75, y: 0.15 },
        neckCentre: { x: 0.5, y: 0.1 },
        hemCentre: { x: 0.5, y: 0.9 },
      },
    },
    image: img,
    dimensions: { width: 600, height: 800, aspectRatio: 0.75 },
    // shoulderSpan = 0.75 - 0.25 = 0.50
    shoulderSpan: 0.50,
    torsoLength: 0.75,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GarmentFitter", () => {
  const fitter = new GarmentFitter();
  const CANVAS_W = 640;
  const CANVAS_H = 480;

  it("returns a FittingResult with the correct garmentId", () => {
    const result = fitter.fit(makeBody(), makeGarment(), CANVAS_W, CANVAS_H);
    expect(result.garmentId).toBe("test-tee");
  });

  it("marks result as confident when shoulder visibility is above threshold", () => {
    const result = fitter.fit(makeBody(), makeGarment(), CANVAS_W, CANVAS_H);
    expect(result.confident).toBe(true);
  });

  it("marks result as not-confident when shoulder visibility is low", () => {
    const body = makeBody();
    // Set left shoulder visibility below threshold
    body.landmarks[11] = { x: 0.35, y: 0.3, z: 0, visibility: 0.1 };
    const result = fitter.fit(body, makeGarment(), CANVAS_W, CANVAS_H);
    expect(result.confident).toBe(false);
  });

  it("garment width scales so shoulder span matches body shoulder pixel width", () => {
    const body = makeBody();
    const garment = makeGarment();
    const result = fitter.fit(body, garment, CANVAS_W, CANVAS_H);

    // Body shoulder pixels: LEFT=0.35, RIGHT=0.65 → mirrored: 0.65, 0.35
    // After mirror: lsPx.x = (1-0.35)*640 = 0.65*640 = 416, rsPx.x = (1-0.65)*640 = 0.35*640 = 224
    // bodyShoulderPx ≈ |416 - 224| = 192  (Y are equal so just X distance)
    const bodyShoulderPx = Math.abs((1 - 0.35) * CANVAS_W - (1 - 0.65) * CANVAS_W);
    // garmentWidthPx = bodyShoulderPx / shoulderSpan = 192 / 0.5 = 384
    expect(result.transform.width).toBeCloseTo(bodyShoulderPx / garment.shoulderSpan, 1);
  });

  it("garment height maintains aspect ratio", () => {
    const result = fitter.fit(makeBody(), makeGarment(), CANVAS_W, CANVAS_H);
    const { width, height } = result.transform;
    // aspect = width/height = 0.75 → height = width / 0.75
    expect(height).toBeCloseTo(width / 0.75, 1);
  });

  it("scale factor equals garmentWidthPx / garment.dimensions.width", () => {
    const garment = makeGarment();
    const result = fitter.fit(makeBody(), garment, CANVAS_W, CANVAS_H);
    expect(result.scale).toBeCloseTo(result.transform.width / garment.dimensions.width, 5);
  });

  it("rotation is 0 when torsoRotation is 0", () => {
    const result = fitter.fit(makeBody(), makeGarment(), CANVAS_W, CANVAS_H);
    expect(result.transform.rotation).toBe(0);
  });

  it("rotation is mirrored for selfie display (-torsoRotation)", () => {
    const body = makeBody({ torsoRotation: Math.PI / 8 });
    const result = fitter.fit(body, makeGarment(), CANVAS_W, CANVAS_H);
    expect(result.transform.rotation).toBeCloseTo(-Math.PI / 8, 5);
  });

  it("origin is the midpoint of the shoulder pixels", () => {
    const body = makeBody();
    const result = fitter.fit(body, makeGarment(), CANVAS_W, CANVAS_H);

    // Mirrored: lsPx.x = (1-0.35)*640, rsPx.x = (1-0.65)*640
    const lsPxX = (1 - 0.35) * CANVAS_W;
    const rsPxX = (1 - 0.65) * CANVAS_W;
    const expectedOriginX = (lsPxX + rsPxX) / 2;
    expect(result.transform.originX).toBeCloseTo(expectedOriginX, 1);
  });

  it("computes unrotated local anchor offset correctly (x, y)", () => {
    const body = makeBody();
    const garment = makeGarment();
    const result = fitter.fit(body, garment, CANVAS_W, CANVAS_H);

    // Garment anchors: left=(0.25, 0.15), right=(0.75, 0.15) -> midpoint = (0.50, 0.15)
    // localX = -0.50 * width, localY = -0.15 * height
    expect(result.transform.x).toBeCloseTo(-0.50 * result.transform.width, 1);
    expect(result.transform.y).toBeCloseTo(-0.15 * result.transform.height, 1);
  });

  it("respects custom minVisibility from FitterConfig", () => {
    const strictFitter = new GarmentFitter({ minVisibility: 0.95 });
    // Default body has visibility 0.9 → below 0.95
    const result = strictFitter.fit(makeBody(), makeGarment(), CANVAS_W, CANVAS_H);
    expect(result.confident).toBe(false);
  });
});
