import { NextRequest, NextResponse } from "next/server";
import { parseCsv } from "@/lib/csv";
import { isAcceptedImageType, MAX_IMAGE_BYTES } from "@/lib/imageValidation";
import type { ApplicationData, VerificationResult } from "@/lib/types";
import { verifyLabel } from "@/lib/verify";

export const runtime = "nodejs";

// Demo-scale batch, not the 200-300 label imports Sarah described — see
// README trade-offs. A production batch would queue work instead of holding
// every file in one request.
const MAX_BATCH_FILES = 25;
const CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function rowToApplicationData(row: Record<string, string>): ApplicationData {
  return {
    brandName: row.brand_name ?? "",
    classType: row.class_type ?? "",
    abvPercent: parseFloat(row.abv_percent ?? ""),
    netContents: row.net_contents ?? "",
  };
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const csvFile = formData.get("csv");
  const imageFiles = formData.getAll("images").filter((entry): entry is File => entry instanceof File);

  if (!(csvFile instanceof File)) {
    return NextResponse.json({ error: "Missing application data CSV." }, { status: 400 });
  }
  if (imageFiles.length === 0) {
    return NextResponse.json({ error: "No label images uploaded." }, { status: 400 });
  }
  if (imageFiles.length > MAX_BATCH_FILES) {
    return NextResponse.json({ error: `This prototype supports up to ${MAX_BATCH_FILES} labels per batch.` }, { status: 400 });
  }

  let rows: Record<string, string>[];
  try {
    rows = parseCsv(await csvFile.text());
  } catch {
    return NextResponse.json({ error: "Could not parse the CSV file." }, { status: 400 });
  }

  const expectedByFileName = new Map<string, ApplicationData>();
  for (const row of rows) {
    if (row.filename) {
      expectedByFileName.set(row.filename.trim().toLowerCase(), rowToApplicationData(row));
    }
  }

  const results = await mapWithConcurrency(imageFiles, CONCURRENCY, async (file): Promise<VerificationResult> => {
    const expected = expectedByFileName.get(file.name.trim().toLowerCase());
    if (!expected) {
      return { fileName: file.name, overallStatus: "rejected", fields: [], processingTimeMs: 0, error: "No matching row in the CSV for this filename." };
    }
    const mediaType = file.type;
    if (!isAcceptedImageType(mediaType)) {
      return { fileName: file.name, overallStatus: "rejected", fields: [], processingTimeMs: 0, error: `Unsupported image type: ${mediaType || "unknown"}.` };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { fileName: file.name, overallStatus: "rejected", fields: [], processingTimeMs: 0, error: "Image too large (max 8MB)." };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    return verifyLabel(buffer.toString("base64"), mediaType, expected, file.name);
  });

  return NextResponse.json({ results });
}
