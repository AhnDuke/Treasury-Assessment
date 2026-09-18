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

  it("requires at least two images, since the warning is usually on the back", () => {
    const result = rowToImportRow({ ...base, filenames: "front.jpg" }, 4);
    expect("error" in result && result.error).toContain("at least 2 images");
  });

  it("rejects more than five images", () => {
    const result = rowToImportRow({ ...base, filenames: "a.jpg;b.jpg;c.jpg;d.jpg;e.jpg;f.jpg" }, 5);
    expect("error" in result && result.error).toContain("more than 5 images");
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
