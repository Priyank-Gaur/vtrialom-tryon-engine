/**
 * tests/core/EngineConfig.test.ts
 *
 * Unit tests for the configuration resolver.
 * These are pure function tests — no DOM, no network, no MediaPipe.
 */

import { describe, it, expect } from "vitest";
import {
  resolveConfig,
  DEFAULT_CAMERA_CONFIG,
  DEFAULT_TRACKING_CONFIG,
  DEFAULT_SEGMENTATION_CONFIG,
  DEFAULT_RENDERING_CONFIG,
} from "../../src/core/EngineConfig";

// Minimal container stub so resolveConfig has a container reference
const mockContainer = document.createElement("div");

describe("resolveConfig", () => {
  it("returns all defaults when only container is provided", () => {
    const result = resolveConfig({ container: mockContainer });

    expect(result.camera).toEqual(DEFAULT_CAMERA_CONFIG);
    expect(result.tracking).toEqual(DEFAULT_TRACKING_CONFIG);
    expect(result.segmentation).toEqual(DEFAULT_SEGMENTATION_CONFIG);
    expect(result.rendering).toEqual(DEFAULT_RENDERING_CONFIG);
    expect(result.container).toBe(mockContainer);
  });

  it("deep-merges partial camera config with defaults", () => {
    const result = resolveConfig({
      container: mockContainer,
      camera: { facingMode: "environment" },
    });

    expect(result.camera.facingMode).toBe("environment");
    // Other camera fields remain at defaults
    expect(result.camera.width).toBe(DEFAULT_CAMERA_CONFIG.width);
    expect(result.camera.height).toBe(DEFAULT_CAMERA_CONFIG.height);
  });

  it("deep-merges partial tracking config with defaults", () => {
    const result = resolveConfig({
      container: mockContainer,
      tracking: { modelComplexity: "heavy", maxPoses: 2 },
    });

    expect(result.tracking.modelComplexity).toBe("heavy");
    expect(result.tracking.maxPoses).toBe(2);
    expect(result.tracking.minDetectionConfidence).toBe(
      DEFAULT_TRACKING_CONFIG.minDetectionConfidence
    );
  });

  it("deep-merges partial rendering config with defaults", () => {
    const result = resolveConfig({
      container: mockContainer,
      rendering: { debugMode: true },
    });

    expect(result.rendering.debugMode).toBe(true);
    expect(result.rendering.targetFps).toBe(DEFAULT_RENDERING_CONFIG.targetFps);
  });

  it("returns all four subsystem configs plus container", () => {
    const result = resolveConfig({ container: mockContainer });
    expect(result).toHaveProperty("camera");
    expect(result).toHaveProperty("tracking");
    expect(result).toHaveProperty("segmentation");
    expect(result).toHaveProperty("rendering");
    expect(result).toHaveProperty("container");
  });
});

