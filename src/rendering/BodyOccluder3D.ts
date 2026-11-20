/**
 * src/rendering/BodyOccluder3D.ts
 *
 * Responsibility:
 *   Real-time 3D Virtual Body Depth Occlusion for authentic AR Virtual Try-On.
 *
 * The Problem in Naive 3D Overlays:
 *   Without depth occlusion, a 3D garment (including its back collar, inner rear fabric,
 *   and rear sleeve holes) is rendered entirely on top of the 2D webcam video stream.
 *   The back collar renders across the user's neck and chin, and the entire shirt
 *   looks like a floating 3D sticker or billboard pasted on top of the person.
 *
 * The Solution:
 *   Standard AR Body Depth Occlusion (as used in Snap Lens Studio, Spark AR, DeepAR):
 *   1. An invisible 3D proxy body (Neck cylinder, Head sphere, Torso volume, Arm capsules)
 *      is positioned dynamically in Three.js world space using live MediaPipe pose landmarks.
 *   2. It uses THREE.MeshBasicMaterial with `colorWrite: false` (writes 0 color to the screen)
 *      and `depthWrite: true` (writes distance into the WebGL Z-buffer).
 *   3. When rendered with `renderOrder = -1`:
 *      - The occluder primes the WebGL depth buffer with the user's physical geometry.
 *      - When the 3D garment is subsequently drawn:
 *        * Front chest and front collar (in front of the body) pass the depth test -> RENDERED.
 *        * Back collar and rear fabric (behind the neck/torso) fail the depth test -> CLIPPED.
 *      - The user's real video feed shines through in between:
 *        * The user's real neck cleanly protrudes THROUGH the garment's collar hole.
 *        * The user's real arms emerge FROM the sleeve cuffs.
 *        * When the user moves arms or hands in front of their chest, the real arms
 *          occlude the garment rather than the garment covering them.
 */

import * as THREE from "three";
import { LANDMARK_INDEX, type BodyGeometry, type Landmark3D } from "../core/types.js";

export class BodyOccluder3D {
  private readonly _group: THREE.Group;
  private readonly _material: THREE.MeshBasicMaterial;

  // Geometry meshes
  private readonly _neckMesh: THREE.Mesh;
  private readonly _headMesh: THREE.Mesh;
  private readonly _torsoMesh: THREE.Mesh;
  private readonly _leftUpperArmMesh: THREE.Mesh;
  private readonly _rightUpperArmMesh: THREE.Mesh;
  private readonly _leftForearmMesh: THREE.Mesh;
  private readonly _rightForearmMesh: THREE.Mesh;

  // Reusable vectors to avoid per-frame GC allocations
  private readonly _vA = new THREE.Vector3();
  private readonly _vB = new THREE.Vector3();
  private readonly _vDir = new THREE.Vector3();
  private readonly _vUp = new THREE.Vector3(0, 1, 0);
  private readonly _quat = new THREE.Quaternion();

  constructor() {
    this._group = new THREE.Group();
    this._group.name = "virtual-body-occluder";

    // Depth-only material: invisible in color, fully active in WebGL depth buffer
    this._material = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
    });

    // 1. Neck: Cylinder connecting shoulder midpoint to chin
    // Base geometry is unit cylinder (radius=1, height=1) along Y axis
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
    this._neckMesh = new THREE.Mesh(cylGeo, this._material);
    this._neckMesh.renderOrder = -1;
    this._group.add(this._neckMesh);

    // 2. Head: Sphere centered around face/head landmarks
    const headGeo = new THREE.SphereGeometry(1, 16, 16);
    this._headMesh = new THREE.Mesh(headGeo, this._material);
    this._headMesh.renderOrder = -1;
    this._group.add(this._headMesh);

    // 3. Torso: Box volume inside the body between shoulders and hips
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this._torsoMesh = new THREE.Mesh(boxGeo, this._material);
    this._torsoMesh.renderOrder = -1;
    this._group.add(this._torsoMesh);

    // 4. Arms: Cylinders connecting joints
    this._leftUpperArmMesh = new THREE.Mesh(cylGeo, this._material);
    this._leftUpperArmMesh.renderOrder = -1;
    this._group.add(this._leftUpperArmMesh);

    this._rightUpperArmMesh = new THREE.Mesh(cylGeo, this._material);
    this._rightUpperArmMesh.renderOrder = -1;
    this._group.add(this._rightUpperArmMesh);

    this._leftForearmMesh = new THREE.Mesh(cylGeo, this._material);
    this._leftForearmMesh.renderOrder = -1;
    this._group.add(this._leftForearmMesh);

    this._rightForearmMesh = new THREE.Mesh(cylGeo, this._material);
    this._rightForearmMesh.renderOrder = -1;
    this._group.add(this._rightForearmMesh);
  }

  get group(): THREE.Group {
    return this._group;
  }

  get visible(): boolean {
    return this._group.visible;
  }

  set visible(val: boolean) {
    this._group.visible = val;
  }

  /**
   * Updates occluder mesh transforms according to live MediaPipe landmarks and camera frustum.
   */
  update(body: BodyGeometry, camera: THREE.PerspectiveCamera): void {
    const landmarks = body.landmarks;
    const ls = landmarks[LANDMARK_INDEX.LEFT_SHOULDER];
    const rs = landmarks[LANDMARK_INDEX.RIGHT_SHOULDER];
    const nose = landmarks[LANDMARK_INDEX.NOSE];
    const lh = landmarks[LANDMARK_INDEX.LEFT_HIP];
    const rh = landmarks[LANDMARK_INDEX.RIGHT_HIP];
    const le = landmarks[LANDMARK_INDEX.LEFT_ELBOW];
    const re = landmarks[LANDMARK_INDEX.RIGHT_ELBOW];
    const lw = landmarks[LANDMARK_INDEX.LEFT_WRIST];
    const rw = landmarks[LANDMARK_INDEX.RIGHT_WRIST];

    if (!ls || !rs || (ls.visibility ?? 0.8) < 0.2 || (rs.visibility ?? 0.8) < 0.2) {
      this._group.visible = false;
      return;
    }

    this._group.visible = true;

    // Calculate frustum dimensions at target depth
    const distance = Math.max(camera.position.z, 0.5);
    const vFovRad = THREE.MathUtils.degToRad(camera.fov);
    const frustumHeight = 2.0 * Math.tan(vFovRad / 2.0) * distance;
    const frustumWidth = frustumHeight * camera.aspect;

    // Helper: converts a 2D/3D landmark into Three.js world space coordinates (selfie mirrored)
    const toWorld = (lm: Landmark3D | { x: number; y: number; z?: number }, out: THREE.Vector3, zOffset = 0): void => {
      // In selfie mode: mirrored horizontally
      const xNorm = 1.0 - lm.x;
      const yNorm = lm.y;
      const x = (xNorm - 0.5) * frustumWidth;
      const y = -(yNorm - 0.5) * frustumHeight;
      // In MediaPipe, landmark.z is negative when closer to camera.
      // In Three.js, camera is at +Z looking at origin, so closer = positive Z.
      const rawZ = lm.z ?? 0;
      const z = -rawZ * 0.4 + zOffset;
      out.set(x, y, z);
    };

    // 1. Suprasternal notch (shoulder midpoint)
    const midShoulder = {
      x: body.shoulderMidpoint.x,
      y: body.shoulderMidpoint.y,
      z: (ls.z !== undefined && rs.z !== undefined) ? (ls.z + rs.z) / 2 : 0,
    };
    toWorld(midShoulder, this._vA, 0.0);

    // 2. Chin / Nose position
    if (nose && (nose.visibility ?? 0.8) > 0.3) {
      toWorld(nose, this._vB, 0.0);
    } else {
      // Fallback: estimate chin ~18cm above shoulder midpoint
      this._vB.copy(this._vA).add(new THREE.Vector3(0, body.shoulderWidth * frustumWidth * 0.45, 0));
    }

    // Chin point: halfway between shoulder midpoint and nose
    const chinPoint = new THREE.Vector3().lerpVectors(this._vA, this._vB, 0.65);

    // A. Neck Occluder: from shoulder midpoint up to chin
    // Radius proportional to shoulder width (~16-18% of shoulder span)
    const shoulderSpanWorld = body.shoulderWidth * frustumWidth;
    const neckRadius = Math.max(shoulderSpanWorld * 0.16, 0.045);
    this._positionCylinder(this._neckMesh, this._vA, chinPoint, neckRadius);

    // B. Head Occluder: sphere at nose / head center
    const headRadius = Math.max(shoulderSpanWorld * 0.28, 0.08);
    this._headMesh.scale.set(headRadius, headRadius * 1.15, headRadius);
    this._headMesh.position.copy(this._vB);

    // C. Torso Volume Occluder:
    // Placed slightly behind front chest (-0.03m) so it blocks rear fabric without clipping front fabric
    const midHip = {
      x: body.hipMidpoint.x,
      y: body.hipMidpoint.y,
      z: (lh && rh && lh.z !== undefined && rh.z !== undefined) ? (lh.z + rh.z) / 2 : 0,
    };
    const hipPos = new THREE.Vector3();
    toWorld(midHip, hipPos, 0.0);

    const torsoCenter = new THREE.Vector3().lerpVectors(this._vA, hipPos, 0.5);
    // Torso depth thickness ~12cm
    const torsoDepth = 0.12;
    const torsoWidth = Math.max(shoulderSpanWorld * 0.82, 0.20);
    const torsoHeight = Math.max(this._vA.y - hipPos.y, 0.25);

    this._torsoMesh.scale.set(torsoWidth, torsoHeight, torsoDepth);
    // Recess torso by -0.025m so front T-shirt fabric sits comfortably in front of it
    this._torsoMesh.position.set(torsoCenter.x, torsoCenter.y, torsoCenter.z - 0.025);
    this._torsoMesh.rotation.set(0, 0, -body.torsoRotation);

    // D. Arm Occluders: Left & Right Upper Arm and Forearm
    const armRadius = Math.max(shoulderSpanWorld * 0.12, 0.035);
    const forearmRadius = Math.max(shoulderSpanWorld * 0.10, 0.03);

    const lsPos = new THREE.Vector3();
    const rsPos = new THREE.Vector3();
    toWorld(ls, lsPos);
    toWorld(rs, rsPos);

    if (le && (le.visibility ?? 0.8) > 0.25) {
      const lePos = new THREE.Vector3();
      toWorld(le, lePos);
      this._leftUpperArmMesh.visible = true;
      this._positionCylinder(this._leftUpperArmMesh, lsPos, lePos, armRadius);

      if (lw && (lw.visibility ?? 0.8) > 0.25) {
        const lwPos = new THREE.Vector3();
        toWorld(lw, lwPos);
        this._leftForearmMesh.visible = true;
        this._positionCylinder(this._leftForearmMesh, lePos, lwPos, forearmRadius);
      } else {
        this._leftForearmMesh.visible = false;
      }
    } else {
      this._leftUpperArmMesh.visible = false;
      this._leftForearmMesh.visible = false;
    }

    if (re && (re.visibility ?? 0.8) > 0.25) {
      const rePos = new THREE.Vector3();
      toWorld(re, rePos);
      this._rightUpperArmMesh.visible = true;
      this._positionCylinder(this._rightUpperArmMesh, rsPos, rePos, armRadius);

      if (rw && (rw.visibility ?? 0.8) > 0.25) {
        const rwPos = new THREE.Vector3();
        toWorld(rw, rwPos);
        this._rightForearmMesh.visible = true;
        this._positionCylinder(this._rightForearmMesh, rePos, rwPos, forearmRadius);
      } else {
        this._rightForearmMesh.visible = false;
      }
    } else {
      this._rightUpperArmMesh.visible = false;
      this._rightForearmMesh.visible = false;
    }
  }

  /**
   * Positions, scales and orients a unit Y-axis cylinder between two 3D world endpoints.
   */
  private _positionCylinder(mesh: THREE.Mesh, pA: THREE.Vector3, pB: THREE.Vector3, radius: number): void {
    this._vDir.subVectors(pB, pA);
    const length = this._vDir.length();
    if (length < 0.005) {
      mesh.visible = false;
      return;
    }

    mesh.visible = true;
    mesh.scale.set(radius, length, radius);
    mesh.position.copy(pA).addScaledVector(this._vDir, 0.5);

    this._vDir.normalize();
    this._quat.setFromUnitVectors(this._vUp, this._vDir);
    mesh.quaternion.copy(this._quat);
  }

  /**
   * Disposes of geometry and material resources.
   */
  dispose(): void {
    this._material.dispose();
    this._neckMesh.geometry.dispose();
    this._headMesh.geometry.dispose();
    this._torsoMesh.geometry.dispose();
    this._leftUpperArmMesh.geometry.dispose();
    this._rightUpperArmMesh.geometry.dispose();
    this._leftForearmMesh.geometry.dispose();
    this._rightForearmMesh.geometry.dispose();
  }
}
