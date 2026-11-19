/**
 * src/segmentation/PersonSegmenter.ts
 *
 * Wraps MediaPipe ImageSegmenter (Tasks Vision SDK) for real-time person
 * foreground segmentation.
 *
 * Responsibilities:
 *   - Load the optimized Selfie Segmenter model in VIDEO running mode.
 *   - Execute GPU-accelerated person segmentation on camera frames.
 *   - Extract confidence masks (Float32Array where each pixel represents foreground probability).
 *   - Perform edge thresholding and spatial smoothing to minimize edge jitter.
 *   - Measure inference latency for real-time profiling.
 *   - Properly free WebGL and WASM mask buffers via MPMask.close().
 */

import {
  ImageSegmenter,
  FilesetResolver,
  type ImageSegmenterResult,
} from "@mediapipe/tasks-vision";
import type { SegmentationConfig } from "../core/EngineConfig.js";
import type { SegmentationMask } from "../core/types.js";

// CDN base for MediaPipe WASM binaries
const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

// Standard Google Cloud Storage model URLs
const MODEL_URLS: Record<SegmentationConfig["model"], string> = {
  selfie:
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
  general:
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
};

export class PersonSegmenter {
  private readonly _config: SegmentationConfig;
  private _segmenter: ImageSegmenter | null = null;

  // Cached latest mask and inference metrics
  private _latestMask: SegmentationMask | null = null;
  private _inferenceLatencyMs = 0;
  private _lastInferenceStart = 0;

  // Reusable buffer for spatial smoothing to avoid per-frame allocations
  private _smoothedBuffer: Float32Array | null = null;

  constructor(config: SegmentationConfig) {
    this._config = config;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Initializes the ImageSegmenter task with WASM binaries and model weights.
   */
  async initialize(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);

    this._segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URLS[this._config.model],
        delegate: "GPU", // WebGL acceleration with automatic CPU fallback
      },
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  }

  /** Releases segmenter model and GPU resources. */
  dispose(): void {
    this._segmenter?.close();
    this._segmenter = null;
    this._latestMask = null;
    this._smoothedBuffer = null;
  }

  // =========================================================================
  // Detection
  // =========================================================================

  /**
   * Submits a video frame for segmentation and extracts the processed mask.
   *
   * @param video HTMLVideoElement from CameraManager
   * @param timestampMs Monotonic timestamp for video frame sequencing
   */
  segmentFrame(video: HTMLVideoElement, timestampMs: number): SegmentationMask | null {
    if (!this._segmenter) return null;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;

    this._lastInferenceStart = performance.now();

    try {
      const result: ImageSegmenterResult = this._segmenter.segmentForVideo(
        video,
        timestampMs
      );

      this._inferenceLatencyMs = performance.now() - this._lastInferenceStart;

      if (!result.confidenceMasks || result.confidenceMasks.length === 0) {
        return null;
      }

      // In selfie_segmenter, mask at index 0 represents person confidence
      const mpMask = result.confidenceMasks[0];
      const width = mpMask.width;
      const height = mpMask.height;

      // Extract raw Float32 confidence data [0.0, 1.0]
      const rawData = mpMask.getAsFloat32Array();

      // Free the underlying WebGL/WASM texture to avoid GPU memory leaks
      mpMask.close();

      // Smooth and threshold the raw confidence data
      const processedData = this._processMask(
        rawData,
        width,
        height,
        this._config.foregroundThreshold,
        this._config.edgeSmoothingRadius
      );

      this._latestMask = {
        data: processedData,
        width,
        height,
      };

      return this._latestMask;
    } catch (err) {
      console.warn("[PersonSegmenter] Error during segmentForVideo:", err);
      return null;
    }
  }

  // =========================================================================
  // Accessors
  // =========================================================================

  get latestMask(): SegmentationMask | null {
    return this._latestMask;
  }

  get inferenceLatencyMs(): number {
    return this._inferenceLatencyMs;
  }

  // =========================================================================
  // Mask Post-Processing (Thresholding + Separable 1D Blur for Smooth Edges)
  // =========================================================================

  private _processMask(
    raw: Float32Array,
    width: number,
    height: number,
    threshold: number,
    radius: number
  ): Float32Array {
    const totalPixels = width * height;

    if (!this._smoothedBuffer || this._smoothedBuffer.length !== totalPixels) {
      this._smoothedBuffer = new Float32Array(totalPixels);
    }

    const output = this._smoothedBuffer;

    if (radius <= 0) {
      // Direct thresholding without spatial blur
      for (let i = 0; i < totalPixels; i++) {
        output[i] = raw[i] >= threshold ? 1.0 : 0.0;
      }
      return output;
    }

    // Apply a fast 1D horizontal then vertical box filter over binary threshold
    // Temporary buffer for intermediate horizontal pass
    const temp = new Float32Array(totalPixels);

    // 1. Threshold + Horizontal box blur
    const windowSize = radius * 2 + 1;
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      let windowSum = 0;

      // Pre-fill initial window
      for (let k = -radius; k <= radius; k++) {
        const clampedX = Math.min(Math.max(k, 0), width - 1);
        const val = raw[rowOffset + clampedX] >= threshold ? 1.0 : 0.0;
        windowSum += val;
      }

      for (let x = 0; x < width; x++) {
        temp[rowOffset + x] = windowSum / windowSize;

        // Slide window
        const removeX = Math.max(x - radius, 0);
        const addX = Math.min(x + radius + 1, width - 1);
        const removeVal = raw[rowOffset + removeX] >= threshold ? 1.0 : 0.0;
        const addVal = raw[rowOffset + addX] >= threshold ? 1.0 : 0.0;
        windowSum += addVal - removeVal;
      }
    }

    // 2. Vertical box blur
    for (let x = 0; x < width; x++) {
      let windowSum = 0;

      for (let k = -radius; k <= radius; k++) {
        const clampedY = Math.min(Math.max(k, 0), height - 1);
        windowSum += temp[clampedY * width + x];
      }

      for (let y = 0; y < height; y++) {
        output[y * width + x] = windowSum / windowSize;

        const removeY = Math.max(y - radius, 0);
        const addY = Math.min(y + radius + 1, height - 1);
        windowSum += temp[addY * width + x] - temp[removeY * width + x];
      }
    }

    return output;
  }
}

