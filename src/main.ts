/**
 * src/main.ts
 *
 * Development shell for the VTrialom Try-On Engine — Phase 3.
 *
 * Capabilities:
 *   - Mounts and runs the TryOnEngine pipeline.
 *   - Draws camera feed (mirrored).
 *   - Draws person segmentation mask overlay.
 *   - Draws arm & torso occlusion analysis with live state indicator.
 *   - Draws pose skeleton overlay.
 *   - Garment Asset Pipeline:
 *     - Dynamic switching between transparent garment assets (T-shirt, streetwear tee, dress shirt).
 *     - Picture-in-picture garment preview displaying normalized anchor points (shoulders, neck, hem, sleeves).
 *     - Zero camera restart during garment switching.
 *   - Real-time performance diagnostics (FPS, Pose latency, Seg latency).
 */

import { VTrialomTryOn } from "./api/TryOnComponent.js";
import { LANDMARK_INDEX } from "./core/types.js";
import type { TrackingResult } from "./tracking/PoseTracker.js";
import type { SegmentationResult, NormalisedPolygon, LoadedGarment, FittingResult } from "./core/types.js";
import { ThreeRenderer } from "./rendering/ThreeRenderer.js";
import { Garment3DLoader, type Loaded3DGarment } from "./garments/Garment3DLoader.js";
import { Garment3DFitter } from "./fitting/Garment3DFitter.js";

// Skeleton connections
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

// Garment catalog available for testing
interface GarmentItem {
  id: string;
  name: string;
  category: string;
  is3D?: boolean;
  metadataUrl: string;
  assetUrl?: string;
  modelUrl?: string;
}

const CATALOG: GarmentItem[] = [
  {
    id: "tshirt-basic",
    name: "3D Classic Crewneck Tee (GLB)",
    category: "Basic short-sleeve T-shirt",
    is3D: true,
    metadataUrl: "/assets/garments/tshirt-basic/metadata.json",
    modelUrl: "/assets/garments/tshirt-basic/model.glb",
    assetUrl: "/garments/classic-white-tee.svg",
  },
  {
    id: "classic-white-tee",
    name: "2D Classic White Tee (SVG)",
    category: "TSHIRT",
    metadataUrl: "/garments/classic-white-tee.json",
    assetUrl: "/garments/classic-white-tee.svg",
  },
  {
    id: "vintage-black-tee",
    name: "2D Vintage Cyber Tee (SVG)",
    category: "TSHIRT",
    metadataUrl: "/garments/vintage-black-tee.json",
    assetUrl: "/garments/vintage-black-tee.svg",
  },
  {
    id: "formal-blue-shirt",
    name: "2D Oxford Blue Shirt (SVG)",
    category: "SHIRT",
    metadataUrl: "/garments/formal-blue-shirt.json",
    assetUrl: "/garments/formal-blue-shirt.svg",
  },
];

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
  const garmentInfoEl = document.getElementById("garment-info")!;
  const landmarkListEl = document.getElementById("landmark-list")!;
  const startBtn = document.getElementById("btn-start") as HTMLButtonElement;
  const stopBtn = document.getElementById("btn-stop") as HTMLButtonElement;

  const skeletonToggle = document.getElementById("toggle-skeleton") as HTMLInputElement;
  const maskToggle = document.getElementById("toggle-mask") as HTMLInputElement;
  const occlusionToggle = document.getElementById("toggle-occlusion") as HTMLInputElement;
  const garmentToggle = document.getElementById("toggle-garment") as HTMLInputElement;
  const fittedToggle = document.getElementById("toggle-fitted") as HTMLInputElement;
  const toggle3D = document.getElementById("toggle-3d") as HTMLInputElement;
  const placeholder = document.getElementById("camera-placeholder")!;

  const fittingScaleEl = document.getElementById("fitting-scale")!;
  const fittingRotEl = document.getElementById("fitting-rotation")!;
  const fittingConfEl = document.getElementById("fitting-confidence")!;

  const garmentButtonsContainer = document.getElementById("garment-buttons")!;

  // 3D Three.js rendering subsystem
  const threeRenderer = new ThreeRenderer();
  container.appendChild(threeRenderer.domElement);

  const loader3D = new Garment3DLoader();
  const fitter3D = new Garment3DFitter();
  let active3DGarment: Loaded3DGarment | null = null;

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
  let latestFitting: FittingResult | null = null;
  let activeGarment: LoadedGarment | null = null;

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

  container.addEventListener("vtrialom:fittingresult", (e) => {
    latestFitting = (e as CustomEvent<FittingResult>).detail;
  });

  container.addEventListener("vtrialom:garmentloaded", (e) => {
    activeGarment = (e as CustomEvent<LoadedGarment>).detail;
    updateGarmentUI(activeGarment, garmentInfoEl);
  });

  // ---- Garment Selector Buttons ----
  CATALOG.forEach((item, index) => {
    const btn = document.createElement("button");
    btn.className = "garment-btn" + (index === 0 ? " active" : "");
    btn.id = `garment-${item.id}`;
    btn.textContent = item.name;

    btn.addEventListener("click", async () => {
      document.querySelectorAll(".garment-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      try {
        if (item.is3D) {
          statusEl.textContent = `Loading 3D asset: ${item.name}…`;
          const loaded3D = await loader3D.loadGarment({
            id: item.id,
            metadataUrl: item.metadataUrl,
            modelUrl: item.modelUrl,
          });
          active3DGarment = loaded3D;
          threeRenderer.setGarmentMesh(loaded3D.model);
          update3DGarmentUI(loaded3D, garmentInfoEl);
          statusEl.textContent = `Loaded 3D model ${loaded3D.metadata.name}`;
        } else {
          threeRenderer.setGarmentMesh(null);
          active3DGarment = null;

          if (engine.state === "uninitialised") {
            statusEl.textContent = "Initializing engine to load garment…";
            await engine.initialize();
          }

          statusEl.textContent = `Loading garment: ${item.name}…`;
          const loaded = await engine.loadGarment({
            id: item.id,
            name: item.name,
            metadataUrl: item.metadataUrl,
            assetUrl: item.assetUrl,
          });
          activeGarment = loaded;
          statusEl.textContent = `Loaded ${loaded.metadata.name}`;
        }
      } catch (err) {
        console.error("Failed to load garment:", err);
        statusEl.textContent = `Garment load failed: ${(err as Error).message}`;
        statusEl.style.color = "#ff4444";
      }
    });

    garmentButtonsContainer.appendChild(btn);
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

        // 2. Draw segmentation mask overlay (optional)
        if (maskToggle.checked && latestSegmentation?.mask && maskCtx) {
          drawSegmentationMask(ctx, maskCanvas, maskCtx, latestSegmentation.mask, w, h);
        }
        ctx.restore();

        // 3. Draw Fitted 2D Garment Overlay (if active)
        if (fittedToggle.checked && activeGarment && latestFitting) {
          drawFittedGarment(ctx, activeGarment, latestFitting, w, h);
        }

        // 3D Real Garment Fitting & Three.js WebGL rendering
        threeRenderer.setSize(w, h);
        if (toggle3D.checked && active3DGarment && latestTracking?.bodyGeometry) {
          const fit3D = fitter3D.fit(latestTracking.bodyGeometry, active3DGarment, threeRenderer.camera);
          threeRenderer.render();

          // Reflect 3D fitting metrics in UI
          fittingScaleEl.textContent = `${(fit3D.scale.x * 100).toFixed(0)}%`;
          const deg = Math.round((fit3D.rotation.z * 180) / Math.PI);
          fittingRotEl.textContent = `${deg}°`;
          fittingConfEl.textContent = fit3D.confident ? "3D High" : "3D Low";
          fittingConfEl.style.color = fit3D.confident ? "#d8b4fe" : "#f59e0b";
        } else if (active3DGarment) {
          threeRenderer.render();
        }

        // 4. Draw Occlusion polygons & analysis
        if (occlusionToggle.checked && latestSegmentation?.occlusion) {
          drawOcclusionRegions(ctx, latestSegmentation.occlusion, w, h);
        }

        // 5. Draw Skeleton overlay
        if (skeletonToggle.checked && latestTracking?.poseDetected) {
          drawSkeleton(ctx, latestTracking, w, h);
        }

        // 6. Draw Garment Asset Preview & Anchors PIP overlay
        if (garmentToggle.checked && activeGarment) {
          drawGarmentPreview(ctx, activeGarment, w, h);
        }

        // 7. Update Diagnostics & Fitting UI
        const diag = engine.diagnostics;
        fpsEl.textContent = `${diag.fps} FPS`;
        trackingLatencyEl.textContent = `${Math.round(diag.poseInferenceLatencyMs)} ms`;
        segLatencyEl.textContent = `${Math.round(diag.segmentationLatencyMs)} ms`;

        poseStateEl.textContent = diag.poseDetected ? "✓ Pose active" : "✗ No pose";
        poseStateEl.style.color = diag.poseDetected ? "#6ed86e" : "#ff8844";

        if (latestFitting && latestFitting.confident) {
          fittingScaleEl.textContent = `${(latestFitting.scale * 100).toFixed(0)}%`;
          const deg = Math.round((latestFitting.transform.rotation * 180) / Math.PI);
          fittingRotEl.textContent = `${deg}°`;
          fittingConfEl.textContent = "High";
          fittingConfEl.style.color = "#6ed86e";
        } else if (latestFitting) {
          fittingScaleEl.textContent = `${(latestFitting.scale * 100).toFixed(0)}%`;
          fittingRotEl.textContent = "–";
          fittingConfEl.textContent = "Low";
          fittingConfEl.style.color = "#f59e0b";
        } else {
          fittingScaleEl.textContent = "–";
          fittingRotEl.textContent = "–";
          fittingConfEl.textContent = "No Fit";
          fittingConfEl.style.color = "#888";
        }

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
    fittingScaleEl.textContent = "–";
    fittingRotEl.textContent = "–";
    fittingConfEl.textContent = "–";
    poseStateEl.textContent = "–";
    occlusionStateEl.textContent = "–";
    segLatencyEl.textContent = "– ms";
    poseStateEl.textContent = "–";
    occlusionStateEl.textContent = "–";
  }

  // ---- Start / Stop Handlers ----
  startBtn.addEventListener("click", async () => {
    try {
      if (engine.state === "uninitialised") {
        statusEl.textContent = "Loading MediaPipe models & initializing engine…";
        await engine.initialize();
      }

      // Preload initial 3D or 2D garment if not yet loaded
      if (!active3DGarment && !activeGarment) {
        const defaultItem = CATALOG[0];
        if (defaultItem.is3D) {
          statusEl.textContent = `Loading 3D asset: ${defaultItem.name}…`;
          active3DGarment = await loader3D.loadGarment({
            id: defaultItem.id,
            metadataUrl: defaultItem.metadataUrl,
            modelUrl: defaultItem.modelUrl,
          });
          threeRenderer.setGarmentMesh(active3DGarment.model);
          update3DGarmentUI(active3DGarment, garmentInfoEl);
        } else {
          statusEl.textContent = `Preloading default garment: ${defaultItem.name}…`;
          activeGarment = await engine.loadGarment({
            id: defaultItem.id,
            name: defaultItem.name,
            metadataUrl: defaultItem.metadataUrl,
            assetUrl: defaultItem.assetUrl,
          });
        }
      }

      statusEl.textContent = "Starting camera…";
      await engine.startCamera();
      placeholder.style.display = "none";
      startDrawLoop();
      statusEl.textContent = "Running — Pose, Segmentation & Garment Pipeline active";
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

/**
 * Phase 4 Core: Renders the fitted garment aligned to the user's shoulders,
 * scaled to their body width, and rotated with the torso angle.
 */
function drawFittedGarment(
  ctx: CanvasRenderingContext2D,
  garment: LoadedGarment,
  fitting: FittingResult,
  _canvasW: number,
  _canvasH: number
): void {
  if (!fitting.transform) return;

  const t = fitting.transform;

  ctx.save();
  // Rotate around the shoulder midpoint origin
  ctx.translate(t.originX, t.originY);
  ctx.rotate(t.rotation);

  // Confidence alpha modulation
  ctx.globalAlpha = fitting.confident ? 0.95 : 0.65;

  // Draw the garment image with its shoulder anchor centered at the rotation origin
  ctx.drawImage(
    garment.image,
    t.x,
    t.y,
    t.width,
    t.height
  );

  ctx.restore();
}

/**
 * Renders a picture-in-picture card showing the loaded garment asset,
 * its dimensions, and plots all normalized anchor points.
 */
function drawGarmentPreview(
  ctx: CanvasRenderingContext2D,
  garment: LoadedGarment,
  canvasW: number,
  _canvasH: number
): void {
  const pipWidth = 180;
  const pipHeight = 180;
  const padding = 16;
  const x = canvasW - pipWidth - padding;
  const y = padding;

  ctx.save();

  // Background card
  ctx.fillStyle = "rgba(17, 24, 39, 0.88)";
  ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, pipWidth, pipHeight, 10);
  ctx.fill();
  ctx.stroke();

  // Garment image
  ctx.drawImage(garment.image, x + 10, y + 10, pipWidth - 20, pipHeight - 20);

  // Overlay Anchor Points
  const anchors = garment.metadata.anchors;
  const anchorScaleX = pipWidth - 20;
  const anchorScaleY = pipHeight - 20;
  const originX = x + 10;
  const originY = y + 10;

  const plotAnchor = (pt: { x: number; y: number }, color: string, label: string) => {
    const px = originX + pt.x * anchorScaleX;
    const py = originY + pt.y * anchorScaleY;

    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "bold 9px monospace";
    ctx.fillStyle = color;
    ctx.fillText(label, px + 6, py + 3);
  };

  // Plot key anchors
  plotAnchor(anchors.leftShoulder, "#facc15", "LS");
  plotAnchor(anchors.rightShoulder, "#facc15", "RS");
  plotAnchor(anchors.neckCentre, "#38bdf8", "N");
  plotAnchor(anchors.hemCentre, "#4ade80", "H");
  if (anchors.leftSleeveTip) plotAnchor(anchors.leftSleeveTip, "#c084fc", "SL");
  if (anchors.rightSleeveTip) plotAnchor(anchors.rightSleeveTip, "#c084fc", "SR");
  if (anchors.chestCentre) plotAnchor(anchors.chestCentre, "#f472b6", "C");

  // Title badge
  ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
  ctx.beginPath();
  ctx.roundRect(x + 8, y + pipHeight - 24, pipWidth - 16, 18, 4);
  ctx.fill();

  ctx.font = "600 10px sans-serif";
  ctx.fillStyle = "#e2e8f0";
  ctx.textAlign = "center";
  ctx.fillText(garment.metadata.name.slice(0, 22), x + pipWidth / 2, y + pipHeight - 12);

  ctx.restore();
}

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
    const alpha = Math.round(confidence * 120);
    const idx = i * 4;
    data[idx] = 16;
    data[idx + 1] = 185;
    data[idx + 2] = 129;
    data[idx + 3] = alpha;
  }

  maskCtx.putImageData(imgData, 0, 0);
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

  if (occlusion.torsoPolygon.length >= 3) {
    ctx.save();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.7)";
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

  const drawArm = (poly: NormalisedPolygon, isOccluding: boolean, label: string) => {
    if (poly.length < 3) return;

    ctx.save();
    if (isOccluding) {
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

function update3DGarmentUI(garment: Loaded3DGarment | null, el: HTMLElement): void {
  if (!garment) {
    el.innerHTML = '<span style="color:#555">No 3D garment loaded</span>';
    return;
  }

  const meta = garment.metadata;
  el.innerHTML = `
    <div class="lm-row"><span class="lm-name">Item (3D)</span><span class="lm-val" style="color:#d8b4fe;font-weight:600">${meta.name}</span></div>
    <div class="lm-row"><span class="lm-name">Category</span><span class="lm-val">${meta.category}</span></div>
    <div class="lm-row"><span class="lm-name">Format</span><span class="lm-val">GLB Mesh (PBR)</span></div>
    <div class="lm-row"><span class="lm-name">Mesh Size</span><span class="lm-val">${(garment.dimensions.x * 100).toFixed(0)}×${(garment.dimensions.y * 100).toFixed(0)}×${(garment.dimensions.z * 100).toFixed(0)} cm</span></div>
    <div class="lm-row"><span class="lm-name">Span</span><span class="lm-val">${(garment.shoulderSpan * 100).toFixed(1)} cm</span></div>
    <div class="lm-row"><span class="lm-name">Licence</span><span class="lm-val" style="color:#6ed86e">${meta.source?.license || "MIT (Commercial Ready)"}</span></div>
  `;
}

function updateGarmentUI(garment: LoadedGarment | null, el: HTMLElement): void {
  if (!garment) {
    el.innerHTML = '<span style="color:#555">No garment loaded</span>';
    return;
  }

  const meta = garment.metadata;
  el.innerHTML = `
    <div class="lm-row"><span class="lm-name">Item</span><span class="lm-val" style="color:#60a5fa;font-weight:600">${meta.name}</span></div>
    <div class="lm-row"><span class="lm-name">Category</span><span class="lm-val">${meta.category}</span></div>
    <div class="lm-row"><span class="lm-name">Resolution</span><span class="lm-val">${garment.dimensions.width}×${garment.dimensions.height}</span></div>
    <div class="lm-row"><span class="lm-name">Shoulder Span</span><span class="lm-val">${(garment.shoulderSpan * 100).toFixed(1)}%</span></div>
    <div class="lm-row"><span class="lm-name">Torso Length</span><span class="lm-val">${(garment.torsoLength * 100).toFixed(1)}%</span></div>
    <div class="lm-row"><span class="lm-name">Sizes</span><span class="lm-val">${meta.availableSizes?.join(", ") || "Default"}</span></div>
  `;
}

function updateOcclusionUI(seg: SegmentationResult | null, el: HTMLElement): void {
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
      return `<div class="lm-row">
        <span class="lm-name">${name}</span>
        <span class="lm-val">${lm.x.toFixed(3)}, ${lm.y.toFixed(3)} (${((lm.visibility ?? 1) * 100).toFixed(0)}%)</span>
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
