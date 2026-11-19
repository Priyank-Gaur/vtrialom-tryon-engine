/**
 * src/garments/GarmentMetadata.ts
 *
 * Defines default anchor templates and validation utilities for garment assets.
 */

import type {
  GarmentAnchors,
  GarmentCategory,
  GarmentMetadata,
} from "../core/types.js";

/** Default normalized anchor templates for standard clothing categories */
export const DEFAULT_ANCHORS: Record<GarmentCategory, GarmentAnchors> = {
  TOP: {
    leftShoulder: { x: 0.28, y: 0.16 },
    rightShoulder: { x: 0.72, y: 0.16 },
    neckCentre: { x: 0.50, y: 0.18 },
    hemCentre: { x: 0.50, y: 0.92 },
    leftHem: { x: 0.26, y: 0.92 },
    rightHem: { x: 0.74, y: 0.92 },
    leftSleeveTip: { x: 0.08, y: 0.38 },
    rightSleeveTip: { x: 0.92, y: 0.38 },
    chestCentre: { x: 0.50, y: 0.42 },
  },
  TSHIRT: {
    leftShoulder: { x: 0.28, y: 0.16 },
    rightShoulder: { x: 0.72, y: 0.16 },
    neckCentre: { x: 0.50, y: 0.18 },
    hemCentre: { x: 0.50, y: 0.92 },
    leftHem: { x: 0.26, y: 0.92 },
    rightHem: { x: 0.74, y: 0.92 },
    leftSleeveTip: { x: 0.08, y: 0.38 },
    rightSleeveTip: { x: 0.92, y: 0.38 },
    chestCentre: { x: 0.50, y: 0.42 },
  },
  SHIRT: {
    leftShoulder: { x: 0.26, y: 0.14 },
    rightShoulder: { x: 0.74, y: 0.14 },
    neckCentre: { x: 0.50, y: 0.15 },
    hemCentre: { x: 0.50, y: 0.94 },
    leftHem: { x: 0.24, y: 0.94 },
    rightHem: { x: 0.76, y: 0.94 },
    leftSleeveTip: { x: 0.06, y: 0.48 },
    rightSleeveTip: { x: 0.94, y: 0.48 },
    chestCentre: { x: 0.50, y: 0.40 },
  },
  HOODIE: {
    leftShoulder: { x: 0.24, y: 0.20 },
    rightShoulder: { x: 0.76, y: 0.20 },
    neckCentre: { x: 0.50, y: 0.22 },
    hemCentre: { x: 0.50, y: 0.90 },
    leftHem: { x: 0.22, y: 0.90 },
    rightHem: { x: 0.78, y: 0.90 },
    leftSleeveTip: { x: 0.05, y: 0.55 },
    rightSleeveTip: { x: 0.95, y: 0.55 },
    chestCentre: { x: 0.50, y: 0.48 },
  },
  OUTERWEAR: {
    leftShoulder: { x: 0.24, y: 0.18 },
    rightShoulder: { x: 0.76, y: 0.18 },
    neckCentre: { x: 0.50, y: 0.20 },
    hemCentre: { x: 0.50, y: 0.92 },
    leftHem: { x: 0.22, y: 0.92 },
    rightHem: { x: 0.78, y: 0.92 },
    leftSleeveTip: { x: 0.06, y: 0.52 },
    rightSleeveTip: { x: 0.94, y: 0.52 },
    chestCentre: { x: 0.50, y: 0.45 },
  },
  PLACEHOLDER: {
    leftShoulder: { x: 0.25, y: 0.20 },
    rightShoulder: { x: 0.75, y: 0.20 },
    neckCentre: { x: 0.50, y: 0.20 },
    hemCentre: { x: 0.50, y: 0.90 },
  },
};

/**
 * Validates and sanitizes raw garment metadata, applying defaults for missing anchors.
 */
export function validateGarmentMetadata(data: unknown): GarmentMetadata {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid garment metadata: payload must be a non-null object.");
  }

  const raw = data as Record<string, any>;

  if (typeof raw.id !== "string" || !raw.id.trim()) {
    throw new Error("Invalid garment metadata: missing or empty 'id' string.");
  }

  if (typeof raw.assetUrl !== "string" || !raw.assetUrl.trim()) {
    throw new Error(`Invalid garment metadata for '${raw.id}': missing or empty 'assetUrl'.`);
  }

  const category: GarmentCategory = raw.category && DEFAULT_ANCHORS[raw.category as GarmentCategory]
    ? (raw.category as GarmentCategory)
    : "TOP";

  const defaultTemplate = DEFAULT_ANCHORS[category];
  const rawAnchors = (raw.anchors && typeof raw.anchors === "object") ? raw.anchors : {};

  const anchors: GarmentAnchors = {
    leftShoulder: rawAnchors.leftShoulder ?? defaultTemplate.leftShoulder,
    rightShoulder: rawAnchors.rightShoulder ?? defaultTemplate.rightShoulder,
    neckCentre: rawAnchors.neckCentre ?? defaultTemplate.neckCentre,
    hemCentre: rawAnchors.hemCentre ?? defaultTemplate.hemCentre,
    leftHem: rawAnchors.leftHem ?? defaultTemplate.leftHem,
    rightHem: rawAnchors.rightHem ?? defaultTemplate.rightHem,
    leftSleeveTip: rawAnchors.leftSleeveTip ?? defaultTemplate.leftSleeveTip,
    rightSleeveTip: rawAnchors.rightSleeveTip ?? defaultTemplate.rightSleeveTip,
    chestCentre: rawAnchors.chestCentre ?? defaultTemplate.chestCentre,
  };

  const shoulderDist = Math.hypot(
    anchors.rightShoulder.x - anchors.leftShoulder.x,
    anchors.rightShoulder.y - anchors.leftShoulder.y
  );

  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : raw.id,
    category,
    assetUrl: raw.assetUrl,
    anchors,
    naturalWidth: typeof raw.naturalWidth === "number" ? raw.naturalWidth : 512,
    naturalHeight: typeof raw.naturalHeight === "number" ? raw.naturalHeight : 512,
    shoulderToWidthRatio:
      typeof raw.shoulderToWidthRatio === "number"
        ? raw.shoulderToWidthRatio
        : shoulderDist,
    description: typeof raw.description === "string" ? raw.description : undefined,
    availableSizes: Array.isArray(raw.availableSizes) ? raw.availableSizes : ["S", "M", "L", "XL"],
    defaultSize: typeof raw.defaultSize === "string" ? raw.defaultSize : "M",
    model3D: raw.model3D,
  };
}

