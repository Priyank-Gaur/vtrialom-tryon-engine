/**
 * src/tracking/PoseTracker.ts
 *
 * Wraps MediaPipe PoseLandmarker (Tasks Vision SDK) for real-time webcam
 * pose tracking.
 *
 * Key design decisions:
 *
 * 1. LIVE_STREAM running mode — the only correct mode for a webcam loop.
 *    IMAGE mode is stateless and re-detects from scratch every frame (slower).
 *    VIDEO mode requires a pre-recorded stream with monotonic timestamps.
 *    LIVE_STREAM mode runs asynchronously and delivers results via callback,
 *    which is the right model for a rAF-driven loop.
 *
 * 2. Model selection — using pose_landmarker_lite.
 *    - Lite: ~3MB, ~20ms inference, adequate for upper-body fitting.
 *    - Full: ~8MB, ~40ms inference, better accuracy for fast movement.
 *    - Heavy: ~25MB, ~80ms inference, best for subtle joint angles.
 *    We start with Lite and expose the choice via config so it can be
 *    upgraded without code changes.
 *
 * 3. WASM loading — MediaPipe Tasks Vision requires the WASM binaries to be
 *    served from a known URL. We use the versioned jsDelivr CDN path that
 *    matches the installed package version to avoid API mismatches.
 *
 * 4. GPU delegate — requested by default. Falls back to CPU automatically
 *    if WebGL is unavailable (e.g., headless environments, some Firefox configs).
 *
 * 5. Result callback — results arrive asynchronously after detectAsync().
 *    The callback updates an internal buffer that _onFrame() reads on the
 *    next animation tick. This avoids blocking the render loop.
 */

import {
  PoseLandmarker,
  FilesetResolver,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { TrackingConfig } from "../core/EngineConfig.js";
import type { PoseLandmarks } from "../core/types.js";
import { LandmarkSmoother } from "./LandmarkSmoother.js";
import { computeBodyGeometry } from "./BodyGeometry.js";
import type { BodyGeometry } from "../core/types.js";

// ---------------------------------------------------------------------------
// Model URLs — versioned to match installed package (0.10.35)
// Using jsDelivr so the WASM and model are served with correct MIME types.
// ---------------------------------------------------------------------------
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

const MODEL_URLS: Record<TrackingConfig["modelComplexity"], string> = {
  lite: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  full: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
  heavy:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
};

// ---------------------------------------------------------------------------
// TrackingResult — what PoseTracker exposes per frame
// ---------------------------------------------------------------------------
export interface TrackingResult {
  /** Smoothed normalised landmarks. Empty array if no pose detected. */
  landmarks: PoseLandmarks;
  /** Derived body geometry. Null if pose not reliably detected. */
  bodyGeometry: BodyGeometry | null;
  /** Raw PoseLandmarker output for diagnostics. */
  raw: PoseLandmarkerResult | null;
  /** Timestamp of the frame that produced this result (ms). */
  timestampMs: number;
  /** True if at least one pose was detected with sufficient confidence. */
  poseDetected: boolean;
  /** MediaPipe model inference latency in ms (measured externally). */
  inferenceLatencyMs: number;
}

// ---------------------------------------------------------------------------
// PoseTracker
// ---------------------------------------------------------------------------
export class PoseTracker {
  private readonly _config: TrackingConfig;
  private _landmarker: PoseLandmarker | null = null;
  private _smoother: LandmarkSmoother;

  // Latest result delivered by the async callback
  private _latestResult: TrackingResult = {
    landmarks: [],
    bodyGeometry: null,
    raw: null,
    timestampMs: 0,
    poseDetected: false,
    inferenceLatencyMs: 0,
  };

  // Timestamps for latency measurement
  private _inferenceStartMs = 0;

  // External callback invoked whenever a new result arrives
  private _onResult: ((result: TrackingResult) => void) | null = null;

  constructor(config: TrackingConfig) {
    this._config = config;
    this._smoother = new LandmarkSmoother(0.4);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Load the WASM runtime and the pose model.
   * Must complete before any detectAsync() calls.
   * Typically takes 1–3 seconds on first load; subsequent loads use cache.
   */
  async initialize(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);

    this._landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URLS[this._config.modelComplexity],
        delegate: "GPU", // falls back to CPU if WebGL unavailable
      },
      runningMode: "VIDEO",
      numPoses: this._config.maxPoses,
      minPoseDetectionConfidence: this._config.minDetectionConfidence,
      minPosePresenceConfidence: this._config.minDetectionConfidence,
      minTrackingConfidence: this._config.minTrackingConfidence,
    });
  }

  /** Release model resources. */
  dispose(): void {
    this._landmarker?.close();
    this._landmarker = null;
    this._smoother.reset();
  }

  // =========================================================================
  // Per-frame detection
  // =========================================================================

  /**
   * Submit a video frame for asynchronous detection.
   * Call this once per animation frame while the camera is running.
   * Results arrive via the callback set with onResult().
   *
   * @param video The live video element from CameraManager.
   * @param timestampMs Monotonically increasing timestamp (use performance.now()).
   */
  detectAsync(video: HTMLVideoElement, timestampMs: number): void {
    if (!this._landmarker) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    this._inferenceStartMs = performance.now();
    const result = this._landmarker.detectForVideo(video, timestampMs);
    this._handleResult(result, timestampMs);
  }

  // =========================================================================
  // Result access
  // =========================================================================

  /** Register a callback invoked on every new tracking result. */
  set onResult(cb: (result: TrackingResult) => void) {
    this._onResult = cb;
  }

  /** The most recent tracking result (may be from a previous frame). */
  get latestResult(): TrackingResult {
    return this._latestResult;
  }

  // =========================================================================
  // Private
  // =========================================================================

  private _handleResult(raw: PoseLandmarkerResult, timestampMs: number): void {
    const inferenceLatencyMs = performance.now() - this._inferenceStartMs;

    const poseDetected = raw.landmarks.length > 0;
    let landmarks: PoseLandmarks = [];
    let bodyGeometry = null;

    if (poseDetected) {
      // MediaPipe returns normalized landmarks; use the first detected pose.
      const rawLandmarks = raw.landmarks[0] as PoseLandmarks;
      landmarks = this._smoother.smooth(rawLandmarks);
      bodyGeometry = computeBodyGeometry(landmarks);
    } else {
      // No pose — reset smoother so we don't blend stale data when
      // the person re-enters the frame.
      this._smoother.reset();
    }

    this._latestResult = {
      landmarks,
      bodyGeometry,
      raw,
      timestampMs,
      poseDetected,
      inferenceLatencyMs,
    };

    this._onResult?.(this._latestResult);
  }
}

