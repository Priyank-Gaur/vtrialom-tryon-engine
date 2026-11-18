/**
 * src/api/TryOnComponent.ts
 *
 * Public integration surface for the VTrialom Try-On Engine.
 *
 * This is what the host VTrialom website imports and uses.
 * It wraps TryOnEngine and handles:
 *   - Canvas mounting inside the host container.
 *   - Basic resize observation.
 *   - Convenience event forwarding.
 *
 * The host application NEVER touches internal modules directly.
 *
 * PHASE 0: Establishes the public contract (documented API shape).
 * Full rendering wiring added in Phase 5.
 */

import { TryOnEngine, LoadGarmentOptions } from "../core/TryOnEngine.js";
import { EngineConfig } from "../core/EngineConfig.js";
import type { EngineState, EngineErrorEvent } from "../core/types.js";

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
    // Create the output canvas and mount it inside the host container
    this._canvas = document.createElement("canvas");
    this._canvas.style.width = "100%";
    this._canvas.style.height = "100%";
    this._canvas.style.display = "block";
    options.container.appendChild(this._canvas);

    // Build the engine config
    const engineConfig: EngineConfig = {
      container: options.container,
      camera: options.camera,
      rendering: {
        debugMode: options.debug ?? false,
      },
    };

    this._engine = new TryOnEngine(engineConfig);

    // Forward engine events to the container element
    this._engine.addEventListener("statechange", (e) => {
      options.container.dispatchEvent(
        new CustomEvent("vtrialom:statechange", { detail: (e as CustomEvent).detail })
      );
    });

    this._engine.addEventListener("error", (e) => {
      const detail = (e as CustomEvent<EngineErrorEvent>).detail;
      console.error(`[VTrialom] Engine error [${detail.code}]:`, detail.message);
      options.container.dispatchEvent(
        new CustomEvent("vtrialom:error", { detail })
      );
    });

    // Observe container resize to keep canvas dimensions accurate
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

  async loadGarment(options: LoadGarmentOptions): Promise<void> {
    await this._engine.loadGarment(options);
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

  get canvas(): HTMLCanvasElement {
    return this._canvas;
  }

  /**
   * The live camera video element. Available after startCamera() resolves.
   * The dev shell uses this to draw a preview; the future Renderer will use it too.
   */
  get videoElement(): HTMLVideoElement | null {
    return this._engine.videoElement;
  }

  // =========================================================================
  // Private
  // =========================================================================

  private _syncCanvasSize(): void {
    const rect = this._canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;
    // Set physical pixel dimensions to match the container's CSS size
    // accounting for devicePixelRatio for crisp rendering on HiDPI screens.
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = Math.round(rect.width * dpr);
    this._canvas.height = Math.round(rect.height * dpr);
  }
}

