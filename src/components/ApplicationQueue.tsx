"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ErrorCard, ResultsCard } from "./ResultsCard";
import { OVERALL_STATUS_META } from "@/lib/statusMeta";
import type { ApplicationRecord, ApplicationStatus } from "@/lib/types";

type FilterKey = "all" | "in_progress" | "needs_review" | "approved" | "other";

const FILTERS: { key: FilterKey; label: string; test: (a: ApplicationRecord) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "in_progress", label: "In progress", test: (a) => a.status === "pending" || a.status === "processing" },
  { key: "needs_review", label: "Needs review", test: (a) => a.status === "done" && a.overallStatus !== "approved" },
  { key: "approved", label: "Approved", test: (a) => a.status === "done" && a.overallStatus === "approved" },
  { key: "other", label: "Cancelled / error", test: (a) => a.status === "cancelled" || a.status === "error" },
];

const LIFECYCLE_META: Record<Exclude<ApplicationStatus, "done">, { label: string; className: string }> = {
  pending: { label: "Pending", className: "text-ink-muted bg-paper-muted border-border" },
  processing: { label: "Processing…", className: "text-seal bg-paper-muted border-seal" },
  cancelled: { label: "Cancelled", className: "text-ink-muted bg-paper-muted border-border" },
  error: { label: "Error", className: "text-reject bg-reject-bg border-reject-border" },
};

function StatusBadge({ application }: { application: ApplicationRecord }) {
  if (application.status === "done" && application.overallStatus) {
    const meta = OVERALL_STATUS_META[application.overallStatus];
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-sm ${meta.className}`}>
        <span aria-hidden>{meta.glyph}</span>
        {meta.label.replace(/ —.*/, "")}
      </span>
    );
  }
  const meta = LIFECYCLE_META[application.status as Exclude<ApplicationStatus, "done">];
  return <span className={`inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-sm ${meta.className}`}>{meta.label}</span>;
}

interface BatchGroup {
  importBatchId: string;
  total: number;
  finished: number;
}

export function ApplicationQueue() {
  const [applications, setApplications] = useState<ApplicationRecord[] | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchApplications = useCallback(async () => {
    try {
      const response = await fetch("/api/applications");
      if (!response.ok) throw new Error(`The server returned an error (${response.status}).`);
      const data = await response.json();
      setApplications(data.applications ?? []);
      setLoadError(null);
    } catch {
      setLoadError("Could not load the review queue. Check the server configuration and try again.");
    }
  }, []);

  useEffect(() => {
    // A data-fetching library (SWR/React Query) is the "by the book" answer
    // to this lint rule, but is more than this prototype's timeline
    // justifies for a single fetch-on-mount-and-poll view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchApplications();
  }, [fetchApplications]);

  const hasInFlight = applications?.some((a) => a.status === "pending" || a.status === "processing") ?? false;

  useEffect(() => {
    if (!hasInFlight) return;
    const interval = setInterval(fetchApplications, 5000);
    return () => clearInterval(interval);
  }, [hasInFlight, fetchApplications]);

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this application? This can't be undone.")) return;
    setBusyId(id);
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    await fetchApplications();
    setBusyId(null);
  }

  async function handleCancelBatch(batchId: string) {
    setBusyId(batchId);
    await fetch(`/api/applications/import/${batchId}/cancel`, { method: "POST" });
    await fetchApplications();
    setBusyId(null);
  }

  async function handleResume(batchId: string) {
    setBusyId(batchId);
    await fetch("/api/applications/process", { method: "POST" });
    await fetchApplications();
    setBusyId(null);
  }

  if (loadError) {
    return <ErrorCard title="Could not load the review queue" message={loadError} />;
  }
  if (applications === null) {
    return <p className="text-ink-muted">Loading applications…</p>;
  }

  const batchGroups: BatchGroup[] = [];
  const seenBatches = new Set<string>();
  for (const application of applications) {
    if (!application.importBatchId || seenBatches.has(application.importBatchId)) continue;
    const rows = applications.filter((a) => a.importBatchId === application.importBatchId);
    const pendingCount = rows.filter((a) => a.status === "pending" || a.status === "processing").length;
    if (pendingCount === 0) continue;
    seenBatches.add(application.importBatchId);
    batchGroups.push({
      importBatchId: application.importBatchId,
      total: rows.length,
      finished: rows.length - pendingCount,
    });
  }

  const filtered = applications.filter(FILTERS.find((f) => f.key === filter)!.test);

  return (
    <div className="space-y-6">
      {batchGroups.map((batch) => (
        <div key={batch.importBatchId} className="flex items-center justify-between border-l-4 border-seal bg-paper-muted p-3 text-sm">
          <span className="text-ink">
            Import in progress: {batch.finished}/{batch.total} processed
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => handleResume(batch.importBatchId)}
              disabled={busyId === batch.importBatchId}
              className="border border-seal px-2 py-1 text-seal hover:bg-paper disabled:opacity-50"
            >
              Resume processing
            </button>
            <button
              type="button"
              onClick={() => handleCancelBatch(batch.importBatchId)}
              disabled={busyId === batch.importBatchId}
              className="border border-reject px-2 py-1 text-reject hover:bg-reject-bg disabled:opacity-50"
            >
              Cancel remaining
            </button>
          </span>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`border px-3 py-1 text-sm font-medium ${
              filter === f.key ? "border-seal bg-seal text-paper" : "border-border text-ink-muted hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {applications.length === 0 ? (
        <p className="border border-dashed border-border p-8 text-center text-ink-muted">
          No applications yet. Add one to get started.
        </p>
      ) : filtered.length === 0 ? (
        <p className="border border-dashed border-border p-8 text-center text-ink-muted">Nothing matches this filter.</p>
      ) : (
        <div className="overflow-x-auto border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-paper-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-ink-muted">Brand</th>
                <th className="px-4 py-2 text-left font-medium text-ink-muted">File</th>
                <th className="px-4 py-2 text-left font-medium text-ink-muted">Status</th>
                <th className="px-4 py-2 text-left font-medium text-ink-muted">Added</th>
                <th className="px-4 py-2 text-left font-medium text-ink-muted" aria-hidden />
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-paper">
              {filtered.map((application) => {
                const isOpen = expandedId === application.id;
                return (
                  <Fragment key={application.id}>
                    <tr className="align-top">
                      <td className="px-4 py-3 font-medium text-ink">{application.brandName}</td>
                      <td className="max-w-40 truncate px-4 py-3 text-ink-muted">
                        {application.images[0]?.filename ?? "—"}
                        {application.images.length > 1 && (
                          <span className="text-ink-muted/70"> +{application.images.length - 1}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge application={application} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{new Date(application.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isOpen ? null : application.id)}
                          className="mr-3 font-medium text-seal hover:underline"
                        >
                          {isOpen ? "Hide" : "View"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(application.id)}
                          disabled={busyId === application.id}
                          className="font-medium text-ink-muted hover:text-reject disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} className="bg-paper-muted p-4">
                          {application.status === "pending" || application.status === "processing" ? (
                            <p className="text-ink-muted">Still processing — check back shortly.</p>
                          ) : application.status === "cancelled" ? (
                            <p className="text-ink-muted">Import was cancelled before this label was checked.</p>
                          ) : application.status === "error" ? (
                            <ErrorCard message={application.errorMessage ?? "Verification failed."} />
                          ) : (
                            <ResultsCard overallStatus={application.overallStatus ?? "rejected"} fields={application.fields ?? []} />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
