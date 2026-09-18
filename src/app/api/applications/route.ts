import { NextRequest, NextResponse } from "next/server";
import { uploadLabelImage } from "@/lib/blob";
import { createApplication, listApplications, updateApplicationResult } from "@/lib/db";
import { isAcceptedImageType, MAX_IMAGE_BYTES } from "@/lib/imageValidation";
import type { ApplicationData, ApplicationStatus } from "@/lib/types";
import { runVerification } from "@/lib/verify";

export const runtime = "nodejs";

function readRequiredString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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
  const formData = await request.formData();
  const image = formData.get("image");

  const brandName = readRequiredString(formData, "brandName");
  const classType = readRequiredString(formData, "classType");
  const abvPercentRaw = readRequiredString(formData, "abvPercent");
  const netContents = readRequiredString(formData, "netContents");

  if (!(image instanceof File)) {
    return NextResponse.json({ error: "Missing label image." }, { status: 400 });
  }
  if (!brandName || !classType || !abvPercentRaw || !netContents) {
    return NextResponse.json({ error: "Please fill in brand name, class/type, ABV, and net contents." }, { status: 400 });
  }
  const mediaType = image.type;
  if (!isAcceptedImageType(mediaType)) {
    return NextResponse.json(
      { error: `Unsupported image type: ${mediaType || "unknown"}. Use JPEG, PNG, WEBP, or GIF.` },
      { status: 400 }
    );
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large (max 8MB)." }, { status: 400 });
  }
  const abvPercent = parseFloat(abvPercentRaw);
  if (Number.isNaN(abvPercent)) {
    return NextResponse.json({ error: "ABV must be a number." }, { status: 400 });
  }

  const data: ApplicationData = { brandName, classType, abvPercent, netContents };
  const buffer = Buffer.from(await image.arrayBuffer());
  const imageUrl = await uploadLabelImage(buffer, image.name, mediaType);

  let application = await createApplication(data, { url: imageUrl, filename: image.name, contentType: mediaType }, "processing");

  try {
    const outcome = await runVerification(buffer.toString("base64"), mediaType, data);
    await updateApplicationResult(application.id, { status: "done", overallStatus: outcome.overallStatus, fields: outcome.fields });
    application = { ...application, status: "done", overallStatus: outcome.overallStatus, fields: outcome.fields };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error during verification.";
    await updateApplicationResult(application.id, { status: "error", errorMessage });
    application = { ...application, status: "error", errorMessage };
  }

  return NextResponse.json({ application });
}
