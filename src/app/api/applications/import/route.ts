import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { mapWithConcurrency } from "@/lib/concurrency";
import { createApplication } from "@/lib/db";
import { isAcceptedImageType } from "@/lib/imageValidation";
import { drainPendingApplications } from "@/lib/processQueue";
import { parseSpreadsheet, rowToImportRow } from "@/lib/spreadsheet";
import type { ApplicationData, LabelImage } from "@/lib/types";

export const runtime = "nodejs";

// Sarah's interview: importers dump "200, 300 label applications" at once.
// This caps well above that while still bounding an unauthenticated endpoint.
const MAX_IMPORT_ROWS = 300;
const INSERT_CONCURRENCY = 8;

interface ValidatedRow {
  data: ApplicationData;
  images: LabelImage[];
}

/**
 * Takes a spreadsheet plus the metadata for images the browser has already
 * uploaded to Blob (see the upload-token route) — the image bytes never pass
 * through here, which is what keeps a 300-row import under Vercel's 4.5MB
 * request body cap.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const spreadsheet = formData.get("spreadsheet");
  const imagesJson = formData.get("images");

  if (!(spreadsheet instanceof File)) {
    return NextResponse.json({ error: "Missing spreadsheet file (CSV or XLSX)." }, { status: 400 });
  }

  let uploaded: LabelImage[];
  try {
    const parsed = JSON.parse(typeof imagesJson === "string" ? imagesJson : "[]");
    uploaded = (Array.isArray(parsed) ? parsed : []).filter(
      (image) => typeof image?.url === "string" && typeof image?.filename === "string" && isAcceptedImageType(image?.contentType)
    );
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded image list." }, { status: 400 });
  }
  if (uploaded.length === 0) {
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

  const imagesByFilename = new Map(uploaded.map((image) => [image.filename.trim().toLowerCase(), image]));
  const errors: string[] = [];
  const validRows: ValidatedRow[] = [];

  records.forEach((record, index) => {
    const result = rowToImportRow(record, index + 2); // +2: 1-indexed, plus header row
    if ("error" in result) {
      errors.push(result.error);
      return;
    }
    const images: LabelImage[] = [];
    const missing: string[] = [];
    for (const filename of result.row.filenames) {
      const image = imagesByFilename.get(filename.toLowerCase());
      if (image) images.push(image);
      else missing.push(filename);
    }
    if (missing.length > 0) {
      errors.push(`Row ${index + 2}: no uploaded image matching ${missing.join(", ")}.`);
      return;
    }
    validRows.push({ data: result.row.data, images });
  });

  const importBatchId = randomUUID();
  let created = 0;

  await mapWithConcurrency(validRows, INSERT_CONCURRENCY, async ({ data, images }) => {
    try {
      await createApplication(data, images, "pending", importBatchId);
      created += 1;
    } catch (err) {
      errors.push(`${images[0]?.filename ?? "row"}: ${err instanceof Error ? err.message : "failed to import."}`);
    }
  });

  if (created > 0) {
    after(() => drainPendingApplications());
  }

  return NextResponse.json({ importBatchId, created, errors });
}
