"use client";

import { FileDropzone } from "./FileDropzone";
import { describeFileProblem } from "@/lib/uploadImages";
import { MAX_IMAGES_PER_APPLICATION } from "@/lib/types";

export interface PendingImage {
  file: File;
  previewUrl: string;
}

/**
 * Turns picked files into previewable images, dropping any the app won't
 * accept and reporting why. Returns both halves so the caller can show the
 * rejections rather than silently discarding a file the agent chose.
 */
export function acceptFiles(files: File[]): { accepted: PendingImage[]; rejected: string[] } {
  const rejected: string[] = [];
  const accepted: PendingImage[] = [];
  for (const file of files) {
    const problem = describeFileProblem(file);
    if (problem) rejected.push(problem);
    else accepted.push({ file, previewUrl: URL.createObjectURL(file) });
  }
  return { accepted, rejected };
}

/**
 * The photo picker shared by the single-add form and each row of a guided
 * import. Thumbnails are object URLs of the local file - nothing is uploaded
 * until the application is submitted, so an agent can add and remove freely
 * without leaving orphans in the Blob store.
 */
export function LabelPhotoPicker({
  images,
  onAdd,
  onRemove,
  disabled = false,
  compact = false,
}: {
  images: PendingImage[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div>
      {images.length < MAX_IMAGES_PER_APPLICATION && !disabled && (
        <FileDropzone
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          onFiles={onAdd}
          helperText={compact ? "JPEG, PNG, WEBP or GIF" : "JPEG, PNG, WEBP, or GIF, up to 8MB each"}
        />
      )}
      {images.length > 0 && (
        <ul className={`mt-3 grid gap-3 ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3"}`}>
          {images.map((image, index) => (
            <li key={`${image.file.name}-${index}`} className="border border-border bg-paper-muted p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.previewUrl}
                alt={`Label photo ${index + 1} of ${images.length}`}
                className={`mx-auto object-contain ${compact ? "h-20" : "h-28"}`}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-ink-muted">{image.file.name}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    className="text-xs text-ink-muted hover:text-reject"
                    aria-label={`Remove ${image.file.name}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
