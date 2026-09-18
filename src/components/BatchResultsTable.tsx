"use client";

import { Fragment, useState } from "react";
import { FIELD_STATUS_META, OVERALL_STATUS_META } from "@/lib/statusMeta";
import type { VerificationResult } from "@/lib/types";

export function BatchResultsTable({ results }: { results: VerificationResult[] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-slate-600">File</th>
            <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
            <th className="px-4 py-2 text-left font-medium text-slate-600" aria-hidden />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {results.map((result, index) => {
            const key = `${result.fileName ?? "file"}-${index}`;
            const isOpen = expandedKey === key;
            const overall = result.error ? null : OVERALL_STATUS_META[result.overallStatus];

            return (
              <Fragment key={key}>
                <tr className="align-top">
                  <td className="px-4 py-3 font-medium text-slate-800">{result.fileName}</td>
                  <td className="px-4 py-3">
                    {overall ? (
                      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 ${overall.className}`}>
                        {overall.icon} {overall.label}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-red-700">
                        ❌ Error
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => setExpandedKey(isOpen ? null : key)} className="font-medium text-blue-600 hover:underline">
                      {isOpen ? "Hide details" : "View details"}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={3} className="bg-slate-50 px-4 py-4">
                      {result.error ? (
                        <p className="text-sm text-red-700">{result.error}</p>
                      ) : (
                        <div className="space-y-2">
                          {result.fields.map((field) => {
                            const meta = FIELD_STATUS_META[field.status];
                            return (
                              <div key={field.field} className="flex flex-wrap items-center gap-2 text-sm">
                                <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 ${meta.className}`}>
                                  {meta.icon} {meta.label}
                                </span>
                                <span className="font-medium text-slate-700">{field.label}:</span>
                                <span className="text-slate-500">expected &quot;{field.expected ?? "—"}&quot;</span>
                                <span className="text-slate-500">found &quot;{field.extracted ?? "—"}&quot;</span>
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
