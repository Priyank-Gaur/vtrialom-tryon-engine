/**
 * tests/garments/GarmentLoader.test.ts
 *
 * Unit tests for GarmentLoader asset loading, caching, and proportion derivation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GarmentLoader } from "../../src/garments/GarmentLoader";

describe("GarmentLoader", () => {
  let loader: GarmentLoader;

  beforeEach(() => {
    loader = new GarmentLoader();

    // Mock _loadImage on prototype so it returns a valid HTMLImageElement without network fetch
    vi.spyOn(loader as any, "_loadImage").mockImplementation(async (...args: unknown[]) => {
      const url = args[0] as string;
      const img = document.createElement("img");
      img.src = url;
      Object.defineProperty(img, "naturalWidth", { value: 600, writable: false });
      Object.defineProperty(img, "naturalHeight", { value: 600, writable: false });
      return img;
    });
  });

  it("throws when loading a garment without an ID", async () => {
    await expect(loader.loadGarment({ id: "" })).rejects.toThrow(/options.id is required/);
  });

  it("throws when loading a garment without assetUrl and without metadataUrl", async () => {
    await expect(loader.loadGarment({ id: "no-url" })).rejects.toThrow(/no assetUrl/);
  });

  it("loads and derives geometric proportions for a valid garment", async () => {
    const garment = await loader.loadGarment({
      id: "white-tee",
      name: "White Tee",
      assetUrl: "/garments/classic-white-tee.svg",
      metadata: {
        category: "TSHIRT",
        anchors: {
          leftShoulder: { x: 0.28, y: 0.16 },
          rightShoulder: { x: 0.72, y: 0.16 },
          neckCentre: { x: 0.50, y: 0.18 },
          hemCentre: { x: 0.50, y: 0.92 },
        },
      },
    });

    expect(garment.metadata.id).toBe("white-tee");
    expect(garment.image).toBeDefined();
    expect(garment.dimensions.width).toBe(600);
    expect(garment.dimensions.height).toBe(600);
    expect(garment.dimensions.aspectRatio).toBeCloseTo(1.0);

    // Shoulder span: 0.72 - 0.28 = 0.44
    expect(garment.shoulderSpan).toBeCloseTo(0.44);

    // Torso length: 0.92 - 0.18 = 0.74
    expect(garment.torsoLength).toBeCloseTo(0.74);
  });

  it("caches loaded garments and returns the cached instance on subsequent calls", async () => {
    const first = await loader.loadGarment({
      id: "cached-shirt",
      assetUrl: "/garments/shirt.svg",
    });

    const second = await loader.loadGarment({
      id: "cached-shirt",
      assetUrl: "/garments/shirt.svg",
    });

    expect(first).toBe(second);
    expect(loader.getCached("cached-shirt")).toBe(first);
  });

  it("preloads multiple garments in parallel", async () => {
    const loaded = await loader.preload([
      { id: "g1", assetUrl: "/g1.svg" },
      { id: "g2", assetUrl: "/g2.svg" },
    ]);

    expect(loaded).toHaveLength(2);
    expect(loader.getCached("g1")).not.toBeNull();
    expect(loader.getCached("g2")).not.toBeNull();
  });

  it("clears cache completely when clearCache() is called", async () => {
    await loader.loadGarment({ id: "temp", assetUrl: "/temp.svg" });
    expect(loader.getCached("temp")).not.toBeNull();

    loader.clearCache();
    expect(loader.getCached("temp")).toBeNull();
  });
});

