import { NextRequest, NextResponse } from "next/server";
import { createApplication, listApplications, updateApplicationResult } from "@/lib/db";
import { downloadLabelImage } from "@/lib/blob";
import { validateImages } from "@/lib/imagePayload";
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
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const brandName = typeof payload.brandName === "string" ? payload.brandName.trim() : "";
  const classType = typeof payload.classType === "string" ? payload.classType.trim() : "";
  const netContents = typeof payload.netContents === "string" ? payload.netContents.trim() : "";
  const abvPercent = typeof payload.abvPercent === "number" ? payload.abvPercent : parseFloat(String(payload.abvPercent));

  if (!brandName || !classType || !netContents || Number.isNaN(abvPercent)) {
    return NextResponse.json({ error: "Please fill in brand name, class/type, ABV, and net contents." }, { status: 400 });
  }

  const imageResult = validateImages(payload.images);
  if ("error" in imageResult) {
    return NextResponse.json({ error: imageResult.error }, { status: 400 });
  }

  const data: ApplicationData = { brandName, classType, abvPercent, netContents };
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
