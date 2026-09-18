import { FIELD_STATUS_META, OVERALL_STATUS_META } from "@/lib/statusMeta";
import type { VerificationResult } from "@/lib/types";

export function ResultsCard({ result }: { result: VerificationResult }) {
  if (result.error) {
    return (
      <div className="animate-reveal rounded border-l-4 border-reject bg-reject-bg p-4 text-reject">
        <p className="font-semibold">Could not verify this label</p>
        <p className="mt-1 text-sm">{result.error}</p>
      </div>
    );
  }

  const overall = OVERALL_STATUS_META[result.overallStatus];

  return (
    <div className="animate-reveal space-y-px">
      <div className={`flex items-center gap-3 border-l-4 p-4 text-lg font-semibold ${overall.className}`}>
        <span aria-hidden className="text-xl leading-none">
          {overall.glyph}
        </span>
        <span>{overall.label}</span>
      </div>

      <div className="border border-t-0 border-border">
        {result.fields.map((field, index) => {
          const meta = FIELD_STATUS_META[field.status];
          return (
            <div
              key={field.field}
              className={`border-l-4 bg-paper p-4 ${meta.edgeClassName} ${index > 0 ? "border-t border-border" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-ink">{field.label}</span>
                <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-sm font-medium ${meta.className}`}>
                  <span aria-hidden>{meta.glyph}</span>
                  {meta.label}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">Submitted on application</dt>
                  <dd className="wrap-break-word text-ink">{field.expected ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Found on label</dt>
                  <dd className="wrap-break-word text-ink">{field.extracted ?? "—"}</dd>
                </div>
              </dl>
              {field.detail && <p className="mt-2 text-sm text-ink-muted">{field.detail}</p>}
              {field.secondOpinion && (
                <p className="mt-2 border-t border-border pt-2 text-sm text-ink-muted">
                  Second check: {field.secondOpinion.agreesWithFirstPass ? (
                    "a second model read the label the same way."
                  ) : (
                    <>a second model read this as &quot;{field.secondOpinion.extracted ?? "nothing"}&quot; instead — confirm manually.</>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3! text-xs text-ink-muted">Processed in {(result.processingTimeMs / 1000).toFixed(1)}s</p>
    </div>
  );
}
