/**
 * src/fitting/GarmentFitter.ts
 *
 * Responsibility:
 *   Map garment anchor points to live body landmark positions and produce a
 *   per-frame canvas-space GarmentTransform so the host renderer knows exactly
 *   where to draw the garment image.
 *
 * Algorithm (landmark-driven rigid fitting):
 *   1. Read body shoulder positions and midpoint from BodyGeometry.
 *   2. Map to mirrored selfie canvas coordinates:
 *      screenMidpointX = (1 - body.shoulderMidpoint.x) * canvasW
 *      screenMidpointY = body.shoulderMidpoint.y * canvasH
 *   3. Compute body shoulder width in pixels.
 *   4. Scale garment so its normalised shoulder-span matches body shoulder width.
 *   5. Set rotation to -body.torsoRotation (mirrored for selfie display).
 *   6. Compute local unrotated offset so the garment's shoulder/neck anchor
 *      aligns exactly with the rotation origin (shoulder midpoint).
 */

import { LANDMARK_INDEX, type BodyGeometry, type FittingResult, type GarmentTransform } from "../core/types.js";
import type { LoadedGarment } from "../core/types.js";

export interface FitterConfig {
  /**
   * Minimum per-landmark visibility score (0–1) for shoulders to be considered reliable.
   * Default: 0.35
   */
  minVisibility?: number;
}

const DEFAULT_FITTER_CONFIG: Required<FitterConfig> = {
  minVisibility: 0.35,
};

export class GarmentFitter {
  private readonly _cfg: Required<FitterConfig>;

  constructor(config: FitterConfig = {}) {
    this._cfg = { ...DEFAULT_FITTER_CONFIG, ...config };
  }

  /**
   * Compute the canvas-space transform for `garment` given the current
   * `body` geometry and canvas dimensions.
   */
  fit(
    body: BodyGeometry,
    garment: LoadedGarment,
    canvasW: number,
    canvasH: number,
  ): FittingResult {
    const landmarks = body.landmarks;

    const lsRaw = landmarks[LANDMARK_INDEX.LEFT_SHOULDER];
    const rsRaw = landmarks[LANDMARK_INDEX.RIGHT_SHOULDER];

    // --- Confidence check -------------------------------------------------
    const lsVis = lsRaw?.visibility ?? 0.8;
    const rsVis = rsRaw?.visibility ?? 0.8;
    const confident =
      lsVis >= this._cfg.minVisibility && rsVis >= this._cfg.minVisibility;

    // --- Origin: Shoulder midpoint in mirrored canvas pixels --------------
    // In selfie mode, x is flipped (1 - x).
    const originX = (1 - body.shoulderMidpoint.x) * canvasW;
    const originY = body.shoulderMidpoint.y * canvasH;

    // --- Body shoulder span in pixels -------------------------------------
    const bodyShoulderPx = Math.max(body.shoulderWidth * canvasW, 10);

    // --- Garment scale factor ---------------------------------------------
    const shoulderSpan = Math.max(garment.shoulderSpan, 0.05);
    const garmentWidthPx = bodyShoulderPx / shoulderSpan;
    const garmentHeightPx = garmentWidthPx / garment.dimensions.aspectRatio;

    const scale = garmentWidthPx / garment.dimensions.width;

    // --- Garment anchor midpoint ------------------------------------------
    const anchors = garment.metadata.anchors;
    const lsAnchor = anchors.leftShoulder;
    const rsAnchor = anchors.rightShoulder;

    // Midpoint between garment shoulder anchors in normalized space (0..1)
    const anchorMidX = (lsAnchor.x + rsAnchor.x) / 2;
    const anchorMidY = (lsAnchor.y + rsAnchor.y) / 2;

    // Local unrotated top-left offset from origin (in pixels)
    const localX = -anchorMidX * garmentWidthPx;
    const localY = -anchorMidY * garmentHeightPx;

    // Torso rotation: mirrored for selfie mode
    const rotation = -body.torsoRotation === 0 ? 0 : -body.torsoRotation;

    const transform: GarmentTransform = {
      x: localX,
      y: localY,
      width: garmentWidthPx,
      height: garmentHeightPx,
      rotation,
      originX,
      originY,
    };

    return {
      garmentId: garment.metadata.id,
      transform,
      confident,
      scale,
    };
  }
}
