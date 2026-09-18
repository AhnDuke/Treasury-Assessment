"use client";

import { useState, type ReactNode } from "react";
import { BatchVerifyForm } from "./BatchVerifyForm";
import { SingleVerifyForm } from "./SingleVerifyForm";

type Tab = "single" | "batch";

export function VerifierApp() {
  const [tab, setTab] = useState<Tab>("single");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">TTB label verification</h1>
        <p className="mt-2 max-w-prose text-ink-muted">
          Check a label photo against the submitted application: brand name, class/type, ABV, net contents, and the
          government warning statement.
        </p>
      </header>

      <div className="mb-8 flex gap-6 border-b border-border">
        <TabButton active={tab === "single"} onClick={() => setTab("single")}>
          Single label
        </TabButton>
        <TabButton active={tab === "batch"} onClick={() => setTab("batch")}>
          Batch upload
        </TabButton>
      </div>

      {tab === "single" ? <SingleVerifyForm /> : <BatchVerifyForm />}
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
