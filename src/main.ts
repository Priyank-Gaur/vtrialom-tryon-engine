/**
 * src/main.ts
 *
 * Development shell for the VTrialom Try-On Engine — Phase 1.
 *
 * What this file does:
 *   - Mounts the engine into the page container.
 *   - Runs ONE draw loop (the engine's internal rAF drives tracking;
 *     this loop only handles canvas painting).
 *   - Draws the camera feed (mirrored).
 *   - Draws the pose skeleton overlay when tracking is active.
 *   - Updates the debug panel: FPS, inference latency, landmark coords.
 *
 * This file is NOT part of the engine library. It is the dev shell only.
 */

import { VTrialomTryOn } from "./api/TryOnComponent.js";
import { LANDMARK_INDEX } from "./core/types.js";
import type { TrackingResult } from "./tracking/PoseTracker.js";

// MediaPipe-defined connections between landmark pairs for skeleton drawing.
// Source: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
const POSE_CONNECTIONS: [number, number][] = [
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15],
  // Right arm
  [12, 14], [14, 16],
  // Left leg
  [23, 25], [25, 27],
  // Right leg
  [24, 26], [26, 28],
];

// Landmarks to highlight prominently (the ones garment fitting depends on)
const KEY_LANDMARKS = new Set<number>([
  LANDMARK_INDEX.LEFT_SHOULDER,
  LANDMARK_INDEX.RIGHT_SHOULDER,
  LANDMARK_INDEX.LEFT_ELBOW,
  LANDMARK_INDEX.RIGHT_ELBOW,
  LANDMARK_INDEX.LEFT_WRIST,
  LANDMARK_INDEX.RIGHT_WRIST,
  LANDMARK_INDEX.LEFT_HIP,
  LANDMARK_INDEX.RIGHT_HIP,
]);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  // ---- DOM refs ----
  const container = document.getElementById("tryon-container")!;
  const statusEl = document.getElementById("status-text")!;
  const fpsEl = document.getElementById("fps-counter")!;
  const latencyEl = document.getElementById("latency-counter")!;
  const poseStateEl = document.getElementById("pose-state")!;
  const landmarkListEl = document.getElementById("landmark-list")!;
  const startBtn = document.getElementById("btn-start") as HTMLButtonElement;
  const stopBtn = document.getElementById("btn-stop") as HTMLButtonElement;
  const skeletonToggle = document.getElementById("toggle-skeleton") as HTMLInputElement;
  const placeholder = document.getElementById("camera-placeholder")!;

  // ---- engine ----
  const engine = new VTrialomTryOn({
    container,
    camera: { facingMode: "user" },
    debug: true,
  });

  // ---- latest tracking result (updated by engine event) ----
  let latestTracking: TrackingResult | null = null;

  container.addEventListener("vtrialom:statechange", (e) => {
    const { current } = (e as CustomEvent).detail;
    statusEl.textContent = `Engine state: ${current}`;
    statusEl.style.color = "";
    updateButtonState(current);
  });

  container.addEventListener("vtrialom:error", (e) => {
    const { code, message } = (e as CustomEvent).detail;
    statusEl.textContent = `ERROR [${code}]: ${message}`;
    statusEl.style.color = "#ff4444";
  });

  container.addEventListener("vtrialom:trackingresult", (e) => {
    latestTracking = (e as CustomEvent<TrackingResult>).detail;
  });

  // ---- draw loop (canvas painting only — tracking runs inside the engine) ----
  let drawLoopId: number | null = null;

  function startDrawLoop() {
    const canvas = engine.canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const video = engine.videoElement;
      const w = canvas.width;
      const h = canvas.height;

      // Clear
      ctx.clearRect(0, 0, w, h);

      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        // Draw mirrored camera feed
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -w, 0, w, h);
        ctx.restore();

        // Draw skeleton overlay
        if (skeletonToggle.checked && latestTracking?.poseDetected) {
          drawSkeleton(ctx, latestTracking, w, h);
        }

        // Update debug panel from engine diagnostics
        const diag = engine.diagnostics;
        fpsEl.textContent = `${diag.fps} FPS`;
        latencyEl.textContent = `${Math.round(diag.inferenceLatencyMs)} ms`;
        poseStateEl.textContent = diag.poseDetected ? "✓ Detected" : "✗ No pose";
        poseStateEl.style.color = diag.poseDetected ? "#6ed86e" : "#ff8844";

        // Update landmark coordinate list
        updateLandmarkList(latestTracking, w, h);
      }

      drawLoopId = requestAnimationFrame(draw);
    };

    drawLoopId = requestAnimationFrame(draw);
  }

  function stopDrawLoop() {
    if (drawLoopId !== null) {
      cancelAnimationFrame(drawLoopId);
      drawLoopId = null;
    }
    const ctx = engine.canvas.getContext("2d");
    ctx?.clearRect(0, 0, engine.canvas.width, engine.canvas.height);
    fpsEl.textContent = "– FPS";
    latencyEl.textContent = "– ms";
    poseStateEl.textContent = "–";
  }

  // ---- button handlers ----
  startBtn.addEventListener("click", async () => {
    try {
      if (engine.state === "uninitialised") {
        statusEl.textContent = "Loading MediaPipe model (~1–3s)…";
        await engine.initialize();
      }
      statusEl.textContent = "Requesting camera…";
      await engine.startCamera();
      placeholder.style.display = "none";
      startDrawLoop();
      statusEl.textContent = "Running — MediaPipe tracking active";
    } catch (err) {
      console.error("[demo] start failed:", err);
      statusEl.textContent = `Start failed: ${(err as Error).message}`;
      statusEl.style.color = "#ff4444";
    }
  });

  stopBtn.addEventListener("click", async () => {
    stopDrawLoop();
    await engine.stopCamera();
    placeholder.style.display = "";
    latestTracking = null;
    landmarkListEl.innerHTML = "";
    statusEl.textContent = "Camera stopped";
  });

  function updateButtonState(state: string) {
    startBtn.disabled = state === "running" || state === "initialising";
    stopBtn.disabled = state !== "running";
  }

  updateButtonState(engine.state);
  statusEl.textContent = `Engine state: ${engine.state}`;
}

// ---------------------------------------------------------------------------
// Skeleton drawing
// ---------------------------------------------------------------------------

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  tracking: TrackingResult,
  w: number,
  h: number
): void {
  const lms = tracking.landmarks;
  if (lms.length === 0) return;

  // MediaPipe normalised coords are for the original (un-mirrored) image.
  // Because we drew the camera mirrored (scale -1,1), we must mirror landmark
  // X coords too so the skeleton aligns with the displayed feed.
  const mx = (x: number) => (1 - x) * w;
  const my = (y: number) => y * h;

  // Draw connections
  ctx.strokeStyle = "rgba(100, 200, 255, 0.85)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";

  for (const [a, b] of POSE_CONNECTIONS) {
    if (a >= lms.length || b >= lms.length) continue;
    const la = lms[a];
    const lb = lms[b];
    if ((la.visibility ?? 1) < 0.3 || (lb.visibility ?? 1) < 0.3) continue;

    ctx.beginPath();
    ctx.moveTo(mx(la.x), my(la.y));
    ctx.lineTo(mx(lb.x), my(lb.y));
    ctx.stroke();
  }

  // Draw landmark dots
  for (let i = 0; i < lms.length; i++) {
    const lm = lms[i];
    if ((lm.visibility ?? 1) < 0.3) continue;

    const isKey = KEY_LANDMARKS.has(i);
    ctx.beginPath();
    ctx.arc(mx(lm.x), my(lm.y), isKey ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = isKey ? "#ffdd44" : "rgba(100, 200, 255, 0.7)";
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Landmark list update
// ---------------------------------------------------------------------------

const LANDMARK_NAMES: Record<number, string> = {
  [LANDMARK_INDEX.LEFT_SHOULDER]: "L Shoulder",
  [LANDMARK_INDEX.RIGHT_SHOULDER]: "R Shoulder",
  [LANDMARK_INDEX.LEFT_ELBOW]: "L Elbow",
  [LANDMARK_INDEX.RIGHT_ELBOW]: "R Elbow",
  [LANDMARK_INDEX.LEFT_WRIST]: "L Wrist",
  [LANDMARK_INDEX.RIGHT_WRIST]: "R Wrist",
  [LANDMARK_INDEX.LEFT_HIP]: "L Hip",
  [LANDMARK_INDEX.RIGHT_HIP]: "R Hip",
};

function updateLandmarkList(
  tracking: TrackingResult | null,
  _w: number,
  _h: number
): void {
  const el = document.getElementById("landmark-list")!;
  if (!tracking?.poseDetected) {
    el.innerHTML = '<span style="color:#555">No pose detected</span>';
    return;
  }

  const rows = Object.entries(LANDMARK_NAMES)
    .map(([idx, name]) => {
      const lm = tracking.landmarks[Number(idx)];
      if (!lm) return "";
      const vis = ((lm.visibility ?? 1) * 100).toFixed(0);
      return `<div class="lm-row">
        <span class="lm-name">${name}</span>
        <span class="lm-val">${lm.x.toFixed(3)}, ${lm.y.toFixed(3)}</span>
        <span class="lm-vis">${vis}%</span>
      </div>`;
    })
    .join("");

  // Also show shoulder width from body geometry
  const geo = tracking.bodyGeometry;
  const geoHtml = geo
    ? `<div class="lm-row" style="margin-top:6px;border-top:1px solid #2a2a2a;padding-top:6px">
        <span class="lm-name">Shoulder W</span>
        <span class="lm-val">${(geo.shoulderWidth * 100).toFixed(1)}%</span>
      </div>
      <div class="lm-row">
        <span class="lm-name">Torso H</span>
        <span class="lm-val">${(geo.torsoHeight * 100).toFixed(1)}%</span>
      </div>
      <div class="lm-row">
        <span class="lm-name">Rotation</span>
        <span class="lm-val">${((geo.torsoRotation * 180) / Math.PI).toFixed(1)}°</span>
      </div>`
    : "";

  el.innerHTML = rows + geoHtml;
}

main().catch(console.error);
