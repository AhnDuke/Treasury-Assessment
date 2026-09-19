"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { FileDropzone } from "./FileDropzone";
import { ErrorCard, ResultsCard } from "./ResultsCard";
import { ALL_CLASS_TYPES } from "@/lib/classTypes";
import { describeFileProblem, describeImageCountProblem, uploadLabelImages } from "@/lib/uploadImages";
import { MAX_IMAGES_PER_APPLICATION, type ApplicationRecord } from "@/lib/types";

const initialFormState = {
  brandName: "",
  classType: "",
  abvPercent: "",
  netContents: "",
};

type FormState = typeof initialFormState;
type Status = "idle" | "uploading" | "verifying" | "done" | "error";

interface PendingImage {
  file: File;
  previewUrl: string;
}

export function AddSingleApplication({ onViewQueue }: { onViewQueue: () => void }) {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [application, setApplication] = useState<ApplicationRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleFiles(files: File[]) {
    const rejected = files.map(describeFileProblem).filter((problem): problem is string => Boolean(problem));
    if (rejected.length > 0) setErrorMessage(rejected.join(" "));
    const accepted = files.filter((file) => !describeFileProblem(file));
    setImages((prev) => [...prev, ...accepted.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function updateField(key: keyof FormState) {
    return (event: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  function resetForm() {
    setForm(initialFormState);
    setImages([]);
    setApplication(null);
    setStatus("idle");
    setErrorMessage(null);
  }

  const countProblem = describeImageCountProblem(images.length);
  const fieldsFilled = Boolean(form.brandName && form.classType && form.abvPercent && form.netContents);
  const canSubmit = fieldsFilled && !countProblem && status !== "uploading" && status !== "verifying";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setErrorMessage(null);
    setApplication(null);

    try {
      // Images go browser -> Blob directly; only their URLs reach our API.
      setStatus("uploading");
      const uploaded = await uploadLabelImages(images.map((image) => image.file));

      setStatus("verifying");
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: form.brandName,
          classType: form.classType,
          abvPercent: form.abvPercent,
          netContents: form.netContents,
          images: uploaded,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not add this application.");
      setApplication(data.application as ApplicationRecord);
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
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Class/type designation</span>
              <input
                type="text"
                list="ttb-class-types"
                value={form.classType}
                onChange={updateField("classType")}
                placeholder="Start typing, e.g. Bourbon"
                required
                className="w-full border border-border bg-paper px-3 py-2 text-ink placeholder:text-ink-muted/60 focus:border-seal focus:outline-none"
              />
              <datalist id="ttb-class-types">
                {ALL_CLASS_TYPES.map((designation) => (
                  <option key={designation} value={designation} />
                ))}
              </datalist>
            </label>
            <TextField label="Alcohol content (% ABV)" value={form.abvPercent} onChange={updateField("abvPercent")} placeholder="45" type="number" step="0.1" />
            <TextField label="Net contents" value={form.netContents} onChange={updateField("netContents")} placeholder="750 mL" />
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold text-ink">
            2. Label photos ({images.length}/{MAX_IMAGES_PER_APPLICATION})
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            Add up to {MAX_IMAGES_PER_APPLICATION} photos. Include the back label if the Government Warning isn&apos;t
            visible on the front — one photo showing both sides works too.
          </p>
          {images.length < MAX_IMAGES_PER_APPLICATION && (
            <FileDropzone
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif"
              onFiles={handleFiles}
              helperText="JPEG, PNG, WEBP, or GIF — up to 8MB each"
            />
          )}
          {images.length > 0 && (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((image, index) => (
                <li key={`${image.file.name}-${index}`} className="border border-border bg-paper-muted p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.previewUrl} alt={`Label ${index + 1}`} className="mx-auto h-28 object-contain" />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-ink-muted">{image.file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="text-xs text-ink-muted hover:text-reject"
                      aria-label={`Remove ${image.file.name}`}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {countProblem && images.length > 0 && <p className="mt-2 text-sm text-flag">{countProblem}</p>}
        </section>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-seal px-4 py-3 text-lg font-semibold text-paper transition-colors hover:bg-seal-dark disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
        >
          {status === "uploading" ? "Uploading photos…" : status === "verifying" ? "Reading labels…" : "Add application"}
        </button>

        {errorMessage && <ErrorCard title="Could not add this application" message={errorMessage} />}
      </form>

      {(status === "uploading" || status === "verifying") && (
        <div className="flex min-h-30 items-center justify-center border border-border text-ink-muted">
          {status === "uploading" ? "Uploading label photos…" : "Reading labels and comparing fields…"}
        </div>
      )}

      {application && (
        <div className="space-y-4">
          {application.status === "error" ? (
            <ErrorCard message={application.errorMessage ?? "Verification failed."} />
          ) : (
            <ResultsCard
              triageStatus={application.triageStatus ?? "discrepancy"}
              fields={application.fields ?? []}
              footer="Saved to the review queue."
            />
          )}
          <div className="flex gap-3">
            <button type="button" onClick={resetForm} className="flex-1 border border-border py-2 font-medium text-ink hover:bg-paper-muted">
              Add another application
            </button>
            <button type="button" onClick={onViewQueue} className="flex-1 border border-seal py-2 font-medium text-seal hover:bg-verified-bg">
              View in review queue
            </button>
          </div>
        </div>
      )}
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
