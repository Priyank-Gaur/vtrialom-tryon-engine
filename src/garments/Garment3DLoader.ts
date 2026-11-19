/**
 * src/garments/Garment3DLoader.ts
 *
 * Responsibility:
 *   Autonomous, robust loading of 3D GLB/glTF garments, parsing metadata,
 *   extracting anchors, computing bounding dimensions, and managing GPU memory.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Garment3DMetadata } from "../core/types.js";

export interface Loaded3DGarment {
  metadata: Garment3DMetadata;
  model: THREE.Group;
  dimensions: THREE.Vector3;
  shoulderSpan: number;
  center: THREE.Vector3;
}

export interface Load3DGarmentOptions {
  id: string;
  modelUrl?: string;
  metadataUrl?: string;
  metadata?: Partial<Garment3DMetadata>;
}

export class Garment3DLoader {
  private readonly _loader = new GLTFLoader();
  private readonly _cache = new Map<string, Loaded3DGarment>();

  /**
   * Load a 3D garment from URL or metadata.
   */
  async loadGarment(options: Load3DGarmentOptions): Promise<Loaded3DGarment> {
    if (!options.id) {
      throw new Error("Garment3DLoader: options.id is required.");
    }

    if (this._cache.has(options.id)) {
      return this._cache.get(options.id)!;
    }

    let meta: Garment3DMetadata;

    if (options.metadataUrl) {
      const res = await fetch(options.metadataUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch 3D garment metadata from ${options.metadataUrl}`);
      }
      meta = (await res.json()) as Garment3DMetadata;
    } else if (options.metadata) {
      meta = {
        id: options.id,
        name: options.metadata.name ?? options.id,
        category: options.metadata.category ?? "T-shirt",
        modelUrl: options.modelUrl ?? options.metadata.modelUrl ?? "",
        anchors: options.metadata.anchors ?? {},
        ...options.metadata,
      } as Garment3DMetadata;
    } else if (options.modelUrl) {
      meta = {
        id: options.id,
        name: options.id,
        category: "T-shirt",
        modelUrl: options.modelUrl,
        anchors: {},
      };
    } else {
      throw new Error(`Garment3DLoader: no modelUrl or metadataUrl provided for "${options.id}".`);
    }

    if (!meta.modelUrl && options.modelUrl) {
      meta.modelUrl = options.modelUrl;
    }

    // Load GLTF / GLB model
    const gltf = await this._loadGLTF(meta.modelUrl);
    const model = gltf.scene;

    // Apply materials configuration: ensure double-sided rendering for cloth interiors
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => {
              m.side = THREE.DoubleSide;
            });
          } else {
            mesh.material.side = THREE.DoubleSide;
          }
        }
      }
    });

    // Compute bounding box and dimensions
    const box = new THREE.Box3().setFromObject(model);
    const dimensions = new THREE.Vector3();
    box.getSize(dimensions);

    const center = new THREE.Vector3();
    box.getCenter(center);

    // Compute shoulder span from anchors or fallback to upper 75% width
    let shoulderSpan = 0.45;
    if (meta.anchors.leftShoulder && meta.anchors.rightShoulder) {
      const ls = new THREE.Vector3(...meta.anchors.leftShoulder);
      const rs = new THREE.Vector3(...meta.anchors.rightShoulder);
      shoulderSpan = ls.distanceTo(rs);
    } else {
      shoulderSpan = Math.max(dimensions.x * 0.75, 0.3);
    }

    const loaded: Loaded3DGarment = {
      metadata: meta,
      model,
      dimensions,
      shoulderSpan,
      center,
    };

    this._cache.set(options.id, loaded);
    return loaded;
  }

  getCached(id: string): Loaded3DGarment | null {
    return this._cache.get(id) ?? null;
  }

  clearCache(): void {
    for (const item of this._cache.values()) {
      item.model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material?.dispose();
          }
        }
      });
    }
    this._cache.clear();
  }

  private _loadGLTF(url: string): Promise<{ scene: THREE.Group }> {
    return new Promise((resolve, reject) => {
      this._loader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (err) => reject(new Error(`Failed to load 3D model from ${url}: ${err}`)),
      );
    });
  }
}
