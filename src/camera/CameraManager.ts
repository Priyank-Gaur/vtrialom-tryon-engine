/**
 * src/camera/CameraManager.ts
 *
 * Responsibility:
 *   - Request webcam access via getUserMedia.
 *   - Manage the MediaStream lifecycle (start, stop, track cleanup).
 *   - Expose the video element for downstream consumers (tracker, renderer).
 *   - Surface camera errors with meaningful codes.
 *
 * Design decisions:
 *   - CameraManager owns a hidden <video> element so it controls its lifetime.
 *   - Callers receive a read-only reference to the video element; they must
 *     not attach it to the DOM themselves — the engine handles layout.
 *   - The video element is reused across start()/stop() cycles to avoid
 *     repeated DOM mutations and GPU texture re-uploads.
 *
 * PHASE 0: Full implementation — camera is the first working subsystem.
 */

import type { CameraConfig } from "../core/EngineConfig.js";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------
export type CameraErrorCode =
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "NOT_READABLE"
  | "OVERCONSTRAINED"
  | "SECURITY_ERROR"
  | "UNKNOWN";

export class CameraError extends Error {
  constructor(
    public readonly code: CameraErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "CameraError";
  }
}

// ---------------------------------------------------------------------------
// CameraManager
// ---------------------------------------------------------------------------
export class CameraManager {
  private readonly _config: CameraConfig;
  private _stream: MediaStream | null = null;
  private _videoEl: HTMLVideoElement | null = null;
  private _running = false;

  constructor(config: CameraConfig) {
    this._config = config;
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Request camera permission and start streaming into the internal video element.
   * Safe to call multiple times — a no-op if already running.
   */
  async start(): Promise<HTMLVideoElement> {
    if (this._running && this._videoEl) {
      return this._videoEl;
    }

    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: this._config.facingMode,
        width: { ideal: this._config.width },
        height: { ideal: this._config.height },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: false,
    };

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      throw this._wrapGetUserMediaError(err);
    }

    this._stream = stream;
    this._videoEl = this._createVideoElement();
    this._videoEl.srcObject = stream;

    await this._waitForVideoReady(this._videoEl);

    this._running = true;
    return this._videoEl;
  }

  /** Stop the stream and release all media tracks. */
  async stop(): Promise<void> {
    this._running = false;

    if (this._videoEl) {
      this._videoEl.pause();
      this._videoEl.srcObject = null;
    }

    if (this._stream) {
      this._stream.getTracks().forEach((track) => track.stop());
      this._stream = null;
    }
  }

  /**
   * Fully clean up: stop the stream and discard the video element.
   * After dispose() this instance cannot be restarted.
   */
  dispose(): void {
    this.stop().catch(() => {
      // Ignore errors during disposal; we're tearing down anyway.
    });
    this._videoEl = null;
  }

  // =========================================================================
  // Accessors
  // =========================================================================

  /** The video element driven by the camera stream. Null before start(). */
  get videoElement(): HTMLVideoElement | null {
    return this._videoEl;
  }

  /** True if the stream is active and the video is playing. */
  get isRunning(): boolean {
    return this._running;
  }

  /**
   * Actual capture dimensions granted by the browser.
   * May differ from the requested config if the hardware doesn't support it.
   */
  get captureSize(): { width: number; height: number } | null {
    if (!this._videoEl) return null;
    return {
      width: this._videoEl.videoWidth,
      height: this._videoEl.videoHeight,
    };
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private _createVideoElement(): HTMLVideoElement {
    const video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    // Keep the element out of the layout flow but ensure it renders frames
    // (some browsers won't decode if display:none).
    video.style.position = "absolute";
    video.style.visibility = "hidden";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.top = "-1px";
    video.style.left = "-1px";
    document.body.appendChild(video);
    return video;
  }

  private _waitForVideoReady(video: HTMLVideoElement): Promise<void> {
    return new Promise((resolve, reject) => {
      const onPlaying = () => {
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        resolve();
      };

      const onError = () => {
        video.removeEventListener("playing", onPlaying);
        video.removeEventListener("error", onError);
        reject(new CameraError("NOT_READABLE", "Video element failed to play."));
      };

      video.addEventListener("playing", onPlaying);
      video.addEventListener("error", onError);

      video.play().catch((err) => {
        // play() promise rejection is redundant with the 'error' event but
        // some browsers throw from the promise rather than firing the event.
        reject(new CameraError("NOT_READABLE", `video.play() rejected: ${err}`));
      });
    });
  }

  private _wrapGetUserMediaError(err: unknown): CameraError {
    if (!(err instanceof DOMException)) {
      return new CameraError(
        "UNKNOWN",
        `Unexpected camera error: ${String(err)}`,
        err
      );
    }

    // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#exceptions
    switch (err.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return new CameraError(
          "PERMISSION_DENIED",
          "Camera permission was denied. Please allow camera access and try again.",
          err
        );
      case "NotFoundError":
      case "DevicesNotFoundError":
        return new CameraError(
          "NOT_FOUND",
          "No camera was found on this device.",
          err
        );
      case "NotReadableError":
      case "TrackStartError":
        return new CameraError(
          "NOT_READABLE",
          "Camera is already in use by another application.",
          err
        );
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        return new CameraError(
          "OVERCONSTRAINED",
          "Camera cannot satisfy the requested constraints (resolution/facing mode).",
          err
        );
      case "SecurityError":
        return new CameraError(
          "SECURITY_ERROR",
          "Camera access requires HTTPS or localhost.",
          err
        );
      default:
        return new CameraError(
          "UNKNOWN",
          `Camera error (${err.name}): ${err.message}`,
          err
        );
    }
  }
}

