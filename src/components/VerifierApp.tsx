"use client";

import { useState, type ReactNode } from "react";
import { AddSingleApplication } from "./AddSingleApplication";
import { ApplicationQueue } from "./ApplicationQueue";
import { ImportApplications } from "./ImportApplications";
import { ThemeToggle } from "./ThemeToggle";

type View = "queue" | "add";
type AddMode = "single" | "import";

export function VerifierApp() {
  const [view, setView] = useState<View>("queue");
  const [addMode, setAddMode] = useState<AddMode>("single");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">TTB label verification</h1>
          <p className="mt-2 max-w-prose text-ink-muted">
            Review submitted applications against their label photos, or add new ones to the queue.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="mb-8 flex gap-6 border-b border-border">
        <TabButton active={view === "queue"} onClick={() => setView("queue")}>
          Review queue
        </TabButton>
        <TabButton active={view === "add"} onClick={() => setView("add")}>
          Add applications
        </TabButton>
      </div>

      {view === "queue" ? (
        <ApplicationQueue />
      ) : (
        <div className="space-y-6">
          <div className="inline-flex border border-border">
            <SubTabButton active={addMode === "single"} onClick={() => setAddMode("single")}>
              Single
            </SubTabButton>
            <SubTabButton active={addMode === "import"} onClick={() => setAddMode("import")}>
              Import
            </SubTabButton>
          </div>
          {addMode === "single" ? (
            <AddSingleApplication onViewQueue={() => setView("queue")} />
          ) : (
            <ImportApplications onViewQueue={() => setView("queue")} />
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-0.5 pb-3 text-base font-semibold transition-colors ${
        active ? "border-seal text-ink" : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function SubTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
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
