"use client";

import { useState } from "react";
import { ErrorCard } from "./ResultsCard";
import { ReviewModal } from "./ReviewModal";
import { DECISION_META, TRIAGE_STATUS_META } from "@/lib/statusMeta";
import { classifyProcessingTime, formatProcessingTime, TARGET_PROCESSING_MS } from "@/lib/processingTime";
import type { ApplicationsState } from "@/lib/useApplications";
import type { ApplicationRecord, ApplicationStatus } from "@/lib/types";

type TabKey = "needs_review" | "reviewed";

/**
 * Two tabs, split on the only question that decides whether an agent still
 * has work to do: has a person signed this off yet.
 *
 * The automated check's own opinion deliberately does not get a tab. It is a
 * triage signal, not a verdict, and giving it navigation of its own invited
 * reading it as one. It lives in the sortable Status column instead, so an
 * agent who wants the discrepancies first sorts by Status and gets them,
 * without the machine having decided anything.
 *
 * Applications that are not checked yet, or that were cancelled or errored,
 * stay in Needs review rather than getting a tab of their own. They still need
 * a person eventually, and an application that is visible nowhere never gets
 * adjudicated, which in a compliance queue is a defect rather than a tidy
 * default. Their Status badge says why they cannot be acted on yet.
 *
 * The two predicates are exact complements, so every application is in exactly
 * one tab by construction.
 */
const TABS: { key: TabKey; label: string; test: (a: ApplicationRecord) => boolean }[] = [
  { key: "needs_review", label: "Needs review", test: (a) => !a.decision },
  { key: "reviewed", label: "Reviewed", test: (a) => Boolean(a.decision) },
];

type SortKey = "brand" | "file" | "status" | "checked" | "decision" | "added";
type SortDir = "asc" | "desc";

/**
 * Orders an application by where it sits in the workflow, so sorting the
 * Status column groups the queue the way an agent thinks about it rather than
 * alphabetically by badge text: still coming, then finished (cleanest first),
 * then the ones that went wrong.
 */
function statusRank(a: ApplicationRecord): number {
  if (a.status !== "done") {
    return { pending: 0, processing: 1, cancelled: 8, error: 9 }[a.status] ?? 9;
  }
  return 3 + ({ clean: 0, review: 1, discrepancy: 2 }[a.triageStatus ?? "discrepancy"] ?? 2);
}

/**
 * Comparators take the direction themselves rather than having their result
 * negated afterwards, so a column can keep rows with nothing to sort by at the
 * bottom in both directions. Flipping the sign of the whole comparison would
 * float every blank to the top the moment you reversed the order, which reads
 * as the table being broken.
 */
function missingLast<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  dir: SortDir,
  compare: (x: T, y: T) => number
): number {
  const aMissing = a === null || a === undefined || a === "";
  const bMissing = b === null || b === undefined || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  const result = compare(a as T, b as T);
  return dir === "asc" ? result : -result;
}

function plain(result: number, dir: SortDir): number {
  return dir === "asc" ? result : -result;
}

const COLUMNS: {
  key: SortKey;
  label: string;
  hint?: string;
  numeric?: boolean;
  /** Which direction a first click should use, so the useful order comes first. */
  firstDir: SortDir;
  compare: (a: ApplicationRecord, b: ApplicationRecord, dir: SortDir) => number;
}[] = [
  { key: "brand", label: "Brand", firstDir: "asc", compare: (a, b, d) => plain(a.brandName.localeCompare(b.brandName), d) },
  {
    key: "file",
    label: "File",
    firstDir: "asc",
    compare: (a, b, d) => missingLast(a.images[0]?.filename, b.images[0]?.filename, d, (x, y) => x.localeCompare(y)),
  },
  { key: "status", label: "Status", firstDir: "asc", compare: (a, b, d) => plain(statusRank(a) - statusRank(b), d) },
  {
    key: "checked",
    label: "Checked in",
    hint: `(target ${TARGET_PROCESSING_MS / 1000}s)`,
    numeric: true,
    firstDir: "desc",
    compare: (a, b, d) => missingLast(a.processingMs, b.processingMs, d, (x, y) => x - y),
  },
  {
    key: "decision",
    label: "Decision",
    firstDir: "asc",
    compare: (a, b, d) => missingLast(a.decision, b.decision, d, (x, y) => x.localeCompare(y)),
  },
  { key: "added", label: "Added", firstDir: "desc", compare: (a, b, d) => plain(a.createdAt.localeCompare(b.createdAt), d) },
];

const LIFECYCLE_META: Record<Exclude<ApplicationStatus, "done">, { label: string; className: string }> = {
  pending: { label: "Pending", className: "text-ink-muted bg-paper-muted border-border" },
  processing: { label: "Processing…", className: "text-seal bg-paper-muted border-seal" },
  cancelled: { label: "Cancelled", className: "text-ink-muted bg-paper-muted border-border" },
  error: { label: "Error", className: "text-reject bg-reject-bg border-reject-border" },
};

/**
 * How long the automated check took on this application.
 *
 * Only a time over the target is coloured, and in the neutral flag tone rather
 * than the reject one: a slow check says something about the check, not about
 * the label, and an agent scanning this column should not read it as a finding
 * against the application.
 */
function ProcessingTimeCell({ ms }: { ms: number | null }) {
  const speed = classifyProcessingTime(ms);
  if (speed === "unknown") return <span className="text-ink-muted">-</span>;
  return (
    <span
      className={speed === "over" ? "text-flag" : "text-ink-muted"}
      title={speed === "over" ? `Slower than the ${TARGET_PROCESSING_MS / 1000}s target` : undefined}
    >
      {formatProcessingTime(ms)}
    </span>
  );
}

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
  // Fallback for a "done" row with no triage status: type-legal (triageStatus
  // is TriageStatus | null) and not reachable through this app's own writes
  // today, but db/schema.sql documents that triage_status carries no CHECK
  // constraint on an existing database. A render-time throw here would take
  // out the whole queue for one bad row, so this degrades to a neutral badge
  // instead of indexing LIFECYCLE_META (which has no "done" key) with undefined.
  const meta = LIFECYCLE_META[application.status as Exclude<ApplicationStatus, "done">] ?? {
    label: "Unknown",
    className: "text-ink-muted bg-paper-muted border-border",
  };
  return <span className={`inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-sm ${meta.className}`}>{meta.label}</span>;
}

interface BatchGroup {
  importBatchId: string;
  total: number;
  finished: number;
}

export function ReviewQueue({
  applications,
  loadError,
  updatedCount,
  applyUpdates,
  reload,
  replace,
}: ApplicationsState) {
  const [tab, setTab] = useState<TabKey>("needs_review");
  const [search, setSearch] = useState("");
  // Status by default, so the queue opens already ordered the way the work
  // gets done: the clean matches an agent can clear quickly, then the ones
  // needing attention, then the discrepancies, then what is not checked yet.
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);


  async function handleDelete(id: string) {
    if (!window.confirm("Remove this application? This can't be undone.")) return;
    setBusyId(id);
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    await reload();
    setBusyId(null);
  }

  async function handleCancelBatch(batchId: string) {
    setBusyId(batchId);
    await fetch(`/api/applications/import/${batchId}/cancel`, { method: "POST" });
    await reload();
    setBusyId(null);
  }

  /** First click on a column uses that column's most useful direction, and
   *  clicking the same one again reverses it. */
  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(COLUMNS.find((c) => c.key === key)!.firstDir);
  }

  async function handleResume(batchId: string) {
    setBusyId(batchId);
    await fetch("/api/applications/process", { method: "POST" });
    await reload();
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


  const column = COLUMNS.find((c) => c.key === sortKey)!;
  const query = search.trim().toLowerCase();
  const visible = applications
    .filter(TABS.find((t) => t.key === tab)!.test)
    .filter(
      (a) =>
        !query ||
        a.brandName.toLowerCase().includes(query) ||
        a.classType.toLowerCase().includes(query)
    )
    .sort((a, b) => column.compare(a, b, sortDir));

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

      {updatedCount > 0 && (
        <div
          // Announced politely so a screen-reader user hears that new results
          // exist without being interrupted mid-row.
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-seal bg-paper-muted p-3 text-sm"
        >
          <span className="text-ink">
            {updatedCount} application{updatedCount === 1 ? " has" : "s have"} finished or changed since this list loaded.
          </span>
          <button
            type="button"
            onClick={applyUpdates}
            className="border border-seal px-3 py-1.5 font-medium text-seal hover:bg-paper"
          >
            Refresh
          </button>
        </div>
      )}


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
      </div>

      {visible.length === 0 && (
        <p className="border border-dashed border-border p-8 text-center text-ink-muted">
          {applications.length === 0
            ? "No applications yet. Add one from the Add applications tab to get started."
            : query
              ? tab === "needs_review"
                ? `Nothing waiting for review matches "${search}".`
                : `Nothing already reviewed matches "${search}".`
              : tab === "needs_review"
                ? "Nothing is waiting for review. Everything has been signed off."
                : "Nothing has been reviewed yet."}
        </p>
      )}

      {visible.length > 0 && (
        <div className="overflow-x-auto border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-paper-muted">
              <tr>
                {COLUMNS.map((column) => {
                  const active = sortKey === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      // aria-sort is what tells a screen reader this table is
                      // sorted and which way, which the arrow only conveys
                      // visually.
                      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                      className="px-4 py-2 text-left font-medium whitespace-nowrap text-ink-muted"
                    >
                      <button
                        type="button"
                        onClick={() => handleSort(column.key)}
                        className={`group inline-flex items-center gap-1 whitespace-nowrap hover:text-ink ${active ? "text-ink" : ""}`}
                      >
                        {column.label}
                        {column.hint && <span className="font-normal text-ink-muted/70">{column.hint}</span>}
                        <span aria-hidden className={active ? "text-seal" : "text-ink-muted/0 group-hover:text-ink-muted/60"}>
                          {active && sortDir === "asc" ? "▲" : "▼"}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th className="px-4 py-2 text-left font-medium text-ink-muted" aria-hidden />
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-paper">
              {visible.map((application) => (
                // Clicking anywhere on the row opens it, as a second way in
                // alongside the Review button. No role or tabIndex is added
                // here on purpose: overriding a table row's semantics would
                // cost screen-reader users the row/column relationships, and
                // the Review button already gives keyboard and assistive-tech
                // users a real control that does the same thing.
                <tr
                  key={application.id}
                  onClick={() => {
                    // Selecting text in a cell should not count as a click,
                    // or copying a brand name would open the modal.
                    if (window.getSelection()?.toString()) return;
                    setOpenId(application.id);
                  }}
                  className="cursor-pointer align-top transition-colors hover:bg-paper-muted"
                >
                  <td className="px-4 py-3 font-medium text-ink">{application.brandName}</td>
                  <td className="max-w-40 truncate px-4 py-3 text-ink-muted">
                    {application.images[0]?.filename ?? "-"}
                    {application.images.length > 1 && (
                      <span className="text-ink-muted/70"> +{application.images.length - 1}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge application={application} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                    <ProcessingTimeCell ms={application.processingMs} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {application.decision ? (
                      <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-sm ${DECISION_META[application.decision].className}`}>
                        <span aria-hidden>{DECISION_META[application.decision].glyph}</span>
                        {DECISION_META[application.decision].label}
                      </span>
                    ) : (
                      <span className="text-ink-muted">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{new Date(application.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenId(application.id);
                      }}
                      className="mr-3 font-medium text-seal hover:underline"
                    >
                      {application.status === "done" ? "Review" : "Details"}
                    </button>
                    <button
                      type="button"
                      // Stopped from bubbling, or deleting a row would also
                      // open the row being deleted.
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDelete(application.id);
                      }}
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
            replace(updated);
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}
