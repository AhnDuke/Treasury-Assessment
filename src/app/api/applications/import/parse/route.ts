import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { parseSpreadsheet, rowToImportRow, type ImportRow } from "@/lib/spreadsheet";

export const runtime = "nodejs";

// Sarah's interview: importers dump "200, 300 label applications" at once.
// This caps well above that while still bounding an unauthenticated endpoint.
const MAX_IMPORT_ROWS = 300;

/**
 * Reads a spreadsheet and hands back the rows for an agent to work through.
 * Creates nothing: an imported application is only written once the agent has
 * attached its photos and submitted that row, which is why this endpoint
 * takes no images and the batch id it mints is just a grouping key the client
 * carries into each submit.
 *
 * Only the sheet travels here, never image bytes, so the 4.5MB Vercel request
 * cap is not a concern even at 300 rows.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const spreadsheet = formData.get("spreadsheet");

  if (!(spreadsheet instanceof File)) {
    return NextResponse.json({ error: "Choose a CSV or XLSX file to import." }, { status: 400 });
  }

  let records: Record<string, string>[];
  try {
    records = await parseSpreadsheet(Buffer.from(await spreadsheet.arrayBuffer()), spreadsheet.name);
  } catch {
    return NextResponse.json({ error: "Could not read that spreadsheet. Use a CSV or XLSX file." }, { status: 400 });
  }

  if (records.length === 0) {
    return NextResponse.json({ error: "That spreadsheet has no data rows." }, { status: 400 });
  }
  if (records.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `This prototype supports up to ${MAX_IMPORT_ROWS} rows per import. That sheet has ${records.length}.` },
      { status: 400 }
    );
  }

  const rows: ImportRow[] = [];
  const errors: string[] = [];

  records.forEach((record, index) => {
    // +2: spreadsheet rows are 1-indexed and the first one is the header, so
    // the number here is what the agent sees in their own spreadsheet.
    const result = rowToImportRow(record, index + 2);
    if ("error" in result) errors.push(result.error);
    else rows.push(result.row);
  });

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No usable rows in that spreadsheet.", errors },
      { status: 400 }
    );
  }

  return NextResponse.json({ importBatchId: randomUUID(), rows, errors });
}
