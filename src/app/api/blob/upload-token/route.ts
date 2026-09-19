import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { MAX_IMAGE_BYTES } from "@/lib/imageValidation";

export const runtime = "nodejs";

/**
 * Issues short-lived tokens so the browser can upload label photos straight
 * to Blob. Necessary, not just nicer: Vercel Functions cap request bodies at
 * 4.5MB, so routing several multi-megabyte phone photos through our own API
 * would 413 before reaching any of our code.
 *
 * The content-type and size limits are enforced here, at token issuance,
 * rather than in the client — a client-side check is a UX affordance, not a
 * control.
 *
 * Caveat, documented in the README: Vercel's guidance is to authenticate the
 * user in onBeforeGenerateToken. This prototype has no auth, so anyone who
 * finds this endpoint can write to the Blob store. That's a storage-abuse
 * vector, not only a data-exposure one.
 */
export async function POST(request: Request) {
  // Checked explicitly so a missing deployment env var reports itself instead
  // of surfacing as an opaque 400 from the SDK's own throw.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Image uploads aren't configured on the server (BLOB_READ_WRITE_TOKEN is not set). Contact your administrator." },
      { status: 500 }
    );
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body was missing or not in the expected format." }, { status: 400 });
  }

  if (typeof parsed !== "object" || parsed === null) {
    return NextResponse.json({ error: "The request body was missing or not in the expected format." }, { status: 400 });
  }
  const body = parsed as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
        maximumSizeInBytes: MAX_IMAGE_BYTES,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // Nothing to do — the application row is created by the add/import
        // route once the client reports its uploaded URLs.
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    // Surfaced in the Vercel function logs — the client only sees the message.
    console.error("Blob upload token generation failed:", err);
    return NextResponse.json({ error: "Could not start the upload. Please try again." }, { status: 400 });
  }
}
