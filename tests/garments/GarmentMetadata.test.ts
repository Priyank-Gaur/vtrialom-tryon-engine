/**
 * tests/garments/GarmentMetadata.test.ts
 *
 * Unit tests for garment metadata validation and anchor templates.
 */

import { describe, it, expect } from "vitest";
import { validateGarmentMetadata, DEFAULT_ANCHORS } from "../../src/garments/GarmentMetadata";

describe("GarmentMetadata", () => {
  it("validates a fully specified garment metadata object", () => {
    const raw = {
      id: "test-shirt",
      name: "Test Shirt",
      category: "TSHIRT",
      assetUrl: "/garments/test.png",
      naturalWidth: 800,
      naturalHeight: 800,
      shoulderToWidthRatio: 0.45,
      anchors: {
        leftShoulder: { x: 0.3, y: 0.2 },
        rightShoulder: { x: 0.7, y: 0.2 },
        neckCentre: { x: 0.5, y: 0.22 },
        hemCentre: { x: 0.5, y: 0.9 },
      },
    };

    const validated = validateGarmentMetadata(raw);
    expect(validated.id).toBe("test-shirt");
    expect(validated.name).toBe("Test Shirt");
    expect(validated.category).toBe("TSHIRT");
    expect(validated.anchors.leftShoulder.x).toBe(0.3);
    expect(validated.anchors.rightShoulder.x).toBe(0.7);
    expect(validated.shoulderToWidthRatio).toBe(0.45);
  });

  it("applies default anchors when anchors are omitted", () => {
    const raw = {
      id: "default-tee",
      assetUrl: "/garments/default.png",
      category: "TSHIRT",
    };

    const validated = validateGarmentMetadata(raw);
    expect(validated.anchors.leftShoulder).toEqual(DEFAULT_ANCHORS.TSHIRT.leftShoulder);
    expect(validated.anchors.rightShoulder).toEqual(DEFAULT_ANCHORS.TSHIRT.rightShoulder);
    expect(validated.anchors.neckCentre).toEqual(DEFAULT_ANCHORS.TSHIRT.neckCentre);
    expect(validated.anchors.hemCentre).toEqual(DEFAULT_ANCHORS.TSHIRT.hemCentre);
  });

  it("throws on null or non-object input", () => {
    expect(() => validateGarmentMetadata(null)).toThrow(/non-null object/);
    expect(() => validateGarmentMetadata("string")).toThrow(/non-null object/);
  });

  it("throws when id is missing or empty", () => {
    expect(() => validateGarmentMetadata({ assetUrl: "/path.png" })).toThrow(/missing or empty 'id'/);
    expect(() => validateGarmentMetadata({ id: "   ", assetUrl: "/path.png" })).toThrow(/missing or empty 'id'/);
  });

  it("throws when assetUrl is missing or empty", () => {
    expect(() => validateGarmentMetadata({ id: "valid-id" })).toThrow(/missing or empty 'assetUrl'/);
    expect(() => validateGarmentMetadata({ id: "valid-id", assetUrl: "  " })).toThrow(/missing or empty 'assetUrl'/);
  });

  it("calculates derived shoulderToWidthRatio when omitted", () => {
    const raw = {
      id: "auto-ratio-shirt",
      assetUrl: "/garments/shirt.png",
      anchors: {
        leftShoulder: { x: 0.25, y: 0.2 },
        rightShoulder: { x: 0.75, y: 0.2 },
        neckCentre: { x: 0.5, y: 0.22 },
        hemCentre: { x: 0.5, y: 0.9 },
      },
    };

    const validated = validateGarmentMetadata(raw);
    // dx = 0.75 - 0.25 = 0.50
    expect(validated.shoulderToWidthRatio).toBeCloseTo(0.50);
  });
});

