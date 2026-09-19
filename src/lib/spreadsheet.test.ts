import { describe, expect, it } from "vitest";
import { rowToImportRow } from "./spreadsheet";

const base = { brand_name: "OLD TOM DISTILLERY", class_type: "Bourbon", abv_percent: "45", net_contents: "750 mL" };

describe("rowToImportRow", () => {
  it("maps a row to application data and keeps its row number", () => {
    const result = rowToImportRow({ ...base }, 2);
    expect(result).toEqual({
      row: {
        rowNumber: 2,
        data: { brandName: "OLD TOM DISTILLERY", classType: "Bourbon", abvPercent: 45, netContents: "750 mL" },
        suggestedFilenames: [],
      },
    });
  });

  it("accepts a sheet with no filenames column at all", () => {
    // Photos are attached per row in the UI now, so a sheet that names no
    // files is the normal case rather than an error.
    const result = rowToImportRow({ ...base }, 3);
    expect("error" in result).toBe(false);
  });

  it("carries semicolon-separated filenames through as a hint", () => {
    const result = rowToImportRow({ ...base, filenames: "front.jpg; back.jpg" }, 4);
    expect("row" in result && result.row.suggestedFilenames).toEqual(["front.jpg", "back.jpg"]);
  });

  it("still reads the legacy single filename column", () => {
    const result = rowToImportRow({ ...base, filename: "front.jpg" }, 5);
    expect("row" in result && result.row.suggestedFilenames).toEqual(["front.jpg"]);
  });

  it("does not reject a row for naming more files than an application may carry", () => {
    // The hint is not a constraint — the count that matters is how many
    // photos the agent actually attaches, which is checked at submit time.
    const result = rowToImportRow({ ...base, filenames: "a.jpg;b.jpg;c.jpg;d.jpg;e.jpg" }, 6);
    expect("error" in result).toBe(false);
  });

  it("errors when a required application field is missing", () => {
    const result = rowToImportRow({ ...base, class_type: "" }, 7);
    expect("error" in result && result.error).toContain("Row 7");
  });

  it("errors when abv_percent isn't a number", () => {
    const result = rowToImportRow({ ...base, abv_percent: "strong" }, 8);
    expect("error" in result && result.error).toContain("is not a number");
  });
});
