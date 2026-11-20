/**
 * src/rendering/ThreeRenderer.ts
 *
 * Responsibility:
 *   Manages a transparent Three.js WebGL context that overlays precisely on top
 *   of the 2D video/canvas stream.
 *
 * Design:
 *   - PerspectiveCamera calibrated to typical webcam FOV (50 degrees).
 *   - Transparent background (alpha: true) so video feed remains visible beneath.
 *   - Integrated BodyOccluder3D for depth-buffer occlusion of neck, head, and arms.
 *   - Studio cloth lighting: ambient + key light + fill light + subtle rim light.
 *   - Resource disposal for clean garbage collection on teardown.
 */

import * as THREE from "three";
import { BodyOccluder3D } from "./BodyOccluder3D.js";
import type { BodyGeometry } from "../core/types.js";

export interface ThreeRendererOptions {
  canvas?: HTMLCanvasElement;
  fov?: number;
  near?: number;
  far?: number;
}

export class ThreeRenderer {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _renderer: THREE.WebGLRenderer;
  private readonly _scene: THREE.Scene;
  private readonly _camera: THREE.PerspectiveCamera;

  private _garmentGroup: THREE.Group;
  private _bodyOccluder: BodyOccluder3D;
  private _ambientLight: THREE.AmbientLight;
  private _keyLight: THREE.DirectionalLight;
  private _fillLight: THREE.DirectionalLight;
  private _rimLight: THREE.DirectionalLight;

  private _width = 640;
  private _height = 480;

  constructor(options: ThreeRendererOptions = {}) {
    this._canvas = options.canvas ?? document.createElement("canvas");
    this._canvas.style.position = "absolute";
    this._canvas.style.inset = "0";
    this._canvas.style.width = "100%";
    this._canvas.style.height = "100%";
    this._canvas.style.pointerEvents = "none";

    const fov = options.fov ?? 50;
    const near = options.near ?? 0.1;
    const far = options.far ?? 1000;

    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    // Ensure transparent background for video overlay
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.0;

    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(fov, 1, near, far);
    // Position camera along +Z axis looking at origin
    this._camera.position.set(0, 0, 2.0);

    // 1. Virtual Body Depth Occluder (rendered first at renderOrder = -1)
    this._bodyOccluder = new BodyOccluder3D();
    this._scene.add(this._bodyOccluder.group);

    // 2. Garment container node
    this._garmentGroup = new THREE.Group();
    this._garmentGroup.name = "garment-layer";
    this._scene.add(this._garmentGroup);

    // 3. Studio lighting calibrated for fabric realism
    this._ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this._scene.add(this._ambientLight);

    this._keyLight = new THREE.DirectionalLight(0xfffaed, 1.1);
    this._keyLight.position.set(1.2, 2.0, 2.5);
    this._scene.add(this._keyLight);

    this._fillLight = new THREE.DirectionalLight(0xdbeafe, 0.5);
    this._fillLight.position.set(-1.2, 0.5, 1.8);
    this._scene.add(this._fillLight);

    this._rimLight = new THREE.DirectionalLight(0xffffff, 0.35);
    this._rimLight.position.set(0, -1.0, -2.0);
    this._scene.add(this._rimLight);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get domElement(): HTMLCanvasElement {
    return this._canvas;
  }

  get scene(): THREE.Scene {
    return this._scene;
  }

  get camera(): THREE.PerspectiveCamera {
    return this._camera;
  }

  get garmentGroup(): THREE.Group {
    return this._garmentGroup;
  }

  get bodyOccluder(): BodyOccluder3D {
    return this._bodyOccluder;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  /**
   * Resize renderer and update camera aspect ratio.
   * Only reallocates WebGL buffers when dimensions actually change.
   */
  setSize(width: number, height: number, dpr = window.devicePixelRatio || 1): void {
    if (width <= 0 || height <= 0) return;
    if (this._width === width && this._height === height) return;
    this._width = width;
    this._height = height;
    this._renderer.setPixelRatio(dpr);
    this._renderer.setSize(width, height, false);
    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();
  }

  /**
   * Set active 3D garment object in the scene.
   */
  setGarmentMesh(mesh: THREE.Object3D | null): void {
    // Clear existing garment objects
    while (this._garmentGroup.children.length > 0) {
      const child = this._garmentGroup.children[0];
      this._garmentGroup.remove(child);
    }

    if (mesh) {
      this._garmentGroup.add(mesh);
      this.domElement.style.display = "block";
    } else {
      this._bodyOccluder.visible = false;
      this.clear();
      this.domElement.style.display = "none";
    }
  }

  /**
   * Clear the WebGL drawing buffer completely with transparent alpha.
   */
  clear(): void {
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.clear();
  }

  /**
   * Render active 3D scene, updating body occluder with live landmarks.
   */
  render(body?: BodyGeometry): void {
    if (this._garmentGroup.children.length === 0) {
      this.clear();
      return;
    }

    // Update body occluder depth mask if body geometry is available
    if (body) {
      this._bodyOccluder.update(body, this._camera);
    } else {
      this._bodyOccluder.visible = false;
    }

    this._renderer.render(this._scene, this._camera);
  }

  /**
   * Free all WebGL resources.
   */
  dispose(): void {
    this.setGarmentMesh(null);
    this._bodyOccluder.dispose();
    this._renderer.dispose();
  }
}
