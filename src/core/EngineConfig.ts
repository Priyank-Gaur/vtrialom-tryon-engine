/**
 * src/core/EngineConfig.ts
 *
 * Configuration schema for the VTrialom Try-On Engine.
 *
 * All fields that have sensible defaults are optional — callers only need to
 * supply the ones they want to customise.  The engine merges the caller's
 * object with DEFAULT_ENGINE_CONFIG on initialisation.
 */

export interface CameraConfig {
  /**
   * "user" = front-facing (selfie), "environment" = rear camera.
   * Default: "user"
   */
  facingMode: "user" | "environment";
  /**
   * Requested capture resolution.  The browser may grant a different size.
   * Default: 1280×720
   */
  width: number;
  height: number;
}

export interface TrackingConfig {
  /**
   * MediaPipe model variant: "lite" is fastest, "full" is most accurate,
   * "heavy" is highest accuracy but slowest.
   * Default: "lite"
   */
  modelComplexity: "lite" | "full" | "heavy";
  /**
   * Maximum number of poses to detect.  For try-on we only need 1.
   * Default: 1
   */
  maxPoses: number;
  /**
   * Minimum confidence to consider a detection valid.
   * Default: 0.5
   */
  minDetectionConfidence: number;
  /**
   * Minimum confidence to continue tracking vs. re-detecting.
   * Default: 0.5
   */
  minTrackingConfidence: number;
  /**
   * Number of frames used by the exponential-moving-average smoother.
   * Higher = smoother but laggier.  Range 1–30.
   * Default: 5
   */
  smoothingWindowFrames: number;
}

export interface SegmentationConfig {
  /**
   * Selfie Segmenter is the best balance of speed and accuracy for a
   * single-person webcam scenario.
   * Default: "selfie"
   */
  model: "selfie" | "general";
  /**
   * Confidence threshold to classify a pixel as foreground.
   * Default: 0.5
   */
  foregroundThreshold: number;
  /**
   * Radius in pixels for mask edge smoothing (box-blur passes).
   * Default: 3
   */
  edgeSmoothingRadius: number;
}

export interface RenderingConfig {
  /**
   * Target frame rate for the render loop.
   * Default: 30
   */
  targetFps: number;
  /**
   * Show debug overlays (skeleton, landmarks, FPS counter).
   * Default: false
   */
  debugMode: boolean;
  /**
   * Composite method for blending the garment over the camera feed.
   * Default: "source-over"
   */
  compositeOperation: GlobalCompositeOperation;
}

/** Full engine configuration, all fields optional for callers. */
export interface EngineConfig {
  camera?: Partial<CameraConfig>;
  tracking?: Partial<TrackingConfig>;
  segmentation?: Partial<SegmentationConfig>;
  rendering?: Partial<RenderingConfig>;
  /**
   * The DOM element that the engine will render into.
   * Required — no default.
   */
  container: HTMLElement;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  facingMode: "user",
  width: 1280,
  height: 720,
};

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  modelComplexity: "lite",
  maxPoses: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
  smoothingWindowFrames: 5,
};

export const DEFAULT_SEGMENTATION_CONFIG: SegmentationConfig = {
  model: "selfie",
  foregroundThreshold: 0.5,
  edgeSmoothingRadius: 3,
};

export const DEFAULT_RENDERING_CONFIG: RenderingConfig = {
  targetFps: 30,
  debugMode: false,
  compositeOperation: "source-over",
};

/** Merge caller config with defaults, returning a complete resolved config. */
export function resolveConfig(partial: EngineConfig): {
  container: HTMLElement;
  camera: CameraConfig;
  tracking: TrackingConfig;
  segmentation: SegmentationConfig;
  rendering: RenderingConfig;
} {
  return {
    container: partial.container,
    camera: { ...DEFAULT_CAMERA_CONFIG, ...partial.camera },
    tracking: { ...DEFAULT_TRACKING_CONFIG, ...partial.tracking },
    segmentation: { ...DEFAULT_SEGMENTATION_CONFIG, ...partial.segmentation },
    rendering: { ...DEFAULT_RENDERING_CONFIG, ...partial.rendering },
  };
}

