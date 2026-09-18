import { FIELD_STATUS_META, OVERALL_STATUS_META } from "@/lib/statusMeta";
import type { VerificationResult } from "@/lib/types";

export function ResultsCard({ result }: { result: VerificationResult }) {
  if (result.error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
        <p className="font-semibold">Could not verify this label</p>
        <p className="mt-1 text-sm">{result.error}</p>
      </div>
    );
  }

  const overall = OVERALL_STATUS_META[result.overallStatus];

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-3 rounded-lg border p-4 text-lg font-semibold ${overall.className}`}>
        <span aria-hidden>{overall.icon}</span>
        <span>{overall.label}</span>
      </div>

      <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
        {result.fields.map((field) => {
          const meta = FIELD_STATUS_META[field.status];
          return (
            <div key={field.field} className="bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-900">{field.label}</span>
                <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-medium ${meta.className}`}>
                  <span aria-hidden>{meta.icon}</span>
                  {meta.label}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Submitted on application</dt>
                  <dd className="break-words text-slate-800">{field.expected ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Found on label</dt>
                  <dd className="break-words text-slate-800">{field.extracted ?? "—"}</dd>
                </div>
              </dl>
              {field.detail && <p className="mt-2 text-sm text-slate-600">{field.detail}</p>}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-400">Processed in {(result.processingTimeMs / 1000).toFixed(1)}s</p>
    </div>
  );
}
