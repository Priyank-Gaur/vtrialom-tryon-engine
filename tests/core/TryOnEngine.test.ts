/**
 * tests/core/TryOnEngine.test.ts
 *
 * Unit tests for the TryOnEngine lifecycle state machine.
 *
 * We test the state transitions in isolation without real camera or ML models.
 * CameraManager.start() is stubbed so the test runs in a headless environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TryOnEngine } from "../../src/core/TryOnEngine";

// ---------------------------------------------------------------------------
// Stubs — replace browser APIs not available in jsdom
// ---------------------------------------------------------------------------

// Stub CameraManager so no actual getUserMedia call is made
vi.mock("../../src/camera/CameraManager", () => {
  return {
    CameraManager: vi.fn().mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(document.createElement("video")),
      stop: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      isRunning: false,
      videoElement: null,
      captureSize: null,
    })),
  };
});

// Stub PoseTracker so no MediaPipe WASM or network models are loaded in unit tests
vi.mock("../../src/tracking/PoseTracker", () => {
  return {
    PoseTracker: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      detectAsync: vi.fn(),
      latestResult: {
        landmarks: [],
        bodyGeometry: null,
        raw: null,
        timestampMs: 0,
        poseDetected: false,
        inferenceLatencyMs: 0,
      },
    })),
  };
});

// requestAnimationFrame is not available in jsdom — provide a stub
globalThis.requestAnimationFrame = vi.fn(() => {
  // Don't actually call cb to avoid an infinite loop in tests
  return 1;
});
globalThis.cancelAnimationFrame = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TryOnEngine — state machine", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("starts in uninitialised state", () => {
    const engine = new TryOnEngine({ container });
    expect(engine.state).toBe("uninitialised");
  });

  it("transitions to ready after initialize()", async () => {
    const engine = new TryOnEngine({ container });
    await engine.initialize();
    expect(engine.state).toBe("ready");
  });

  it("throws if initialize() is called twice", async () => {
    const engine = new TryOnEngine({ container });
    await engine.initialize();
    await expect(engine.initialize()).rejects.toThrow(/invalid state/i);
  });

  it("transitions to running after startCamera()", async () => {
    const engine = new TryOnEngine({ container });
    await engine.initialize();
    await engine.startCamera();
    expect(engine.state).toBe("running");
  });

  it("transitions back to ready after stopCamera()", async () => {
    const engine = new TryOnEngine({ container });
    await engine.initialize();
    await engine.startCamera();
    await engine.stopCamera();
    expect(engine.state).toBe("ready");
  });

  it("transitions to disposed after dispose()", async () => {
    const engine = new TryOnEngine({ container });
    await engine.initialize();
    engine.dispose();
    expect(engine.state).toBe("disposed");
  });

  it("throws if startCamera() called before initialize()", async () => {
    const engine = new TryOnEngine({ container });
    // The engine is in "uninitialised" state; startCamera() requires "ready" or "running".
    await expect(engine.startCamera()).rejects.toThrow(/requires state to be/i);
  });

  it("emits statechange events on each transition", async () => {
    const engine = new TryOnEngine({ container });
    const transitions: string[] = [];

    engine.addEventListener("statechange", (e) => {
      transitions.push((e as CustomEvent).detail.current);
    });

    await engine.initialize();
    await engine.startCamera();
    await engine.stopCamera();
    engine.dispose();

    expect(transitions).toEqual([
      "initialising",
      "ready",
      "running",
      "ready",
      "disposed",
    ]);
  });
});

