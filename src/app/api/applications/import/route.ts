import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { uploadLabelImage } from "@/lib/blob";
import { mapWithConcurrency } from "@/lib/concurrency";
import { createApplication } from "@/lib/db";
import { isAcceptedImageType, MAX_IMAGE_BYTES } from "@/lib/imageValidation";
import { drainPendingApplications } from "@/lib/processQueue";
import { parseSpreadsheet, rowToImportRow } from "@/lib/spreadsheet";
import type { ApplicationData } from "@/lib/types";

export const runtime = "nodejs";

// Sarah's interview: importers dump "200, 300 label applications" at once.
// This caps well above that while still bounding an unauthenticated endpoint.
const MAX_IMPORT_ROWS = 300;
const UPLOAD_CONCURRENCY = 8;

interface ValidatedRow {
  filename: string;
  data: ApplicationData;
  file: File;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const spreadsheet = formData.get("spreadsheet");
  const imageFiles = formData.getAll("images").filter((entry): entry is File => entry instanceof File);

  if (!(spreadsheet instanceof File)) {
    return NextResponse.json({ error: "Missing spreadsheet file (CSV or XLSX)." }, { status: 400 });
  }
  if (imageFiles.length === 0) {
    return NextResponse.json({ error: "No label images uploaded." }, { status: 400 });
  }

  let records: Record<string, string>[];
  try {
    records = await parseSpreadsheet(Buffer.from(await spreadsheet.arrayBuffer()), spreadsheet.name);
  } catch {
    return NextResponse.json({ error: "Could not parse the spreadsheet. Use a CSV or XLSX file." }, { status: 400 });
  }
  if (records.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `This prototype supports up to ${MAX_IMPORT_ROWS} rows per import.` }, { status: 400 });
  }

  const imagesByFilename = new Map(imageFiles.map((file) => [file.name.trim().toLowerCase(), file]));
  const errors: string[] = [];
  const validRows: ValidatedRow[] = [];

  records.forEach((record, index) => {
    const result = rowToImportRow(record, index + 2); // +2: 1-indexed, plus header row
    if ("error" in result) {
      errors.push(result.error);
      return;
    }
    const file = imagesByFilename.get(result.row.filename.toLowerCase());
    if (!file) {
      errors.push(`Row ${index + 2} (${result.row.filename}): no matching uploaded image.`);
      return;
    }
    if (!isAcceptedImageType(file.type)) {
      errors.push(`Row ${index + 2} (${result.row.filename}): unsupported image type "${file.type || "unknown"}".`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      errors.push(`Row ${index + 2} (${result.row.filename}): image exceeds 8MB.`);
      return;
    }
    validRows.push({ filename: result.row.filename, data: result.row.data, file });
  });

  const importBatchId = randomUUID();
  let created = 0;

  await mapWithConcurrency(validRows, UPLOAD_CONCURRENCY, async ({ filename, data, file }) => {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const imageUrl = await uploadLabelImage(buffer, filename, file.type);
      await createApplication(data, { url: imageUrl, filename, contentType: file.type }, "pending", importBatchId);
      created += 1;
    } catch (err) {
      errors.push(`${filename}: ${err instanceof Error ? err.message : "failed to import."}`);
    }
  });

  if (created > 0) {
    after(() => drainPendingApplications());
  }

  return NextResponse.json({ importBatchId, created, errors });
}
