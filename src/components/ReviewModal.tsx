"use client";

import { useEffect, useRef, useState } from "react";
import { DecisionControls, DecisionRecord, ReviewBody, ReviewHeading } from "./ReviewDetail";
import type { ApplicationRecord } from "@/lib/types";

interface ReviewModalProps {
  application: ApplicationRecord;
  onClose: () => void;
  onDecided: (updated: ApplicationRecord) => void;
}

/**
 * One application opened from the table. Its contents come from ReviewDetail,
 * shared with the one-at-a-time flow, so the two surfaces cannot drift into
 * disagreeing about what an agent is shown before signing off.
 *
 * Built on the native `<dialog>`: focus trapping, Esc to close and the
 * backdrop come from the browser, which matters more than usual given the
 * accessibility bar this tool is built to.
 */
export function ReviewModal({ application, onClose, onDecided }: ReviewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [rechecking, setRechecking] = useState(false);

  // showModal() can't be set declaratively - it's the call that establishes
  // the top layer, the backdrop, and the focus trap.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[min(72rem,92vw)] max-w-none bg-paper p-0 text-ink backdrop:bg-ink/50"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <ReviewHeading application={application} />
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="border border-border px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      <div className="max-h-[65vh] overflow-y-auto">
        <ReviewBody application={application} />
      </div>

      <div className="border-t border-border bg-paper-muted p-5">
        {application.decision ? (
          <DecisionRecord application={application} />
        ) : (
          <DecisionControls application={application} onDecided={onDecided} />
        )}

        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={async () => {
              setRechecking(true);
              try {
                const response = await fetch(`/api/applications/${application.id}/recheck`, { method: "POST" });
                const data = await response.json();
                if (response.ok) onDecided(data.application as ApplicationRecord);
              } finally {
                setRechecking(false);
              }
            }}
            disabled={rechecking || application.status === "pending" || application.status === "processing"}
            className="text-sm font-medium text-seal hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {rechecking ? "Queued for checking…" : "Check this label again"}
          </button>
          <p className="mt-1 text-sm text-ink-muted">
            Results are a snapshot of the checks that existed when the application was processed. Re-run it to apply
            the current ones. A recorded decision is left as it is.
          </p>
        </div>
      </div>
    </dialog>
  );
}
