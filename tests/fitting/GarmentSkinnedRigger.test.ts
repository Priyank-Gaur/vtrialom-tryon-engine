/**
 * tests/fitting/GarmentSkinnedRigger.test.ts
 *
 * Unit tests for GarmentSkinnedRigger GPU SkinnedMesh rigging.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { GarmentSkinnedRigger } from "../../src/fitting/GarmentSkinnedRigger";
import type { Loaded3DGarment } from "../../src/garments/Garment3DLoader";
import type { BodyGeometry } from "../../src/core/types";

function createMockMeshGarment(): Loaded3DGarment {
  const geom = new THREE.BufferGeometry();
  // 6 vertices: torso (x ~ 0), left sleeve (x ~ -0.22), right sleeve (x ~ +0.22)
  const vertices = new Float32Array([
    // Torso
    0.0, 0.2, 0.0,
    0.0, -0.2, 0.0,
    // Left sleeve
    -0.22, 0.1, 0.0,
    -0.28, 0.0, 0.0,
    // Right sleeve
    0.22, 0.1, 0.0,
    0.28, 0.0, 0.0,
  ]);
  geom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial());
  const group = new THREE.Group();
  group.add(mesh);

  return {
    metadata: {
      id: "test-garment",
      name: "Test Garment",
      category: "T-shirt",
      modelUrl: "test.glb",
      anchors: {
        leftShoulder: [-0.20, 0.20, 0.0],
        rightShoulder: [0.20, 0.20, 0.0],
      },
    },
    model: group,
    dimensions: new THREE.Vector3(0.6, 0.65, 0.25),
    shoulderSpan: 0.40,
    center: new THREE.Vector3(0, 0, 0),
  };
}

function makeArmRaisedBody(): BodyGeometry {
  return {
    shoulderMidpoint: { x: 0.5, y: 0.35 },
    shoulderWidth: 0.3,
    hipMidpoint: { x: 0.5, y: 0.65 },
    hipWidth: 0.25,
    torsoHeight: 0.3,
    torsoCentre: { x: 0.5, y: 0.5 },
    torsoRotation: 0,
    landmarks: Array.from({ length: 33 }, (_, i) => {
      if (i === 11) return { x: 0.65, y: 0.35, z: 0.0, visibility: 0.95 }; // LEFT_SHOULDER
      if (i === 12) return { x: 0.35, y: 0.35, z: 0.0, visibility: 0.95 }; // RIGHT_SHOULDER
      // Left arm raised horizontally
      if (i === 13) return { x: 0.85, y: 0.30, z: 0.0, visibility: 0.9 }; // LEFT_ELBOW
      // Right arm down
      if (i === 14) return { x: 0.25, y: 0.55, z: 0.0, visibility: 0.9 }; // RIGHT_ELBOW
      return { x: 0.5, y: 0.5, z: 0, visibility: 0.8 };
    }),
  };
}

describe("GarmentSkinnedRigger", () => {
  let rigger: GarmentSkinnedRigger;

  beforeEach(() => {
    rigger = new GarmentSkinnedRigger();
  });

  it("converts child Mesh into a SkinnedMesh with 3 bones", () => {
    const garment = createMockMeshGarment();
    const armature = rigger.ensureRigged(garment);

    expect(armature.rootBone.name).toBe("Bone_Torso");
    expect(armature.leftArmBone.name).toBe("Bone_LeftArm");
    expect(armature.rightArmBone.name).toBe("Bone_RightArm");

    const skinnedMesh = garment.model.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    expect(skinnedMesh).toBeDefined();
    expect(skinnedMesh.isSkinnedMesh).toBe(true);

    const geo = skinnedMesh.geometry;
    expect(geo.attributes.skinIndex).toBeDefined();
    expect(geo.attributes.skinWeight).toBeDefined();
  });

  it("rotates arm bones when arms are moved", () => {
    const garment = createMockMeshGarment();
    const armature = rigger.ensureRigged(garment);
    const body = makeArmRaisedBody();

    rigger.updateArmature(garment, body);

    // Left arm bone quaternion should differ from identity
    const leftQ = armature.leftArmBone.quaternion;
    const isRotated = Math.abs(leftQ.x) > 0.001 || Math.abs(leftQ.y) > 0.001 || Math.abs(leftQ.z) > 0.001;
    expect(isRotated).toBe(true);
  });
});
