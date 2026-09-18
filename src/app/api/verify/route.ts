import { NextRequest, NextResponse } from "next/server";
import { isAcceptedImageType, MAX_IMAGE_BYTES } from "@/lib/imageValidation";
import type { ApplicationData } from "@/lib/types";
import { verifyLabel } from "@/lib/verify";

export const runtime = "nodejs";

function readRequiredString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

  const expected: ApplicationData = { brandName, classType, abvPercent, netContents };
  const buffer = Buffer.from(await image.arrayBuffer());

  const result = await verifyLabel(buffer.toString("base64"), mediaType, expected, image.name);
  return NextResponse.json(result);
}
