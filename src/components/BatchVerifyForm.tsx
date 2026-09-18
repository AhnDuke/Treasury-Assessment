"use client";

import { useState, type FormEvent } from "react";
import { FileDropzone } from "./FileDropzone";
import { BatchResultsTable } from "./BatchResultsTable";
import { useSessionState } from "@/lib/useSessionState";
import type { VerificationResult } from "@/lib/types";

type Status = "idle" | "loading" | "done" | "error";

export function BatchVerifyForm() {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useSessionState<VerificationResult[] | null>("ttb-batch-results", null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = Boolean(csvFile) && imageFiles.length > 0 && status !== "loading";

  function removeImage(index: number) {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!csvFile || imageFiles.length === 0) return;
    setStatus("loading");
    setErrorMessage(null);
    setResults(null);

    const body = new FormData();
    body.append("csv", csvFile);
    imageFiles.forEach((file) => body.append("images", file));

    try {
      const response = await fetch("/api/batch", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Batch verification failed.");
      setResults(data.results as VerificationResult[]);
      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <p>
          Upload a CSV of submitted application data alongside the label images. Each image&apos;s filename must match the{" "}
          <code className="rounded bg-slate-200 px-1 py-0.5">filename</code> column in the CSV.
        </p>
        <a href="/sample-batch-template.csv" download className="mt-2 inline-block font-medium text-blue-600 hover:underline">
          Download a CSV template
        </a>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-2 block text-sm font-medium text-slate-700">Application Data (CSV)</span>
            {csvFile ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span className="truncate">{csvFile.name}</span>
                <button type="button" onClick={() => setCsvFile(null)} className="ml-2 text-slate-400 hover:text-red-600">
                  Remove
                </button>
              </div>
            ) : (
              <FileDropzone accept=".csv,text/csv" onFiles={(files) => setCsvFile(files[0])} helperText="One row per label" />
            )}
          </div>
          <div>
            <span className="mb-2 block text-sm font-medium text-slate-700">Label Images ({imageFiles.length} selected)</span>
            <FileDropzone
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif"
              onFiles={(files) => setImageFiles((prev) => [...prev, ...files])}
              helperText="Up to 25 images per batch"
            />
            {imageFiles.length > 0 && (
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-sm">
                {imageFiles.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex items-center justify-between rounded bg-slate-100 px-2 py-1">
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="ml-2 text-slate-400 hover:text-red-600"
                      aria-label={`Remove ${file.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-lg font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {status === "loading"
            ? `Verifying ${imageFiles.length} label${imageFiles.length === 1 ? "" : "s"}…`
            : `Verify ${imageFiles.length || ""} Label${imageFiles.length === 1 ? "" : "s"}`.trim()}
        </button>

        {errorMessage && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMessage}</p>}
      </form>

      {results && <BatchResultsTable results={results} />}
    </div>
  );
}
