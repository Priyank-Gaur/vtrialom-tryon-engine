/**
 * src/main.ts
 *
 * VTrialom — V-Wear Real-Time AI Virtual Try-On Engine.
 *
 * Modes:
 *   1. V-Wear AI Mode (Default / Featured):
 *      - Real-time AI garment fitting directly on the live camera stream.
 *      - 4 Featured Garment Presets:
 *        * Classic Oxford Button-Down Shirt
 *        * Streetwear Pullover Hoodie
 *        * Vintage Crewneck Sweatshirt
 *        * Ribbed High-Neck / Turtleneck Sweater
 *      - Universal Drag & Drop / Upload: try on any image from e-commerce stores.
 *      - Anatomical shoulder, high-neck collar, and sleeve tracking.
 *   2. 3D WebGL Mode:
 *      - GPU SkinnedMesh rigging with MediaPipe pose skeleton.
 */

import { VTrialomTryOn } from "./api/TryOnComponent.js";
import type { TrackingResult } from "./tracking/PoseTracker.js";
import type { SegmentationResult } from "./core/types.js";
import { ThreeRenderer } from "./rendering/ThreeRenderer.js";
import { Garment3DLoader, type Loaded3DGarment } from "./garments/Garment3DLoader.js";
import { Garment3DFitter } from "./fitting/Garment3DFitter.js";
import { GarmentSkinnedRigger } from "./fitting/GarmentSkinnedRigger.js";
import { ANYWEAR_PRESETS, type AnywearGarment } from "./vton/AnywearPresets.js";
import { VWearRenderer } from "./vton/VWearRenderer.js";
import { DecartAnywearClient } from "./vton/DecartAnywearClient.js";

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

const CATALOG_3D = [
  {
    id: "tshirt-basic",
    name: "Classic Crewneck Tee",
    modelUrl: "/assets/garments/tshirt-basic/model.glb",
    metadataUrl: "/assets/garments/tshirt-basic/metadata.json",
  },
  {
    id: "casual-shirt",
    name: "Classic Oxford Shirt",
    modelUrl: "/assets/garments/casual-shirt/model.glb",
    metadataUrl: "/assets/garments/casual-shirt/metadata.json",
  },
  {
    id: "sweatshirt",
    name: "Streetwear Hoodie",
    modelUrl: "/assets/garments/sweatshirt/model.glb",
    metadataUrl: "/assets/garments/sweatshirt/metadata.json",
  },
  {
    id: "lightweight-jacket",
    name: "Lightweight Jacket",
    modelUrl: "/assets/garments/lightweight-jacket/model.glb",
    metadataUrl: "/assets/garments/lightweight-jacket/metadata.json",
  },
];

async function main() {
  const container = document.getElementById("tryon-container")!;
  const statusEl = document.getElementById("status-text")!;
  const fpsEl = document.getElementById("fps-counter")!;
  const trackingLatencyEl = document.getElementById("tracking-latency")!;
  const segLatencyEl = document.getElementById("seg-latency")!;
  const startBtn = document.getElementById("btn-start") as HTMLButtonElement;
  const stopBtn = document.getElementById("btn-stop") as HTMLButtonElement;

  const skeletonToggle = document.getElementById("toggle-skeleton") as HTMLInputElement;
  const maskToggle = document.getElementById("toggle-mask") as HTMLInputElement;
  const placeholder = document.getElementById("camera-placeholder")!;

  const modeVWearBtn = document.getElementById("mode-vwear") as HTMLButtonElement;
  const mode3DBtn = document.getElementById("mode-3d") as HTMLButtonElement;
  const trayOverlay = document.getElementById("tray-overlay")!;
  const presetCardsContainer = document.getElementById("preset-cards-container")!;
  const customFileInput = document.getElementById("custom-file-input") as HTMLInputElement;
  const dropZoneOverlay = document.getElementById("drop-zone-overlay")!;
  const falKeyInput = document.getElementById("fal-key-input") as HTMLInputElement;
  const framingGuide = document.getElementById("framing-guide")!;
  const framingText = document.getElementById("framing-text")!;

  const activeThumb = document.getElementById("active-garment-thumb") as HTMLImageElement;
  const activeName = document.getElementById("active-garment-name")!;
  const activeTag = document.getElementById("active-garment-tag")!;
  const activeDesc = document.getElementById("active-garment-desc")!;
  const legacy3DSection = document.getElementById("legacy-3d-section")!;
  const garmentButtonsContainer = document.getElementById("garment-buttons")!;

  // 1. V-Wear Direct Canvas Renderer
  const vwearRenderer = new VWearRenderer();

  // 2. Cloud AI WebRTC Client (Optional)
  const decartClient = new DecartAnywearClient({
    onStatus: (msg, isErr) => {
      statusEl.textContent = msg;
      statusEl.style.color = isErr ? "#f87171" : "#a7f3d0";
    },
    onStream: (stream) => {
      const vtonVideo = document.getElementById("vton-remote-video") as HTMLVideoElement;
      if (vtonVideo) {
        vtonVideo.srcObject = stream;
        vtonVideo.style.display = "block";
      }
    },
  });

  // 3. 3D WebGL subsystem (for 3D mode)
  const threeRenderer = new ThreeRenderer();
  threeRenderer.domElement.style.display = "none";
  container.appendChild(threeRenderer.domElement);

  const loader3D = new Garment3DLoader();
  const fitter3D = new Garment3DFitter();
  const skinnedRigger = new GarmentSkinnedRigger();
  let active3DGarment: Loaded3DGarment | null = null;

  // State
  let engineMode: "vwear" | "3d" = "vwear";
  let activeGarment: AnywearGarment = ANYWEAR_PRESETS[0]!;

  // Eagerly preload all 4 V-Wear preset images immediately
  ANYWEAR_PRESETS.forEach((preset) => {
    vwearRenderer.preloadImage(preset.imageUrl);
  });

  // ---- Engine instance ----
  const engine = new VTrialomTryOn({
    container,
    camera: { facingMode: "user" },
    debug: true,
  });

  let latestTracking: TrackingResult | null = null;
  let latestSegmentation: SegmentationResult | null = null;

  // State handlers
  container.addEventListener("vtrialom:statechange", (e) => {
    const { current } = (e as CustomEvent).detail;
    statusEl.textContent = `Engine: ${current}`;
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

  // Update active garment UI metadata
  function updateActiveGarmentUI(garment: AnywearGarment) {
    activeThumb.src = garment.imageUrl;
    activeName.textContent = garment.name;
    activeTag.textContent = garment.tag;
    activeDesc.textContent = garment.description;
  }

  // ---- Render the 4 V-Wear Featured Presets in Tray ----
  function renderVWearCards() {
    presetCardsContainer.innerHTML = "";
    ANYWEAR_PRESETS.forEach((preset) => {
      const card = document.createElement("div");
      card.className = "preset-card" + (preset.id === activeGarment.id ? " active" : "");
      card.id = `preset-${preset.id}`;
      card.innerHTML = `
        <img class="preset-img" src="${preset.thumbnailUrl}" alt="${preset.name}" />
        <span class="preset-label">${preset.name}</span>
      `;

      card.addEventListener("click", () => {
        document.querySelectorAll(".preset-card").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        activeGarment = preset;
        vwearRenderer.preloadImage(preset.imageUrl);
        updateActiveGarmentUI(preset);
        statusEl.textContent = `Wearing: ${preset.name}`;
        statusEl.style.color = "#a7f3d0";

        // Notify cloud stream if connected
        decartClient.setGarment({
          name: preset.name,
          imageUrl: preset.imageUrl,
          description: preset.prompt,
        });
      });

      presetCardsContainer.appendChild(card);
    });
  }

  renderVWearCards();
  updateActiveGarmentUI(activeGarment);

  // ---- Drag & Drop Any Product Image ----
  const viewport = document.getElementById("viewport")!;

  viewport.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZoneOverlay.style.display = "flex";
  });

  viewport.addEventListener("dragleave", (e) => {
    if (e.target === dropZoneOverlay) {
      dropZoneOverlay.style.display = "none";
    }
  });

  viewport.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZoneOverlay.style.display = "none";
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file && file.type.startsWith("image/")) {
        loadCustomImage(file);
      }
    }
  });

  customFileInput.addEventListener("change", (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file) {
        loadCustomImage(file);
      }
    }
  });

  function loadCustomImage(file: File) {
    const url = URL.createObjectURL(file);
    const customGarment: AnywearGarment = {
      id: `custom-${Date.now()}`,
      name: file.name.replace(/\.[^/.]+$/, ""),
      category: "shirt",
      tag: "Custom Upload",
      description: "User-imported e-commerce apparel asset.",
      imageUrl: url,
      thumbnailUrl: url,
      prompt: `Substitute current upper-body clothing with ${file.name}`,
      fitting: {
        collarHeight: 0.05,
        shoulderFit: "relaxed",
        chestFitRatio: 1.08,
        torsoLengthRatio: 1.05,
        sleeveLength: "long",
      },
    };

    activeGarment = customGarment;
    vwearRenderer.preloadImage(url);
    updateActiveGarmentUI(customGarment);
    statusEl.textContent = `Uploaded custom apparel: ${customGarment.name}`;
  }

  // ---- Mode Switcher: V-Wear AI vs 3D WebGL ----
  modeVWearBtn.addEventListener("click", () => {
    engineMode = "vwear";
    modeVWearBtn.classList.add("active", "vwear-tab");
    mode3DBtn.classList.remove("active");
    trayOverlay.style.display = "flex";
    threeRenderer.setGarmentMesh(null);
    threeRenderer.domElement.style.display = "none";
    legacy3DSection.style.display = "none";
    statusEl.textContent = "Switched to V-Wear AI Try-On Mode";
  });

  mode3DBtn.addEventListener("click", async () => {
    engineMode = "3d";
    mode3DBtn.classList.add("active");
    modeVWearBtn.classList.remove("active", "vwear-tab");
    trayOverlay.style.display = "none";
    legacy3DSection.style.display = "block";

    // Load initial 3D model if needed
    if (!active3DGarment) {
      const defaultItem = CATALOG_3D[0]!;
      const loaded = await loader3D.loadGarment({
        id: defaultItem.id,
        metadataUrl: defaultItem.metadataUrl,
        modelUrl: defaultItem.modelUrl,
      });
      skinnedRigger.ensureRigged(loaded);
      active3DGarment = loaded;
      threeRenderer.setGarmentMesh(loaded.model);
    } else {
      threeRenderer.setGarmentMesh(active3DGarment.model);
    }
    threeRenderer.domElement.style.display = "block";
    statusEl.textContent = "Switched to 3D WebGL Mode";
  });

  // ---- 3D Catalogue Buttons ----
  CATALOG_3D.forEach((item, index) => {
    const btn = document.createElement("button");
    btn.className = "garment-btn" + (index === 0 ? " active" : "");
    btn.textContent = item.name;
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".garment-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      try {
        threeRenderer.setGarmentMesh(null);
        const loaded3D = await loader3D.loadGarment({
          id: item.id,
          metadataUrl: item.metadataUrl,
          modelUrl: item.modelUrl,
        });
        skinnedRigger.ensureRigged(loaded3D);
        active3DGarment = loaded3D;
        threeRenderer.setGarmentMesh(loaded3D.model);
        statusEl.textContent = `Wearing: ${loaded3D.metadata.name}`;
      } catch (err) {
        statusEl.textContent = `3D load error: ${(err as Error).message}`;
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
        const hasSeg = !!(latestSegmentation?.mask);

        // 1. ALWAYS draw the mirrored webcam video as the base layer
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -w, 0, w, h);

        // 2. Optional segmentation mask debug overlay
        if (maskToggle.checked && latestSegmentation?.mask) {
          drawSegmentationMask(ctx, latestSegmentation.mask, w, h);
        }
        ctx.restore();

        // 3. Render according to active mode
        if (engineMode === "vwear") {
          // V-Wear AI True Try-On Mode:
          // With segmentation: inverse compositing — garment replaces the shirt,
          //   user's head/arms naturally emerge from inside the clothing.
          // Without segmentation: anatomical overlay with head restoration.
          if (latestTracking?.bodyGeometry) {
            vwearRenderer.drawGarment(ctx, activeGarment, latestTracking.bodyGeometry, w, h, video, hasSeg ? latestSegmentation : null);
          }
        } else {
          // 3D WebGL Mode
          threeRenderer.setSize(w, h);
          if (active3DGarment && latestTracking?.bodyGeometry) {
            skinnedRigger.updateArmature(active3DGarment, latestTracking.bodyGeometry);
            fitter3D.fit(latestTracking.bodyGeometry, active3DGarment, threeRenderer.camera);
            threeRenderer.render(latestTracking.bodyGeometry);
          } else {
            threeRenderer.clear();
          }
        }

        // 4. Draw Skeleton overlay if enabled
        if (skeletonToggle.checked && latestTracking?.poseDetected) {
          drawSkeleton(ctx, latestTracking, w, h);
        }

        // 5. Smart Framing Silhouette Guidance (Anywear UX)
        if (latestTracking?.bodyGeometry) {
          const bg = latestTracking.bodyGeometry;
          if (bg.shoulderWidth >= 0.20 && bg.shoulderWidth <= 0.46 && bg.shoulderMidpoint.y >= 0.24 && bg.shoulderMidpoint.y <= 0.54) {
            framingGuide.classList.add("aligned");
            framingText.textContent = `✓ Aligned — Wearing: ${activeGarment.name}`;
          } else if (bg.shoulderWidth > 0.46) {
            framingGuide.classList.remove("aligned");
            framingText.textContent = "Step back slightly for optimal fit";
          } else if (bg.shoulderWidth < 0.20) {
            framingGuide.classList.remove("aligned");
            framingText.textContent = "Step forward a bit";
          } else {
            framingGuide.classList.remove("aligned");
            framingText.textContent = "Align inside the silhouette";
          }
        } else {
          framingGuide.classList.remove("aligned");
          framingText.textContent = "Step into frame to align";
        }

        // 6. Diagnostics
        const diag = engine.diagnostics;
        fpsEl.textContent = `${diag.fps} FPS`;
        trackingLatencyEl.textContent = `${diag.poseInferenceLatencyMs}ms`;
        segLatencyEl.textContent = `${diag.segmentationLatencyMs}ms`;
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
    threeRenderer.setGarmentMesh(null);
    threeRenderer.clear();
  }

  // ---- Camera Start / Stop ----
  startBtn.addEventListener("click", async () => {
    try {
      if (engine.state === "uninitialised") {
        statusEl.textContent = "Initializing tracking pipeline…";
        await engine.initialize();
      }
      statusEl.textContent = "Starting camera…";
      await engine.startCamera();
      placeholder.style.display = "none";
      framingGuide.style.display = "flex";
      startDrawLoop();

      // If API key is present, establish cloud WebRTC connection
      const falKey = falKeyInput.value.trim();
      const localStream = engine.videoElement?.srcObject as MediaStream;
      if (falKey && localStream) {
        decartClient.connect(localStream, falKey);
      } else {
        statusEl.textContent = `V-Wear Live AI Active — Wearing: ${activeGarment.name}`;
        statusEl.style.color = "#a7f3d0";
      }
    } catch (err) {
      statusEl.textContent = `Start failed: ${(err as Error).message}`;
      statusEl.style.color = "#ff4444";
    }
  });

  const connectCloudBtn = document.getElementById("btn-connect-cloud") as HTMLButtonElement | null;
  connectCloudBtn?.addEventListener("click", () => {
    const falKey = falKeyInput.value.trim();
    if (!falKey) {
      statusEl.textContent = "Please enter your fal.ai API key to connect cloud diffusion";
      statusEl.style.color = "#f87171";
      return;
    }
    const localStream = engine.videoElement?.srcObject as MediaStream;
    if (!localStream) {
      statusEl.textContent = "Please start the camera first to stream to Decart Lucy AI";
      statusEl.style.color = "#fbbf24";
      return;
    }
    decartClient.connect(localStream, falKey);
  });

  stopBtn.addEventListener("click", async () => {
    stopDrawLoop();
    decartClient.disconnect();
    await engine.stopCamera();
    placeholder.style.display = "";
    framingGuide.style.display = "none";
    latestTracking = null;
    latestSegmentation = null;
    statusEl.textContent = "Camera stopped";
  });

  function updateButtonState(state: string) {
    startBtn.disabled = state === "running" || state === "initialising";
    stopBtn.disabled = state !== "running";
  }

  updateButtonState(engine.state);

  // Pre-initialize engine in background so models are ready immediately
  engine.initialize().then(() => {
    statusEl.textContent = "V-Wear ready — Click 'Start Try-On'";
  }).catch((err) => {
    console.warn("Pre-initialization deferred:", err);
  });
}

// ---- Helpers ----

function drawSegmentationMask(
  ctx: CanvasRenderingContext2D,
  _mask: { data: Float32Array; width: number; height: number },
  destW: number,
  destH: number
): void {
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#8b5cf6";
  ctx.fillRect(-destW, 0, destW, destH);
  ctx.restore();
}

function drawSkeleton(ctx: CanvasRenderingContext2D, tracking: TrackingResult, w: number, h: number): void {
  const lms = tracking.landmarks;
  if (!lms || lms.length === 0) return;

  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(168, 85, 247, 0.75)";

  for (const [startIdx, endIdx] of POSE_CONNECTIONS) {
    const p1 = lms[startIdx];
    const p2 = lms[endIdx];
    if (p1 && p2 && (p1.visibility ?? 1) > 0.4 && (p2.visibility ?? 1) > 0.4) {
      ctx.beginPath();
      ctx.moveTo(p1.x * w, p1.y * h);
      ctx.lineTo(p2.x * w, p2.y * h);
      ctx.stroke();
    }
  }

  for (let i = 0; i < lms.length; i++) {
    const lm = lms[i];
    if (lm && (lm.visibility ?? 1) > 0.4) {
      ctx.fillStyle = i === 11 || i === 12 ? "#ec4899" : "#60a5fa";
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

main().catch(console.error);
