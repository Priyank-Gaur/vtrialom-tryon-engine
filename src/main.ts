/**
 * src/main.ts
 *
 * Development entry point for the VTrialom Try-On Engine.
 *
 * PHASE 0 dev shell:
 *   - Instantiates the engine and mounts the canvas.
 *   - Shows camera permission UI with meaningful state feedback.
 *   - Draws the live camera feed to the canvas so the camera can be visually
 *     verified (the future Renderer will own this in Phase 5).
 *   - Renders a live FPS counter.
 *
 * Later phases will add: tracking overlay, garment selector, composited output.
 */

import { VTrialomTryOn } from "./api/TryOnComponent.js";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  const container = document.getElementById("tryon-container");
  if (!container) {
    throw new Error("Required element #tryon-container not found in index.html");
  }

  const statusEl = document.getElementById("status-text")!;
  const fpsEl = document.getElementById("fps-counter")!;
  const startBtn = document.getElementById("btn-start") as HTMLButtonElement;
  const stopBtn = document.getElementById("btn-stop") as HTMLButtonElement;
  const placeholder = document.getElementById("camera-placeholder")!;

  // ---- create engine ----
  const engine = new VTrialomTryOn({
    container,
    camera: { facingMode: "user" },
    debug: true,
  });

  // ---- state display ----
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

  // ---- Camera feed → canvas draw loop ----
  // Phase 0 responsibility: prove the camera is live by painting frames.
  // Phase 5 (Renderer) will own this properly; this is intentionally minimal.
  let drawLoopId: number | null = null;
  let frameCount = 0;
  let lastFpsTime = performance.now();

  function startDrawLoop() {
    const canvas = engine.canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const video = engine.videoElement;

      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        // Mirror horizontally (selfie convention — feels natural)
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();

        // FPS counter overlay (top-left, debug only)
        frameCount++;
        const now = performance.now();
        const elapsed = now - lastFpsTime;
        if (elapsed >= 1000) {
          const fps = Math.round((frameCount * 1000) / elapsed);
          fpsEl.textContent = `FPS: ${fps}`;
          frameCount = 0;
          lastFpsTime = now;
        }
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
    // Clear the canvas to black when stopped
    const ctx = engine.canvas.getContext("2d");
    ctx?.clearRect(0, 0, engine.canvas.width, engine.canvas.height);
    fpsEl.textContent = "– FPS";
  }

  // ---- button handlers ----
  startBtn.addEventListener("click", async () => {
    try {
      if (engine.state === "uninitialised") {
        statusEl.textContent = "Initialising engine…";
        await engine.initialize();
      }
      statusEl.textContent = "Requesting camera permission…";
      await engine.startCamera();

      // Hide placeholder, start drawing
      placeholder.style.display = "none";
      startDrawLoop();
      statusEl.textContent = "Camera running ✓";
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
    statusEl.textContent = "Camera stopped";
  });

  function updateButtonState(state: string) {
    startBtn.disabled = state === "running" || state === "initialising";
    stopBtn.disabled = state !== "running";
  }

  updateButtonState(engine.state);
  statusEl.textContent = `Engine state: ${engine.state}`;
}

main().catch(console.error);

