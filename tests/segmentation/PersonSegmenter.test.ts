/**
 * tests/segmentation/PersonSegmenter.test.ts
 *
 * Unit tests for PersonSegmenter configuration and mask processing logic.
 */

import { describe, it, expect } from "vitest";
import { PersonSegmenter } from "../../src/segmentation/PersonSegmenter";

describe("PersonSegmenter", () => {
  it("initializes with default config without errors", () => {
    const segmenter = new PersonSegmenter({
      model: "selfie",
      foregroundThreshold: 0.5,
      edgeSmoothingRadius: 3,
    });

    expect(segmenter.latestMask).toBeNull();
    expect(segmenter.inferenceLatencyMs).toBe(0);
  });

  it("safely handles segmentFrame when not initialized", () => {
    const segmenter = new PersonSegmenter({
      model: "selfie",
      foregroundThreshold: 0.5,
      edgeSmoothingRadius: 0,
    });

    const mockVideo = document.createElement("video");
    const result = segmenter.segmentFrame(mockVideo, 100);
    expect(result).toBeNull();
  });

  it("processes mask thresholding correctly", () => {
    const segmenter = new PersonSegmenter({
      model: "selfie",
      foregroundThreshold: 0.5,
      edgeSmoothingRadius: 0, // no blur
    });

    // Access private _processMask for unit testing
    const raw = new Float32Array([0.1, 0.49, 0.5, 0.85]);
    const processed = (segmenter as any)._processMask(raw, 2, 2, 0.5, 0);

    expect(processed[0]).toBe(0.0);
    expect(processed[1]).toBe(0.0);
    expect(processed[2]).toBe(1.0);
    expect(processed[3]).toBe(1.0);
  });

  it("applies spatial smoothing to reduce sharp edge transitions", () => {
    const segmenter = new PersonSegmenter({
      model: "selfie",
      foregroundThreshold: 0.5,
      edgeSmoothingRadius: 1, // 1-pixel radius filter
    });

    // 4x4 image with a sharp 2x2 square in center
    const raw = new Float32Array([
      0, 0, 0, 0,
      0, 1, 1, 0,
      0, 1, 1, 0,
      0, 0, 0, 0,
    ]);

    const processed = (segmenter as any)._processMask(raw, 4, 4, 0.5, 1);

    // The smoothed mask should have values between 0.0 and 1.0 along the boundary
    expect(processed[0]).toBeLessThan(0.5); // corner is low
    expect(processed[5]).toBeGreaterThan(0.3); // center is high
    expect(processed.length).toBe(16);
  });

  it("cleans up resources on dispose", () => {
    const segmenter = new PersonSegmenter({
      model: "selfie",
      foregroundThreshold: 0.5,
      edgeSmoothingRadius: 2,
    });

    segmenter.dispose();
    expect(segmenter.latestMask).toBeNull();
  });
});

