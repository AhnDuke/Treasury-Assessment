"use client";

import { useState, type FormEvent } from "react";
import { ErrorCard, ResultsCard } from "./ResultsCard";
import {
  ApplicationFields,
  emptyApplicationForm,
  isApplicationFormFilled,
  type ApplicationFormState,
} from "./ApplicationFields";
import { acceptFiles, LabelPhotoPicker, type PendingImage } from "./LabelPhotoPicker";
import { describeImageCountProblem, uploadLabelImages } from "@/lib/uploadImages";
import { MAX_IMAGES_PER_APPLICATION, type ApplicationRecord } from "@/lib/types";

type Status = "idle" | "uploading" | "verifying" | "done" | "error";

export function AddSingleApplication({ onViewQueue }: { onViewQueue: () => void }) {
  const [form, setForm] = useState<ApplicationFormState>(emptyApplicationForm);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [application, setApplication] = useState<ApplicationRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleFiles(files: File[]) {
    const { accepted, rejected } = acceptFiles(files);
    if (rejected.length > 0) setErrorMessage(rejected.join(" "));
    setImages((prev) => [...prev, ...accepted].slice(0, MAX_IMAGES_PER_APPLICATION));
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setForm(emptyApplicationForm);
    setImages([]);
    setApplication(null);
    setStatus("idle");
    setErrorMessage(null);
  }

  const countProblem = describeImageCountProblem(images.length);
  const canSubmit =
    isApplicationFormFilled(form) && !countProblem && status !== "uploading" && status !== "verifying";

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
      // No importBatchId here, so this one is checked inline and its result
      // comes straight back — a single add has nothing to batch with.
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
          <ApplicationFields form={form} onChange={setForm} idPrefix="single-add" />
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold text-ink">
            2. Label photos ({images.length}/{MAX_IMAGES_PER_APPLICATION})
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            Add up to {MAX_IMAGES_PER_APPLICATION} photos. Include the back label if the Government Warning isn&apos;t
            visible on the front — one photo showing both sides works too.
          </p>
          <LabelPhotoPicker images={images} onAdd={handleFiles} onRemove={removeImage} />
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
