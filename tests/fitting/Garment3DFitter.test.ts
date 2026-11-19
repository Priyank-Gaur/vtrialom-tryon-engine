/**
 * tests/fitting/Garment3DFitter.test.ts
 *
 * Unit tests for Garment3DFitter 3D position, rotation, and scaling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { Garment3DFitter } from "../../src/fitting/Garment3DFitter";
import type { Loaded3DGarment } from "../../src/garments/Garment3DLoader";
import type { BodyGeometry } from "../../src/core/types";

function makeTestBody(overrides: Partial<BodyGeometry> = {}): BodyGeometry {
  return {
    shoulderMidpoint: { x: 0.5, y: 0.35 },
    shoulderWidth: 0.3,
    hipMidpoint: { x: 0.5, y: 0.65 },
    hipWidth: 0.25,
    torsoHeight: 0.3,
    torsoCentre: { x: 0.5, y: 0.5 },
    torsoRotation: 0,
    landmarks: Array.from({ length: 33 }, (_, i) => {
      if (i === 11) return { x: 0.65, y: 0.35, z: 0.05, visibility: 0.9 }; // LEFT_SHOULDER
      if (i === 12) return { x: 0.35, y: 0.35, z: -0.05, visibility: 0.9 }; // RIGHT_SHOULDER
      if (i === 23) return { x: 0.62, y: 0.65, z: 0.02, visibility: 0.9 }; // LEFT_HIP
      if (i === 24) return { x: 0.38, y: 0.65, z: -0.02, visibility: 0.9 }; // RIGHT_HIP
      return { x: 0.5, y: 0.5, z: 0, visibility: 0.8 };
    }),
    ...overrides,
  };
}

function makeMock3DGarment(): Loaded3DGarment {
  const model = new THREE.Group();
  return {
    metadata: {
      id: "tshirt-basic",
      name: "Basic Crewneck T-Shirt",
      category: "Basic short-sleeve T-shirt",
      modelUrl: "/assets/garments/tshirt-basic/model.glb",
      anchors: {
        leftShoulder: [-0.22, 0.42, 0.0],
        rightShoulder: [0.22, 0.42, 0.0],
      },
    },
    model,
    dimensions: new THREE.Vector3(0.6, 0.7, 0.25),
    shoulderSpan: 0.44,
    center: new THREE.Vector3(0, 0, 0),
  };
}

describe("Garment3DFitter", () => {
  let fitter: Garment3DFitter;
  let camera: THREE.PerspectiveCamera;

  beforeEach(() => {
    fitter = new Garment3DFitter();
    camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    camera.position.set(0, 0, 2.0);
  });

  it("places garment at origin X when person is centered at x=0.5", () => {
    const body = makeTestBody({ shoulderMidpoint: { x: 0.5, y: 0.5 } });
    const garment = makeMock3DGarment();
    const result = fitter.fit(body, garment, camera);

    expect(result.confident).toBe(true);
    expect(result.position.x).toBeCloseTo(0, 2);
    expect(garment.model.position.x).toBeCloseTo(0, 2);
  });

  it("calculates positive roll when body shoulder line is tilted", () => {
    const body = makeTestBody({ torsoRotation: -Math.PI / 10 });
    const garment = makeMock3DGarment();
    const result = fitter.fit(body, garment, camera);

    // Mirrored roll: -(-PI/10) = +PI/10
    expect(result.rotation.z).toBeCloseTo(Math.PI / 10, 4);
    expect(garment.model.rotation.z).toBeCloseTo(Math.PI / 10, 4);
  });

  it("scales up when user steps closer to camera (larger shoulderWidth)", () => {
    const garment = makeMock3DGarment();
    const farBody = makeTestBody({ shoulderWidth: 0.2 });
    const nearBody = makeTestBody({ shoulderWidth: 0.4 });

    const farResult = fitter.fit(farBody, garment, camera);
    const farScaleX = farResult.scale.x;

    const nearResult = fitter.fit(nearBody, garment, camera);
    const nearScaleX = nearResult.scale.x;

    expect(nearScaleX).toBeGreaterThan(farScaleX);
  });

  it("updates garment model transform directly", () => {
    const body = makeTestBody();
    const garment = makeMock3DGarment();
    fitter.fit(body, garment, camera);

    expect(garment.model.scale.x).toBeGreaterThan(0);
    expect(garment.model.scale.y).toBeGreaterThan(0);
    expect(garment.model.scale.z).toBeGreaterThan(0);
  });
});
