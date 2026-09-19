"use client";

import { useState } from "react";
import { DecisionControls, ReviewBody, ReviewHeading } from "./ReviewDetail";
import type { ApplicationRecord } from "@/lib/types";

/**
 * Works through applications one at a time: approve, reject, or skip, and the
 * next one loads straight away.
 *
 * This exists because the table alone made the routine case expensive. If a
 * person has to sign off on every application, the whole saving is in how
 * cheap one review is, and open-modal, decide, close, find the next row, open
 * again put navigation between every single decision. The interviews describe
 * agents "drowning in routine stuff", and that was the routine.
 *
 * What it deliberately does not do is let an agent act on a set. Each
 * application is still shown in full and decided on its own, because a bulk
 * approve would turn sign-off into a gesture over things nobody looked at,
 * which is the one thing this tool is built not to do.
 */
export function QuickReview({
  applications,
  onDecided,
  onFinished,
}: {
  /** Everything currently in the queue. Filtered here to what can be decided. */
  applications: ApplicationRecord[];
  onDecided: (updated: ApplicationRecord) => void;
  /** Called when the agent chooses to go back to the table. */
  onFinished: () => void;
}) {
  // Skips last for this sitting only. Nothing is written for a skip, so the
  // application stays exactly where it was in the queue for anyone else.
  const [skipped, setSkipped] = useState<string[]>([]);
  const [decidedCount, setDecidedCount] = useState(0);

  // Only applications a decision can actually be recorded against: the server
  // refuses one on a row whose check has not finished, so offering it here
  // would be offering an action that cannot succeed.
  const decidable = applications.filter((a) => a.status === "done" && !a.decision);
  const queue = decidable.filter((a) => !skipped.includes(a.id));
  const current = queue[0] ?? null;

  const waiting = applications.filter((a) => a.status !== "done" && !a.decision).length;

  if (!current) {
    const nothingLeft = decidable.length === 0;
    return (
      <div className="border border-border p-8 text-center">
        <p className="text-lg font-semibold text-ink">
          {nothingLeft ? "Nothing left to review." : `${skipped.length} skipped, nothing else waiting.`}
        </p>
        <p className="mt-2 text-ink-muted">
          {decidedCount > 0 && `You signed off on ${decidedCount} application${decidedCount === 1 ? "" : "s"}. `}
          {waiting > 0 && `${waiting} more ${waiting === 1 ? "is" : "are"} still being checked.`}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {skipped.length > 0 && (
            <button
              type="button"
              onClick={() => setSkipped([])}
              className="border border-seal px-4 py-2 font-medium text-seal hover:bg-paper-muted"
            >
              Go back to the {skipped.length} skipped
            </button>
          )}
          <button
            type="button"
            onClick={onFinished}
            className="border border-border px-4 py-2 font-medium text-ink hover:bg-paper-muted"
          >
            Back to the list
          </button>
        </div>
      </div>
    );
  }

  return (



    <section
      aria-label="Review one at a time"
      className="flex max-h-[calc(100vh-19rem)] min-h-[24rem] flex-col border border-border"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-4">
        <ReviewHeading application={current} />
        <div className="text-right text-sm text-ink-muted">
          <p className="font-medium text-ink">
            {queue.length} left to review
          </p>
          {decidedCount > 0 && <p>{decidedCount} done this sitting</p>}
          {skipped.length > 0 && <p>{skipped.length} skipped</p>}
        </div>
      </div>

      <ReviewBody application={current} compact />

      <div className="border-t border-border bg-paper-muted p-4">
        <DecisionControls
          // Keyed by application, so moving to the next one remounts these
          // controls and resets them. Without it React reuses the component
          // and its state persists: a half-opened rejection box stays open
          // over the next application, still holding the previous one's
          // pre-filled reason. That would attach one application's defects to
          // another's recorded basis for rejection.
          key={current.id}
          application={current}
          onDecided={(updated) => {
            setDecidedCount((n) => n + 1);
            // Removing it from `applications` is the parent's job; this just
            // records that one more got done so the count is honest.
            onDecided(updated);
          }}
          extraAction={
            <>
              <button
                type="button"
                onClick={() => setSkipped((prev) => [...prev, current.id])}
                className="border border-border px-4 py-2 font-medium text-ink-muted hover:text-ink"
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={onFinished}
                className="ml-auto px-4 py-2 font-medium text-ink-muted hover:text-ink"
              >
                Stop and go back to the list
              </button>
            </>
          }
        />
        <p className="mt-2 text-sm text-ink-muted">
          Skipping records nothing. The application stays in the queue exactly as it was.
        </p>
      </div>
    </section>
  );
}
