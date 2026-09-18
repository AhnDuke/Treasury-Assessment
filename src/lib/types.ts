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

export interface VerificationResult {
  fileName?: string;
  overallStatus: OverallStatus;
  fields: FieldResult[];
  processingTimeMs: number;
  error?: string;
}

export type AcceptedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
