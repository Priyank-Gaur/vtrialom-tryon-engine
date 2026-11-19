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
 * Garment category. Drives which fitting and deformation algorithms are selected.
 * Extensible for future bottomwear and full-body clothing.
 */
export type GarmentCategory =
  | "TOP"
  | "TSHIRT"
  | "SHIRT"
  | "HOODIE"
  | "OUTERWEAR"
  | "PLACEHOLDER";

/**
 * Anchor points that locate the garment on the body.
 * All coordinates are normalised [0,1] in garment-image space.
 */
export interface GarmentAnchors {
  leftShoulder: NormalisedPoint2D;
  rightShoulder: NormalisedPoint2D;
  neckCentre: NormalisedPoint2D;
  hemCentre: NormalisedPoint2D;
  leftHem?: NormalisedPoint2D;
  rightHem?: NormalisedPoint2D;
  leftSleeveTip?: NormalisedPoint2D;
  rightSleeveTip?: NormalisedPoint2D;
  chestCentre?: NormalisedPoint2D;
}

/** 3D model metadata for future 3D rendering pipeline. */
export interface Garment3DAnchors {
  neckline?: [number, number, number];
  leftShoulder?: [number, number, number];
  rightShoulder?: [number, number, number];
  chest?: [number, number, number];
  waist?: [number, number, number];
  hem?: [number, number, number];
  leftElbow?: [number, number, number];
  rightElbow?: [number, number, number];
  leftWrist?: [number, number, number];
  rightWrist?: [number, number, number];
}

export interface Garment3DMetadata {
  id: string;
  name: string;
  category: string;
  modelUrl: string;
  format?: "GLB" | "GLTF";
  anchors: Garment3DAnchors;
  scale?: [number, number, number] | number;
  rotationOffset?: [number, number, number];
  positionOffset?: [number, number, number];
  source?: {
    repository?: string;
    url?: string;
    license?: string;
    commercialUsePermitted?: boolean;
    author?: string;
  };
  fitting?: {
    proportions?: "regular" | "oversized" | "slim" | "fitted";
    shoulderStiffness?: number;
    sleeveFollowTorso?: number;
  };
}

/** Complete metadata specification for a garment asset. */
export interface GarmentMetadata {
  id: string;
  name: string;
  category: GarmentCategory;
  /** URL or path to the transparent PNG/WebP image asset. */
  assetUrl: string;
  anchors: GarmentAnchors;
  /** Natural pixel dimensions of the source image. */
  naturalWidth: number;
  naturalHeight: number;
  /**
   * Ratio of the garment's shoulder span relative to its full width [0.0, 1.0].
   * Used for proportion-aware scaling.
   */
  shoulderToWidthRatio: number;
  description?: string;
  availableSizes?: string[];
  defaultSize?: string;
  model3D?: Garment3DMetadata;
}

/** A fully loaded and parsed garment asset ready for rendering and fitting. */
export interface LoadedGarment {
  metadata: GarmentMetadata;
  image: HTMLImageElement;
  dimensions: {
    width: number;
    height: number;
    aspectRatio: number;
  };
  /** Distance between left and right shoulder in normalized asset units [0,1]. */
  shoulderSpan: number;
  /** Length from neckline to bottom hem in normalized asset units [0,1]. */
  torsoLength: number;
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

/** Per-frame result produced by GarmentFitter. */
export interface FittingResult {
  /** The garment ID this result applies to. */
  garmentId: string;
  /** Canvas-space transform describing where and how to draw the garment. */
  transform: GarmentTransform;
  /** Whether the body was sufficiently visible for a confident fit. */
  confident: boolean;
  /** Scale factor applied (body shoulder px / garment shoulder span). */
  scale: number;
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

