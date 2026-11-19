/**
 * src/api/TryOnComponent.ts
 *
 * Public integration surface for the VTrialom Try-On Engine.
 *
 * This is what the host VTrialom website (and dev shell) imports.
 * Internal modules are never imported directly by the host.
 *
 * PHASE 1 changes:
 *   - Removed private field access hack (engine["_engine"]).
 *   - Added proper trackingresult and framerendered event forwarding.
 *   - Added diagnostics accessor.
 *   - Added latestTrackingResult accessor for the debug UI.
 */

import { TryOnEngine, LoadGarmentOptions } from "../core/TryOnEngine.js";
import { EngineConfig } from "../core/EngineConfig.js";
import type { EngineState, EngineErrorEvent, SegmentationResult, LoadedGarment, FittingResult } from "../core/types.js";
import type { TrackingResult } from "../tracking/PoseTracker.js";

export interface TryOnComponentOptions {
  container: HTMLElement;
  camera?: {
    facingMode?: "user" | "environment";
    width?: number;
    height?: number;
  };
  debug?: boolean;
}

export class VTrialomTryOn {
  private _engine: TryOnEngine;
  private _canvas: HTMLCanvasElement;
  private _resizeObserver: ResizeObserver | null = null;

  constructor(options: TryOnComponentOptions) {
    this._canvas = document.createElement("canvas");
    this._canvas.style.width = "100%";
    this._canvas.style.height = "100%";
    this._canvas.style.display = "block";
    options.container.appendChild(this._canvas);

    const engineConfig: EngineConfig = {
      container: options.container,
      camera: options.camera,
      rendering: {
        debugMode: options.debug ?? false,
      },
    };

    this._engine = new TryOnEngine(engineConfig);

    // Forward all engine events to the container element as custom events
    this._engine.addEventListener("statechange", (e) => {
      options.container.dispatchEvent(
        new CustomEvent("vtrialom:statechange", { detail: (e as CustomEvent).detail })
      );
    });

    this._engine.addEventListener("error", (e) => {
      const detail = (e as CustomEvent<EngineErrorEvent>).detail;
      console.error(`[VTrialom] Engine error [${detail.code}]:`, detail.message);
      options.container.dispatchEvent(new CustomEvent("vtrialom:error", { detail }));
    });

    this._engine.addEventListener("trackingresult", (e) => {
      options.container.dispatchEvent(
        new CustomEvent("vtrialom:trackingresult", {
          detail: (e as CustomEvent<TrackingResult>).detail,
        })
      );
    });

    this._engine.addEventListener("segmentationresult", (e) => {
      options.container.dispatchEvent(
        new CustomEvent("vtrialom:segmentationresult", {
          detail: (e as CustomEvent<SegmentationResult>).detail,
        })
      );
    });

    this._engine.addEventListener("garmentloaded", (e) => {
      options.container.dispatchEvent(
        new CustomEvent("vtrialom:garmentloaded", {
          detail: (e as CustomEvent<LoadedGarment>).detail,
        })
      );
    });

    this._engine.addEventListener("fittingresult", (e) => {
      options.container.dispatchEvent(
        new CustomEvent("vtrialom:fittingresult", {
          detail: (e as CustomEvent<FittingResult>).detail,
        })
      );
    });

    this._engine.addEventListener("framerendered", (e) => {
      options.container.dispatchEvent(
        new CustomEvent("vtrialom:framerendered", { detail: (e as CustomEvent).detail })
      );
    });

    this._resizeObserver = new ResizeObserver(() => {
      this._syncCanvasSize();
    });
    this._resizeObserver.observe(options.container);
    this._syncCanvasSize();
  }

  // =========================================================================
  // Public lifecycle API
  // =========================================================================

  async initialize(): Promise<void> {
    await this._engine.initialize();
  }

  async startCamera(): Promise<void> {
    await this._engine.startCamera();
  }

  async stopCamera(): Promise<void> {
    await this._engine.stopCamera();
  }

  async loadGarment(options: LoadGarmentOptions): Promise<LoadedGarment> {
    return this._engine.loadGarment(options);
  }

  setOutputDimensions(width: number, height: number): void {
    this._engine.setOutputDimensions(width, height);
  }

  dispose(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._engine.dispose();
    this._canvas.remove();
  }

  // =========================================================================
  // Accessors
  // =========================================================================

  get state(): EngineState {
    return this._engine.state;
  }

  get activeGarment(): LoadedGarment | null {
    return this._engine.activeGarment;
  }

  get canvas(): HTMLCanvasElement {
    return this._canvas;
  }

  get videoElement(): HTMLVideoElement | null {
    return this._engine.videoElement;
  }

  get diagnostics() {
    return this._engine.diagnostics;
  }

  get latestTrackingResult(): TrackingResult | null {
    return this._engine.latestTrackingResult;
  }

  get latestSegmentationResult(): SegmentationResult | null {
    return this._engine.latestSegmentationResult;
  }

  get latestFittingResult(): FittingResult | null {
    return this._engine.latestFittingResult;
  }

  // =========================================================================
  // Private
  // =========================================================================

  private _syncCanvasSize(): void {
    const rect = this._canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = Math.round(rect.width * dpr);
    this._canvas.height = Math.round(rect.height * dpr);
    this._engine.setOutputDimensions(this._canvas.width, this._canvas.height);
  }
}
