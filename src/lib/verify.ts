import { extractLabelData, getSecondOpinion } from "./anthropic";
import { compareLabelToApplication, determineOverallStatus } from "./comparison";
import { applySecondOpinions, fieldsNeedingSecondOpinion } from "./escalation";
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
    let fields = compareLabelToApplication(expected, extracted);

    const flagged = fieldsNeedingSecondOpinion(fields);
    if (flagged.length > 0) {
      try {
        const secondOpinions = await getSecondOpinion(imageBase64, mediaType, flagged);
        fields = applySecondOpinions(fields, secondOpinions);
      } catch {
        // Escalation is a quality add-on, not a hard dependency: if the
        // second-opinion call fails, keep the first-pass result rather than
        // failing the whole verification over it.
      }
    }

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
