import { del, get, put } from "@vercel/blob";

/**
 * Uploads a label image to Vercel Blob and returns its URL. The store is
 * private, so this URL isn't directly fetchable by a browser - reads go
 * through downloadLabelImage() below, authenticated with the store token.
 */
export async function uploadLabelImage(buffer: Buffer, filename: string, contentType: string): Promise<string> {
  const blob = await put(`labels/${crypto.randomUUID()}-${filename}`, buffer, {
    access: "private",
    contentType,
  });
  return blob.url;
}

/**
 * Reads a stored label image back. Needed because processing is deferred:
 * the invocation that runs the Claude call is usually not the one that
 * received the upload, so the bytes have to come back out of Blob.
 */
export async function downloadLabelImage(url: string): Promise<Buffer> {
  const result = await get(url, { access: "private" });
  if (!result) {
    throw new Error("The stored label image could not be found.");
  }
  if (!result.stream) {
    throw new Error("The stored label image returned no content.");
  }
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

export async function deleteLabelImage(url: string): Promise<void> {
  await del(url);
}
