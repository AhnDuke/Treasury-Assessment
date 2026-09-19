"use client";

import { useState, type ReactNode } from "react";
import { AddSingleApplication } from "./AddSingleApplication";
import { GuidedImport } from "./GuidedImport";
import { QuickReview } from "./QuickReview";
import { ReviewQueue } from "./ReviewQueue";
import { useApplications } from "@/lib/useApplications";
import { ThemeToggle } from "./ThemeToggle";

type View = "applications" | "review" | "add";
type AddMode = "single" | "import";

export function VerifierApp() {
  const [view, setView] = useState<View>("applications");
  // One source for both surfaces, so the list and the one-at-a-time review
  // never disagree about what is in the queue.
  const queue = useApplications();

  /**
   * Switching between the list and the one-at-a-time review refetches, so
   * neither shows what the other has already changed. Done here in the click
   * rather than in an effect on `view`: it is a response to something the
   * agent did, not state to synchronise.
   */
  function show(next: View) {
    setView(next);
    if (next !== "add") void queue.reload();
  }
  const [addMode, setAddMode] = useState<AddMode>("single");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">
            TTB label verification
          </h1>
          <p className="mt-2 max-w-prose text-ink-muted">
            Check each application against its label photos, then approve or
            reject it.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="mb-8 flex gap-6 border-b border-border">
        <TabButton active={view === "applications"} onClick={() => show("applications")}>
          Applications
        </TabButton>
        <TabButton active={view === "review"} onClick={() => show("review")}>
          Review
        </TabButton>
        <TabButton active={view === "add"} onClick={() => show("add")}>
          Add Test Applications
        </TabButton>
      </div>

      {/* Every panel stays mounted and is hidden with CSS instead of being
          unmounted. Switching to the queue partway through an import used to
          discard the parsed sheet, every field edit and every attached photo,
          leaving the agent to start again from the CSV. `hidden` sets
          display:none, so a hidden panel is out of the accessibility tree and
          out of the tab order too. */}
      <div className={view === "applications" ? undefined : "hidden"}>
        <ReviewQueue {...queue} />
      </div>

      {/* Unlike the other panels this one is NOT kept mounted. Where it is in
          the queue is derived from the data rather than held in state, so
          remounting on entry is what makes it open on the next thing actually
          waiting instead of a stale application left over from a previous
          visit. Nothing is lost by unmounting it: a skip is per-sitting and a
          decision is already recorded on the server. */}
      {view === "review" && (
        <QuickReview
          applications={queue.applications ?? []}
          onDecided={queue.replace}
          onFinished={() => show("applications")}
        />
      )}

      <div className={`space-y-6 ${view === "add" ? "" : "hidden"}`}>
        <div className="inline-flex border border-border">
          <SubTabButton
            active={addMode === "single"}
            onClick={() => setAddMode("single")}
          >
            Single
          </SubTabButton>
          <SubTabButton
            active={addMode === "import"}
            onClick={() => setAddMode("import")}
          >
            Import
          </SubTabButton>
        </div>
        <div className={addMode === "single" ? undefined : "hidden"}>
          <AddSingleApplication onViewQueue={() => show("applications")} />
        </div>
        <div className={addMode === "import" ? undefined : "hidden"}>
          <GuidedImport onViewQueue={() => show("applications")} />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-0.5 pb-3 text-base font-semibold transition-colors ${
        active
          ? "border-seal text-ink"
          : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 text-sm font-medium transition-colors ${active ? "bg-seal text-paper" : "text-ink-muted hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
