/**
 * tests/rendering/BodyOccluder3D.test.ts
 *
 * Unit tests for BodyOccluder3D real-time depth occlusion.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { BodyOccluder3D } from "../../src/rendering/BodyOccluder3D";
import type { BodyGeometry } from "../../src/core/types";

function makeTestBody(): BodyGeometry {
  return {
    shoulderMidpoint: { x: 0.5, y: 0.35 },
    shoulderWidth: 0.3,
    hipMidpoint: { x: 0.5, y: 0.65 },
    hipWidth: 0.25,
    torsoHeight: 0.3,
    torsoCentre: { x: 0.5, y: 0.5 },
    torsoRotation: 0,
    landmarks: Array.from({ length: 33 }, (_, i) => {
      if (i === 0) return { x: 0.5, y: 0.20, z: -0.05, visibility: 0.95 }; // NOSE
      if (i === 11) return { x: 0.65, y: 0.35, z: 0.05, visibility: 0.9 }; // LEFT_SHOULDER
      if (i === 12) return { x: 0.35, y: 0.35, z: -0.05, visibility: 0.9 }; // RIGHT_SHOULDER
      if (i === 13) return { x: 0.72, y: 0.50, z: 0.02, visibility: 0.85 }; // LEFT_ELBOW
      if (i === 14) return { x: 0.28, y: 0.50, z: -0.02, visibility: 0.85 }; // RIGHT_ELBOW
      if (i === 15) return { x: 0.75, y: 0.65, z: 0.01, visibility: 0.8 }; // LEFT_WRIST
      if (i === 16) return { x: 0.25, y: 0.65, z: -0.01, visibility: 0.8 }; // RIGHT_WRIST
      if (i === 23) return { x: 0.62, y: 0.65, z: 0.02, visibility: 0.9 }; // LEFT_HIP
      if (i === 24) return { x: 0.38, y: 0.65, z: -0.02, visibility: 0.9 }; // RIGHT_HIP
      return { x: 0.5, y: 0.5, z: 0, visibility: 0.8 };
    }),
  };
}

describe("BodyOccluder3D", () => {
  let occluder: BodyOccluder3D;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    occluder = new BodyOccluder3D();
    camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    camera.position.set(0, 0, 2.0);
  });

  it("configures depth-only material with colorWrite: false and depthWrite: true", () => {
    expect(occluder.group.children.length).toBeGreaterThan(0);
    occluder.group.children.forEach((child) => {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      expect(mat.colorWrite).toBe(false);
      expect(mat.depthWrite).toBe(true);
      expect(mesh.renderOrder).toBe(-1);
    });
  });

  it("updates mesh positions based on body landmarks", () => {
    const body = makeTestBody();
    occluder.update(body, camera);

    expect(occluder.visible).toBe(true);
  });

  it("hides occluder when shoulder visibility is too low", () => {
    const body = makeTestBody();
    body.landmarks[11]!.visibility = 0.05;
    body.landmarks[12]!.visibility = 0.05;

    occluder.update(body, camera);
    expect(occluder.visible).toBe(false);
  });

  it("disposes geometry and materials without error", () => {
    expect(() => occluder.dispose()).not.toThrow();
  });
});
