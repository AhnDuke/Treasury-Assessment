import ExcelJS from "exceljs";
import { parseCsv } from "./csv";
import { isBeverageType } from "./beverageType";
import type { ApplicationData } from "./types";

/** Parses a CSV or XLSX buffer into lowercase-keyed records, one per data row. */
export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<Record<string, string>[]> {
  if (filename.toLowerCase().endsWith(".csv")) {
    return parseCsv(buffer.toString("utf8"));
  }

  const workbook = new ExcelJS.Workbook();
  // exceljs's own .d.ts declares a minimal global `Buffer extends ArrayBuffer
  // {}` shim (so its types work without @types/node), which collides with
  // @types/node's real, richer Buffer type - a known exceljs typing issue,
  // not a real incompatibility. Identical at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  let header: string[] = [];
  const records: Record<string, string>[] = [];

  worksheet.eachRow((row, rowNumber) => {
    const values = (row.values as unknown[]).slice(1).map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim()));
    if (rowNumber === 1) {
      header = values.map((cell) => cell.toLowerCase());
      return;
    }
    if (values.every((cell) => cell === "")) return;
    const record: Record<string, string> = {};
    header.forEach((key, i) => {
      record[key] = values[i] ?? "";
    });
    records.push(record);
  });

  return records;
}

export interface ImportRow {
  rowNumber: number;
  data: ApplicationData;
  /**
   * Filenames the sheet suggests for this row, if it carries a `filenames`
   * column. Purely a hint shown to the agent so they know which files to
   * pick - the app never resolves them, because the photos are attached by
   * hand per row. A sheet without the column is perfectly valid.
   */
  suggestedFilenames: string[];
}

/**
 * Validates and maps one lowercase-keyed spreadsheet record into an
 * ImportRow. Pure and library-agnostic (works the same for a row that came
 * from CSV or XLSX) so it's unit-testable without a real file.
 *
 * Note what is NOT validated here: images. An imported row carries only the
 * application data, and the agent attaches its photos while reviewing the row
 * - so a sheet that names no files is not an error, and the image count is
 * enforced at submit time instead.
 */
export function rowToImportRow(row: Record<string, string>, rowNumber: number): { row: ImportRow } | { error: string } {
  // Semicolon-separated, because a comma would collide with CSV delimiters.
  // The legacy single `filename` column is still read.
  const rawFilenames = row.filenames?.trim() || row.filename?.trim() || "";
  const suggestedFilenames = rawFilenames
    .split(";")
    .map((name) => name.trim())
    .filter(Boolean);

  const brandName = row.brand_name?.trim();
  const classType = row.class_type?.trim();
  const abvPercentRaw = row.abv_percent?.trim();
  const netContents = row.net_contents?.trim();
  // Optional. Left null when absent or unrecognised, so the class/type
  // designation decides instead of a typo silently picking the wrong rules.
  const declaredType = row.beverage_type?.trim().toLowerCase();
  const beverageType = isBeverageType(declaredType) ? declaredType : null;

  if (!brandName || !classType || !abvPercentRaw || !netContents) {
    return { error: `Row ${rowNumber}: missing brand_name, class_type, abv_percent, or net_contents.` };
  }
  const abvPercent = parseFloat(abvPercentRaw);
  if (Number.isNaN(abvPercent)) {
    return { error: `Row ${rowNumber}: abv_percent "${abvPercentRaw}" is not a number.` };
  }

  return { row: { rowNumber, data: { brandName, classType, abvPercent, netContents, beverageType }, suggestedFilenames } };
}
