import { del, put } from "@vercel/blob";

/**
 * Uploads a label image to Vercel Blob and returns its public URL. Public,
 * not signed/private — consistent with the rest of this prototype's
 * no-auth posture (see README trade-offs): nothing here is behind a login,
 * so a directly-accessible-but-unguessable blob URL doesn't change the
 * threat model.
 */
export async function uploadLabelImage(buffer: Buffer, filename: string, contentType: string): Promise<string> {
  const blob = await put(`labels/${crypto.randomUUID()}-${filename}`, buffer, {
    access: "public",
    contentType,
  });
  return blob.url;
}

export async function deleteLabelImage(url: string): Promise<void> {
  await del(url);
}
