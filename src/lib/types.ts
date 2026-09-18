export interface ApplicationData {
  brandName: string;
  classType: string;
  abvPercent: number;
  netContents: string;
}

export interface ExtractedLabelData {
  brandName: string | null;
  classType: string | null;
  abvPercent: number | null;
  netContents: string | null;
  warningStatementText: string | null;
}

export type FieldStatus = "match" | "review" | "mismatch" | "missing";

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

export type OverallStatus = "approved" | "flagged" | "rejected";

export type AcceptedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

/** Result of the extract -> compare -> escalate pipeline, before persistence. */
export interface VerificationOutcome {
  overallStatus: OverallStatus;
  fields: FieldResult[];
}

export type ApplicationStatus = "pending" | "processing" | "done" | "cancelled" | "error";

/** A persisted application row (Neon) - the unit the review queue works on. */
export interface ApplicationRecord {
  id: string;
  importBatchId: string | null;
  brandName: string;
  classType: string;
  abvPercent: number;
  netContents: string;
  imageUrl: string;
  imageFilename: string;
  imageContentType: AcceptedImageType;
  status: ApplicationStatus;
  overallStatus: OverallStatus | null;
  fields: FieldResult[] | null;
  errorMessage: string | null;
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
