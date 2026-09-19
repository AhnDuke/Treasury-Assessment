import { FIELD_TO_EXTRACTION_KEY, SECOND_OPINION_MODEL } from "./anthropic";
import { normalizeForComparison } from "./textMatch";
import type { ExtractedLabelData, FieldResult } from "./types";

export function fieldsNeedingSecondOpinion(fields: FieldResult[]): string[] {
  // not_shown is excluded deliberately: a stronger model re-reading the same
  // images cannot find text that isn't in them, so escalating an evidence gap
  // buys nothing and costs a Sonnet call.
  return fields
    .filter((f) => f.status !== "match" && f.status !== "not_shown")
    .map((f) => f.field);
}

function parseNumericField(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function valuesAgree(
  extractionKey: keyof ExtractedLabelData,
  firstPass: string | null,
  secondPass: string | number | null
): boolean {
  if (extractionKey === "abvPercent") {
    const a = parseNumericField(firstPass);
    const b = parseNumericField(secondPass);
    return a === null || b === null ? a === b : Math.abs(a - b) < 0.05;
  }
  const a = firstPass === null ? null : normalizeForComparison(firstPass);
  const b = secondPass === null ? null : normalizeForComparison(String(secondPass));
  return a === b;
}

function formatSecondOpinionValue(
  extractionKey: keyof ExtractedLabelData,
  value: string | number | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  return extractionKey === "abvPercent" ? `${value}%` : String(value);
}

/**
 * Merges a stronger model's independent re-read onto the fields it covers.
 * Pure and side-effect-free so it's unit-testable without an API call -
 * never changes `status` itself, only annotates it (see FieldResult.secondOpinion).
 */
export function applySecondOpinions(
  fields: FieldResult[],
  secondOpinions: Partial<ExtractedLabelData>
): FieldResult[] {
  return fields.map((field) => {
    const extractionKey = FIELD_TO_EXTRACTION_KEY[field.field];
    if (!extractionKey || !(extractionKey in secondOpinions)) return field;

    const secondRaw = secondOpinions[extractionKey] ?? null;
    return {
      ...field,
      secondOpinion: {
        model: SECOND_OPINION_MODEL,
        extracted: formatSecondOpinionValue(extractionKey, secondRaw),
        agreesWithFirstPass: valuesAgree(extractionKey, field.extracted, secondRaw),
      },
    };
  });
}
