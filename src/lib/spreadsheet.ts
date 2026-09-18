import ExcelJS from "exceljs";
import { parseCsv } from "./csv";
import { MAX_IMAGES_PER_APPLICATION, MIN_IMAGES_PER_APPLICATION, type ApplicationData } from "./types";

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
  filenames: string[];
  data: ApplicationData;
}

/**
 * Validates and maps one lowercase-keyed spreadsheet record into an
 * ImportRow. Pure and library-agnostic (works the same for a row that came
 * from CSV or XLSX) so it's unit-testable without a real file.
 */
export function rowToImportRow(row: Record<string, string>, rowIndex: number): { row: ImportRow } | { error: string } {
  // `filenames` is semicolon-separated (a comma would collide with CSV
  // delimiters). The legacy single `filename` column still works.
  const rawFilenames = row.filenames?.trim() || row.filename?.trim() || "";
  const filenames = rawFilenames
    .split(";")
    .map((name) => name.trim())
    .filter(Boolean);

  const brandName = row.brand_name?.trim();
  const classType = row.class_type?.trim();
  const abvPercentRaw = row.abv_percent?.trim();
  const netContents = row.net_contents?.trim();

  if (filenames.length === 0) return { error: `Row ${rowIndex}: missing "filenames".` };
  const label = filenames.join(", ");
  if (filenames.length < MIN_IMAGES_PER_APPLICATION) {
    return { error: `Row ${rowIndex} (${label}): needs at least ${MIN_IMAGES_PER_APPLICATION} images (front and back), separated by ";".` };
  }
  if (filenames.length > MAX_IMAGES_PER_APPLICATION) {
    return { error: `Row ${rowIndex} (${label}): more than ${MAX_IMAGES_PER_APPLICATION} images.` };
  }
  if (!brandName || !classType || !abvPercentRaw || !netContents) {
    return { error: `Row ${rowIndex} (${label}): missing brand_name, class_type, abv_percent, or net_contents.` };
  }
  const abvPercent = parseFloat(abvPercentRaw);
  if (Number.isNaN(abvPercent)) {
    return { error: `Row ${rowIndex} (${label}): abv_percent "${abvPercentRaw}" is not a number.` };
  }

  return { row: { filenames, data: { brandName, classType, abvPercent, netContents } } };
}
