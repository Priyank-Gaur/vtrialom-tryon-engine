/**
 * src/garments/GarmentLoader.ts
 *
 * Responsible for loading, validating, and caching 2D garment assets
 * (PNG, WebP, SVG) and their accompanying metadata specifications.
 */

import type {
  GarmentMetadata,
  LoadedGarment,
} from "../core/types.js";
import { validateGarmentMetadata } from "./GarmentMetadata.js";

export interface LoadGarmentOptions {
  id: string;
  assetUrl?: string;
  metadataUrl?: string;
  metadata?: Partial<GarmentMetadata>;
  name?: string;
}

export class GarmentLoader {
  private readonly _cache = new Map<string, LoadedGarment>();

  /**
   * Loads a garment from specified options.
   * If already loaded, returns the cached instance immediately.
   */
  async loadGarment(options: LoadGarmentOptions): Promise<LoadedGarment> {
    if (!options.id || !options.id.trim()) {
      throw new Error("Cannot load garment: options.id is required.");
    }

    // 1. Check in-memory cache
    if (this._cache.has(options.id)) {
      return this._cache.get(options.id)!;
    }

    // 2. Resolve metadata (from metadataUrl or options or default)
    let rawMetadata: Record<string, any> = {
      id: options.id,
      name: options.name ?? options.id,
      assetUrl: options.assetUrl,
      ...options.metadata,
    };

    if (options.metadataUrl) {
      try {
        const response = await fetch(options.metadataUrl);
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status} loading metadata from ${options.metadataUrl}`);
        }
        const json = await response.json();
        rawMetadata = { ...json, ...rawMetadata };
      } catch (err) {
        console.warn(`[GarmentLoader] Failed to fetch metadataUrl "${options.metadataUrl}":`, err);
        // Fall back to provided metadata if available
        if (!rawMetadata.assetUrl) {
          throw new Error(`Failed to load garment metadata: ${err}`);
        }
      }
    }

    if (!rawMetadata.assetUrl) {
      throw new Error(`Garment "${options.id}" has no assetUrl specified.`);
    }

    // 3. Load the image asset into an HTMLImageElement
    const image = await this._loadImage(rawMetadata.assetUrl);

    // Update natural dimensions from loaded image if not explicitly set
    rawMetadata.naturalWidth = rawMetadata.naturalWidth ?? image.naturalWidth;
    rawMetadata.naturalHeight = rawMetadata.naturalHeight ?? image.naturalHeight;

    // 4. Validate and sanitize metadata
    const metadata = validateGarmentMetadata(rawMetadata);

    // 5. Derive geometric proportions
    const shoulderSpan = Math.hypot(
      metadata.anchors.rightShoulder.x - metadata.anchors.leftShoulder.x,
      metadata.anchors.rightShoulder.y - metadata.anchors.leftShoulder.y
    );

    const torsoLength = Math.hypot(
      metadata.anchors.hemCentre.x - metadata.anchors.neckCentre.x,
      metadata.anchors.hemCentre.y - metadata.anchors.neckCentre.y
    );

    const loaded: LoadedGarment = {
      metadata,
      image,
      dimensions: {
        width: metadata.naturalWidth,
        height: metadata.naturalHeight,
        aspectRatio: metadata.naturalWidth / (metadata.naturalHeight || 1),
      },
      shoulderSpan,
      torsoLength,
    };

    // Cache the loaded garment
    this._cache.set(options.id, loaded);

    return loaded;
  }

  /**
   * Preloads an array of garments in parallel.
   */
  async preload(garments: LoadGarmentOptions[]): Promise<LoadedGarment[]> {
    return Promise.all(garments.map((g) => this.loadGarment(g)));
  }

  /** Retrieves a cached garment by ID if already loaded. */
  getCached(id: string): LoadedGarment | null {
    return this._cache.get(id) ?? null;
  }

  /** Clears the garment cache. */
  clearCache(): void {
    this._cache.clear();
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private _loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        resolve(img);
      };

      img.onerror = (err) => {
        reject(new Error(`Failed to load garment image asset from "${url}": ${err}`));
      };

      img.src = url;
    });
  }
}

