import { describe, expect, it } from "vitest";
import { compareLabelToApplication, determineOverallStatus } from "./comparison";
import { STATUTORY_WARNING_TEXT } from "./warningStatement";
import type { ApplicationData, ExtractedLabelData } from "./types";

const application: ApplicationData = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  abvPercent: 45,
  netContents: "750 mL",
};

function extracted(overrides: Partial<ExtractedLabelData> = {}): ExtractedLabelData {
  return {
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    abvPercent: 45,
    netContents: "750 mL",
    warningStatementText: STATUTORY_WARNING_TEXT,
    ...overrides,
  };
}

describe("compareLabelToApplication", () => {
  it("approves a label that matches the application exactly", () => {
    const fields = compareLabelToApplication(application, extracted());
    expect(fields.every((f) => f.status === "match")).toBe(true);
    expect(determineOverallStatus(fields)).toBe("approved");
  });

  it("treats a casing/punctuation-only difference as a full match, not a rejection", () => {
    // Dave's example: "STONE'S THROW" vs "Stone's Throw" — technically not an
    // exact string match, but obviously the same brand. Should not even need
    // human review, per his complaint about tools creating needless friction.
    const fields = compareLabelToApplication(
      { ...application, brandName: "STONE'S THROW" },
      extracted({ brandName: "Stone's Throw" })
    );
    const brand = fields.find((f) => f.field === "brandName")!;
    expect(brand.status).toBe("match");
    expect(determineOverallStatus(fields)).toBe("approved");
  });

  it("flags a near-miss spelling as needing review rather than auto-rejecting", () => {
    const fields = compareLabelToApplication(
      application,
      extracted({ classType: "Kentucky Straight Bourban Whiskey" })
    );
    const classType = fields.find((f) => f.field === "classType")!;
    expect(classType.status).toBe("review");
    expect(determineOverallStatus(fields)).toBe("flagged");
  });

  it("rejects an ABV outside tolerance", () => {
    const fields = compareLabelToApplication(application, extracted({ abvPercent: 40 }));
    const abv = fields.find((f) => f.field === "abvPercent")!;
    expect(abv.status).toBe("mismatch");
    expect(determineOverallStatus(fields)).toBe("rejected");
  });

  it("accepts net contents expressed in different but equivalent units", () => {
    const fields = compareLabelToApplication({ ...application, netContents: "0.75 L" }, extracted({ netContents: "750 mL" }));
    expect(fields.find((f) => f.field === "netContents")!.status).toBe("match");
  });

  it("rejects a warning statement with altered wording", () => {
    const fields = compareLabelToApplication(
      application,
      extracted({ warningStatementText: "GOVERNMENT WARNING: Drinking alcoholic beverages may cause health problems." })
    );
    expect(fields.find((f) => f.field === "warningStatement")!.status).toBe("mismatch");
  });

  it("flags correct warning wording that isn't capitalized in the header", () => {
    const lowerHeader = STATUTORY_WARNING_TEXT.replace("GOVERNMENT WARNING:", "Government Warning:");
    const fields = compareLabelToApplication(application, extracted({ warningStatementText: lowerHeader }));
    const warning = fields.find((f) => f.field === "warningStatement")!;
    expect(warning.status).toBe("review");
  });

  it("marks a missing field rather than crashing when extraction returns null", () => {
    const fields = compareLabelToApplication(application, extracted({ netContents: null }));
    expect(fields.find((f) => f.field === "netContents")!.status).toBe("missing");
    expect(determineOverallStatus(fields)).toBe("rejected");
  });
});
