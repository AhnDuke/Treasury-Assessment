import { describe, expect, it } from "vitest";
import { canonicalCountry, collapseInitialisms, normalizeNameAddress, stripNameAddressLeadIn } from "./labelText";

describe("normalizeNameAddress", () => {
  it("reconciles the wording a label requires with the wording a person types", () => {
    // The case that prompted this: reported as an 82% mismatch, when the
    // company and the address are identical and every difference is either
    // required by the regulations or an ordinary abbreviation.
    expect(normalizeNameAddress("PRODUCED BY THE SMIRNOFF CO., NEW YORK, N.Y.")).toBe(
      normalizeNameAddress("Smirnoff Co, New York, NY")
    );
  });

  it("ignores which production phrase the label uses", () => {
    const application = "Old Tom Distillery, Bardstown, KY";
    for (const label of [
      "Bottled by Old Tom Distillery, Bardstown, KY",
      "Distilled and bottled by Old Tom Distillery, Bardstown, KY",
      "Distilled in Kentucky and imported by Old Tom Distillery, Bardstown, KY",
    ]) {
      expect(normalizeNameAddress(label)).toBe(normalizeNameAddress(application));
    }
  });

  it("treats spelled-out and abbreviated corporate forms as the same", () => {
    expect(normalizeNameAddress("Kestrel Hill Company")).toBe(normalizeNameAddress("Kestrel Hill Co"));
    expect(normalizeNameAddress("Riverbend Incorporated")).toBe(normalizeNameAddress("Riverbend Inc."));
  });

  it("still tells two different companies apart", () => {
    expect(normalizeNameAddress("Bottled by Old Tom Distillery, Bardstown, KY")).not.toBe(
      normalizeNameAddress("Summit Crossing Reserve, Portland, OR")
    );
  });

  it("does not drop a leading word that is part of the name", () => {
    // "The" is dropped as an article, but nothing else is.
    expect(normalizeNameAddress("Theodore Spirits Co")).toContain("theodore");
  });
});

describe("collapseInitialisms", () => {
  it("rejoins letters that punctuation stripping separated", () => {
    expect(collapseInitialisms("new york n y")).toBe("new york ny");
    expect(collapseInitialisms("washington d c")).toBe("washington dc");
  });

  it("leaves ordinary words alone", () => {
    expect(collapseInitialisms("old tom distillery")).toBe("old tom distillery");
  });
});

describe("stripNameAddressLeadIn", () => {
  it("leaves a name whose opening clause is not a production statement", () => {
    expect(stripNameAddressLeadIn("Goodbye Spirits Co Denver CO")).toBe("Goodbye Spirits Co Denver CO");
  });
});

describe("canonicalCountry", () => {
  it("resolves the names that mean the United States", () => {
    // The second case from the same screenshot: "USA" on the application was
    // reported as disagreeing with "MADE IN AMERICA" on the label.
    const target = canonicalCountry("USA");
    for (const written of ["MADE IN AMERICA", "Product of the USA", "United States of America", "U.S.A."]) {
      expect(canonicalCountry(written)).toBe(target);
    }
  });

  it("strips the phrase a label wraps a country in", () => {
    expect(canonicalCountry("Product of Mexico")).toBe(canonicalCountry("Mexico"));
    expect(canonicalCountry("Distilled in Scotland")).toBe(canonicalCountry("Scotland"));
    expect(canonicalCountry("Imported from Japan")).toBe(canonicalCountry("Japan"));
  });

  it("still tells two different countries apart", () => {
    expect(canonicalCountry("Product of Mexico")).not.toBe(canonicalCountry("Product of Canada"));
    expect(canonicalCountry("Scotland")).not.toBe(canonicalCountry("Ireland"));
  });

  it("returns an empty string for nothing usable, rather than a false match", () => {
    expect(canonicalCountry("   ")).toBe("");
    expect(canonicalCountry("Product of")).toBe("");
  });
});
