"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorCard } from "./ResultsCard";
import { FileDropzone } from "./FileDropzone";
import { ApplicationFields, formBeverageType, isApplicationFormFilled, type ApplicationFormState } from "./ApplicationFields";
import { acceptFiles, LabelPhotoPicker, type PendingImage } from "./LabelPhotoPicker";
import { clearImportSession, loadImportSession, saveImportSession } from "@/lib/importSession";
import { describeImageCountProblem, uploadLabelImages } from "@/lib/uploadImages";
import { MAX_IMAGES_PER_APPLICATION } from "@/lib/types";

/** One parsed spreadsheet row as the agent works it. */
interface WorkRow {
  rowNumber: number;
  form: ApplicationFormState;
  /** Filenames the sheet named, shown as a hint. The app never resolves them. */
  suggestedFilenames: string[];
  images: PendingImage[];
  state: "todo" | "submitted" | "scrapped";
  error: string | null;
}

interface ParsedResponse {
  importBatchId: string;
  rows: { rowNumber: number; data: { brandName: string; classType: string; abvPercent: number; netContents: string; bottlerInfo?: string | null; countryOfOrigin?: string | null; beverageType?: string | null }; suggestedFilenames: string[] }[];
  errors: string[];
}

export function GuidedImport({ onViewQueue }: { onViewQueue: () => void }) {
  const [spreadsheet, setSpreadsheet] = useState<File | null>(null);
  const [spreadsheetName, setSpreadsheetName] = useState<string>("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [skippedRows, setSkippedRows] = useState<string[]>([]);
  /** Photos that were attached but not submitted when a restored session was saved. */
  const [photosLostOnRestore, setPhotosLostOnRestore] = useState(0);

  const [batchId, setBatchId] = useState<string | null>(null);
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // Nothing queued by this import is checked until the whole sheet is handled
  // - see startProcessing.
  const [startState, setStartState] = useState<"idle" | "starting" | "started" | "failed">("idle");

  const counts = useMemo(
    () => ({
      submitted: rows.filter((r) => r.state === "submitted").length,
      scrapped: rows.filter((r) => r.state === "scrapped").length,
      todo: rows.filter((r) => r.state === "todo").length,
    }),
    [rows]
  );

  // Restored after the first paint rather than in a lazy initialiser: this
  // panel is server-rendered, sessionStorage is not readable there, and
  // seeding state from it during the first client render would be a hydration
  // mismatch. One extra frame showing the empty state is the cost.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const session = loadImportSession();
    if (!session) return;
    /* eslint-disable react-hooks/set-state-in-effect --
       The rule guards against cascading renders from setState in an effect.
       These run once, on mount, and React batches them into a single render.
       The alternative the rule points at, seeding state during render, is not
       available: sessionStorage cannot be read while server-rendering, so
       doing it in an initialiser would make the first client render disagree
       with the server's and break hydration. */
    setBatchId(session.batchId);
    setSpreadsheetName(session.spreadsheetName);
    setSkippedRows(session.skippedRows ?? []);
    setStartState(session.startState ?? "idle");
    setActiveIndex(Math.min(session.activeIndex ?? 0, session.rows.length - 1));
    setRows(
      session.rows.map((row) => ({
        rowNumber: row.rowNumber,
        form: row.form,
        suggestedFilenames: row.suggestedFilenames ?? [],
        images: [],
        state: row.state,
        error: null,
      }))
    );
    setPhotosLostOnRestore(
      session.rows.reduce((sum, row) => (row.state === "todo" ? sum + (row.attachedPhotoCount ?? 0) : sum), 0)
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Mirrors the session to storage on every change, so a reload at any moment
  // lands on what the agent last saw rather than on the last explicit save.
  useEffect(() => {
    if (rows.length === 0 || !batchId) return;
    saveImportSession({
      batchId,
      spreadsheetName,
      activeIndex,
      skippedRows,
      startState,
      rows: rows.map((row) => ({
        rowNumber: row.rowNumber,
        form: row.form,
        suggestedFilenames: row.suggestedFilenames,
        state: row.state,
        attachedPhotoCount: row.images.length,
      })),
    });
  }, [rows, batchId, spreadsheetName, activeIndex, skippedRows, startState]);

  async function handleParse() {
    if (!spreadsheet) return;
    setParsing(true);
    setParseError(null);
    try {
      const body = new FormData();
      body.append("spreadsheet", spreadsheet);
      const response = await fetch("/api/applications/import/parse", { method: "POST", body });
      const data = (await response.json()) as ParsedResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not read that spreadsheet.");

      setBatchId(data.importBatchId);
      setSpreadsheetName(spreadsheet.name);
      setSkippedRows(data.errors ?? []);
      setPhotosLostOnRestore(0);
      setStartState("idle");
      setRows(
        data.rows.map((row) => ({
          rowNumber: row.rowNumber,
          form: {
            brandName: row.data.brandName,
            classType: row.data.classType,
            abvPercent: String(row.data.abvPercent),
            netContents: row.data.netContents,
            bottlerInfo: row.data.bottlerInfo ?? "",
            countryOfOrigin: row.data.countryOfOrigin ?? "",
            beverageType: row.data.beverageType ?? "",
          },
          suggestedFilenames: row.suggestedFilenames ?? [],
          images: [],
          state: "todo",
          error: null,
        }))
      );
      setActiveIndex(0);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read that spreadsheet.");
    } finally {
      setParsing(false);
    }
  }

  function updateRow(index: number, patch: Partial<WorkRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /**
   * Applies a change and hands back the resulting rows, so a caller can decide
   * what to do next from the new state rather than the stale closure - whether
   * to advance, and whether the sheet is now finished.
   */
  function applyRowChange(index: number, patch: Partial<WorkRow>): WorkRow[] {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    setRows(next);
    return next;
  }

  /** Moves to the next row still needing work, or stays put if none is left. */
  function advanceFrom(index: number, next: WorkRow[]) {
    const after = next.findIndex((row, i) => i > index && row.state === "todo");
    if (after !== -1) return setActiveIndex(after);
    const before = next.findIndex((row) => row.state === "todo");
    if (before !== -1) return setActiveIndex(before);
  }

  /**
   * Kicks off checking, once, after the last row is handled. Deliberately not
   * per-submit: an agent still working the sheet shouldn't be competing with a
   * stream of Claude calls, and rows flipping to "processing" underneath them
   * is noise. If every row was scrapped there is nothing queued to check.
   */
  async function startProcessing(next: WorkRow[]) {
    if (!next.some((row) => row.state === "submitted")) return;
    setStartState("starting");
    try {
      const response = await fetch("/api/applications/process", { method: "POST" });
      if (!response.ok) throw new Error();
      setStartState("started");
    } catch {
      // Left recoverable rather than swallowed: the rows are queued either
      // way, and the completion panel offers to try again.
      setStartState("failed");
    }
  }

  function afterRowHandled(index: number, next: WorkRow[]) {
    advanceFrom(index, next);
    if (!next.some((row) => row.state === "todo")) void startProcessing(next);
  }

  async function handleSubmitRow() {
    const row = rows[activeIndex];
    if (!row || !batchId || submitting) return;

    setSubmitting(true);
    updateRow(activeIndex, { error: null });
    try {
      // Straight to Blob from the browser - image bytes never go through our
      // API, which is what keeps this under Vercel's 4.5MB request cap.
      const uploaded = await uploadLabelImages(row.images.map((image) => image.file));
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandName: row.form.brandName,
          classType: row.form.classType,
          abvPercent: row.form.abvPercent,
          netContents: row.form.netContents,
          bottlerInfo: row.form.bottlerInfo,
          countryOfOrigin: row.form.countryOfOrigin,
          beverageType: formBeverageType(row.form),
          images: uploaded,
          importBatchId: batchId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not submit this application.");

      afterRowHandled(activeIndex, applyRowChange(activeIndex, { state: "submitted", error: null }));
    } catch (err) {
      updateRow(activeIndex, { error: err instanceof Error ? err.message : "Could not submit this application." });
    } finally {
      setSubmitting(false);
    }
  }

  function handleScrapRow() {
    afterRowHandled(activeIndex, applyRowChange(activeIndex, { state: "scrapped", error: null }));
  }

  /**
   * Abandons the current sheet and returns to the file picker. Needed once the
   * session survives reloads: without it a finished or unwanted import would
   * follow the agent around this tab with no way to dismiss it.
   */
  function handleStartOver() {
    const unfinished = rows.some((row) => row.state === "todo");
    const message = unfinished
      ? "Discard this import and choose a different spreadsheet? Rows you already submitted stay in the review queue, but the ones you haven't handled will be forgotten."
      : "Choose a different spreadsheet? Rows you already submitted stay in the review queue.";
    if (!window.confirm(message)) return;
    clearImportSession();
    setRows([]);
    setBatchId(null);
    setSpreadsheet(null);
    setSpreadsheetName("");
    setSkippedRows([]);
    setPhotosLostOnRestore(0);
    setStartState("idle");
    setActiveIndex(0);
  }

  function handleRestoreRow(index: number) {
    applyRowChange(index, { state: "todo", error: null });
    setActiveIndex(index);
    // Reopening means the sheet is unfinished again, so finishing it a second
    // time should start the newly queued rows.
    setStartState("idle");
  }

  // --- Step 1: choose a spreadsheet ---------------------------------------

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <div className="border border-border bg-paper-muted p-4 text-sm text-ink-muted">
          <p>
            Upload a spreadsheet (CSV or XLSX) of application data. Each row needs{" "}
            <code className="bg-paper px-1 py-0.5">brand_name</code>, <code className="bg-paper px-1 py-0.5">class_type</code>,{" "}
            <code className="bg-paper px-1 py-0.5">abv_percent</code> and <code className="bg-paper px-1 py-0.5">net_contents</code>.
          </p>
          <p className="mt-2">
            You&apos;ll then go through the rows one at a time - checking the details and attaching that
            application&apos;s label photos, so no filenames are needed in the sheet. If it has a{" "}
            <code className="bg-paper px-1 py-0.5">filenames</code> column it&apos;s shown as a reminder of which files
            belong to each row.
          </p>
          <a href="/sample-batch-template.csv" download className="mt-2 inline-block font-medium text-seal hover:underline">
            Download a template
          </a>
        </div>

        {spreadsheet ? (
          <div className="flex items-center justify-between border border-border bg-paper-muted px-3 py-2 text-sm">
            <span className="truncate">{spreadsheet.name}</span>
            <button type="button" onClick={() => setSpreadsheet(null)} className="ml-2 text-ink-muted hover:text-reject">
              Remove
            </button>
          </div>
        ) : (
          <FileDropzone
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onFiles={(files) => setSpreadsheet(files[0])}
            helperText="One row per application"
          />
        )}

        <button
          type="button"
          onClick={handleParse}
          disabled={!spreadsheet || parsing}
          className="w-full bg-seal px-4 py-3 text-lg font-semibold text-paper transition-colors hover:bg-seal-dark disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
        >
          {parsing ? "Reading spreadsheet…" : "Read spreadsheet"}
        </button>

        {parseError && <ErrorCard title="Could not read that spreadsheet" message={parseError} />}
      </div>
    );
  }

  // --- Step 2: work the rows ----------------------------------------------

  const active = rows[activeIndex];
  const countProblem = describeImageCountProblem(active.images.length);
  const canSubmit = active.state === "todo" && isApplicationFormFilled(active.form) && !countProblem && !submitting;
  const allDone = counts.todo === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-paper-muted px-4 py-3">
        <div className="text-sm text-ink">
          <span className="font-semibold">{spreadsheetName || spreadsheet?.name || "Spreadsheet"}</span>
          <span className="text-ink-muted">, {rows.length} rows</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-verified">{counts.submitted} submitted</span>
          <span className="text-ink-muted">{counts.scrapped} scrapped</span>
          <span className="text-ink">{counts.todo} left</span>
          <button type="button" onClick={handleStartOver} className="font-medium text-seal hover:underline">
            Different sheet
          </button>
        </div>
      </div>

      {photosLostOnRestore > 0 && (
        <p className="border-l-4 border-flag bg-flag-bg p-3 text-sm text-ink">
          This import was restored after the page reloaded. Your row details were kept, but{" "}
          {photosLostOnRestore} photo{photosLostOnRestore === 1 ? "" : "s"} you had attached but not yet submitted could
          not be, because browsers don&apos;t allow a page to hold on to chosen files. Attach them again before
          submitting those rows.
        </p>
      )}

      {skippedRows.length > 0 && (
        <details className="border-l-4 border-flag bg-flag-bg p-3 text-sm text-ink">
          <summary className="cursor-pointer font-medium">
            {skippedRows.length} row{skippedRows.length === 1 ? "" : "s"} skipped while reading the sheet
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
            {skippedRows.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </details>
      )}

      {allDone && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 border-l-4 p-4 ${
            startState === "failed" ? "border-flag bg-flag-bg" : "border-verified bg-verified-bg"
          }`}
        >
          <p className="text-ink">
            All {rows.length} rows handled: {counts.submitted} submitted, {counts.scrapped} scrapped.{" "}
            {counts.submitted === 0
              ? "Nothing was queued."
              : startState === "started"
                ? "Checking them now. Results appear in the review queue as they finish."
                : startState === "starting"
                  ? "Starting the checks…"
                  : startState === "failed"
                    ? "They're queued, but the checks didn't start."
                    : ""}
          </p>
          <span className="flex flex-wrap gap-2">
            {startState === "failed" && (
              <button
                type="button"
                onClick={() => void startProcessing(rows)}
                className="border border-seal px-3 py-1.5 font-medium text-seal hover:bg-paper"
              >
                Start checking
              </button>
            )}
            <button type="button" onClick={onViewQueue} className="border border-seal px-3 py-1.5 font-medium text-seal hover:bg-paper">
              View in review queue
            </button>
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Import rows" className="max-h-128 overflow-y-auto border border-border">
          <ul className="divide-y divide-border">
            {rows.map((row, index) => {
              const isActive = index === activeIndex;
              const glyph = row.state === "submitted" ? "✓" : row.state === "scrapped" ? "✕" : "·";
              const glyphClass =
                row.state === "submitted" ? "text-verified" : row.state === "scrapped" ? "text-reject" : "text-ink-muted";
              return (
                <li key={row.rowNumber}>
                  <button
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-current={isActive ? "true" : undefined}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      isActive ? "bg-seal text-paper" : "text-ink hover:bg-paper-muted"
                    }`}
                  >
                    <span aria-hidden className={isActive ? "text-paper" : glyphClass}>
                      {glyph}
                    </span>
                    {/* Position in this import, not the spreadsheet row. The
                        sheet's own numbering starts at 2 because of its header,
                        which read as an off-by-one against a list of 40. */}
                    <span className={`w-8 shrink-0 tabular-nums ${isActive ? "text-paper/80" : "text-ink-muted"}`}>
                      {index + 1}
                    </span>
                    <span className="truncate">{row.form.brandName || "(no brand)"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Named so it reads as a distinct region beside the worklist nav
            rather than as an unlabelled section. */}
        <section aria-label="Import row details" className="border border-border p-4">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            {/* Position first, provenance second. Leading with the spreadsheet
                row put two unrelated numbers side by side ("row 11  10 of 40"),
                which reads as a typo. */}
            <h2 className="font-semibold text-ink">
              Application {activeIndex + 1} of {rows.length}
              <span className="ml-2 text-sm font-normal text-ink-muted">from spreadsheet row {active.rowNumber}</span>
            </h2>
            {active.state !== "todo" && (
              <button
                type="button"
                onClick={() => handleRestoreRow(activeIndex)}
                className="text-sm font-medium text-seal hover:underline"
              >
                {active.state === "submitted" ? "Submitted (reopen)" : "Scrapped (restore)"}
              </button>
            )}
          </div>

          {active.state === "submitted" ? (
            <p className="border-l-4 border-verified bg-verified-bg p-3 text-sm text-ink">
              Queued for checking. Reopening won&apos;t undo it - it would add a second application. Manage it from the
              review queue instead.
            </p>
          ) : active.state === "scrapped" ? (
            <p className="border-l-4 border-border bg-paper-muted p-3 text-sm text-ink-muted">
              Scrapped. Nothing was created for this row.
            </p>
          ) : null}

          <div className={active.state === "todo" ? "" : "pointer-events-none mt-4 opacity-50"}>
            <ApplicationFields
              form={active.form}
              onChange={(form) => updateRow(activeIndex, { form })}
              idPrefix={`import-row-${active.rowNumber}`}
              disabled={active.state !== "todo"}
            />

            <div className="mt-5">
              <h3 className="mb-1 text-sm font-semibold text-ink">
                Label photos ({active.images.length}/{MAX_IMAGES_PER_APPLICATION})
              </h3>
              {active.suggestedFilenames.length > 0 && (
                <p className="mb-2 text-sm text-ink-muted">
                  The sheet names {active.suggestedFilenames.join(", ")} for this row.
                </p>
              )}
              <p className="mb-3 text-sm text-ink-muted">
                Include the back label if the Government Warning isn&apos;t visible on the front - one photo showing both
                sides works too.
              </p>
              <LabelPhotoPicker
                compact
                images={active.images}
                disabled={active.state !== "todo"}
                onAdd={(files) => {
                  const { accepted, rejected } = acceptFiles(files);
                  updateRow(activeIndex, {
                    images: [...active.images, ...accepted].slice(0, MAX_IMAGES_PER_APPLICATION),
                    error: rejected.length > 0 ? rejected.join(" ") : active.error,
                  });
                }}
                onRemove={(index) => updateRow(activeIndex, { images: active.images.filter((_, i) => i !== index) })}
              />
              {/* At zero photos this is guidance, not a warning - the agent
                  hasn't done anything wrong yet, and the disabled submit button
                  already says they can't continue. Only an actual violation
                  (too many) earns the flag colour. */}
              {countProblem && active.state === "todo" && (
                <p className={`mt-2 text-sm ${active.images.length === 0 ? "text-ink-muted" : "text-flag"}`}>
                  {countProblem}
                </p>
              )}
            </div>
          </div>

          {active.error && (
            <div className="mt-4">
              <ErrorCard title="Could not submit this row" message={active.error} />
            </div>
          )}

          {active.state === "todo" && (
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleSubmitRow}
                disabled={!canSubmit}
                className="flex-1 bg-seal px-4 py-2.5 font-semibold text-paper transition-colors hover:bg-seal-dark disabled:cursor-not-allowed disabled:bg-border disabled:text-ink-muted"
              >
                {submitting ? "Submitting…" : "Submit and continue"}
              </button>
              <button
                type="button"
                onClick={handleScrapRow}
                disabled={submitting}
                className="border border-reject px-4 py-2.5 font-semibold text-reject hover:bg-reject-bg disabled:opacity-50"
              >
                Scrap row
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
