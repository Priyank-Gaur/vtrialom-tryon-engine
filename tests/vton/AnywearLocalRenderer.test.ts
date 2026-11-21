/**
 * tests/vton/AnywearLocalRenderer.test.ts
 *
 * Unit tests for AnywearLocalRenderer.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AnywearLocalRenderer } from "../../src/vton/AnywearLocalRenderer";
import { ANYWEAR_PRESETS } from "../../src/vton/AnywearPresets";
import type { BodyGeometry } from "../../src/core/types";

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
      if (i === 11) return { x: 0.65, y: 0.35, z: 0.05, visibility: 0.9 }; // LEFT_SHOULDER
      if (i === 12) return { x: 0.35, y: 0.35, z: -0.05, visibility: 0.9 }; // RIGHT_SHOULDER
      if (i === 13) return { x: 0.75, y: 0.50, z: 0.02, visibility: 0.85 }; // LEFT_ELBOW
      if (i === 14) return { x: 0.25, y: 0.50, z: -0.02, visibility: 0.85 }; // RIGHT_ELBOW
      if (i === 23) return { x: 0.62, y: 0.65, z: 0.02, visibility: 0.9 }; // LEFT_HIP
      if (i === 24) return { x: 0.38, y: 0.65, z: -0.02, visibility: 0.9 }; // RIGHT_HIP
      return { x: 0.5, y: 0.5, z: 0, visibility: 0.8 };
    }),
  };
}

describe("AnywearLocalRenderer", () => {
  let renderer: AnywearLocalRenderer;

  beforeEach(() => {
    renderer = new AnywearLocalRenderer();
  });

  it("initializes with canvas element", () => {
    expect(renderer.domElement).toBeDefined();
    expect(renderer.domElement.tagName.toLowerCase()).toBe("canvas");
  });

  it("updates canvas dimensions cleanly", () => {
    renderer.setSize(1280, 720);
    expect(renderer.domElement.width).toBe(1280);
    expect(renderer.domElement.height).toBe(720);
  });

  it("executes renderGarment safely for each of the 4 Anywear presets", () => {
    const body = makeTestBody();
    for (const preset of ANYWEAR_PRESETS) {
      expect(() => renderer.renderGarment(preset, body, 640, 480)).not.toThrow();
    }
  });
});
