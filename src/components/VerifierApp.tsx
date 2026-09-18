"use client";

import { useState, type ReactNode } from "react";
import { BatchVerifyForm } from "./BatchVerifyForm";
import { SingleVerifyForm } from "./SingleVerifyForm";

type Tab = "single" | "batch";

export function VerifierApp() {
  const [tab, setTab] = useState<Tab>("single");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">TTB Label Verification</h1>
        <p className="mt-2 text-slate-600">
          Upload a label image and the submitted application data to check brand name, class/type, ABV, net contents, and the
          Government Warning statement in seconds.
        </p>
      </header>

      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
        <TabButton active={tab === "single"} onClick={() => setTab("single")}>
          Single Label
        </TabButton>
        <TabButton active={tab === "batch"} onClick={() => setTab("batch")}>
          Batch Upload
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
      className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
        active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
