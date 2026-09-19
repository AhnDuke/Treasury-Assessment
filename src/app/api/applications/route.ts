import { after, NextRequest, NextResponse } from "next/server";
import { createApplication, listApplications, updateApplicationResult } from "@/lib/db";
import { downloadLabelImage } from "@/lib/blob";
import { validateImages } from "@/lib/imagePayload";
import { drainPendingApplications } from "@/lib/processQueue";
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

  const data: ApplicationData = { brandName, classType, abvPercent, netContents };

  // A row submitted from a guided import carries its batch id. Those are
  // queued and checked in the background rather than inline: an agent working
  // a 40-row sheet shouldn't wait several seconds per row for a Claude call,
  // and the batch id is what lets the review queue show the batch's progress
  // and offer to cancel the rest. A one-off single add has nothing to batch
  // with and no reason to defer, so it keeps its inline result.
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
    after(() => drainPendingApplications());
    return NextResponse.json({ application: queued });
  }

  let application = await createApplication(data, imageResult.images, "processing");

  try {
    const encoded = await Promise.all(
      imageResult.images.map(async (image) => ({
        base64: (await downloadLabelImage(image.url)).toString("base64"),
        mediaType: image.contentType,
      }))
    );
    const outcome = await runVerification(encoded, data);
    await updateApplicationResult(application.id, { status: "done", triageStatus: outcome.triageStatus, fields: outcome.fields });
    application = { ...application, status: "done", triageStatus: outcome.triageStatus, fields: outcome.fields };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error during verification.";
    await updateApplicationResult(application.id, { status: "error", errorMessage });
    application = { ...application, status: "error", errorMessage };
  }

  return NextResponse.json({ application });
}
