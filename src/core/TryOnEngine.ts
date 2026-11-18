/**
 * src/core/TryOnEngine.ts
 *
 * Root orchestrator for the VTrialom Try-On Engine.
 *
 * Responsibility:
 *   - Own and expose the engine's public lifecycle API.
 *   - Hold references to all subsystem managers.
 *   - Coordinate the per-frame processing pipeline.
 *   - Emit typed events to allow the host application to react to state changes.
 *
 * What it does NOT do:
 *   - Understand webcam hardware details (delegated to CameraManager).
 *   - Understand ML model internals (delegated to PoseTracker / PersonSegmenter).
 *   - Understand rendering primitives (delegated to Renderer / Compositor).
 *
 * This separation means each subsystem can be tested independently and swapped
 * without touching the engine shell.
 *
 * PHASE 0: Only the skeleton of the engine is implemented.
 * Subsystem integrations are added in later phases.
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
  EngineEventType,
  StateChangeEvent,
  EngineErrorEvent,
  GarmentMetadata,
} from "./types.js";
import { CameraManager } from "../camera/CameraManager.js";

// ---------------------------------------------------------------------------
// Public event map — typed overloads for addEventListener
// ---------------------------------------------------------------------------
export interface TryOnEngineEventMap {
  statechange: CustomEvent<StateChangeEvent>;
  error: CustomEvent<EngineErrorEvent>;
  framerendered: CustomEvent<{ timestampMs: number }>;
}

// ---------------------------------------------------------------------------
// Minimal garment load options (expanded in Phase 3)
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
  // ---- resolved configuration ----
  private readonly _config: ReturnType<typeof resolveConfig>;

  // ---- state ----
  private _state: EngineState = "uninitialised";

  // ---- subsystems (populated in later phases) ----
  private _camera: CameraManager | null = null;
  // private _tracker: PoseTracker | null = null;      // Phase 1
  // private _segmenter: PersonSegmenter | null = null; // Phase 2
  // private _garmentLoader: GarmentLoader | null = null; // Phase 3
  // private _renderer: Renderer | null = null;         // Phase 5

  // ---- active garment ----
  private _activeGarment: GarmentMetadata | null = null;

  // ---- render loop ----
  private _animFrameId: number | null = null;
  private _lastFrameTime = 0;

  constructor(config: EngineConfig) {
    super();
    this._config = resolveConfig(config);
  }

  // =========================================================================
  // Public API — Lifecycle
  // =========================================================================

  /**
   * Allocate subsystems and load ML models.
   * Must be called before startCamera() or loadGarment().
   */
  async initialize(): Promise<void> {
    if (this._state !== "uninitialised") {
      throw new Error(
        `initialize() called in invalid state: "${this._state}". ` +
          `dispose() first if you want to reinitialise.`
      );
    }

    this._transitionTo("initialising");

    try {
      // Phase 0: Instantiate CameraManager only.
      // Tracking and segmentation managers are added in Phase 1 & 2.
      this._camera = new CameraManager(this._config.camera);

      this._transitionTo("ready");
    } catch (err) {
      this._emitError("INIT_FAILED", "Engine initialisation failed.", err);
      this._transitionTo("error");
      throw err;
    }
  }

  /**
   * Request camera permission and begin the video feed.
   * Engine must be in "ready" or "running" state.
   */
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

  /** Stop the camera feed without disposing the engine. */
  async stopCamera(): Promise<void> {
    this._stopRenderLoop();
    await this._camera?.stop();

    if (this._state === "running") {
      this._transitionTo("ready");
    }
  }

  /**
   * Load a garment asset and make it active.
   * Phase 3 implementation will parse metadata; for now records a placeholder.
   */
  async loadGarment(_options: LoadGarmentOptions): Promise<void> {
    this._assertState(["ready", "running"], "loadGarment");
    // Full implementation in Phase 3.
    // The method signature is established here so the host application can
    // call it without changes in later phases.
    console.warn(
      "[TryOnEngine] loadGarment() is a stub — full implementation in Phase 3."
    );
  }

  /**
   * Release all resources: camera stream, ML models, canvas, event listeners.
   * The engine cannot be used after dispose(); construct a new instance instead.
   */
  dispose(): void {
    this._stopRenderLoop();
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

  /**
   * The raw video element driven by the camera stream.
   * Exposed so the dev shell (main.ts) and future Renderer can draw frames.
   * Returns null before startCamera() is called.
   */
  get videoElement(): HTMLVideoElement | null {
    return this._camera?.videoElement ?? null;
  }

  // =========================================================================
  // Render loop (Phase 0: frame counter only)
  // =========================================================================

  private _startRenderLoop(): void {
    if (this._animFrameId !== null) return;

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
   * Phase 0: emits a framerendered event with the timestamp.
   * Later phases will add: capture → track → segment → fit → deform → composite.
   */
  private _onFrame(timestampMs: number): void {
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

