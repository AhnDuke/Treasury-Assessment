import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses headers and rows into lowercase-keyed records", () => {
    const rows = parseCsv("filename,brand_name,abv_percent\nlabel1.jpg,OLD TOM,45\n");
    expect(rows).toEqual([{ filename: "label1.jpg", brand_name: "OLD TOM", abv_percent: "45" }]);
  });

  it("handles quoted fields containing commas", () => {
    const rows = parseCsv('filename,class_type\nlabel1.jpg,"Bourbon, Straight"\n');
    expect(rows[0].class_type).toBe("Bourbon, Straight");
  });

  it("skips blank trailing lines", () => {
    const rows = parseCsv("filename,brand_name\nlabel1.jpg,A\n\n");
    expect(rows).toHaveLength(1);
  });
});
