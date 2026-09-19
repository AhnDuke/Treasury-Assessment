import { NextRequest, NextResponse } from "next/server";
import { createApplication, listApplications, updateApplicationResult } from "@/lib/db";
import { downloadLabelImage } from "@/lib/blob";
import { validateImages } from "@/lib/imagePayload";
import { isBeverageType } from "@/lib/beverageType";
import type { ApplicationData, ApplicationStatus } from "@/lib/types";
import { runVerification } from "@/lib/verify";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  const validStatuses: ApplicationStatus[] = ["pending", "processing", "done", "cancelled", "error"];
  if (status && !validStatuses.includes(status as ApplicationStatus)) {
    return NextResponse.json({ error: `Invalid status filter: ${status}` }, { status: 400 });
  }
  const applications = await listApplications(status as ApplicationStatus | undefined);
  return NextResponse.json({ applications });
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body was missing or not in the expected format." }, { status: 400 });
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return NextResponse.json({ error: "The request body was missing or not in the expected format." }, { status: 400 });
  }
  const body = payload as Record<string, unknown>;

  const brandName = typeof body.brandName === "string" ? body.brandName.trim() : "";
  const classType = typeof body.classType === "string" ? body.classType.trim() : "";
  const netContents = typeof body.netContents === "string" ? body.netContents.trim() : "";
  const abvPercent = typeof body.abvPercent === "number" ? body.abvPercent : parseFloat(String(body.abvPercent));

  if (!brandName || !classType || !netContents || Number.isNaN(abvPercent)) {
    return NextResponse.json({ error: "Please fill in brand name, class/type, ABV, and net contents." }, { status: 400 });
  }

  const imageResult = validateImages(body.images);
  if ("error" in imageResult) {
    return NextResponse.json({ error: imageResult.error }, { status: 400 });
  }

  // Optional: when absent the type is inferred from the class/type
  // designation at comparison time.
  const beverageType = isBeverageType(body.beverageType) ? body.beverageType : null;
  const data: ApplicationData = { brandName, classType, abvPercent, netContents, beverageType };

  // A row submitted from a guided import carries its batch id. It is queued
  // and deliberately NOT checked yet - not inline, and not in the background
  // either. An agent still working the sheet shouldn't be racing a stream of
  // Claude calls for the same serverless invocation, and rows flickering
  // between "processing" and "done" while they type is noise. The import
  // fires /api/applications/process once every row has been handled, and the
  // batch id is what lets the queue show that batch's progress and cancel the
  // rest. A one-off single add has nothing to batch with and no reason to
  // defer, so it keeps its inline result.
  // Checked against the UUID shape rather than passed straight through: the
  // column is a UUID, so a malformed value would surface as an opaque database
  // error instead of a clear one.
  const rawBatchId = typeof body.importBatchId === "string" ? body.importBatchId.trim() : "";
  if (rawBatchId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawBatchId)) {
    return NextResponse.json({ error: "That import batch reference isn't valid." }, { status: 400 });
  }
  const importBatchId = rawBatchId || null;

  if (importBatchId) {
    const queued = await createApplication(data, imageResult.images, "pending", importBatchId);
    return NextResponse.json({ application: queued });
  }

  let application = await createApplication(data, imageResult.images, "processing");

  // This path is the one a person actually waits on, so what it costs is worth
  // recording. Measured from fetching the photos back out of Blob, which is
  // where the server's work starts.
  const startedAt = Date.now();
  try {
    const encoded = await Promise.all(
      imageResult.images.map(async (image) => ({
        base64: (await downloadLabelImage(image.url)).toString("base64"),
        mediaType: image.contentType,
      }))
    );
    const outcome = await runVerification(encoded, data);
    const processingMs = Date.now() - startedAt;
    await updateApplicationResult(application.id, {
      status: "done",
      triageStatus: outcome.triageStatus,
      fields: outcome.fields,
      processingMs,
    });
    application = { ...application, status: "done", triageStatus: outcome.triageStatus, fields: outcome.fields, processingMs };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error during verification.";
    const processingMs = Date.now() - startedAt;
    await updateApplicationResult(application.id, { status: "error", errorMessage, processingMs });
    application = { ...application, status: "error", errorMessage, processingMs };
  }

  return NextResponse.json({ application });
}
