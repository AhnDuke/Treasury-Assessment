"use client";

import { upload } from "@vercel/blob/client";
import { isAcceptedImageType, MAX_IMAGE_BYTES } from "./imageValidation";
import { MAX_IMAGES_PER_APPLICATION, MIN_IMAGES_PER_APPLICATION, type LabelImage } from "./types";

export function describeImageCountProblem(count: number): string | null {
  if (count < MIN_IMAGES_PER_APPLICATION) {
    return `Add at least ${MIN_IMAGES_PER_APPLICATION} photos (front and back).`;
  }
  if (count > MAX_IMAGES_PER_APPLICATION) {
    return `Up to ${MAX_IMAGES_PER_APPLICATION} photos per application.`;
  }
  return null;
}

export function describeFileProblem(file: File): string | null {
  if (!isAcceptedImageType(file.type)) {
    return `${file.name}: unsupported type (${file.type || "unknown"}). Use JPEG, PNG, WEBP, or GIF.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name}: larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB.`;
  }
  return null;
}

/**
 * Uploads each file straight from the browser to Blob and returns the
 * metadata the API routes need. Goes direct rather than through our own API
 * because Vercel Functions cap request bodies at 4.5MB — a couple of phone
 * photos would exceed that on their own.
 */
export async function uploadLabelImages(files: File[]): Promise<LabelImage[]> {
  return Promise.all(
    files.map(async (file) => {
      const blob = await upload(`labels/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/api/blob/upload-token",
        contentType: file.type,
      });
      return {
        url: blob.url,
        filename: file.name,
        contentType: file.type as LabelImage["contentType"],
      };
    })
  );
}
