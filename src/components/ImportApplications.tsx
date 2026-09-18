"use client";

import { useState, type FormEvent } from "react";
import { FileDropzone } from "./FileDropzone";

type Status = "idle" | "loading" | "done" | "error";

interface ImportSummary {
  importBatchId: string;
  created: number;
  errors: string[];
}

export function ImportApplications({ onViewQueue }: { onViewQueue: () => void }) {
  const [spreadsheet, setSpreadsheet] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = Boolean(spreadsheet) && imageFiles.length > 0 && status !== "loading";

  function removeImage(index: number) {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!spreadsheet || imageFiles.length === 0) return;
    setStatus("loading");
    setErrorMessage(null);
    setSummary(null);

    const body = new FormData();
    body.append("spreadsheet", spreadsheet);
    imageFiles.forEach((file) => body.append("images", file));

    try {
      const response = await fetch("/api/applications/import", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Import failed.");
      setSummary(data as ImportSummary);
      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div className="space-y-8">
      <div className="border border-border bg-paper-muted p-4 text-sm text-ink-muted">
        <p>
          Upload a spreadsheet (CSV or XLSX) of application data alongside the label images. Each image&apos;s filename must
          match the <code className="bg-paper px-1 py-0.5">filename</code> column. Imported applications are queued and
          processed in the background — check the review queue for progress.
        </p>
        <a href="/sample-batch-template.csv" download className="mt-2 inline-block font-medium text-seal hover:underline">
          Download a template
        </a>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">1. Application data (CSV or XLSX)</h2>
          {spreadsheet ? (
            <div className="flex items-center justify-between border border-border bg-paper-muted px-3 py-2 text-sm">
              <span className="truncate">{spreadsheet.name}</span>
              <button type="button" onClick={() => setSpreadsheet(null)} className="ml-2 text-ink-muted hover:text-reject">
                Remove
              </button>
            </div>
          ) : (
            <FileDropzone
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onFiles={(files) => setSpreadsheet(files[0])}
              helperText="One row per label"
            />
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">2. Label photos ({imageFiles.length} selected)</h2>
          <FileDropzone
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif"
            onFiles={(files) => setImageFiles((prev) => [...prev, ...files])}
            helperText="Up to 300 images per import"
          />
          {imageFiles.length > 0 && (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-sm">
              {imageFiles.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center justify-between bg-paper-muted px-2 py-1">
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="ml-2 text-ink-muted hover:text-reject"
                    aria-label={`Remove ${file.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-seal px-4 py-3 text-lg font-semibold text-paper transition-colors hover:bg-seal-dark disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
        >
          {status === "loading" ? `Importing ${imageFiles.length} label${imageFiles.length === 1 ? "" : "s"}…` : "Import applications"}
        </button>

        {errorMessage && <p className="border-l-4 border-reject bg-reject-bg p-3 text-sm text-reject">{errorMessage}</p>}
      </form>

      {summary && (
        <div className="animate-reveal space-y-3">
          <div className="border-l-4 border-verified bg-verified-bg p-4 text-verified">
            <p className="font-semibold">{summary.created} application{summary.created === 1 ? "" : "s"} queued for processing.</p>
            <button type="button" onClick={onViewQueue} className="mt-2 border border-seal px-3 py-1.5 text-sm font-medium text-seal hover:bg-paper">
              View in review queue
            </button>
          </div>
          {summary.errors.length > 0 && (
            <div className="border-l-4 border-flag bg-flag-bg p-4 text-sm text-flag">
              <p className="font-semibold">{summary.errors.length} row{summary.errors.length === 1 ? "" : "s"} skipped:</p>
              <ul className="mt-1 list-inside list-disc">
                {summary.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
