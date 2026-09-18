import type { FieldStatus, OverallStatus } from "./types";

export const FIELD_STATUS_META: Record<FieldStatus, { icon: string; label: string; className: string }> = {
  match: { icon: "✅", label: "Match", className: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  review: { icon: "⚠️", label: "Needs Review", className: "text-amber-700 bg-amber-50 border-amber-200" },
  mismatch: { icon: "❌", label: "Mismatch", className: "text-red-700 bg-red-50 border-red-200" },
  missing: { icon: "❓", label: "Not Found", className: "text-red-700 bg-red-50 border-red-200" },
};

export const OVERALL_STATUS_META: Record<OverallStatus, { icon: string; label: string; className: string }> = {
  approved: { icon: "✅", label: "Approved — All Checks Passed", className: "text-emerald-800 bg-emerald-50 border-emerald-300" },
  flagged: { icon: "⚠️", label: "Flagged for Review", className: "text-amber-800 bg-amber-50 border-amber-300" },
  rejected: { icon: "❌", label: "Rejected — Discrepancies Found", className: "text-red-800 bg-red-50 border-red-300" },
};
