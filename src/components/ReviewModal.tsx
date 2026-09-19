"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorCard } from "./ResultsCard";
import { DECISION_META, FIELD_STATUS_META, TRIAGE_STATUS_META } from "@/lib/statusMeta";
import type { ApplicationRecord, FieldResult, ReviewDecision } from "@/lib/types";

interface ReviewModalProps {
  application: ApplicationRecord;
  onClose: () => void;
  onDecided: (updated: ApplicationRecord) => void;
}

/** Pre-fills the rejection box from what the automated check flagged, so the
 *  common rejection is a confirmation rather than an essay. */
function suggestedReason(fields: FieldResult[]): string {
  const flagged = fields.filter((f) => f.status !== "match");
  if (flagged.length === 0) return "";
  return flagged.map((f) => `${f.label}: ${f.detail ?? "does not match the application."}`).join("\n");
}

export function ReviewModal({ application, onClose, onDecided }: ReviewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fields = application.fields ?? [];
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(() => suggestedReason(fields));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // showModal() can't be set declaratively — it's the call that establishes
  // the top layer, the backdrop, and the focus trap.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function decide(decision: ReviewDecision) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/applications/${application.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason: decision === "rejected" ? reason : undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not record this decision.");
      onDecided(data.application as ApplicationRecord);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record this decision.");
      setBusy(false);
    }
  }

  const triage = application.triageStatus ? TRIAGE_STATUS_META[application.triageStatus] : null;
  const decided = application.decision ? DECISION_META[application.decision] : null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[min(72rem,92vw)] max-w-none bg-paper p-0 text-ink backdrop:bg-ink/50"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <h2 className="text-xl font-bold text-ink">{application.brandName}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Added {new Date(application.createdAt).toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="border border-border px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      {triage && (
        <p className={`flex items-center gap-3 border-l-4 p-4 font-semibold ${triage.className} ${triage.edgeClassName}`}>
          <span aria-hidden className="text-xl leading-none">{triage.glyph}</span>
          {triage.label}
        </p>
      )}

      <div className="grid max-h-[65vh] gap-6 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink">Label photos</h3>
          <div className="space-y-3">
            {application.images.map((image, index) => (
              <figure key={image.url} className="border border-border bg-paper-muted">
                {/* Deliberately a plain <img>: these are private, authenticated
                    bytes served by our own route, which next/image's optimizer
                    can't fetch. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/applications/${application.id}/images/${index}`}
                  alt={`Label photo ${index + 1} of ${application.images.length} for ${application.brandName}`}
                  className="max-h-96 w-full bg-paper object-contain"
                />
                <figcaption className="truncate border-t border-border px-3 py-1.5 text-xs text-ink-muted">
                  {image.filename}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink">Application fields</h3>
          {application.status === "pending" || application.status === "processing" ? (
            <p className="text-ink-muted">Still processing — check back shortly.</p>
          ) : application.status === "cancelled" ? (
            <p className="text-ink-muted">Import was cancelled before this label was checked.</p>
          ) : application.status === "error" ? (
            <ErrorCard message={application.errorMessage ?? "Verification failed."} />
          ) : (
            <div className="border border-border">
              {fields.map((field, index) => {
                const meta = FIELD_STATUS_META[field.status];
                return (
                  <div
                    key={field.field}
                    className={`border-l-4 bg-paper p-4 ${meta.edgeClassName} ${index > 0 ? "border-t border-border" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-ink">{field.label}</span>
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-sm font-medium ${meta.className}`}>
                        <span aria-hidden>{meta.glyph}</span>
                        {meta.label}
                      </span>
                    </div>
                    <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-ink-muted">Submitted on application</dt>
                        <dd className="wrap-break-word text-ink">{field.expected ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Found on label</dt>
                        <dd className="wrap-break-word text-ink">{field.extracted ?? "—"}</dd>
                      </div>
                    </dl>
                    {field.detail && <p className="mt-2 text-sm text-ink-muted">{field.detail}</p>}
                    {field.secondOpinion && (
                      <p className="mt-2 border-t border-border pt-2 text-sm text-ink-muted">
                        Second check:{" "}
                        {field.secondOpinion.agreesWithFirstPass
                          ? "a second model read the label the same way."
                          : `a second model read this as "${field.secondOpinion.extracted ?? "nothing"}" instead — confirm manually.`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {application.status === "done" && (
        <div className="border-t border-border bg-paper-muted p-5">
          {error && <p className="mb-3 border-l-4 border-reject bg-reject-bg p-3 text-sm text-reject">{error}</p>}

          {decided ? (
            <div className="space-y-2">
              <p className={`inline-flex items-center gap-2 rounded border px-3 py-1 font-semibold ${decided.className}`}>
                <span aria-hidden>{decided.glyph}</span>
                {decided.label} on {new Date(application.decidedAt!).toLocaleString()}
              </p>
              {application.decisionReason && (
                <p className="whitespace-pre-line text-sm text-ink-muted">{application.decisionReason}</p>
              )}
            </div>
          ) : rejecting ? (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Why is this being rejected?</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={4}
                  className="w-full border border-border bg-paper p-2 text-ink"
                />
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => decide("rejected")}
                  disabled={busy || !reason.trim()}
                  className="bg-reject px-4 py-2 font-semibold text-paper disabled:opacity-50"
                >
                  {busy ? "Recording…" : "Reject application"}
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  disabled={busy}
                  className="border border-border px-4 py-2 font-medium text-ink-muted hover:text-ink"
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => decide("approved")}
                disabled={busy}
                className="bg-verified px-4 py-2 font-semibold text-paper disabled:opacity-50"
              >
                {busy ? "Recording…" : "Approve application"}
              </button>
              <button
                type="button"
                onClick={() => setRejecting(true)}
                disabled={busy}
                className="border border-reject px-4 py-2 font-semibold text-reject hover:bg-reject-bg disabled:opacity-50"
              >
                Reject application
              </button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
