import type { AcceptedImageType } from "./types";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ACCEPTED_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function isAcceptedImageType(type: string): type is AcceptedImageType {
  return ACCEPTED_TYPES.has(type);
}
