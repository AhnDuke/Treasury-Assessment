import { describe, expect, it } from "vitest";
import { similarityRatio } from "./textMatch";

describe("similarityRatio", () => {
  it("treats casing/punctuation differences as a near-exact match", () => {
    // Dave's example from the stakeholder interview: same brand, different casing.
    expect(similarityRatio("STONE'S THROW", "Stone's Throw")).toBe(1);
  });

  it("returns 1 for identical strings", () => {
    expect(similarityRatio("OLD TOM DISTILLERY", "OLD TOM DISTILLERY")).toBe(1);
  });

  it("returns a low ratio for genuinely different brand names", () => {
    expect(similarityRatio("OLD TOM DISTILLERY", "NEW RIVER SPIRITS")).toBeLessThan(0.5);
  });

  it("scores a small typo as a high but non-perfect match", () => {
    const ratio = similarityRatio("Kentucky Straight Bourbon Whiskey", "Kentucky Straight Bourban Whiskey");
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1);
  });
});
