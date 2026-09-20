import { describe, expect, it } from "vitest";
import { normalizeExtractedText, toExtractedLabelData } from "./anthropic";

describe("normalizeExtractedText", () => {
  it("keeps real label text as it was printed", () => {
    expect(normalizeExtractedText("  OLD TOM DISTILLERY  ")).toBe("OLD TOM DISTILLERY");
    expect(normalizeExtractedText("45% Alc./Vol. (90 Proof)")).toBe("45% Alc./Vol. (90 Proof)");
  });

  it("turns the placeholder a model returns instead of null into null", () => {
    // Observed in a real run: a front-only label came back with the literal
    // string "<UNKNOWN>" for the Government Warning. A non-empty string means
    // "the label says this", so it was compared against the statutory text and
    // reported as a wording violation.
    expect(normalizeExtractedText("<UNKNOWN>")).toBeNull();
    expect(normalizeExtractedText("UNKNOWN")).toBeNull();
    expect(normalizeExtractedText("N/A")).toBeNull();
    expect(normalizeExtractedText("not visible")).toBeNull();
    expect(normalizeExtractedText("Not Found")).toBeNull();
    expect(normalizeExtractedText("[none]")).toBeNull();
    expect(normalizeExtractedText("null")).toBeNull();
  });

  it("treats blanks and bare punctuation as absent", () => {
    expect(normalizeExtractedText("")).toBeNull();
    expect(normalizeExtractedText("   ")).toBeNull();
    expect(normalizeExtractedText("-")).toBeNull();
    expect(normalizeExtractedText("...")).toBeNull();
  });

  it("does not swallow real text that merely contains a placeholder word", () => {
    // The guard matches a whole value, not a substring, so a brand or address
    // using one of these words survives.
    expect(normalizeExtractedText("Unknown Pleasures Brewing Co")).toBe("Unknown Pleasures Brewing Co");
    expect(normalizeExtractedText("Bottled by None Such Distillery Austin TX")).toBe(
      "Bottled by None Such Distillery Austin TX"
    );
  });

  it("returns null for anything that is not a string", () => {
    expect(normalizeExtractedText(null)).toBeNull();
    expect(normalizeExtractedText(undefined)).toBeNull();
    expect(normalizeExtractedText(42)).toBeNull();
  });
});

describe("toExtractedLabelData", () => {
  it("establishes the shape rather than asserting it", () => {
    const result = toExtractedLabelData({
      brandName: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      abvPercent: 45,
      netContents: "750 mL",
      bottlerInfo: "Bottled by Old Tom Distillery Bardstown KY",
      countryOfOrigin: null,
      warningStatementText: "GOVERNMENT WARNING: ...",
      backLabelVisible: true,
    });
    expect(result.brandName).toBe("OLD TOM DISTILLERY");
    expect(result.abvPercent).toBe(45);
    expect(result.countryOfOrigin).toBeNull();
    expect(result.backLabelVisible).toBe(true);
  });

  it("normalises a placeholder-filled read of a front-only label", () => {
    const result = toExtractedLabelData({
      brandName: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      abvPercent: 45,
      netContents: "750 mL",
      bottlerInfo: "<UNKNOWN>",
      countryOfOrigin: "<UNKNOWN>",
      warningStatementText: "<UNKNOWN>",
      backLabelVisible: false,
    });
    expect(result.bottlerInfo).toBeNull();
    expect(result.countryOfOrigin).toBeNull();
    expect(result.warningStatementText).toBeNull();
  });

  it("recovers a number written as text and rejects one that is not a number", () => {
    expect(toExtractedLabelData({ abvPercent: "45% Alc./Vol." }).abvPercent).toBe(45);
    expect(toExtractedLabelData({ abvPercent: "<UNKNOWN>" }).abvPercent).toBeNull();
    expect(toExtractedLabelData({}).abvPercent).toBeNull();
  });

  it("defaults a missing backLabelVisible to false", () => {
    // The safe direction: an evidence gap gets reported rather than a
    // fabricated violation.
    expect(toExtractedLabelData({}).backLabelVisible).toBe(false);
  });
});
