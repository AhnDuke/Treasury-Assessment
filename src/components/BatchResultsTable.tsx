"use client";

import { Fragment, useState } from "react";
import { FIELD_STATUS_META, OVERALL_STATUS_META } from "@/lib/statusMeta";
import type { VerificationResult } from "@/lib/types";

export function BatchResultsTable({ results }: { results: VerificationResult[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="animate-reveal overflow-x-auto border border-border">
      <table className="min-w-full text-sm">
        <thead className="bg-paper-muted">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-ink-muted">File</th>
            <th className="px-4 py-2 text-left font-medium text-ink-muted">Status</th>
            <th className="px-4 py-2 text-left font-medium text-ink-muted" aria-hidden />
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-paper">
          {results.map((result, index) => {
            const key = `${result.fileName ?? "file"}-${index}`;
            const isOpen = expandedKey === key;
            const overall = result.error ? null : OVERALL_STATUS_META[result.overallStatus];

            return (
              <Fragment key={key}>
                <tr className={`border-l-4 align-top ${overall ? overall.edgeClassName : "border-l-reject"}`}>
                  <td className="px-4 py-3 font-medium text-ink">{result.fileName}</td>
                  <td className="px-4 py-3">
                    {overall ? (
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 ${overall.className}`}>
                        <span aria-hidden>{overall.glyph}</span>
                        {overall.label}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-reject-border bg-reject-bg px-2 py-0.5 text-reject">
                        <span aria-hidden>✕</span>
                        Error
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => setExpandedKey(isOpen ? null : key)} className="font-medium text-seal hover:underline">
                      {isOpen ? "Hide details" : "View details"}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={3} className="border-l-4 border-l-border bg-paper-muted px-4 py-4">
                      {result.error ? (
                        <p className="text-sm text-reject">{result.error}</p>
                      ) : (
                        <div className="space-y-3">
                          {result.fields.map((field) => {
                            const meta = FIELD_STATUS_META[field.status];
                            return (
                              <div key={field.field} className={`border-l-4 bg-paper p-2 pl-3 ${meta.edgeClassName}`}>
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                  <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 ${meta.className}`}>
                                    <span aria-hidden>{meta.glyph}</span>
                                    {meta.label}
                                  </span>
                                  <span className="font-medium text-ink">{field.label}:</span>
                                  <span className="text-ink-muted">submitted &quot;{field.expected ?? "—"}&quot;</span>
                                  <span className="text-ink-muted">found &quot;{field.extracted ?? "—"}&quot;</span>
                                </div>
                                {field.secondOpinion && (
                                  <p className="mt-1 text-xs text-ink-muted">
                                    Second check: {field.secondOpinion.agreesWithFirstPass
                                      ? "agrees with the first read."
                                      : `read this as "${field.secondOpinion.extracted ?? "nothing"}" instead.`}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
