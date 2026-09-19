import { describe, expect, it } from "vitest";
import { compareLabelToApplication, determineTriageStatus } from "./comparison";
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
    backLabelVisible: true,
    ...overrides,
  };
}

describe("compareLabelToApplication", () => {
  it("approves a label that matches the application exactly", () => {
    const fields = compareLabelToApplication(application, extracted());
    expect(fields.every((f) => f.status === "match")).toBe(true);
    expect(determineTriageStatus(fields)).toBe("clean");
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
    expect(determineTriageStatus(fields)).toBe("clean");
  });

  it("flags a near-miss spelling as needing review rather than auto-rejecting", () => {
    const fields = compareLabelToApplication(
      application,
      extracted({ classType: "Kentucky Straight Bourban Whiskey" })
    );
    const classType = fields.find((f) => f.field === "classType")!;
    expect(classType.status).toBe("review");
    expect(determineTriageStatus(fields)).toBe("review");
  });

  it("rejects an ABV outside tolerance", () => {
    const fields = compareLabelToApplication(application, extracted({ abvPercent: 40 }));
    const abv = fields.find((f) => f.field === "abvPercent")!;
    expect(abv.status).toBe("mismatch");
    expect(determineTriageStatus(fields)).toBe("discrepancy");
  });

  it("accepts net contents expressed in different but equivalent units", () => {
    const fields = compareLabelToApplication({ ...application, netContents: "0.75 L" }, extracted({ netContents: "750 mL" }));
    expect(fields.find((f) => f.field === "netContents")!.status).toBe("match");
  });

  it("flags a near-perfect warning read as review, not a mismatch", () => {
    // One dropped character is a transcription artifact, not a label defect —
    // treating it as a violation is what produced false "incorrect warning"
    // reports.
    const typo = STATUTORY_WARNING_TEXT.replace("birth defects", "birth defect");
    const fields = compareLabelToApplication(application, extracted({ warningStatementText: typo }));
    const warning = fields.find((f) => f.field === "warningStatement")!;
    expect(warning.status).toBe("review");
    expect(warning.detail).toContain("transcription");
  });

  it("still rejects a warning statement with genuinely altered wording", () => {
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
    expect(determineTriageStatus(fields)).toBe("discrepancy");
  });

  it("reports a missing warning as an evidence gap when no back view was supplied", () => {
    // A single front photo genuinely doesn't contain the warning. Calling
    // that a violation is what manufactured false "missing warning" reports.
    const fields = compareLabelToApplication(
      application,
      extracted({ warningStatementText: null, backLabelVisible: false })
    );
    const warning = fields.find((f) => f.field === "warningStatement")!;
    expect(warning.status).toBe("not_shown");
    expect(warning.detail).toContain("back");
  });

  it("reports a missing warning as a genuine omission when a back view was supplied", () => {
    const fields = compareLabelToApplication(
      application,
      extracted({ warningStatementText: null, backLabelVisible: true })
    );
    expect(fields.find((f) => f.field === "warningStatement")!.status).toBe("missing");
  });
});

describe("determineTriageStatus", () => {
  it("separates a clean read from one needing attention from one with a hard discrepancy", () => {
    // These three values are the AI's triage signal, never a decision — an
    // agent's approve/reject is recorded separately. Keeping the vocabularies
    // apart is the point of the names.
    expect(determineTriageStatus(compareLabelToApplication(application, extracted()))).toBe("clean");
    expect(
      determineTriageStatus(
        compareLabelToApplication(application, extracted({ classType: "Kentucky Straight Bourban Whiskey" }))
      )
    ).toBe("review");
    expect(
      determineTriageStatus(compareLabelToApplication(application, extracted({ abvPercent: 40 })))
    ).toBe("discrepancy");
  });

  it("routes an unphotographed field to attention, not to a discrepancy", () => {
    const fields = compareLabelToApplication(
      application,
      extracted({ warningStatementText: null, backLabelVisible: false })
    );
    expect(determineTriageStatus(fields)).toBe("review");
  });
});
