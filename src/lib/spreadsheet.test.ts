import { describe, expect, it } from "vitest";
import { rowToImportRow } from "./spreadsheet";

describe("rowToImportRow", () => {
  it("maps a complete row to an ImportRow", () => {
    const result = rowToImportRow(
      { filename: "label1.jpg", brand_name: "OLD TOM DISTILLERY", class_type: "Bourbon", abv_percent: "45", net_contents: "750 mL" },
      2
    );
    expect(result).toEqual({
      row: {
        filename: "label1.jpg",
        data: { brandName: "OLD TOM DISTILLERY", classType: "Bourbon", abvPercent: 45, netContents: "750 mL" },
      },
    });
  });

  it("errors when filename is missing", () => {
    const result = rowToImportRow({ brand_name: "X", class_type: "Y", abv_percent: "5", net_contents: "1 L" }, 3);
    expect(result).toEqual({ error: 'Row 3: missing "filename".' });
  });

  it("errors when a required application field is missing", () => {
    const result = rowToImportRow({ filename: "a.jpg", brand_name: "X", class_type: "", abv_percent: "5", net_contents: "1 L" }, 4);
    expect("error" in result).toBe(true);
  });

  it("errors when abv_percent isn't a number", () => {
    const result = rowToImportRow(
      { filename: "a.jpg", brand_name: "X", class_type: "Y", abv_percent: "strong", net_contents: "1 L" },
      5
    );
    expect(result).toEqual({ error: 'Row 5 (a.jpg): abv_percent "strong" is not a number.' });
  });
});
