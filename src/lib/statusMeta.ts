import type { FieldStatus, OverallStatus } from "./types";

// Plain typographic glyphs, not emoji: colored via our own palette instead
// of the platform's built-in emoji rendering, so a status mark looks the
// same on every device — closer to a stamped mark on a paper ledger than a
// chat-app icon, and more predictable for the "Dave" / "my mother" audience.
export const FIELD_STATUS_META: Record<
  FieldStatus,
  { glyph: string; label: string; className: string; edgeClassName: string }
> = {
  match: { glyph: "✓", label: "Match", className: "text-verified bg-verified-bg border-verified-border", edgeClassName: "border-l-verified" },
  review: { glyph: "!", label: "Needs review", className: "text-flag bg-flag-bg border-flag-border", edgeClassName: "border-l-flag" },
  mismatch: { glyph: "✕", label: "Mismatch", className: "text-reject bg-reject-bg border-reject-border", edgeClassName: "border-l-reject" },
  missing: { glyph: "?", label: "Not found", className: "text-reject bg-reject-bg border-reject-border", edgeClassName: "border-l-reject" },
};

export const OVERALL_STATUS_META: Record<
  OverallStatus,
  { glyph: string; label: string; className: string; edgeClassName: string }
> = {
  approved: {
    glyph: "✓",
    label: "Approved — all checks passed",
    className: "text-verified bg-verified-bg border-verified-border",
    edgeClassName: "border-l-verified",
  },
  flagged: {
    glyph: "!",
    label: "Flagged for review",
    className: "text-flag bg-flag-bg border-flag-border",
    edgeClassName: "border-l-flag",
  },
  rejected: {
    glyph: "✕",
    label: "Rejected — discrepancies found",
    className: "text-reject bg-reject-bg border-reject-border",
    edgeClassName: "border-l-reject",
  },
};
