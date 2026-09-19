"use client";

import { useState } from "react";
import { ErrorCard } from "./ResultsCard";
import { DECISION_META, FIELD_STATUS_META, TRIAGE_STATUS_META } from "@/lib/statusMeta";
import { classifyProcessingTime, formatProcessingTime } from "@/lib/processingTime";
import type { ApplicationRecord, FieldResult, ReviewDecision } from "@/lib/types";

/**
 * The parts of a review that both surfaces share: the modal opened from the
 * table, and the one-at-a-time flow. Kept in one place so the two cannot drift
 * into disagreeing about what an agent is shown before they sign off.
 */

/**
 * Photos beside fields, which is the comparison the job actually is.
 *
 * `compact` is for the one-at-a-time flow, where the whole review has to fit
 * the window: an agent clearing a run of applications should never have to
 * scroll the page to find the buttons. It shrinks the photos, lays them out
 * side by side rather than stacked, and gives each column its own scrollbar so
 * a long field list cannot push the decision out of view.
 */
export function ReviewBody({
  application,
  compact = false,
}: {
  application: ApplicationRecord;
  compact?: boolean;
}) {
  const fields = application.fields ?? [];
  const triage = application.triageStatus ? TRIAGE_STATUS_META[application.triageStatus] : null;

  return (
    <>
      {triage && (
        <p
          className={`flex items-center gap-3 border-l-4 font-semibold ${compact ? "p-3 text-sm" : "p-4"} ${triage.className} ${triage.edgeClassName}`}
        >
          <span aria-hidden className={compact ? "leading-none" : "text-xl leading-none"}>
            {triage.glyph}
          </span>
          {triage.label}
        </p>
      )}

      <div
        className={
          compact
            ? "grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            : "grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        }
      >
        <section className={compact ? "flex min-h-0 flex-col" : undefined}>
          <h3 className="mb-3 text-sm font-semibold text-ink">Label photos</h3>
          <div
            className={
              compact
                ? "min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
                : "space-y-3"
            }
          >
            {application.images.map((image, index) => (
              <figure key={image.url} className="border border-border bg-paper-muted">
                {/* Deliberately a plain <img>: these are private, authenticated
                    bytes served by our own route, which next/image's optimizer
                    can't fetch. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/applications/${application.id}/images/${index}`}
                  alt={`Label photo ${index + 1} of ${application.images.length} for ${application.brandName}`}
                  className={compact ? "max-h-[34vh] w-full bg-paper object-contain" : "max-h-96 w-full bg-paper object-contain"}
                />
                <figcaption className="truncate border-t border-border px-3 py-1.5 text-xs text-ink-muted">
                  {image.filename}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className={compact ? "flex min-h-0 flex-col" : undefined}>
          <h3 className="mb-3 text-sm font-semibold text-ink">Application fields</h3>
          {application.status === "pending" || application.status === "processing" ? (
            <p className="text-ink-muted">Still processing. Check back shortly.</p>
          ) : application.status === "cancelled" ? (
            <p className="text-ink-muted">Import was cancelled before this label was checked.</p>
          ) : application.status === "error" ? (
            <ErrorCard message={application.errorMessage ?? "Verification failed."} />
          ) : (
            <div className={compact ? "min-h-0 flex-1 overflow-y-auto border border-border" : "border border-border"}>
              {fields.map((field, index) => {
                const meta = FIELD_STATUS_META[field.status];
                return (
                  <div
                    key={field.field}
                    className={`border-l-4 bg-paper ${compact ? "p-3" : "p-4"} ${meta.edgeClassName} ${index > 0 ? "border-t border-border" : ""}`}
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
                        <dd className="wrap-break-word text-ink">{field.expected ?? "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-muted">Found on label</dt>
                        <dd className="wrap-break-word text-ink">{field.extracted ?? "-"}</dd>
                      </div>
                    </dl>
                    {field.detail && <p className="mt-2 text-sm text-ink-muted">{field.detail}</p>}
                    {field.secondOpinion && (
                      <p className="mt-2 border-t border-border pt-2 text-sm text-ink-muted">
                        Second check:{" "}
                        {field.secondOpinion.agreesWithFirstPass
                          ? "a second model read the label the same way."
                          : `a second model read this as "${field.secondOpinion.extracted ?? "nothing"}" instead. Confirm manually.`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/** Pre-fills the rejection box from what the automated check flagged, so the
 *  common rejection is a confirmation rather than an essay. A `not_shown`
 *  field gets its own line rather than the generic one: it's an evidence gap
 *  ("nobody photographed this"), not a finding against the label, so the
 *  rejection basis it suggests is "send a better photo", not the field's
 *  raw detail text. `not_required` is excluded entirely, because the label is
 *  allowed to omit it and it is not a basis for rejecting anything. */
export function suggestedReason(fields: FieldResult[]): string {
  const flagged = fields.filter((f) => f.status !== "match" && f.status !== "not_required");
  if (flagged.length === 0) return "";
  return flagged
    .map((f) =>
      f.status === "not_shown"
        ? `${f.label}: not visible in the photos supplied - a clearer photo is needed.`
        : `${f.label}: ${f.detail ?? "does not match the application."}`
    )
    .join("\n");
}

export function DecisionRecord({ application }: { application: ApplicationRecord }) {
  const decided = application.decision ? DECISION_META[application.decision] : null;
  if (!decided) return null;
  return (
    <div className="space-y-2">
      <p className={`inline-flex items-center gap-2 rounded border px-3 py-1 font-semibold ${decided.className}`}>
        <span aria-hidden>{decided.glyph}</span>
        {decided.label} on {new Date(application.decidedAt!).toLocaleString()}
      </p>
      {application.decisionReason && (
        <p className="whitespace-pre-line text-sm text-ink-muted">{application.decisionReason}</p>
      )}
    </div>
  );
}

/**
 * Approve, reject with a reason, and whatever extra action the surface wants
 * beside them. The asymmetry is deliberate and enforced by the server too: a
 * rejection needs a recorded basis, an approval does not, because the common
 * case is "everything matched" and demanding a note there would only train
 * people to type "ok".
 */
export function DecisionControls({
  application,
  onDecided,
  extraAction,
}: {
  application: ApplicationRecord;
  onDecided: (updated: ApplicationRecord) => void;
  /** Rendered alongside Approve/Reject. Used by the flow for Skip. */
  extraAction?: React.ReactNode;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(() => suggestedReason(application.fields ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (application.status !== "done") return null;

  return (
    <div>
      {error && <p className="mb-3 border-l-4 border-reject bg-reject-bg p-3 text-sm text-reject">{error}</p>}

      {rejecting ? (
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
          {extraAction}
        </div>
      )}
    </div>
  );
}

/** The header line both surfaces show above a review. */
export function ReviewHeading({ application }: { application: ApplicationRecord }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-ink">{application.brandName}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Added {new Date(application.createdAt).toLocaleString()}
        {typeof application.processingMs === "number" && (
          <span className="ml-2">
            &middot; checked in{" "}
            <span className={classifyProcessingTime(application.processingMs) === "over" ? "text-flag" : undefined}>
              {formatProcessingTime(application.processingMs)}
            </span>
          </span>
        )}
      </p>
    </div>
  );
}
