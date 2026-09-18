import { isAcceptedImageType } from "./imageValidation";
import { MAX_IMAGES_PER_APPLICATION, MIN_IMAGES_PER_APPLICATION, type LabelImage } from "./types";

/**
 * Validates the image list a client reports after uploading straight to Blob.
 * The bytes never pass through our API (see the upload-token route), so this
 * is where we re-check what the client claims it uploaded.
 */
export function validateImages(value: unknown): { images: LabelImage[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "Missing label images." };
  if (value.length < MIN_IMAGES_PER_APPLICATION) {
    return { error: `Add at least ${MIN_IMAGES_PER_APPLICATION} label photos (front and back).` };
  }
  if (value.length > MAX_IMAGES_PER_APPLICATION) {
    return { error: `Up to ${MAX_IMAGES_PER_APPLICATION} label photos per application.` };
  }

  const images: LabelImage[] = [];
  for (const entry of value) {
    const url = typeof entry?.url === "string" ? entry.url : null;
    const filename = typeof entry?.filename === "string" ? entry.filename : null;
    const contentType = typeof entry?.contentType === "string" ? entry.contentType : null;
    if (!url || !filename || !contentType) return { error: "Each image needs a url, filename, and contentType." };
    if (!isAcceptedImageType(contentType)) return { error: `Unsupported image type: ${contentType}.` };
    images.push({ url, filename, contentType });
  }
  return { images };
}
