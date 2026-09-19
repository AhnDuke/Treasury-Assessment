import { STATUTORY_WARNING_TEXT } from "./warningStatement";
import { collapseWhitespace, normalizeForComparison, similarityRatio } from "./textMatch";
import type { ApplicationData, ExtractedLabelData, FieldResult, TriageStatus } from "./types";

// Below this similarity ratio (post case/punctuation normalization) a text
// field is treated as a real mismatch rather than a formatting difference.
// Tuned against Dave's "STONE'S THROW" vs "Stone's Throw" example - same
// brand, different casing, should not hard-fail.
const FUZZY_MATCH_THRESHOLD = 0.85;

const ABV_TOLERANCE_PERCENT = 0.3;
const NET_CONTENTS_TOLERANCE_RATIO = 0.01;

// Above this similarity, a non-exact warning statement is treated as a
// transcription artifact needing human confirmation rather than a wording
// violation. The statutory text is ~250 characters, so this still only
// tolerates a few characters of drift.
const WARNING_TRANSCRIPTION_THRESHOLD = 0.97;

const OZ_TO_ML = 29.5735;
const UNIT_TO_ML: Array<{ pattern: RegExp; toMl: number }> = [
  { pattern: /^fl ?oz$/, toMl: OZ_TO_ML },
  { pattern: /^oz$/, toMl: OZ_TO_ML },
  { pattern: /^m ?l$/, toMl: 1 },
  { pattern: /^milliliters?$/, toMl: 1 },
  { pattern: /^l$/, toMl: 1000 },
  { pattern: /^lit(?:er|re)s?$/, toMl: 1000 },
];

function compareTextField(field: string, label: string, expected: string, extracted: string | null): FieldResult {
  if (!extracted || !extracted.trim()) {
    return { field, label, expected, extracted: null, status: "missing", detail: "Not found on label." };
  }
  const ratio = similarityRatio(expected, extracted);
  if (ratio === 1) {
    return { field, label, expected, extracted, status: "match" };
  }
  if (ratio >= FUZZY_MATCH_THRESHOLD) {
    return {
      field,
      label,
      expected,
      extracted,
      status: "review",
      detail: `${Math.round(ratio * 100)}% similar to the submitted value - differs only in casing/punctuation. Confirm manually.`,
    };
  }
  return {
    field,
    label,
    expected,
    extracted,
    status: "mismatch",
    detail: `Only ${Math.round(ratio * 100)}% similar to the submitted value.`,
  };
}

function compareAbv(expected: number, extracted: number | null): FieldResult {
  const label = "Alcohol Content (ABV)";
  const expectedStr = `${expected}%`;
  if (extracted === null) {
    return { field: "abvPercent", label, expected: expectedStr, extracted: null, status: "missing", detail: "Not found on label." };
  }
  const diff = Math.abs(expected - extracted);
  const extractedStr = `${extracted}%`;
  if (diff <= ABV_TOLERANCE_PERCENT) {
    return { field: "abvPercent", label, expected: expectedStr, extracted: extractedStr, status: "match" };
  }
  return {
    field: "abvPercent",
    label,
    expected: expectedStr,
    extracted: extractedStr,
    status: "mismatch",
    detail: `Differs by ${diff.toFixed(1)} percentage points (tolerance is ${ABV_TOLERANCE_PERCENT}).`,
  };
}

function parseNetContentsToMl(value: string): number | null {
  // Note: periods are stripped only from the matched unit text below, never
  // from the whole string up front - this field's number is often a decimal
  // (e.g. "0.75 L"), and an earlier version of this function blanket-stripped
  // periods to handle "fl. oz." and corrupted "0.75" into "075".
  const cleaned = value.toLowerCase().replace(/\s+/g, " ").trim();
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(fl\.?\s?oz\.?|m\.?l\.?|milliliters?|lit(?:er|re)s?|l\.?|oz\.?)\b/);
  if (!match) return null;
  const quantity = parseFloat(match[1]);
  const unit = match[2].replace(/[.\s]+/g, "");
  const alias = UNIT_TO_ML.find((u) => u.pattern.test(unit));
  return alias ? quantity * alias.toMl : null;
}

function compareNetContents(expected: string, extracted: string | null): FieldResult {
  const label = "Net Contents";
  if (!extracted || !extracted.trim()) {
    return { field: "netContents", label, expected, extracted: null, status: "missing", detail: "Not found on label." };
  }
  const expectedMl = parseNetContentsToMl(expected);
  const extractedMl = parseNetContentsToMl(extracted);
  if (expectedMl !== null && extractedMl !== null) {
    const tolerance = Math.max(1, expectedMl * NET_CONTENTS_TOLERANCE_RATIO);
    if (Math.abs(expectedMl - extractedMl) <= tolerance) {
      return { field: "netContents", label, expected, extracted, status: "match" };
    }
    return {
      field: "netContents",
      label,
      expected,
      extracted,
      status: "mismatch",
      detail: `Parsed as ${extractedMl.toFixed(1)} mL vs. expected ${expectedMl.toFixed(1)} mL.`,
    };
  }
  if (normalizeForComparison(expected) === normalizeForComparison(extracted)) {
    return { field: "netContents", label, expected, extracted, status: "match" };
  }
  return {
    field: "netContents",
    label,
    expected,
    extracted,
    status: "review",
    detail: "Could not confidently parse quantity/unit on one side. Confirm manually.",
  };
}

function compareWarningStatement(extracted: string | null, backLabelVisible: boolean): FieldResult {
  const label = "Government Warning Statement";
  const expected = STATUTORY_WARNING_TEXT;
  if (!extracted || !extracted.trim()) {
    // Two different findings share one symptom. The warning is printed on the
    // back or side in nearly every case, so "not found" means one thing when
    // we were shown that side and something else entirely when we weren't.
    // Reporting an evidence gap as a violation is what produced the false
    // "missing warning" results this check was rewritten to fix.
    if (!backLabelVisible) {
      return {
        field: "warningStatement",
        label,
        expected,
        extracted: null,
        status: "not_shown",
        detail:
          "No photo shows the back or side of the packaging, where this statement is almost always printed. This is not a finding against the label. Request a photo of the back before deciding.",
      };
    }
    return {
      field: "warningStatement",
      label,
      expected,
      extracted: null,
      status: "missing",
      detail: "A back or side view was supplied and carries no warning statement, which is a genuine omission.",
    };
  }

  const textMatches = collapseWhitespace(expected).toLowerCase() === collapseWhitespace(extracted).toLowerCase();
  const headerMatch = extracted.match(/government warning:?/i);
  const headerIsAllCaps = headerMatch ? headerMatch[0] === headerMatch[0].toUpperCase() : false;

  if (!textMatches) {
    // A near-perfect read almost certainly means the label is correct and the
    // transcription slipped a character - a measurement error, not a label
    // defect. Treating those as outright mismatches is what produced false
    // "incorrect warning" reports. Strictness is preserved: anything short of
    // essentially identical still goes to a human, it just isn't pre-judged
    // as a violation.
    const similarity = similarityRatio(expected, extracted);
    if (similarity >= WARNING_TRANSCRIPTION_THRESHOLD) {
      return {
        field: "warningStatement",
        label,
        expected,
        extracted,
        status: "review",
        detail: `Wording appears correct (${Math.round(similarity * 100)}% identical) but the transcription differed slightly - likely a reading artifact rather than a label defect. Confirm visually.`,
      };
    }
    return {
      field: "warningStatement",
      label,
      expected,
      extracted,
      status: "mismatch",
      detail: `Wording does not match the required statutory text (27 CFR 16.21) - only ${Math.round(similarity * 100)}% identical.`,
    };
  }
  if (!headerIsAllCaps) {
    return {
      field: "warningStatement",
      label,
      expected,
      extracted,
      status: "review",
      detail:
        '"GOVERNMENT WARNING:" is not all-caps in the extracted text. Note: bold formatting cannot be verified from OCR text alone. Confirm caps/bold visually.',
    };
  }
  return { field: "warningStatement", label, expected, extracted, status: "match" };
}

export function compareLabelToApplication(expected: ApplicationData, extracted: ExtractedLabelData): FieldResult[] {
  return [
    compareTextField("brandName", "Brand Name", expected.brandName, extracted.brandName),
    compareTextField("classType", "Class/Type Designation", expected.classType, extracted.classType),
    compareAbv(expected.abvPercent, extracted.abvPercent),
    compareNetContents(expected.netContents, extracted.netContents),
    compareWarningStatement(extracted.warningStatementText, extracted.backLabelVisible),
  ];
}

export function determineTriageStatus(fields: FieldResult[]): TriageStatus {
  if (fields.length === 0) return "discrepancy";
  if (fields.some((f) => f.status === "mismatch" || f.status === "missing")) return "discrepancy";
  if (fields.some((f) => f.status === "review" || f.status === "not_shown")) return "review";
  return "clean";
}
