import { describe, expect, it } from "vitest";
import { compareLabelToApplication, determineTriageStatus } from "./comparison";
import { STATUTORY_WARNING_TEXT } from "./warningStatement";
import type { ApplicationData, ExtractedLabelData } from "./types";

const application: ApplicationData = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  abvPercent: 45,
  netContents: "750 mL",
  bottlerInfo: "Old Tom Distillery, Bardstown, KY",
};

function extracted(overrides: Partial<ExtractedLabelData> = {}): ExtractedLabelData {
  return {
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    abvPercent: 45,
    netContents: "750 mL",
    bottlerInfo: "Bottled by Old Tom Distillery Bardstown KY",
    countryOfOrigin: null,
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
    // Dave's example: "STONE'S THROW" vs "Stone's Throw" - technically not an
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
    // One dropped character is a transcription artifact, not a label defect -
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
    // These three values are the AI's triage signal, never a decision - an
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

describe("alcohol content by beverage type", () => {
  it("does not flag a compliant beer that states no alcohol content", () => {
    // 27 CFR 7.63: a malt beverage need not state its ABV. Reporting its
    // absence as a discrepancy invented a rule, and flagged every ordinary
    // American beer.
    const fields = compareLabelToApplication(
      { brandName: "STONE'S THROW", classType: "India Pale Ale", abvPercent: 6.2, netContents: "355 mL", bottlerInfo: "Old Tom Distillery, Bardstown, KY" },
      extracted({ brandName: "STONE'S THROW", classType: "India Pale Ale", abvPercent: null, netContents: "355 mL" })
    );
    const abv = fields.find((f) => f.field === "abvPercent")!;
    expect(abv.status).toBe("not_required");
    expect(determineTriageStatus(fields)).toBe("clean");
  });

  it("still flags distilled spirits that state no alcohol content", () => {
    const fields = compareLabelToApplication(
      { ...application, abvPercent: 45 },
      extracted({ abvPercent: null })
    );
    const abv = fields.find((f) => f.field === "abvPercent")!;
    expect(abv.status).toBe("missing");
    expect(determineTriageStatus(fields)).toBe("discrepancy");
  });

  it("excuses a table wine between 7 and 14 percent", () => {
    const fields = compareLabelToApplication(
      { brandName: "RIVERBEND CELLARS", classType: "Table Wine", abvPercent: 12, netContents: "750 mL", bottlerInfo: "Old Tom Distillery, Bardstown, KY" },
      extracted({ brandName: "RIVERBEND CELLARS", classType: "Table Wine", abvPercent: null, netContents: "750 mL" })
    );
    expect(fields.find((f) => f.field === "abvPercent")!.status).toBe("not_required");
  });

  it("still compares the numbers when the label does state an alcohol content", () => {
    // The exemption is only about absence. A stated value that disagrees is
    // still a discrepancy, whatever the beverage type.
    const fields = compareLabelToApplication(
      { brandName: "STONE'S THROW", classType: "India Pale Ale", abvPercent: 6.2, netContents: "355 mL", bottlerInfo: "Old Tom Distillery, Bardstown, KY" },
      extracted({ brandName: "STONE'S THROW", classType: "India Pale Ale", abvPercent: 9.1, netContents: "355 mL", bottlerInfo: "Old Tom Distillery, Bardstown, KY" })
    );
    expect(fields.find((f) => f.field === "abvPercent")!.status).toBe("mismatch");
  });

  it("honours a declared beverage type over the class/type designation", () => {
    const fields = compareLabelToApplication(
      { brandName: "NEW THING", classType: "Hard Kombucha", abvPercent: 45, netContents: "750 mL", bottlerInfo: "Old Tom Distillery, Bardstown, KY", beverageType: "spirits" },
      extracted({ brandName: "NEW THING", classType: "Hard Kombucha", abvPercent: null, netContents: "750 mL" })
    );
    expect(fields.find((f) => f.field === "abvPercent")!.status).toBe("missing");
  });
});

describe("name and address of bottler/producer", () => {
  it("ignores the lead-in phrase the regulations require", () => {
    // A label must say "Bottled by ..."; an application almost never repeats
    // the phrase. Comparing raw strings penalised the label for wording the
    // rules demand.
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: "Old Tom Distillery, Bardstown, KY" },
      extracted({ bottlerInfo: "Distilled and bottled by Old Tom Distillery Bardstown KY" })
    );
    expect(fields.find((f) => f.field === "bottlerInfo")!.status).toBe("match");
  });

  it("strips a lead-in that names where the product was made", () => {
    // Real labels write "Distilled in Scotland and imported by ...". A fixed
    // list of known phrases missed that shape and reported a mismatch against
    // an application that simply named the company.
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: "Kestrel Hill Imports Boston MA" },
      extracted({ bottlerInfo: "Distilled in Scotland and imported by Kestrel Hill Imports Boston MA" })
    );
    expect(fields.find((f) => f.field === "bottlerInfo")!.status).toBe("match");
  });

  it("leaves a name alone when the opening clause is not a production statement", () => {
    // Guard on the stripper: it only removes a clause that reads like one.
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: "Goodbye Spirits Co Denver CO" },
      extracted({ bottlerInfo: "Goodbye Spirits Co Denver CO" })
    );
    expect(fields.find((f) => f.field === "bottlerInfo")!.status).toBe("match");
  });

  it("reports a label carrying no name and address as a violation", () => {
    // Mandatory on every label, whatever the beverage type.
    const fields = compareLabelToApplication(application, extracted({ bottlerInfo: null }));
    expect(fields.find((f) => f.field === "bottlerInfo")!.status).toBe("missing");
    expect(determineTriageStatus(fields)).toBe("discrepancy");
  });

  it("asks for confirmation when the application left it blank", () => {
    // The label meets the requirement, but there is nothing to check it
    // against, and an agent has no other way to notice the blank.
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: null },
      extracted({ bottlerInfo: "Bottled by Old Tom Distillery Bardstown KY" })
    );
    const field = fields.find((f) => f.field === "bottlerInfo")!;
    expect(field.status).toBe("review");
    expect(field.detail).toContain("didn't state this");
  });

  it("flags a genuinely different bottler", () => {
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: "Old Tom Distillery, Bardstown, KY" },
      extracted({ bottlerInfo: "Bottled by Summit Crossing Reserve, Portland, OR" })
    );
    expect(fields.find((f) => f.field === "bottlerInfo")!.status).toBe("mismatch");
  });
});

describe("country of origin", () => {
  it("is not checked at all for a domestic product", () => {
    // Only imports must state it. Emitting a non-finding for every domestic
    // label would be noise dressed up as a check.
    const fields = compareLabelToApplication(application, extracted({ countryOfOrigin: null }));
    expect(fields.some((f) => f.field === "countryOfOrigin")).toBe(false);
  });

  it("matches when the label wraps the country in the usual phrasing", () => {
    const fields = compareLabelToApplication(
      { ...application, countryOfOrigin: "Mexico" },
      extracted({ countryOfOrigin: "Product of Mexico" })
    );
    expect(fields.find((f) => f.field === "countryOfOrigin")!.status).toBe("match");
  });

  it("reports an import whose label states no country of origin", () => {
    const fields = compareLabelToApplication(
      { ...application, countryOfOrigin: "Scotland" },
      extracted({ countryOfOrigin: null })
    );
    expect(fields.find((f) => f.field === "countryOfOrigin")!.status).toBe("missing");
  });

  it("flags the wrong country", () => {
    const fields = compareLabelToApplication(
      { ...application, countryOfOrigin: "Scotland" },
      extracted({ countryOfOrigin: "Product of Canada" })
    );
    expect(fields.find((f) => f.field === "countryOfOrigin")!.status).toBe("mismatch");
  });
});

describe("evidence gaps beyond the warning statement", () => {
  it("does not call a missing bottler a violation when only the front was photographed", () => {
    // Same reasoning as the Government Warning: the name and address is small
    // print on the back, so a front-only photo cannot establish its absence.
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: "Old Tom Distillery, Bardstown, KY" },
      extracted({ bottlerInfo: null, warningStatementText: null, backLabelVisible: false })
    );
    expect(fields.find((f) => f.field === "bottlerInfo")!.status).toBe("not_shown");
    expect(determineTriageStatus(fields)).toBe("review");
  });

  it("still calls it a violation when a back view was supplied and carries none", () => {
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: "Old Tom Distillery, Bardstown, KY" },
      extracted({ bottlerInfo: null, backLabelVisible: true })
    );
    expect(fields.find((f) => f.field === "bottlerInfo")!.status).toBe("missing");
    expect(determineTriageStatus(fields)).toBe("discrepancy");
  });

  it("applies the same rule to country of origin on an import", () => {
    const fields = compareLabelToApplication(
      { ...application, countryOfOrigin: "Scotland" },
      extracted({ countryOfOrigin: null, warningStatementText: null, backLabelVisible: false })
    );
    expect(fields.find((f) => f.field === "countryOfOrigin")!.status).toBe("not_shown");
  });
});

describe("a front-only photo cannot support a hard finding on back-label print", () => {
  it("downgrades a bottler mismatch to review when no back view was supplied", () => {
    // A front-only photo often offers up something else as the name and
    // address, such as the town printed under the brand. Calling that a
    // violation asserts a finding about text nobody photographed.
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: "Old Tom Distillery, Bardstown, KY" },
      extracted({ bottlerInfo: "Bardstown Kentucky", warningStatementText: null, backLabelVisible: false })
    );
    const field = fields.find((f) => f.field === "bottlerInfo")!;
    expect(field.status).toBe("review");
    expect(field.detail).toContain("back");
  });

  it("keeps it a mismatch when a back view was supplied", () => {
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: "Old Tom Distillery, Bardstown, KY" },
      extracted({ bottlerInfo: "Bottled by Summit Crossing Reserve Portland OR", backLabelVisible: true })
    );
    expect(fields.find((f) => f.field === "bottlerInfo")!.status).toBe("mismatch");
  });
});

describe("formatting differences that are not defects", () => {
  it("accepts the name and address a label is required to write", () => {
    // Reported from a real run as an 82% mismatch. The company and the address
    // are identical; every difference is either the production phrase the
    // regulations require, the article in front of it, or how a person
    // abbreviates a state.
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: "Smirnoff Co, New York, NY" },
      extracted({ bottlerInfo: "PRODUCED BY THE SMIRNOFF CO., NEW YORK, N.Y." })
    );
    expect(fields.find((f) => f.field === "bottlerInfo")!.status).toBe("match");
  });

  it("accepts a country written a different way", () => {
    const fields = compareLabelToApplication(
      { ...application, countryOfOrigin: "USA" },
      extracted({ countryOfOrigin: "MADE IN AMERICA" })
    );
    expect(fields.find((f) => f.field === "countryOfOrigin")!.status).toBe("match");
    expect(determineTriageStatus(fields)).toBe("clean");
  });

  it("does not let that leniency accept the wrong country", () => {
    const fields = compareLabelToApplication(
      { ...application, countryOfOrigin: "USA" },
      extracted({ countryOfOrigin: "Product of Mexico" })
    );
    expect(fields.find((f) => f.field === "countryOfOrigin")!.status).toBe("mismatch");
  });

  it("does not let that leniency accept the wrong bottler", () => {
    const fields = compareLabelToApplication(
      { ...application, bottlerInfo: "Smirnoff Co, New York, NY" },
      extracted({ bottlerInfo: "PRODUCED BY THE SUMMIT CROSSING CO., PORTLAND, OR." })
    );
    expect(fields.find((f) => f.field === "bottlerInfo")!.status).toBe("mismatch");
  });
});
