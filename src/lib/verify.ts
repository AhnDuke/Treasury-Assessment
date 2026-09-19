import { extractLabelData, getSecondOpinion, type EncodedImage } from "./anthropic";
import { compareLabelToApplication, determineOverallStatus } from "./comparison";
import { applySecondOpinions, fieldsNeedingSecondOpinion } from "./escalation";
import type { ApplicationData, VerificationOutcome } from "./types";

/**
 * The extract -> compare -> escalate pipeline, with no persistence baked in
 * — callers (the single-add route, the import batch processor) each decide
 * how to store the result. Throws (with an already-friendly message) on
 * failure rather than swallowing it, so callers can record it as their own
 * `error` status instead of a silent default.
 */
export async function runVerification(images: EncodedImage[], expected: ApplicationData): Promise<VerificationOutcome> {
  const extracted = await extractLabelData(images);
  let fields = compareLabelToApplication(expected, extracted);

  const flagged = fieldsNeedingSecondOpinion(fields);
  if (flagged.length > 0) {
    try {
      const secondOpinions = await getSecondOpinion(images, flagged);
      fields = applySecondOpinions(fields, secondOpinions);
    } catch {
      // Escalation is a quality add-on, not a hard dependency: if the
      // second-opinion call fails, keep the first-pass result rather than
      // failing the whole verification over it.
    }
  }

  return { overallStatus: determineOverallStatus(fields), fields };
}
