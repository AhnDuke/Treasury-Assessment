"use client";

import { useState, type DragEvent } from "react";

interface FileDropzoneProps {
  multiple?: boolean;
  accept: string;
  onFiles: (files: File[]) => void;
  helperText: string;
}

export function FileDropzone({ multiple = false, accept, onFiles, helperText }: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : [files[0]]);
  }

  return (
    <label
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed p-8 text-center transition-colors ${
        isDragging ? "border-seal bg-verified-bg" : "border-border bg-paper-muted hover:bg-border/40"
      }`}
    >
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-7 text-ink-muted">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0 4 4m-4-4-4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
      </svg>
      <span className="font-medium text-ink">Click to choose {multiple ? "files" : "a file"}, or drag it here</span>
      <span className="text-sm text-ink-muted">{helperText}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onFiles(files);
          event.target.value = "";
        }}
      />
    </label>
  );
}
