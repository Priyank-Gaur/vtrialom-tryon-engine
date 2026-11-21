/**
 * tests/vton/DecartAnywearClient.test.ts
 *
 * Unit tests for DecartAnywearClient.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DecartAnywearClient } from "../../src/vton/DecartAnywearClient";

describe("DecartAnywearClient", () => {
  let client: DecartAnywearClient;

  beforeEach(() => {
    client = new DecartAnywearClient();
  });

  it("initializes with default endpoint and disconnected state", () => {
    expect(client.isConnected).toBe(false);
    expect(client.activeGarment).toBeNull();
    expect(client.remoteStream).toBeNull();
  });

  it("stores active garment when setGarment is called", () => {
    client.setGarment({
      name: "Vintage Denim Jacket",
      imageUrl: "https://example.com/jacket.jpg",
      description: "Oversized classic blue denim jacket with brass buttons",
    });

    expect(client.activeGarment).not.toBeNull();
    expect(client.activeGarment?.name).toBe("Vintage Denim Jacket");
    expect(client.activeGarment?.imageUrl).toBe("https://example.com/jacket.jpg");
  });

  it("handles disconnect safely", () => {
    expect(() => client.disconnect()).not.toThrow();
    expect(client.isConnected).toBe(false);
  });
});
