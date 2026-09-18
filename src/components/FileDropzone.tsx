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
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
        isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100"
      }`}
    >
      <span className="text-3xl" aria-hidden>
        📁
      </span>
      <span className="font-medium text-slate-700">Click to choose {multiple ? "files" : "a file"}, or drag it here</span>
      <span className="text-sm text-slate-500">{helperText}</span>
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
