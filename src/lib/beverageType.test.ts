import { describe, expect, it } from "vitest";
import { abvRequirement, inferBeverageType, resolveBeverageType } from "./beverageType";

describe("inferBeverageType", () => {
  it("recognises designations from each of the three TTB parts", () => {
    expect(inferBeverageType("Kentucky Straight Bourbon Whiskey")).toBe("spirits");
    expect(inferBeverageType("Cabernet Sauvignon")).toBe("wine");
    expect(inferBeverageType("India Pale Ale")).toBe("malt");
  });

  it("ignores casing and punctuation", () => {
    expect(inferBeverageType("  london dry GIN  ")).toBe("spirits");
  });

  it("finds a known designation inside a longer one", () => {
    expect(inferBeverageType("Kentucky Straight Bourbon Whiskey Bottled in Bond")).toBe("spirits");
  });

  it("returns null rather than guessing at something it doesn't know", () => {
    // A wrong guess silently changes which rules the label is judged against,
    // which is worse than admitting the type is undetermined.
    expect(inferBeverageType("Hard Kombucha")).toBeNull();
    expect(inferBeverageType("")).toBeNull();
  });
});

describe("resolveBeverageType", () => {
  it("prefers a declared type over the inferred one", () => {
    // An agent correcting an unrecognised designation must not be overridden.
    expect(resolveBeverageType("Cabernet Sauvignon", "malt")).toBe("malt");
    expect(resolveBeverageType("Hard Kombucha", "malt")).toBe("malt");
  });

  it("falls back to inference when nothing was declared", () => {
    expect(resolveBeverageType("Cabernet Sauvignon", null)).toBe("wine");
    expect(resolveBeverageType("Cabernet Sauvignon")).toBe("wine");
  });
});

describe("abvRequirement", () => {
  it("always requires alcohol content on distilled spirits", () => {
    // 27 CFR 5.65.
    expect(abvRequirement("spirits", "Bourbon Whiskey", 45).requirement).toBe("required");
    expect(abvRequirement("spirits", "Vodka", 40).requirement).toBe("required");
  });

  it("does not require it on an ordinary malt beverage", () => {
    // 27 CFR 7.63(a)(3): mandatory only where alcohol comes from added
    // nonbeverage flavors. This is the case that was producing a discrepancy
    // on every compliant American beer.
    const rule = abvRequirement("malt", "India Pale Ale", 6.2);
    expect(rule.requirement).toBe("optional");
    expect(rule.reason).toContain("7.63");
  });

  it("requires it on wine by default", () => {
    expect(abvRequirement("wine", "Cabernet Sauvignon", 14.5).requirement).toBe("required");
  });

  it("excuses it on 7 to 14 percent wine designated table or light wine", () => {
    // 27 CFR 4.34: the class designation may stand in for a numerical
    // statement in that band.
    expect(abvRequirement("wine", "Table Wine", 12).requirement).toBe("optional");
    expect(abvRequirement("wine", "Light Wine", 7).requirement).toBe("optional");
    expect(abvRequirement("wine", "Table Wine", 14).requirement).toBe("optional");
  });

  it("still requires it on a table wine outside that band", () => {
    expect(abvRequirement("wine", "Table Wine", 14.5).requirement).toBe("required");
    expect(abvRequirement("wine", "Table Wine", 6.5).requirement).toBe("required");
  });

  it("does not require it when the beverage type could not be determined", () => {
    // Asserting a violation under a rule we could not identify is the failure
    // this whole function exists to prevent.
    const rule = abvRequirement(null, "Hard Kombucha", 5);
    expect(rule.requirement).toBe("optional");
    expect(rule.reason).toContain("could not be determined");
  });
});
