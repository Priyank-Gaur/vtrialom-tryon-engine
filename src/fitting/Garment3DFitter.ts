/**
 * src/fitting/Garment3DFitter.ts
 *
 * Responsibility:
 *   Fits a 3D garment mesh to live 3D body landmarks:
 *   - Translates landmark 3D positions to Three.js world space coordinates.
 *   - Calculates 3D shoulder midpoint position (X, Y, Z).
 *   - Computes 3D rotation quaternion (Roll, Pitch, Yaw).
 *   - Computes non-uniform 3D scale based on shoulder span, torso height, and chest depth.
 *   - Dynamically positions the 3D garment object in the Three.js scene.
 */

import * as THREE from "three";
import { LANDMARK_INDEX, type BodyGeometry } from "../core/types.js";
import type { Loaded3DGarment } from "../garments/Garment3DLoader.js";

export interface Fitting3DResult {
  garmentId: string;
  confident: boolean;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

export class Garment3DFitter {
  private readonly _tmpPos = new THREE.Vector3();
  private readonly _tmpScale = new THREE.Vector3();
  private readonly _tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");

  /**
   * Fits `garment` to the user's live 3D `body` geometry and camera projection.
   */
  fit(
    body: BodyGeometry,
    garment: Loaded3DGarment,
    camera: THREE.PerspectiveCamera,
  ): Fitting3DResult {
    const landmarks = body.landmarks;
    const ls = landmarks[LANDMARK_INDEX.LEFT_SHOULDER];
    const rs = landmarks[LANDMARK_INDEX.RIGHT_SHOULDER];
    const lh = landmarks[LANDMARK_INDEX.LEFT_HIP];
    const rh = landmarks[LANDMARK_INDEX.RIGHT_HIP];

    const confident = (ls?.visibility ?? 0.8) > 0.35 && (rs?.visibility ?? 0.8) > 0.35;

    // Camera frustum dimensions at target depth (z = 0 plane, camera at camera.position.z)
    const distance = Math.max(camera.position.z, 0.5);
    const vFovRad = THREE.MathUtils.degToRad(camera.fov);
    const frustumHeight = 2.0 * Math.tan(vFovRad / 2.0) * distance;
    const frustumWidth = frustumHeight * camera.aspect;

    // 1. Calculate 3D Shoulder midpoint in Three.js world coordinates
    // In selfie mode: horizontal X is flipped (1 - x)
    const midXNorm = 1.0 - body.shoulderMidpoint.x;
    const midYNorm = body.shoulderMidpoint.y;

    const posX = (midXNorm - 0.5) * frustumWidth;
    const posY = -(midYNorm - 0.5) * frustumHeight;
    // Z estimated from shoulder width scaling / depth
    const posZ = (ls?.z && rs?.z) ? -((ls.z + rs.z) / 2.0) * 0.8 : 0.0;

    this._tmpPos.set(posX, posY, posZ);

    // Apply garment-specific position offset if present in metadata
    if (garment.metadata.positionOffset) {
      this._tmpPos.x += garment.metadata.positionOffset[0];
      this._tmpPos.y += garment.metadata.positionOffset[1];
      this._tmpPos.z += garment.metadata.positionOffset[2];
    }

    // 2. Calculate 3D Rotation (Yaw, Pitch, Roll)
    // Roll: In-plane shoulder tilt (mirrored)
    const roll = -body.torsoRotation;

    // Pitch: Torso forward/backward lean (shoulder Z vs hip Z)
    let pitch = 0;
    if (ls && rs && lh && rh && ls.z !== undefined && lh.z !== undefined) {
      const shoulderZ = (ls.z + rs.z) / 2;
      const hipZ = (lh.z + rh.z) / 2;
      const deltaY = Math.max(body.torsoHeight, 0.1);
      pitch = Math.atan2(shoulderZ - hipZ, deltaY) * 0.6;
    }

    // Yaw: Turning left or right (left shoulder Z vs right shoulder Z)
    let yaw = 0;
    if (ls && rs && ls.z !== undefined && rs.z !== undefined) {
      // In selfie mirror: anatomical left is screen left
      const deltaZ = rs.z - ls.z;
      const deltaX = Math.max(body.shoulderWidth, 0.1);
      yaw = Math.atan2(deltaZ, deltaX) * 0.8;
    }

    this._tmpEuler.set(pitch, yaw, roll);

    // 3. Calculate 3D Scale
    // Target 3D shoulder span in Three.js world units
    const targetShoulderWidth = body.shoulderWidth * frustumWidth;
    const baseSpan = Math.max(garment.shoulderSpan, 0.1);

    const uniformScale = targetShoulderWidth / baseSpan;

    // Proportion scaling
    const scaleX = uniformScale;
    const scaleY = (body.torsoHeight * frustumHeight) / Math.max(garment.dimensions.y * 0.7, 0.2);
    const scaleZ = (scaleX + scaleY) / 2.0;

    this._tmpScale.set(
      scaleX * 0.95,
      Math.min(scaleY, scaleX * 1.3),
      scaleZ * 0.95,
    );

    // Apply metadata scale factor if configured
    if (typeof garment.metadata.scale === "number") {
      this._tmpScale.multiplyScalar(garment.metadata.scale);
    }

    // 4. Update garment 3D object transform directly
    garment.model.position.copy(this._tmpPos);
    garment.model.rotation.copy(this._tmpEuler);
    garment.model.scale.copy(this._tmpScale);

    return {
      garmentId: garment.metadata.id,
      confident,
      position: this._tmpPos.clone(),
      rotation: this._tmpEuler.clone(),
      scale: this._tmpScale.clone(),
    };
  }
}
