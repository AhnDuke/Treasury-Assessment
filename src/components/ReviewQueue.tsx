"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorCard } from "./ResultsCard";
import { ReviewModal } from "./ReviewModal";
import { DECISION_META, TRIAGE_STATUS_META } from "@/lib/statusMeta";
import { classifyProcessingTime, formatProcessingTime, TARGET_PROCESSING_MS } from "@/lib/processingTime";
import type { ApplicationRecord, ApplicationStatus } from "@/lib/types";

type TabKey = "clean" | "attention" | "approved" | "rejected" | "not_ready";

const TABS: { key: TabKey; label: string; test: (a: ApplicationRecord) => boolean }[] = [
  // Order follows the working day: the easy pile, then the judgement calls,
  // then what's already been signed off. "Not ready" is last but present -
  // an application that vanishes from every tab never gets adjudicated, and
  // in a compliance queue that's a defect, not a tidy default.
  { key: "clean", label: "Clean matches", test: (a) => a.status === "done" && !a.decision && a.triageStatus === "clean" },
  { key: "attention", label: "Needs attention", test: (a) => a.status === "done" && !a.decision && a.triageStatus !== "clean" },
  { key: "approved", label: "Approved", test: (a) => a.decision === "approved" },
  { key: "rejected", label: "Rejected", test: (a) => a.decision === "rejected" },
  { key: "not_ready", label: "Not ready", test: (a) => a.status !== "done" },
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

/** Identifies what a row is currently showing, so a poll can tell whether
 *  anything an agent would notice has actually changed. */
function queueSignature(list: ApplicationRecord[]): string {
  return list
    .map((a) => `${a.id}:${a.status}:${a.triageStatus ?? ""}:${a.decision ?? ""}:${a.processingMs ?? ""}`)
    .join("|");
}

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

export function ReviewQueue() {
  const [applications, setApplications] = useState<ApplicationRecord[] | null>(null);
  /** Fetched by the poll but deliberately not shown yet. See loadApplications. */
  const [incoming, setIncoming] = useState<ApplicationRecord[] | null>(null);
  const [tab, setTab] = useState<TabKey>("clean");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("added");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Background polls stage their result instead of applying it. Rows
   * rearranging themselves under a reviewer's cursor while they are reading
   * one is worse than being slightly out of date, so a poll only offers the
   * update and the agent takes it when they are ready. Anything the agent
   * themselves did (a decision, a delete, a resume) applies immediately,
   * because they are expecting that change.
   */
  const loadApplications = useCallback(async (apply: boolean) => {
    try {
      const response = await fetch("/api/applications");
      if (!response.ok) throw new Error(`The server returned an error (${response.status}).`);
      const data = await response.json();
      const list: ApplicationRecord[] = data.applications ?? [];
      if (apply) {
        setApplications(list);
        setIncoming(null);
      } else {
        setIncoming(list);
      }
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
    loadApplications(true);
  }, [loadApplications]);

  const hasInFlight = applications?.some((a) => a.status === "pending" || a.status === "processing") ?? false;

  useEffect(() => {
    // Checked often while a batch is running, and still occasionally when the
    // queue looks idle: this app has no auth and one shared queue, so work can
    // finish because of a cron sweep or another reviewer, not only because of
    // something this tab started.
    const interval = setInterval(() => void loadApplications(false), hasInFlight ? 5000 : 20000);
    return () => clearInterval(interval);
  }, [hasInFlight, loadApplications]);

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this application? This can't be undone.")) return;
    setBusyId(id);
    await fetch(`/api/applications/${id}`, { method: "DELETE" });
    await loadApplications(true);
    setBusyId(null);
  }

  async function handleCancelBatch(batchId: string) {
    setBusyId(batchId);
    await fetch(`/api/applications/import/${batchId}/cancel`, { method: "POST" });
    await loadApplications(true);
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

  function handleApplyUpdates() {
    if (!incoming) return;
    setApplications(incoming);
    setIncoming(null);
  }

  async function handleResume(batchId: string) {
    setBusyId(batchId);
    await fetch("/api/applications/process", { method: "POST" });
    await loadApplications(true);
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

  // How many rows the poll has seen change or appear since what is on screen.
  // Compared by signature rather than by length so a row finishing its check
  // counts, not just a row being added.
  const updatedCount = (() => {
    if (!incoming) return 0;
    if (queueSignature(incoming) === queueSignature(applications)) return 0;
    const before = new Map(applications.map((a) => [a.id, `${a.status}:${a.triageStatus ?? ""}:${a.decision ?? ""}`]));
    let changed = 0;
    for (const a of incoming) {
      const prev = before.get(a.id);
      if (prev === undefined || prev !== `${a.status}:${a.triageStatus ?? ""}:${a.decision ?? ""}`) changed += 1;
    }
    // A row disappearing is a change worth offering too.
    const incomingIds = new Set(incoming.map((a) => a.id));
    changed += applications.filter((a) => !incomingIds.has(a.id)).length;
    return changed;
  })();

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
            onClick={handleApplyUpdates}
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
              ? `Nothing in ${TABS.find((t) => t.key === tab)!.label.toLowerCase()} matches "${search}".`
              : `Nothing in ${TABS.find((t) => t.key === tab)!.label.toLowerCase()} right now.`}
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
            setApplications((prev) => (prev ?? []).map((a) => (a.id === updated.id ? updated : a)));
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}
