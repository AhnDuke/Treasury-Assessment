import { extractLabelData } from "./anthropic";
import { compareLabelToApplication, determineOverallStatus } from "./comparison";
import type { AcceptedImageType, ApplicationData, VerificationResult } from "./types";

export async function verifyLabel(
  imageBase64: string,
  mediaType: AcceptedImageType,
  expected: ApplicationData,
  fileName?: string
): Promise<VerificationResult> {
  const start = Date.now();
  try {
    const extracted = await extractLabelData(imageBase64, mediaType);
    const fields = compareLabelToApplication(expected, extracted);
    return {
      fileName,
      overallStatus: determineOverallStatus(fields),
      fields,
      processingTimeMs: Date.now() - start,
    };
  } catch (err) {
    return {
      fileName,
      overallStatus: "rejected",
      fields: [],
      processingTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error during verification.",
    };
  }
}
