import { describe, expect, it } from "vitest";
import { applySecondOpinions, fieldsNeedingSecondOpinion } from "./escalation";
import type { FieldResult } from "./types";

function field(overrides: Partial<FieldResult>): FieldResult {
  return {
    field: "brandName",
    label: "Brand Name",
    expected: "OLD TOM DISTILLERY",
    extracted: "OLD TOM DISTILLERY",
    status: "match",
    ...overrides,
  };
}

describe("fieldsNeedingSecondOpinion", () => {
  it("only flags fields that didn't cleanly match", () => {
    const fields = [
      field({ field: "brandName", status: "match" }),
      field({ field: "classType", status: "review" }),
      field({ field: "abvPercent", status: "mismatch" }),
      field({ field: "netContents", status: "missing" }),
    ];
    expect(fieldsNeedingSecondOpinion(fields)).toEqual(["classType", "abvPercent", "netContents"]);
  });

  it("doesn't spend a second-opinion call on a field nobody photographed", () => {
    // A stronger model re-reading the same images can't find text that isn't
    // in them - escalating an evidence gap buys nothing and costs a call.
    const fields = [
      field({ field: "warningStatement", status: "not_shown" }),
      field({ field: "classType", status: "review" }),
    ];
    expect(fieldsNeedingSecondOpinion(fields)).toEqual(["classType"]);
  });
});

describe("applySecondOpinions", () => {
  it("marks agreement when the second read matches the first, post-normalization", () => {
    const fields = [field({ field: "classType", status: "review", extracted: "Kentucky Straight Bourban Whiskey" })];
    const result = applySecondOpinions(fields, { classType: "kentucky straight bourban whiskey" });
    expect(result[0].secondOpinion).toEqual({
      model: "claude-sonnet-5",
      extracted: "kentucky straight bourban whiskey",
      agreesWithFirstPass: true,
    });
  });

  it("marks disagreement when the second read genuinely differs", () => {
    const fields = [field({ field: "classType", status: "review", extracted: "Bourban Whiskey" })];
    const result = applySecondOpinions(fields, { classType: "Rye Whiskey" });
    expect(result[0].secondOpinion?.agreesWithFirstPass).toBe(false);
  });

  it("compares abvPercent numerically, ignoring the '%' formatting on the first-pass value", () => {
    const fields = [field({ field: "abvPercent", status: "mismatch", extracted: "40%" })];
    const result = applySecondOpinions(fields, { abvPercent: 40 });
    expect(result[0].secondOpinion).toEqual({
      model: "claude-sonnet-5",
      extracted: "40%",
      agreesWithFirstPass: true,
    });
  });

  it("leaves fields untouched when no second opinion was requested for them", () => {
    const fields = [field({ field: "brandName", status: "match" })];
    const result = applySecondOpinions(fields, { classType: "Rye Whiskey" });
    expect(result[0].secondOpinion).toBeUndefined();
  });

  it("treats a null second-pass reading as disagreement with a non-null first pass", () => {
    const fields = [field({ field: "netContents", status: "missing", extracted: null })];
    const result = applySecondOpinions(fields, { netContents: null });
    expect(result[0].secondOpinion?.agreesWithFirstPass).toBe(true);
    expect(result[0].secondOpinion?.extracted).toBeNull();
  });
});
