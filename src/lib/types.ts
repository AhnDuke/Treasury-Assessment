import type { BeverageType } from "./beverageType";

export interface ApplicationData {
  brandName: string;
  classType: string;
  abvPercent: number;
  netContents: string;
  /**
   * Which body of TTB regulation the product falls under. Optional because it
   * can usually be inferred from the class/type designation; declare it when
   * the designation is free text we would not recognise.
   */
  beverageType?: BeverageType | null;
}

export interface ExtractedLabelData {
  brandName: string | null;
  classType: string | null;
  abvPercent: number | null;
  netContents: string | null;
  warningStatementText: string | null;
  /**
   * Whether any supplied image shows a face other than the front. Drives the
   * distinction between "the label is missing the warning" (a violation) and
   * "nobody photographed the side it's printed on" (an evidence gap) - see
   * compareWarningStatement.
   */
  backLabelVisible: boolean;
}

export type FieldStatus = "match" | "review" | "mismatch" | "missing" | "not_shown" | "not_required";

export interface SecondOpinion {
  model: string;
  extracted: string | null;
  agreesWithFirstPass: boolean;
}

export interface FieldResult {
  field: string;
  label: string;
  expected: string | null;
  extracted: string | null;
  status: FieldStatus;
  detail?: string;
  secondOpinion?: SecondOpinion;
}

/**
 * What the automated check thinks of an application - a triage signal used to
 * sort the queue, never a decision. A person's approve/reject is recorded
 * separately as ReviewDecision, and the two deliberately use different words.
 */
export type TriageStatus = "clean" | "review" | "discrepancy";

/** A person's sign-off. Only ever set by an agent, never by the automated check. */
export type ReviewDecision = "approved" | "rejected";

export type AcceptedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** Result of the extract -> compare -> escalate pipeline, before persistence. */
export interface VerificationOutcome {
  triageStatus: TriageStatus;
  fields: FieldResult[];
}

export type ApplicationStatus = "pending" | "processing" | "done" | "cancelled" | "error";

/** One uploaded label photo. Applications carry several (front, back, ...). */
export interface LabelImage {
  url: string;
  filename: string;
  contentType: AcceptedImageType;
}

// One image is allowed because an applicant may supply a single composite
// photo showing front and back together. A front-only photo is caught by the
// evidence-gap check in comparison.ts, not by a count rule - the count never
// told us what was actually photographed.
export const MIN_IMAGES_PER_APPLICATION = 1;
export const MAX_IMAGES_PER_APPLICATION = 3;

/** A persisted application row (Neon) - the unit the review queue works on. */
export interface ApplicationRecord {
  id: string;
  importBatchId: string | null;
  brandName: string;
  classType: string;
  abvPercent: number;
  netContents: string;
  beverageType: BeverageType | null;
  images: LabelImage[];
  status: ApplicationStatus;
  triageStatus: TriageStatus | null;
  fields: FieldResult[] | null;
  errorMessage: string | null;
  /**
   * How long the automated check took, in milliseconds. Null while a row is
   * still queued, and on rows that errored before a result existed.
   */
  processingMs: number | null;
  decision: ReviewDecision | null;
  decisionReason: string | null;
  decidedAt: string | null;
  /** Which fields the automated check had flagged when the agent signed off. */
  decisionFlaggedFields: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface BatchProgress {
  importBatchId: string;
  total: number;
  pending: number;
  processing: number;
  done: number;
  cancelled: number;
  error: number;
}
