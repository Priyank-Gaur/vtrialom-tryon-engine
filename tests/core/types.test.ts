/**
 * tests/core/types.test.ts
 *
 * Verifies the LANDMARK_INDEX constant values match MediaPipe's documented
 * pose landmark indices. These are load-bearing constants — if they drift
 * from the MediaPipe spec, garment fitting will silently break.
 *
 * Reference:
 * https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
 */

import { describe, it, expect } from "vitest";
import { LANDMARK_INDEX } from "../../src/core/types";

describe("LANDMARK_INDEX", () => {
  it("maps NOSE to index 0", () => {
    expect(LANDMARK_INDEX.NOSE).toBe(0);
  });

  it("maps LEFT_SHOULDER to index 11", () => {
    expect(LANDMARK_INDEX.LEFT_SHOULDER).toBe(11);
  });

  it("maps RIGHT_SHOULDER to index 12", () => {
    expect(LANDMARK_INDEX.RIGHT_SHOULDER).toBe(12);
  });

  it("maps LEFT_ELBOW to index 13", () => {
    expect(LANDMARK_INDEX.LEFT_ELBOW).toBe(13);
  });

  it("maps RIGHT_ELBOW to index 14", () => {
    expect(LANDMARK_INDEX.RIGHT_ELBOW).toBe(14);
  });

  it("maps LEFT_WRIST to index 15", () => {
    expect(LANDMARK_INDEX.LEFT_WRIST).toBe(15);
  });

  it("maps RIGHT_WRIST to index 16", () => {
    expect(LANDMARK_INDEX.RIGHT_WRIST).toBe(16);
  });

  it("maps LEFT_HIP to index 23", () => {
    expect(LANDMARK_INDEX.LEFT_HIP).toBe(23);
  });

  it("maps RIGHT_HIP to index 24", () => {
    expect(LANDMARK_INDEX.RIGHT_HIP).toBe(24);
  });

  it("contains exactly the documented landmark subset", () => {
    // 11 entries: NOSE + LEFT/RIGHT × SHOULDER, ELBOW, WRIST, HIP, KNEE
    // Guard: if someone adds or removes an index this test fails, prompting review.
    const keys = Object.keys(LANDMARK_INDEX);
    expect(keys).toHaveLength(11);
  });
});

