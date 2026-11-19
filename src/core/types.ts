/**
 * src/core/types.ts
 *
 * Central type definitions for the VTrialom Try-On Engine.
 *
 * Design principle: types are defined here and imported by every module.
 * This prevents circular dependencies and gives a single source of truth
 * for the shape of data flowing through the system.
 */

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

/** A 2D point in normalised [0,1] image space (matches MediaPipe convention). */
export interface NormalisedPoint2D {
  x: number; // 0 = left edge, 1 = right edge
  y: number; // 0 = top edge, 1 = bottom edge
}

/** A 2D point in pixel space relative to the canvas/video dimensions. */
export interface PixelPoint2D {
  x: number;
  y: number;
}

/** A 3D landmark as returned by MediaPipe PoseLandmarker. */
export interface Landmark3D {
  x: number; // normalised [0,1] in x
  y: number; // normalised [0,1] in y
  z: number; // depth relative to hip (metre-scale but unitless here)
  visibility?: number; // confidence [0,1], may be undefined for world coords
}

// ---------------------------------------------------------------------------
// Body tracking
// ---------------------------------------------------------------------------

/**
 * Subset of the 33 MediaPipe pose landmarks that the Try-On Engine actively
 * uses. Indices match the MediaPipe PoseLandmark enum exactly, so the array
 * from detectForVideo() can be indexed directly.
 *
 * Full landmark map:
 * https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
 */
export const LANDMARK_INDEX = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
} as const;

/** A set of pose landmarks indexed by the constant names above. */
export type PoseLandmarks = Landmark3D[];

/** Smoothed, engine-ready body geometry derived from raw landmarks. */
export interface BodyGeometry {
  /** Midpoint of left & right shoulder in normalised coords. */
  shoulderMidpoint: NormalisedPoint2D;
  /** Width between shoulders in normalised units. */
  shoulderWidth: number;
  /** Midpoint of left & right hip in normalised coords. */
  hipMidpoint: NormalisedPoint2D;
  /** Width between hips in normalised units. */
  hipWidth: number;
  /** Torso height: shoulder midpoint Y to hip midpoint Y (normalised). */
  torsoHeight: number;
  /** Approximate torso centre in normalised coords. */
  torsoCentre: NormalisedPoint2D;
  /** Raw landmarks for modules that need fine-grained access. */
  landmarks: PoseLandmarks;
  /** Estimated in-plane torso rotation in radians. Positive = clockwise. */
  torsoRotation: number;
}

// ---------------------------------------------------------------------------
// Segmentation & Occlusion
// ---------------------------------------------------------------------------

/** Binary or confidence mask produced by the segmentation module. */
export interface SegmentationMask {
  /** Confidence values in [0,1] per pixel, row-major, length = width*height. */
  data: Float32Array;
  width: number;
  height: number;
}

/** 2D convex or non-convex polygon represented as a list of normalised vertices. */
export type NormalisedPolygon = NormalisedPoint2D[];

/** State and geometry of body-part occlusion relative to the torso. */
export interface OcclusionState {
  /** True if the left arm/hand is positioned in front of or across the torso. */
  isLeftArmOccludingTorso: boolean;
  /** True if the right arm/hand is positioned in front of or across the torso. */
  isRightArmOccludingTorso: boolean;
  /** True if left hand/wrist is inside the torso bounding area. */
  isLeftHandOverTorso: boolean;
  /** True if right hand/wrist is inside the torso bounding area. */
  isRightHandOverTorso: boolean;
  /** Estimated ratio [0,1] of the left arm overlapping the torso region. */
  leftArmOverlapRatio: number;
  /** Estimated ratio [0,1] of the right arm overlapping the torso region. */
  rightArmOverlapRatio: number;
  /** Estimated torso bounding polygon in normalised coordinates. */
  torsoPolygon: NormalisedPolygon;
  /** Estimated left arm sleeve/forearm polygon in normalised coordinates. */
  leftArmPolygon: NormalisedPolygon;
  /** Estimated right arm sleeve/forearm polygon in normalised coordinates. */
  rightArmPolygon: NormalisedPolygon;
}

/** Result produced by PersonSegmenter and OcclusionManager each frame. */
export interface SegmentationResult {
  /** Smoothed foreground person mask. Null if segmentation failed or skipped. */
  mask: SegmentationMask | null;
  /** Body-part occlusion analysis based on pose landmarks and regions. */
  occlusion: OcclusionState | null;
  /** Time taken in milliseconds for the ML segmentation model inference. */
  inferenceLatencyMs: number;
  /** Timestamp of the frame processed (ms). */
  timestampMs: number;
}

// ---------------------------------------------------------------------------
// Garments
// ---------------------------------------------------------------------------

/**
 * Garment category.  Drives which fitting algorithm is selected.
 * Extensible — add "TROUSERS", "DRESS", etc. as new phases are reached.
 */
export type GarmentCategory = "TOP" | "OUTERWEAR" | "PLACEHOLDER";

/**
 * Anchor points that locate the garment on the body.
 * All values are in normalised [0,1] garment-image space.
 *
 * Example for a T-shirt:
 *   leftShoulder  → where the left shoulder seam begins
 *   rightShoulder → where the right shoulder seam begins
 *   neckCentre    → collar centre
 *   hemCentre     → bottom hem centre
 */
export interface GarmentAnchors {
  leftShoulder: NormalisedPoint2D;
  rightShoulder: NormalisedPoint2D;
  neckCentre: NormalisedPoint2D;
  hemCentre: NormalisedPoint2D;
  leftSleeveTip?: NormalisedPoint2D;
  rightSleeveTip?: NormalisedPoint2D;
}

/** All metadata for one garment asset. */
export interface GarmentMetadata {
  id: string;
  name: string;
  category: GarmentCategory;
  /** URL or path to the transparent PNG/WebP image. */
  assetUrl: string;
  anchors: GarmentAnchors;
  /** Natural pixel dimensions of the source image. */
  naturalWidth: number;
  naturalHeight: number;
  /**
   * Aspect ratio of the garment's shoulder span relative to its full width.
   * Used for proportion-aware scaling.
   */
  shoulderToWidthRatio: number;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Describes how a garment should be placed on the canvas this frame. */
export interface GarmentTransform {
  /** Top-left pixel origin of the garment rectangle on the output canvas. */
  x: number;
  y: number;
  /** Pixel dimensions of the scaled garment. */
  width: number;
  height: number;
  /** Rotation in radians around the transform origin (torsoCentre). */
  rotation: number;
  /** Origin of rotation in pixel coords (absolute on canvas). */
  originX: number;
  originY: number;
}

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------

/** Engine operational state machine. */
export type EngineState =
  | "uninitialised"
  | "initialising"
  | "ready"
  | "running"
  | "error"
  | "disposed";

/** Events emitted by the engine on its event target. */
export type EngineEventType =
  | "statechange"
  | "error"
  | "trackingresult"
  | "segmentationresult"
  | "framerendered";

/** Payload for a statechange event. */
export interface StateChangeEvent {
  previous: EngineState;
  current: EngineState;
}

/** Payload for an error event. */
export interface EngineErrorEvent {
  code: string;
  message: string;
  cause?: unknown;
}

