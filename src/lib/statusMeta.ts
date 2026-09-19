import type { FieldStatus, ReviewDecision, TriageStatus } from "./types";

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
  not_shown: { glyph: "–", label: "Not shown", className: "text-ink-muted bg-paper-muted border-border", edgeClassName: "border-l-border" },
};

// Note: FieldStatus and TriageStatus both have a "review" member, but they
// mean different things at different levels — a single field needing a
// closer look, versus a whole application needing attention. The labels
// below correctly diverge ("Needs review" vs "Needs attention"), so this is
// a trip hazard for a developer reading the two maps, not a user-facing bug.
export const TRIAGE_STATUS_META: Record<
  TriageStatus,
  { glyph: string; label: string; shortLabel: string; className: string; edgeClassName: string }
> = {
  clean: {
    glyph: "✓",
    label: "Clean match — every field agrees with the application",
    shortLabel: "Clean match",
    className: "text-verified bg-verified-bg border-verified-border",
    edgeClassName: "border-l-verified",
  },
  review: {
    glyph: "!",
    label: "Needs attention — some fields could not be confirmed",
    shortLabel: "Needs attention",
    className: "text-flag bg-flag-bg border-flag-border",
    edgeClassName: "border-l-flag",
  },
  discrepancy: {
    glyph: "✕",
    label: "Needs attention — the label disagrees with the application",
    shortLabel: "Discrepancy",
    className: "text-reject bg-reject-bg border-reject-border",
    edgeClassName: "border-l-reject",
  },
};

export const DECISION_META: Record<ReviewDecision, { glyph: string; label: string; className: string }> = {
  approved: { glyph: "✓", label: "Approved", className: "text-verified bg-verified-bg border-verified-border" },
  rejected: { glyph: "✕", label: "Rejected", className: "text-reject bg-reject-bg border-reject-border" },
};
