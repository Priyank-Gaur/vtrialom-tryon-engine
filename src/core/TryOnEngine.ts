/**
 * src/core/TryOnEngine.ts
 *
 * Root orchestrator for the VTrialom Try-On Engine.
 *
 * Responsibility:
 *   - Own and expose the engine's public lifecycle API.
 *   - Hold references to all subsystem managers.
 *   - Coordinate the single per-frame processing pipeline.
 *   - Emit typed events to allow the host application to react to state changes.
 *
 * Pipeline (single rAF loop, executed in order each frame):
 *   1. Submit video frame to PoseTracker (async — result arrives next tick)
 *   2. Read latest TrackingResult
 *   3. Emit trackingresult event
 *   4. Emit framerendered event
 *   [Future phases insert segmentation, fitting, deformation, compositing here]
 *
 * PHASE 1: Camera + PoseTracker integrated. Segmentation, garment and
 * rendering subsystems are stubs added in later phases.
 */

import {
  EngineConfig,
  resolveConfig,
  CameraConfig,
  TrackingConfig,
  SegmentationConfig,
  RenderingConfig,
} from "./EngineConfig.js";
import {
  EngineState,
  StateChangeEvent,
  EngineErrorEvent,
  GarmentMetadata,
} from "./types.js";
import { CameraManager } from "../camera/CameraManager.js";
import { PoseTracker, type TrackingResult } from "../tracking/PoseTracker.js";

// ---------------------------------------------------------------------------
// Public event map
// ---------------------------------------------------------------------------
export interface TryOnEngineEventMap {
  statechange: CustomEvent<StateChangeEvent>;
  error: CustomEvent<EngineErrorEvent>;
  trackingresult: CustomEvent<TrackingResult>;
  framerendered: CustomEvent<{ timestampMs: number }>;
}

// ---------------------------------------------------------------------------
// Garment load options (stub until Phase 3)
// ---------------------------------------------------------------------------
export interface LoadGarmentOptions {
  id: string;
  assetUrl: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// TryOnEngine
// ---------------------------------------------------------------------------
export class TryOnEngine extends EventTarget {
  private readonly _config: ReturnType<typeof resolveConfig>;

  private _state: EngineState = "uninitialised";

  // Subsystems
  private _camera: CameraManager | null = null;
  private _tracker: PoseTracker | null = null;
  // private _segmenter: PersonSegmenter | null = null;  // Phase 2
  // private _garmentLoader: GarmentLoader | null = null; // Phase 3
  // private _compositor: Compositor | null = null;       // Phase 6

  private _activeGarment: GarmentMetadata | null = null;

  // Single unified render loop
  private _animFrameId: number | null = null;
  private _lastFrameTime = 0;

  // Diagnostics exposed to the dev shell and future perf tools
  private _diagnostics = {
    fps: 0,
    frameCount: 0,
    lastFpsSampleTime: 0,
    inferenceLatencyMs: 0,
    poseDetected: false,
  };

  constructor(config: EngineConfig) {
    super();
    this._config = resolveConfig(config);
  }

  // =========================================================================
  // Public API — Lifecycle
  // =========================================================================

  async initialize(): Promise<void> {
    if (this._state !== "uninitialised") {
      throw new Error(
        `initialize() called in invalid state: "${this._state}". ` +
          `dispose() first if you want to reinitialise.`
      );
    }

    this._transitionTo("initialising");

    try {
      this._camera = new CameraManager(this._config.camera);

      // Phase 1: initialise the pose tracker.
      // This downloads and compiles the WASM + model (~1-3s on first load).
      this._tracker = new PoseTracker(this._config.tracking);
      await this._tracker.initialize();

      this._transitionTo("ready");
    } catch (err) {
      this._emitError("INIT_FAILED", "Engine initialisation failed.", err);
      this._transitionTo("error");
      throw err;
    }
  }

  async startCamera(): Promise<void> {
    this._assertState(["ready", "running"], "startCamera");

    if (!this._camera) {
      throw new Error("Camera manager not initialised. Call initialize() first.");
    }

    await this._camera.start();

    if (this._state === "ready") {
      this._transitionTo("running");
      this._startRenderLoop();
    }
  }

  async stopCamera(): Promise<void> {
    this._stopRenderLoop();
    await this._camera?.stop();

    if (this._state === "running") {
      this._transitionTo("ready");
    }
  }

  async loadGarment(_options: LoadGarmentOptions): Promise<void> {
    this._assertState(["ready", "running"], "loadGarment");
    console.warn(
      "[TryOnEngine] loadGarment() is a stub — full implementation in Phase 3."
    );
  }

  dispose(): void {
    this._stopRenderLoop();
    this._tracker?.dispose();
    this._tracker = null;
    this._camera?.dispose();
    this._camera = null;
    this._activeGarment = null;
    this._transitionTo("disposed");
  }

  // =========================================================================
  // Public API — Accessors
  // =========================================================================

  get state(): EngineState {
    return this._state;
  }

  get config(): {
    camera: CameraConfig;
    tracking: TrackingConfig;
    segmentation: SegmentationConfig;
    rendering: RenderingConfig;
  } {
    return {
      camera: this._config.camera,
      tracking: this._config.tracking,
      segmentation: this._config.segmentation,
      rendering: this._config.rendering,
    };
  }

  get activeGarment(): GarmentMetadata | null {
    return this._activeGarment;
  }

  get videoElement(): HTMLVideoElement | null {
    return this._camera?.videoElement ?? null;
  }

  get diagnostics() {
    return { ...this._diagnostics };
  }

  get latestTrackingResult(): TrackingResult | null {
    return this._tracker?.latestResult ?? null;
  }

  // =========================================================================
  // Single unified render loop
  // =========================================================================

  private _startRenderLoop(): void {
    if (this._animFrameId !== null) return;

    this._diagnostics.lastFpsSampleTime = performance.now();
    this._diagnostics.frameCount = 0;

    const tick = (now: number) => {
      if (this._state !== "running") return;

      const elapsed = now - this._lastFrameTime;
      const targetInterval = 1000 / this._config.rendering.targetFps;

      if (elapsed >= targetInterval) {
        this._lastFrameTime = now;
        this._onFrame(now);
      }

      this._animFrameId = requestAnimationFrame(tick);
    };

    this._animFrameId = requestAnimationFrame(tick);
  }

  private _stopRenderLoop(): void {
    if (this._animFrameId !== null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  }

  /**
   * Per-frame processing pipeline.
   *
   * Phase 1 pipeline:
   *   1. Submit video frame to PoseTracker (non-blocking, result via callback)
   *   2. Read latest TrackingResult (may be from previous tick — that is fine)
   *   3. Update diagnostics
   *   4. Emit events for the dev shell / host app
   *
   * Future phases will insert after step 2:
   *   - PersonSegmenter.segmentAsync()
   *   - GarmentFitter.fit()
   *   - MeshDeformer.deform()
   *   - Compositor.composite()
   */
  private _onFrame(timestampMs: number): void {
    const video = this._camera?.videoElement;

    // 1. Submit frame to tracker
    if (this._tracker && video) {
      this._tracker.detectAsync(video, timestampMs);
    }

    // 2. Read latest result (async callback may update this between ticks)
    const tracking = this._tracker?.latestResult;

    // 3. Update diagnostics
    this._diagnostics.frameCount++;
    const diagElapsed = timestampMs - this._diagnostics.lastFpsSampleTime;
    if (diagElapsed >= 1000) {
      this._diagnostics.fps = Math.round(
        (this._diagnostics.frameCount * 1000) / diagElapsed
      );
      this._diagnostics.frameCount = 0;
      this._diagnostics.lastFpsSampleTime = timestampMs;
    }

    if (tracking) {
      this._diagnostics.inferenceLatencyMs = tracking.inferenceLatencyMs;
      this._diagnostics.poseDetected = tracking.poseDetected;
    }

    // 4. Emit events
    if (tracking) {
      this.dispatchEvent(
        new CustomEvent<TrackingResult>("trackingresult", { detail: tracking })
      );
    }

    this.dispatchEvent(
      new CustomEvent<{ timestampMs: number }>("framerendered", {
        detail: { timestampMs },
      })
    );
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  private _transitionTo(next: EngineState): void {
    const previous = this._state;
    this._state = next;

    this.dispatchEvent(
      new CustomEvent<StateChangeEvent>("statechange", {
        detail: { previous, current: next },
      })
    );
  }

  private _assertState(allowed: EngineState[], method: string): void {
    if (!allowed.includes(this._state)) {
      throw new Error(
        `${method}() requires state to be one of [${allowed.join(", ")}], ` +
          `but engine is currently "${this._state}".`
      );
    }
  }

  private _emitError(code: string, message: string, cause?: unknown): void {
    this.dispatchEvent(
      new CustomEvent<EngineErrorEvent>("error", {
        detail: { code, message, cause },
      })
    );
  }
}
