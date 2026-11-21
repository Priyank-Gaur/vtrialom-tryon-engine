/**
 * src/vton/VWearRenderer.ts
 *
 * TRUE Virtual Try-On Renderer — Segmentation-Based Inpainting Approach.
 *
 * HOW DECART ANYWEAR ACTUALLY ACHIEVES THE "WEARING" EFFECT:
 *   The Lucy V-TON neural network synthesizes every pixel frame-by-frame via
 *   WebRTC — it completely replaces the user's torso clothing region with the
 *   target garment, using diffusion to synthesize realistic fabric folds,
 *   skin-to-cloth contact, and natural lighting.
 *
 * HOW WE REPLICATE IT CLIENT-SIDE (WITHOUT A GPU CLUSTER):
 *   Step 1 — Garment Base Layer:
 *     Draw the fitted garment first to a hidden offscreen canvas.
 *
 *   Step 2 — Segmentation Mask:
 *     Use the MediaPipe person segmentation mask to identify ALL person pixels
 *     (the entire person silhouette: head + torso + arms + legs).
 *
 *   Step 3 — Inverse Compositing ("Wearing" illusion):
 *     a) Start with garment drawn at the fitted body position.
 *     b) Draw ONLY the user's foreground body pixels (from segmentation)
 *        OVER the garment — but CLIP the draw so only the SLEEVE and NECK/HEAD
 *        regions of the person body show through (not the torso/chest,
 *        which is where the new garment should be visible).
 *     c) This makes it look like the person is INSIDE the garment:
 *        - Their head, neck, face sit above the collar
 *        - Their real arms/hands extend from inside the sleeves
 *        - Their legs/lower body show below the hem
 *     d) The torso/chest area of the user is HIDDEN by the garment fabric.
 *
 *   Step 4 — Forearm & Hand Occlusion for arm-raised poses:
 *     When arms cross chest, re-composite forearms on top of garment.
 *
 * Result: The garment fabric completely replaces the user's shirt/chest area
 * and the person's head/neck/arms naturally emerge from inside the clothing.
 */

import { LANDMARK_INDEX, type BodyGeometry, type SegmentationMask, type SegmentationResult } from "../core/types.js";
import type { AnywearGarment } from "./AnywearPresets.js";

export class VWearRenderer {
  private readonly _imageCache = new Map<string, HTMLImageElement>();
  private readonly _loadingUrls = new Set<string>();

  // Offscreen canvases for compositing
  private _offscreenGarment: HTMLCanvasElement | null = null;
  private _offscreenPerson: HTMLCanvasElement | null = null;
  private _offscreenGarmentCtx: CanvasRenderingContext2D | null = null;
  private _offscreenPersonCtx: CanvasRenderingContext2D | null = null;

  /**
   * Preloads an image into the image cache.
   */
  preloadImage(url: string): HTMLImageElement {
    const existing = this._imageCache.get(url);
    if (existing) return existing;

    const img = new Image();
    img.crossOrigin = "anonymous";
    this._imageCache.set(url, img);
    this._loadingUrls.add(url);

    img.onload = () => { this._loadingUrls.delete(url); };
    img.onerror = (err) => {
      console.warn(`[VWearRenderer] Failed to load garment image: ${url}`, err);
      this._loadingUrls.delete(url);
    };

    img.src = url;
    return img;
  }

  /**
   * Gets image if loaded and ready to draw.
   */
  getLoadedImage(url: string): HTMLImageElement | null {
    let img = this._imageCache.get(url);
    if (!img) img = this.preloadImage(url);
    if (img.complete && img.naturalWidth > 0) return img;
    return null;
  }

  // =========================================================================
  // Ensure offscreen canvases match main canvas size
  // =========================================================================
  private _ensureOffscreen(w: number, h: number): void {
    if (!this._offscreenGarment || this._offscreenGarment.width !== w || this._offscreenGarment.height !== h) {
      this._offscreenGarment = document.createElement("canvas");
      this._offscreenGarment.width = w;
      this._offscreenGarment.height = h;
      this._offscreenGarmentCtx = this._offscreenGarment.getContext("2d", { willReadFrequently: true });
    }
    if (!this._offscreenPerson || this._offscreenPerson.width !== w || this._offscreenPerson.height !== h) {
      this._offscreenPerson = document.createElement("canvas");
      this._offscreenPerson.width = w;
      this._offscreenPerson.height = h;
      this._offscreenPersonCtx = this._offscreenPerson.getContext("2d", { willReadFrequently: true });
    }
  }

  // =========================================================================
  // MAIN ENTRY POINT
  // =========================================================================
  /**
   * Renders the garment as if the user is truly wearing it.
   *
   * With segmentation mask: uses inverse compositing to put the garment
   * BEHIND the person's head/neck/arms, creating a genuine "wearing" illusion.
   *
   * Without segmentation: falls back to anatomical overlay mode.
   */
  drawGarment(
    ctx: CanvasRenderingContext2D,
    garment: AnywearGarment,
    body: BodyGeometry,
    canvasWidth: number,
    canvasHeight: number,
    video?: HTMLVideoElement | null,
    segmentation?: SegmentationResult | null
  ): void {
    const img = this.getLoadedImage(garment.imageUrl);
    if (!img) return;

    const landmarks = body.landmarks;
    const ls = landmarks[LANDMARK_INDEX.LEFT_SHOULDER];
    const rs = landmarks[LANDMARK_INDEX.RIGHT_SHOULDER];
    if (!ls || !rs) return;
    if ((ls.visibility ?? 0.8) < 0.25 || (rs.visibility ?? 0.8) < 0.25) return;

    // Compute screen-space body geometry
    const geo = this._computeBodyGeo(body, canvasWidth, canvasHeight);
    if (geo.shoulderSpan < 20) return;

    const hasMask = !!(segmentation?.mask && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);

    if (hasMask) {
      // =====================================================================
      // TRUE WEARING MODE: Segmentation-based inverse compositing
      // =====================================================================
      this._drawWithSegmentation(ctx, img, garment, body, geo, canvasWidth, canvasHeight, video!, segmentation!.mask!);
    } else {
      // =====================================================================
      // FALLBACK MODE: Anatomical overlay (no segmentation data yet)
      // =====================================================================
      this._drawFallbackOverlay(ctx, img, garment, body, geo, canvasWidth, canvasHeight, video);
    }
  }

  // =========================================================================
  // TRUE WEARING MODE — Segmentation-Based Inverse Compositing
  // =========================================================================
  private _drawWithSegmentation(
    mainCtx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    garment: AnywearGarment,
    body: BodyGeometry,
    geo: BodyGeo,
    w: number,
    h: number,
    video: HTMLVideoElement,
    mask: SegmentationMask
  ): void {
    this._ensureOffscreen(w, h);
    const gCtx = this._offscreenGarmentCtx!;
    const pCtx = this._offscreenPersonCtx!;

    // --- Layer A: Draw the fitted garment onto offscreen canvas ---
    gCtx.clearRect(0, 0, w, h);
    this._drawFittedGarment(gCtx, img, garment, geo, w, h);

    // --- Layer B: Build segmented person canvas (mirrored video * mask) ---
    pCtx.clearRect(0, 0, w, h);
    // Draw the mirrored video
    pCtx.save();
    pCtx.scale(-1, 1);
    pCtx.drawImage(video, -w, 0, w, h);
    pCtx.restore();

    // Apply segmentation mask: erase background pixels, keep only person
    this._applySegMaskToCanvas(pCtx, mask, w, h);

    // --- Composite onto main canvas ---
    // The main canvas ALREADY has the full mirrored video drawn.
    // Now we:
    //   1. Draw the garment layer over the video
    //   2. Then draw person ONLY outside the garment's torso region
    //      (head + arms + legs visible; torso/chest covered by garment)

    // Step 1: Draw garment
    mainCtx.drawImage(this._offscreenGarment!, 0, 0);

    // Step 2: Draw person BACK on top of garment but MASK OUT the garment's
    //         body coverage area so the garment fabric shows through on the torso.
    //         The person's head, neck, arms (outside sleeve edges), and legs
    //         show through naturally above/beside/below the garment.
    this._compositePersonOverGarment(mainCtx, body, geo, w, h, video);
  }

  /**
   * Applies the segmentation mask to a canvas context (erases background).
   * Modifies canvas pixels in-place using globalCompositeOperation.
   */
  private _applySegMaskToCanvas(
    ctx: CanvasRenderingContext2D,
    mask: SegmentationMask,
    canvasW: number,
    canvasH: number
  ): void {
    // Get current pixel data from the canvas
    const imgData = ctx.getImageData(0, 0, canvasW, canvasH);
    const pixels = imgData.data;

    const maskW = mask.width;
    const maskH = mask.height;

    for (let py = 0; py < canvasH; py++) {
      for (let px = 0; px < canvasW; px++) {
        // Sample mask at this pixel (bilinear would be ideal, but nearest is fast)
        const mx = Math.round((px / canvasW) * maskW);
        const my = Math.round((py / canvasH) * maskH);
        const maskIdx = Math.min(my, maskH - 1) * maskW + Math.min(mx, maskW - 1);
        const confidence = mask.data[maskIdx] ?? 0;

        // Apply confidence as alpha: foreground person = opaque, background = transparent
        const alpha = Math.min(1, confidence * 1.4); // slightly boost to fill edge gaps
        const pixelIdx = (py * canvasW + px) * 4;
        pixels[pixelIdx + 3] = Math.round(alpha * 255);
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  /**
   * Composites the segmented person back over the garment.
   * Excludes the central torso region where the garment fabric should be visible.
   * The person's HEAD, NECK, ARMS (outer), and LEGS show through naturally.
   */
  private _compositePersonOverGarment(
    mainCtx: CanvasRenderingContext2D,
    body: BodyGeometry,
    geo: BodyGeo,
    w: number,
    h: number,
    video?: HTMLVideoElement
  ): void {
    const pCtx = this._offscreenPersonCtx;
    if (!pCtx || !this._offscreenPerson) return;

    // Erase the garment body coverage from the person layer
    pCtx.save();
    pCtx.globalCompositeOperation = "destination-out";

    const minX = Math.min(geo.lsX, geo.rsX);
    const maxX = Math.max(geo.lsX, geo.rsX);
    const torsoBottom = geo.torsoBottomY;

    // Expand slightly to cover the full garment body panel
    const expandX = geo.shoulderSpan * 0.12;
    const topY = Math.min(geo.lsY, geo.rsY) - geo.shoulderSpan * 0.05;
    const bottomY = torsoBottom + geo.shoulderSpan * 0.05;

    pCtx.beginPath();
    pCtx.moveTo(minX + expandX, topY);
    pCtx.lineTo(maxX - expandX, topY);
    pCtx.lineTo(maxX - expandX * 0.7, bottomY);
    pCtx.lineTo(minX + expandX * 0.7, bottomY);
    pCtx.closePath();
    pCtx.fill();

    pCtx.restore();

    // Now draw the masked person canvas (head + arms + legs visible) over the garment
    mainCtx.drawImage(this._offscreenPerson, 0, 0);

    // Re-composite forearms and hands when crossed or raised in front of the chest
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this._restoreForegroundArms(mainCtx, video, body, minX, maxX, topY, bottomY, w, h);
    }
  }

  /**
   * Restores forearms and hands in front of garment when hands are raised or crossed over chest.
   */
  private _restoreForegroundArms(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    body: BodyGeometry,
    torsoMinX: number,
    torsoMaxX: number,
    torsoTopY: number,
    torsoBottomY: number,
    w: number,
    h: number
  ): void {
    const lms = body.landmarks;
    const arms = [
      { elbow: lms[LANDMARK_INDEX.LEFT_ELBOW], wrist: lms[LANDMARK_INDEX.LEFT_WRIST] },
      { elbow: lms[LANDMARK_INDEX.RIGHT_ELBOW], wrist: lms[LANDMARK_INDEX.RIGHT_WRIST] },
    ];

    for (const arm of arms) {
      if (!arm.wrist || (arm.wrist.visibility ?? 1) < 0.4) continue;
      const wx = (1.0 - arm.wrist.x) * w;
      const wy = arm.wrist.y * h;

      // Check if wrist is positioned across the chest/torso area
      if (wx >= torsoMinX - 10 && wx <= torsoMaxX + 10 && wy >= torsoTopY && wy <= torsoBottomY) {
        ctx.save();
        ctx.beginPath();
        if (arm.elbow && (arm.elbow.visibility ?? 1) > 0.4) {
          const ex = (1.0 - arm.elbow.x) * w;
          const ey = arm.elbow.y * h;
          ctx.lineWidth = Math.hypot(torsoMaxX - torsoMinX) * 0.20;
          ctx.lineCap = "round";
          ctx.moveTo(ex, ey);
          ctx.lineTo(wx, wy);
        } else {
          ctx.arc(wx, wy, Math.hypot(torsoMaxX - torsoMinX) * 0.14, 0, Math.PI * 2);
        }
        ctx.clip();
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -w, 0, w, h);
        ctx.restore();
        ctx.restore();
      }
    }
  }

  // =========================================================================
  // FALLBACK MODE — Anatomical Overlay (No Segmentation)
  // =========================================================================
  private _drawFallbackOverlay(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    garment: AnywearGarment,
    body: BodyGeometry,
    geo: BodyGeo,
    w: number,
    h: number,
    video?: HTMLVideoElement | null
  ): void {
    this._drawFittedGarment(ctx, img, garment, geo, w, h);

    // Restore user's head/face above the collar
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this._restoreHead(ctx, video, body, geo, garment.category, w, h);
    }
  }

  // =========================================================================
  // Fitted Garment Drawing
  // =========================================================================
  private _drawFittedGarment(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    garment: AnywearGarment,
    geo: BodyGeo,
    _w: number,
    _h: number
  ): void {
    const fit = garment.fitting;
    const garmentWidth = geo.shoulderSpan * fit.chestFitRatio * 1.42;
    const garmentHeight = geo.torsoHeight * fit.torsoLengthRatio * 1.28;

    let collarOffsetRatio = 0.13;
    if (garment.category === "highneck") collarOffsetRatio = 0.22;
    else if (garment.category === "hoodie") collarOffsetRatio = 0.16;
    else if (garment.category === "shirt") collarOffsetRatio = 0.14;

    ctx.save();
    ctx.translate(geo.midX, geo.midY);
    ctx.rotate(geo.shoulderAngle);
    ctx.drawImage(img, -garmentWidth / 2, -garmentHeight * collarOffsetRatio, garmentWidth, garmentHeight);
    ctx.restore();
  }

  // =========================================================================
  // Head / Face Restoration (Fallback mode only)
  // =========================================================================
  private _restoreHead(
    ctx: CanvasRenderingContext2D,
    video: HTMLVideoElement,
    body: BodyGeometry,
    geo: BodyGeo,
    category: string,
    w: number,
    h: number
  ): void {
    const landmarks = body.landmarks;
    const nose = landmarks[LANDMARK_INDEX.NOSE];
    const mouthL = landmarks[9];
    const mouthR = landmarks[10];

    let chinX = geo.midX;
    let chinY = geo.midY - geo.shoulderSpan * 0.28;

    if (mouthL && mouthR) {
      chinX = (1.0 - (mouthL.x + mouthR.x) / 2) * w;
      chinY = ((mouthL.y + mouthR.y) / 2) * h + geo.shoulderSpan * 0.08;
    } else if (nose) {
      chinX = (1.0 - nose.x) * w;
      chinY = nose.y * h + geo.shoulderSpan * 0.22;
    }

    const neckCutoffY = category === "highneck"
      ? chinY + geo.shoulderSpan * 0.02
      : geo.midY - geo.shoulderSpan * 0.08;

    const headRadiusX = geo.shoulderSpan * 0.36;
    const headRadiusY = Math.max((neckCutoffY - (chinY - geo.shoulderSpan * 0.42)) / 2, geo.shoulderSpan * 0.26);
    const headCenterY = neckCutoffY - headRadiusY;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(chinX, headCenterY, headRadiusX, headRadiusY, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -w, 0, w, h);
    ctx.restore();
    ctx.restore();
  }

  // =========================================================================
  // Body Geometry Helper
  // =========================================================================
  private _computeBodyGeo(body: BodyGeometry, w: number, h: number): BodyGeo {
    const landmarks = body.landmarks;
    const ls = landmarks[LANDMARK_INDEX.LEFT_SHOULDER]!;
    const rs = landmarks[LANDMARK_INDEX.RIGHT_SHOULDER]!;
    const lh = landmarks[LANDMARK_INDEX.LEFT_HIP];
    const rh = landmarks[LANDMARK_INDEX.RIGHT_HIP];

    const lsX = (1.0 - ls.x) * w;
    const lsY = ls.y * h;
    const rsX = (1.0 - rs.x) * w;
    const rsY = rs.y * h;
    const midX = (lsX + rsX) / 2;
    const midY = (lsY + rsY) / 2;
    const shoulderSpan = Math.hypot(rsX - lsX, rsY - lsY);
    const shoulderAngle = Math.atan2(rsY - lsY, rsX - lsX);

    let torsoHeight = shoulderSpan * 1.35;
    let torsoBottomY = midY + torsoHeight;
    if (lh && rh && (lh.visibility ?? 0.8) > 0.25 && (rh.visibility ?? 0.8) > 0.25) {
      const hipY = ((lh.y + rh.y) / 2) * h;
      torsoHeight = Math.max(hipY - midY, shoulderSpan * 1.15);
      torsoBottomY = hipY;
    }

    return { lsX, lsY, rsX, rsY, midX, midY, shoulderSpan, shoulderAngle, torsoHeight, torsoBottomY };
  }
}

interface BodyGeo {
  lsX: number;
  lsY: number;
  rsX: number;
  rsY: number;
  midX: number;
  midY: number;
  shoulderSpan: number;
  shoulderAngle: number;
  torsoHeight: number;
  torsoBottomY: number;
}
