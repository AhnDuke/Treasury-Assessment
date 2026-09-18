"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { FileDropzone } from "./FileDropzone";
import { ResultsCard } from "./ResultsCard";
import { useSessionState } from "@/lib/useSessionState";
import type { VerificationResult } from "@/lib/types";

const initialFormState = {
  brandName: "",
  classType: "",
  abvPercent: "",
  netContents: "",
};

type FormState = typeof initialFormState;
type Status = "idle" | "loading" | "done" | "error";

export function SingleVerifyForm() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useSessionState<VerificationResult | null>("ttb-single-result", null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleFile(files: File[]) {
    const chosen = files[0];
    setFile(chosen);
    setPreviewUrl(URL.createObjectURL(chosen));
    setResult(null);
    setStatus("idle");
  }

  function removeFile() {
    setFile(null);
    setPreviewUrl(null);
  }

  function updateField(key: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  const isFormComplete = Boolean(file && form.brandName && form.classType && form.abvPercent && form.netContents);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setStatus("loading");
    setErrorMessage(null);
    setResult(null);

    const body = new FormData();
    body.append("image", file);
    body.append("brandName", form.brandName);
    body.append("classType", form.classType);
    body.append("abvPercent", form.abvPercent);
    body.append("netContents", form.netContents);

    try {
      const response = await fetch("/api/verify", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Verification failed.");
      setResult(data as VerificationResult);
      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">1. Application data</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Brand name" value={form.brandName} onChange={updateField("brandName")} placeholder="OLD TOM DISTILLERY" />
            <TextField
              label="Class/type designation"
              value={form.classType}
              onChange={updateField("classType")}
              placeholder="Kentucky Straight Bourbon Whiskey"
            />
            <TextField label="Alcohol content (% ABV)" value={form.abvPercent} onChange={updateField("abvPercent")} placeholder="45" type="number" step="0.1" />
            <TextField label="Net contents" value={form.netContents} onChange={updateField("netContents")} placeholder="750 mL" />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">2. Label photo</h2>
          {previewUrl ? (
            <div className="border border-border bg-paper-muted p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Label preview" className="mx-auto max-h-64 object-contain" />
              <button type="button" onClick={removeFile} className="mt-3 text-sm font-medium text-ink-muted hover:text-reject">
                Remove image
              </button>
            </div>
          ) : (
            <FileDropzone accept="image/jpeg,image/png,image/webp,image/gif" onFiles={handleFile} helperText="JPEG, PNG, WEBP, or GIF — up to 8MB" />
          )}
        </section>

        <button
          type="submit"
          disabled={!isFormComplete || status === "loading"}
          className="w-full bg-seal px-4 py-3 text-lg font-semibold text-paper transition-colors hover:bg-seal-dark disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
        >
          {status === "loading" ? "Reading label…" : "Verify label"}
        </button>

        {errorMessage && <p className="border-l-4 border-reject bg-reject-bg p-3 text-sm text-reject">{errorMessage}</p>}
      </form>

      <div>
        {status === "loading" && (
          <div className="flex min-h-30 items-center justify-center border border-border text-ink-muted">
            Reading label and comparing fields…
          </div>
        )}
        {result && <ResultsCard result={result} />}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  step,
}: {
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required
        className="w-full border border-border bg-paper px-3 py-2 text-ink placeholder:text-ink-muted/60 focus:border-seal focus:outline-none"
      />
    </label>
  );
}
