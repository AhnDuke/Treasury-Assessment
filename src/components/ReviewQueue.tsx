"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorCard } from "./ResultsCard";
import { ReviewModal } from "./ReviewModal";
import { DECISION_META, TRIAGE_STATUS_META } from "@/lib/statusMeta";
import type { ApplicationRecord, ApplicationStatus } from "@/lib/types";

type TabKey = "clean" | "attention" | "approved" | "rejected" | "not_ready";

const TABS: { key: TabKey; label: string; test: (a: ApplicationRecord) => boolean }[] = [
  // Order follows the working day: the easy pile, then the judgement calls,
  // then what's already been signed off. "Not ready" is last but present —
  // an application that vanishes from every tab never gets adjudicated, and
  // in a compliance queue that's a defect, not a tidy default.
  { key: "clean", label: "Clean matches", test: (a) => a.status === "done" && !a.decision && a.triageStatus === "clean" },
  { key: "attention", label: "Needs attention", test: (a) => a.status === "done" && !a.decision && a.triageStatus !== "clean" },
  { key: "approved", label: "Approved", test: (a) => a.decision === "approved" },
  { key: "rejected", label: "Rejected", test: (a) => a.decision === "rejected" },
  { key: "not_ready", label: "Not ready", test: (a) => a.status !== "done" },
];

type SortKey = "newest" | "oldest" | "brand";

const SORTS: { key: SortKey; label: string; compare: (a: ApplicationRecord, b: ApplicationRecord) => number }[] = [
  { key: "newest", label: "Newest first", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
  { key: "oldest", label: "Oldest first", compare: (a, b) => a.createdAt.localeCompare(b.createdAt) },
  { key: "brand", label: "Brand name (A-Z)", compare: (a, b) => a.brandName.localeCompare(b.brandName) },
];

const LIFECYCLE_META: Record<Exclude<ApplicationStatus, "done">, { label: string; className: string }> = {
  pending: { label: "Pending", className: "text-ink-muted bg-paper-muted border-border" },
  processing: { label: "Processing…", className: "text-seal bg-paper-muted border-seal" },
  cancelled: { label: "Cancelled", className: "text-ink-muted bg-paper-muted border-border" },
  error: { label: "Error", className: "text-reject bg-reject-bg border-reject-border" },
};

function StatusBadge({ application }: { application: ApplicationRecord }) {
  if (application.status === "done" && application.triageStatus) {
    const meta = TRIAGE_STATUS_META[application.triageStatus];
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-sm ${meta.className}`}>
        <span aria-hidden>{meta.glyph}</span>
        {meta.shortLabel}
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

export function ReviewQueue() {
  const [applications, setApplications] = useState<ApplicationRecord[] | null>(null);
  const [tab, setTab] = useState<TabKey>("clean");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [openId, setOpenId] = useState<string | null>(null);
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

  const query = search.trim().toLowerCase();
  const visible = applications
    .filter(TABS.find((t) => t.key === tab)!.test)
    .filter(
      (a) =>
        !query ||
        a.brandName.toLowerCase().includes(query) ||
        a.classType.toLowerCase().includes(query)
    )
    .sort(SORTS.find((s) => s.key === sort)!.compare);

  // Looked up fresh on every render rather than trusted from when the modal
  // was opened: this queue has no auth and is shared, so another reviewer
  // (or the 5s poll) can remove the open row out from under this session.
  const openApplication = openId ? (applications.find((a) => a.id === openId) ?? null) : null;

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
        {TABS.map((t) => {
          const count = applications.filter(t.test).length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`border px-3 py-1.5 text-sm font-medium ${
                tab === t.key ? "border-seal bg-seal text-paper" : "border-border text-ink-muted hover:text-ink"
              }`}
            >
              {t.label}
              <span className={tab === t.key ? "ml-2 text-paper/80" : "ml-2 text-ink-muted/70"}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex-1">
          <span className="sr-only">Search by brand or class/type</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by brand or class/type"
            className="w-full border border-border bg-paper px-3 py-2 text-ink placeholder:text-ink-muted"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">Sort</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="border border-border bg-paper px-3 py-2 text-ink"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 && (
        <p className="border border-dashed border-border p-8 text-center text-ink-muted">
          {applications.length === 0
            ? "No applications yet. Add one from the Add applications tab to get started."
            : query
              ? `Nothing in ${TABS.find((t) => t.key === tab)!.label.toLowerCase()} matches "${search}".`
              : `Nothing in ${TABS.find((t) => t.key === tab)!.label.toLowerCase()} right now.`}
        </p>
      )}

      {visible.length > 0 && (
        <div className="overflow-x-auto border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-paper-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-ink-muted">Brand</th>
                <th className="px-4 py-2 text-left font-medium text-ink-muted">File</th>
                <th className="px-4 py-2 text-left font-medium text-ink-muted">Status</th>
                <th className="px-4 py-2 text-left font-medium text-ink-muted">Decision</th>
                <th className="px-4 py-2 text-left font-medium text-ink-muted">Added</th>
                <th className="px-4 py-2 text-left font-medium text-ink-muted" aria-hidden />
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-paper">
              {visible.map((application) => (
                <tr key={application.id} className="align-top">
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
                  <td className="px-4 py-3 whitespace-nowrap">
                    {application.decision ? (
                      <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-sm ${DECISION_META[application.decision].className}`}>
                        <span aria-hidden>{DECISION_META[application.decision].glyph}</span>
                        {DECISION_META[application.decision].label}
                      </span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{new Date(application.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setOpenId(application.id)}
                      disabled={application.status !== "done"}
                      className="mr-3 font-medium text-seal hover:underline disabled:cursor-not-allowed disabled:text-ink-muted disabled:no-underline"
                    >
                      Review
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openApplication && (
        <ReviewModal
          application={openApplication}
          onClose={() => setOpenId(null)}
          onDecided={(updated) => {
            setApplications((prev) => (prev ?? []).map((a) => (a.id === updated.id ? updated : a)));
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}
