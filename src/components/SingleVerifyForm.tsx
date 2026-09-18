"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { FileDropzone } from "./FileDropzone";
import { ResultsCard } from "./ResultsCard";
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
  const [result, setResult] = useState<VerificationResult | null>(null);
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
    <div className="grid gap-8 lg:grid-cols-2">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Brand Name" value={form.brandName} onChange={updateField("brandName")} placeholder="OLD TOM DISTILLERY" />
          <TextField
            label="Class/Type Designation"
            value={form.classType}
            onChange={updateField("classType")}
            placeholder="Kentucky Straight Bourbon Whiskey"
          />
          <TextField label="Alcohol Content (% ABV)" value={form.abvPercent} onChange={updateField("abvPercent")} placeholder="45" type="number" step="0.1" />
          <TextField label="Net Contents" value={form.netContents} onChange={updateField("netContents")} placeholder="750 mL" />
        </div>

        {previewUrl ? (
          <div className="rounded-lg border border-slate-200 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Label preview" className="mx-auto max-h-64 rounded object-contain" />
            <button type="button" onClick={removeFile} className="mt-3 text-sm font-medium text-slate-500 hover:text-red-600">
              Remove image
            </button>
          </div>
        ) : (
          <FileDropzone accept="image/jpeg,image/png,image/webp,image/gif" onFiles={handleFile} helperText="JPEG, PNG, WEBP, or GIF — up to 8MB" />
        )}

        <button
          type="submit"
          disabled={!isFormComplete || status === "loading"}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-lg font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {status === "loading" ? "Reading label…" : "Verify Label"}
        </button>

        {errorMessage && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMessage}</p>}
      </form>

      <div>
        {status === "loading" && (
          <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-slate-200 text-slate-500">
            Reading label and comparing fields…
          </div>
        )}
        {result && <ResultsCard result={result} />}
        {status === "idle" && !result && (
          <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-200 text-center text-slate-400">
            Results will appear here after you verify a label.
          </div>
        )}
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
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
    </label>
  );
}
