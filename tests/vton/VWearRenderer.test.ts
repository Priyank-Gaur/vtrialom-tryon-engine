/**
 * tests/vton/VWearRenderer.test.ts
 *
 * Unit tests for VWearRenderer — Segmentation-Based Inverse Compositing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { VWearRenderer } from "../../src/vton/VWearRenderer";
import { ANYWEAR_PRESETS } from "../../src/vton/AnywearPresets";
import type { BodyGeometry, SegmentationResult } from "../../src/core/types";

function makeTestBody(): BodyGeometry {
  return {
    shoulderMidpoint: { x: 0.5, y: 0.35 },
    shoulderWidth: 0.3,
    hipMidpoint: { x: 0.5, y: 0.65 },
    hipWidth: 0.25,
    torsoHeight: 0.3,
    torsoCentre: { x: 0.5, y: 0.5 },
    torsoRotation: 0,
    landmarks: Array.from({ length: 33 }, (_, i) => {
      if (i === 0) return { x: 0.5, y: 0.18, z: 0.0, visibility: 0.95 };  // NOSE
      if (i === 9) return { x: 0.47, y: 0.24, z: 0.0, visibility: 0.9 };  // MOUTH_LEFT
      if (i === 10) return { x: 0.53, y: 0.24, z: 0.0, visibility: 0.9 }; // MOUTH_RIGHT
      if (i === 11) return { x: 0.65, y: 0.35, z: 0.05, visibility: 0.9 }; // LEFT_SHOULDER
      if (i === 12) return { x: 0.35, y: 0.35, z: -0.05, visibility: 0.9 }; // RIGHT_SHOULDER
      if (i === 13) return { x: 0.75, y: 0.52, z: 0.02, visibility: 0.85 }; // LEFT_ELBOW
      if (i === 14) return { x: 0.25, y: 0.52, z: -0.02, visibility: 0.85 }; // RIGHT_ELBOW
      if (i === 15) return { x: 0.80, y: 0.68, z: 0.02, visibility: 0.85 }; // LEFT_WRIST
      if (i === 16) return { x: 0.20, y: 0.68, z: -0.02, visibility: 0.85 }; // RIGHT_WRIST
      if (i === 23) return { x: 0.62, y: 0.65, z: 0.02, visibility: 0.9 }; // LEFT_HIP
      if (i === 24) return { x: 0.38, y: 0.65, z: -0.02, visibility: 0.9 }; // RIGHT_HIP
      return { x: 0.5, y: 0.5, z: 0, visibility: 0.8 };
    }),
  };
}

function makeMockCtx(): CanvasRenderingContext2D {
  return {
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    drawImage: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    ellipse: () => {},
    fill: () => {},
    clip: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
      colorSpace: "srgb",
    } as ImageData),
    putImageData: () => {},
    globalCompositeOperation: "source-over",
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
}

describe("VWearRenderer", () => {
  let renderer: VWearRenderer;

  beforeEach(() => {
    renderer = new VWearRenderer();
  });

  it("preloads and caches images without duplicate network calls", () => {
    const img1 = renderer.preloadImage("/assets/anywear/shirt.png");
    const img2 = renderer.preloadImage("/assets/anywear/shirt.png");
    expect(img1).toBe(img2);
  });

  it("handles drawGarment safely for all 4 preset categories — no seg data (fallback mode)", () => {
    const mockCtx = makeMockCtx();
    const body = makeTestBody();
    for (const preset of ANYWEAR_PRESETS) {
      expect(() => renderer.drawGarment(mockCtx, preset, body, 640, 480)).not.toThrow();
    }
  });

  it("handles drawGarment with segmentation mask (true wearing mode)", () => {
    const mockCtx = makeMockCtx();
    const mockVideo = { readyState: 4 } as unknown as HTMLVideoElement;

    const segMask = {
      data: new Float32Array(16 * 12).fill(0.9),
      width: 16,
      height: 12,
    };

    const mockSegmentation: SegmentationResult = {
      mask: segMask,
      inferenceLatencyMs: 10,
      timestampMs: 2000,
      occlusion: null,
    };

    const body = makeTestBody();
    for (const preset of ANYWEAR_PRESETS) {
      expect(() =>
        renderer.drawGarment(mockCtx, preset, body, 640, 480, mockVideo, mockSegmentation)
      ).not.toThrow();
    }
  });

  it("handles drawGarment when image is not yet loaded", () => {
    const mockCtx = makeMockCtx();
    const body = makeTestBody();
    const notLoaded = ANYWEAR_PRESETS[0]!;
    // Don't preload — renderer should return gracefully
    expect(() => renderer.drawGarment(mockCtx, notLoaded, body, 640, 480)).not.toThrow();
  });
});
