/**
 * src/main.ts
 *
 * Development shell for the VTrialom Try-On Engine — Phase 2.
 *
 * What this file does:
 *   - Mounts the engine into the page container.
 *   - Runs ONE draw loop for canvas painting.
 *   - Draws the camera feed (mirrored).
 *   - Draws the person segmentation mask overlay (with toggle).
 *   - Draws the arm & torso occlusion regions (with toggle).
 *   - Draws the pose skeleton overlay (with toggle).
 *   - Displays live performance metrics: FPS, tracking latency, segmentation latency.
 *   - Displays real-time occlusion diagnostics and landmark coordinates.
 */

import { VTrialomTryOn } from "./api/TryOnComponent.js";
import { LANDMARK_INDEX } from "./core/types.js";
import type { TrackingResult } from "./tracking/PoseTracker.js";
import type { SegmentationResult, NormalisedPolygon } from "./core/types.js";

// MediaPipe connections for skeleton drawing
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
  const trackingLatencyEl = document.getElementById("tracking-latency")!;
  const segLatencyEl = document.getElementById("seg-latency")!;
  const poseStateEl = document.getElementById("pose-state")!;
  const occlusionStateEl = document.getElementById("occlusion-state")!;
  const landmarkListEl = document.getElementById("landmark-list")!;
  const startBtn = document.getElementById("btn-start") as HTMLButtonElement;
  const stopBtn = document.getElementById("btn-stop") as HTMLButtonElement;

  const skeletonToggle = document.getElementById("toggle-skeleton") as HTMLInputElement;
  const maskToggle = document.getElementById("toggle-mask") as HTMLInputElement;
  const occlusionToggle = document.getElementById("toggle-occlusion") as HTMLInputElement;
  const placeholder = document.getElementById("camera-placeholder")!;

  // Offscreen canvas for fast mask rendering
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");

  // ---- Engine instance ----
  const engine = new VTrialomTryOn({
    container,
    camera: { facingMode: "user" },
    debug: true,
  });

  let latestTracking: TrackingResult | null = null;
  let latestSegmentation: SegmentationResult | null = null;

  // ---- State change handlers ----
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

  container.addEventListener("vtrialom:segmentationresult", (e) => {
    latestSegmentation = (e as CustomEvent<SegmentationResult>).detail;
  });

  // ---- Draw Loop ----
  let drawLoopId: number | null = null;

  function startDrawLoop() {
    const canvas = engine.canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const video = engine.videoElement;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        // 1. Draw mirrored webcam frame
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -w, 0, w, h);

        // 2. Draw segmentation mask overlay (mirrored to match camera)
        if (maskToggle.checked && latestSegmentation?.mask && maskCtx) {
          drawSegmentationMask(ctx, maskCanvas, maskCtx, latestSegmentation.mask, w, h);
        }
        ctx.restore();

        // 3. Draw Occlusion polygons & analysis
        if (occlusionToggle.checked && latestSegmentation?.occlusion) {
          drawOcclusionRegions(ctx, latestSegmentation.occlusion, w, h);
        }

        // 4. Draw Skeleton overlay
        if (skeletonToggle.checked && latestTracking?.poseDetected) {
          drawSkeleton(ctx, latestTracking, w, h);
        }

        // 5. Update Diagnostics UI
        const diag = engine.diagnostics;
        fpsEl.textContent = `${diag.fps} FPS`;
        trackingLatencyEl.textContent = `${Math.round(diag.poseInferenceLatencyMs)} ms`;
        segLatencyEl.textContent = `${Math.round(diag.segmentationLatencyMs)} ms`;

        poseStateEl.textContent = diag.poseDetected ? "✓ Pose active" : "✗ No pose";
        poseStateEl.style.color = diag.poseDetected ? "#6ed86e" : "#ff8844";

        updateOcclusionUI(latestSegmentation, occlusionStateEl);
        updateLandmarkList(latestTracking);
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
    trackingLatencyEl.textContent = "– ms";
    segLatencyEl.textContent = "– ms";
    poseStateEl.textContent = "–";
    occlusionStateEl.textContent = "–";
  }

  // ---- Button Handlers ----
  startBtn.addEventListener("click", async () => {
    try {
      if (engine.state === "uninitialised") {
        statusEl.textContent = "Loading MediaPipe Pose & Segmentation models…";
        await engine.initialize();
      }
      statusEl.textContent = "Starting camera…";
      await engine.startCamera();
      placeholder.style.display = "none";
      startDrawLoop();
      statusEl.textContent = "Running — Pose & Segmentation active";
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
    latestSegmentation = null;
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
// Rendering Functions
// ---------------------------------------------------------------------------

function drawSegmentationMask(
  ctx: CanvasRenderingContext2D,
  maskCanvas: HTMLCanvasElement,
  maskCtx: CanvasRenderingContext2D,
  mask: { data: Float32Array; width: number; height: number },
  destW: number,
  destH: number
): void {
  const mw = mask.width;
  const mh = mask.height;

  if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
    maskCanvas.width = mw;
    maskCanvas.height = mh;
  }

  const imgData = maskCtx.createImageData(mw, mh);
  const data = imgData.data;
  const maskData = mask.data;
  const len = mw * mh;

  for (let i = 0; i < len; i++) {
    const confidence = maskData[i];
    const alpha = Math.round(confidence * 120); // semi-transparent emerald overlay
    const idx = i * 4;
    data[idx] = 16;      // R
    data[idx + 1] = 185;  // G
    data[idx + 2] = 129;  // B (emerald-500)
    data[idx + 3] = alpha;
  }

  maskCtx.putImageData(imgData, 0, 0);

  // Draw scaled onto the active canvas (in mirrored context: -destW to 0)
  ctx.drawImage(maskCanvas, -destW, 0, destW, destH);
}

function drawOcclusionRegions(
  ctx: CanvasRenderingContext2D,
  occlusion: {
    isLeftArmOccludingTorso: boolean;
    isRightArmOccludingTorso: boolean;
    isLeftHandOverTorso: boolean;
    isRightHandOverTorso: boolean;
    torsoPolygon: NormalisedPolygon;
    leftArmPolygon: NormalisedPolygon;
    rightArmPolygon: NormalisedPolygon;
  },
  w: number,
  h: number
): void {
  const mx = (x: number) => (1 - x) * w;
  const my = (y: number) => y * h;

  // 1. Draw Torso Boundary Polygon
  if (occlusion.torsoPolygon.length >= 3) {
    ctx.save();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.7)"; // light blue dashed
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillStyle = "rgba(56, 189, 248, 0.08)";

    ctx.beginPath();
    ctx.moveTo(mx(occlusion.torsoPolygon[0].x), my(occlusion.torsoPolygon[0].y));
    for (let i = 1; i < occlusion.torsoPolygon.length; i++) {
      ctx.lineTo(mx(occlusion.torsoPolygon[i].x), my(occlusion.torsoPolygon[i].y));
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Helper for drawing arm capsules
  const drawArm = (
    poly: NormalisedPolygon,
    isOccluding: boolean,
    label: string
  ) => {
    if (poly.length < 3) return;

    ctx.save();
    if (isOccluding) {
      // Highlight occluding arm in vivid amber/orange
      ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
      ctx.fillStyle = "rgba(245, 158, 11, 0.28)";
      ctx.lineWidth = 2.5;
    } else {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
      ctx.fillStyle = "rgba(148, 163, 184, 0.08)";
      ctx.lineWidth = 1.5;
    }

    ctx.beginPath();
    ctx.moveTo(mx(poly[0].x), my(poly[0].y));
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(mx(poly[i].x), my(poly[i].y));
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw badge if occluding
    if (isOccluding) {
      const midX = mx(poly[1].x);
      const midY = my(poly[1].y);
      ctx.font = "bold 11px monospace";
      ctx.fillStyle = "#f59e0b";
      ctx.fillText(`⚡ ${label} OCCLUDING`, midX - 45, midY - 8);
    }
    ctx.restore();
  };

  drawArm(occlusion.leftArmPolygon, occlusion.isLeftArmOccludingTorso, "LEFT ARM");
  drawArm(occlusion.rightArmPolygon, occlusion.isRightArmOccludingTorso, "RIGHT ARM");
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  tracking: TrackingResult,
  w: number,
  h: number
): void {
  const lms = tracking.landmarks;
  if (lms.length === 0) return;

  const mx = (x: number) => (1 - x) * w;
  const my = (y: number) => y * h;

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
// Diagnostics Panel Updates
// ---------------------------------------------------------------------------

function updateOcclusionUI(
  seg: SegmentationResult | null,
  el: HTMLElement
): void {
  if (!seg?.occlusion) {
    el.innerHTML = '<span style="color:#555">Waiting for pose…</span>';
    return;
  }

  const occ = seg.occlusion;
  const leftTag = occ.isLeftArmOccludingTorso
    ? '<span style="color:#f59e0b;font-weight:700">OCCLUDING (' + Math.round(occ.leftArmOverlapRatio * 100) + '%)</span>'
    : '<span style="color:#6ee7b7">Clear</span>';

  const rightTag = occ.isRightArmOccludingTorso
    ? '<span style="color:#f59e0b;font-weight:700">OCCLUDING (' + Math.round(occ.rightArmOverlapRatio * 100) + '%)</span>'
    : '<span style="color:#6ee7b7">Clear</span>';

  el.innerHTML = `
    <div class="lm-row"><span class="lm-name">Left Arm</span><span class="lm-val">${leftTag}</span></div>
    <div class="lm-row"><span class="lm-name">Right Arm</span><span class="lm-val">${rightTag}</span></div>
    <div class="lm-row"><span class="lm-name">Hand On Torso</span><span class="lm-val">${
      (occ.isLeftHandOverTorso ? "L " : "") +
      (occ.isRightHandOverTorso ? "R" : "") || "None"
    }</span></div>
  `;
}

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

function updateLandmarkList(tracking: TrackingResult | null): void {
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
