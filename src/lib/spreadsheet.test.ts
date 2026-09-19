import { describe, expect, it } from "vitest";
import { rowToImportRow } from "./spreadsheet";

const base = { brand_name: "OLD TOM DISTILLERY", class_type: "Bourbon", abv_percent: "45", net_contents: "750 mL" };

describe("rowToImportRow", () => {
  it("splits semicolon-separated filenames into an ordered list", () => {
    const result = rowToImportRow({ ...base, filenames: "front.jpg; back.jpg" }, 2);
    expect(result).toEqual({
      row: {
        filenames: ["front.jpg", "back.jpg"],
        data: { brandName: "OLD TOM DISTILLERY", classType: "Bourbon", abvPercent: 45, netContents: "750 mL" },
      },
    });
  });

  it("errors when filenames are missing entirely", () => {
    const result = rowToImportRow({ ...base }, 3);
    expect(result).toEqual({ error: 'Row 3: missing "filenames".' });
  });

  it("accepts a single filename, which may be a composite front-and-back photo", () => {
    const result = rowToImportRow({ ...base, filenames: "front-and-back.jpg" }, 4);
    expect(result).toEqual({
      row: {
        filenames: ["front-and-back.jpg"],
        data: { brandName: "OLD TOM DISTILLERY", classType: "Bourbon", abvPercent: 45, netContents: "750 mL" },
      },
    });
  });

  it("rejects more than three images", () => {
    const result = rowToImportRow({ ...base, filenames: "a.jpg;b.jpg;c.jpg;d.jpg" }, 5);
    expect("error" in result && result.error).toContain("more than 3 images");
  });

  it("errors when a required application field is missing", () => {
    const result = rowToImportRow({ ...base, class_type: "", filenames: "a.jpg;b.jpg" }, 6);
    expect("error" in result).toBe(true);
  });

  it("errors when abv_percent isn't a number", () => {
    const result = rowToImportRow({ ...base, abv_percent: "strong", filenames: "a.jpg;b.jpg" }, 7);
    expect("error" in result && result.error).toContain("is not a number");
  });
});
