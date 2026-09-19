import { NextResponse } from "next/server";
import { downloadLabelImage } from "@/lib/blob";
import { getApplication } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Streams one of an application's label photos to the browser.
 *
 * Needed because the Blob store is private: the stored URL isn't fetchable
 * from a page, so reads go through the SDK authenticated with the store
 * token. Indexing by position in the application's own image list - rather
 * than taking a Blob URL as a parameter - keeps this from becoming an open
 * proxy for arbitrary URLs.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await context.params;

  const application = await getApplication(id);
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const position = Number(index);
  if (!Number.isInteger(position) || position < 0 || position >= application.images.length) {
    return NextResponse.json({ error: "No such image for this application." }, { status: 404 });
  }

  const image = application.images[position];
  try {
    const bytes = await downloadLabelImage(image.url);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": image.contentType,
        // Immutable: an application's photos never change after upload, and
        // the reviewer will open the same ones repeatedly while working.
        "Cache-Control": "private, max-age=3600, immutable",
        "Content-Disposition": `inline; filename="${encodeURIComponent(image.filename)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "The stored label photo could not be read." }, { status: 502 });
  }
}
