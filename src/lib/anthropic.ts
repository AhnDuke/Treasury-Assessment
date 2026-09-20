import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { AcceptedImageType, ExtractedLabelData } from "./types";

// Haiku, not Sonnet/Opus: label field extraction is a bounded, low-ambiguity
// read task, and the 5-second turnaround Sarah described rules out a slower
// model for what is otherwise a one-shot vision call.
const MODEL = "claude-haiku-4-5-20251001";

// Used only to re-check fields the first pass didn't cleanly match - see
// getSecondOpinion. Never the primary path, so the latency/cost trade-off
// only applies to the labels that actually need it.
export const SECOND_OPINION_MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_KEY is not set. Add it to .env.local (see .env.example).");
  }
  client = new Anthropic({ apiKey });
  return client;
}

// Maps FieldResult.field keys (used by comparison.ts) to ExtractedLabelData
// keys - they differ for the warning statement ("warningStatement" vs.
// "warningStatementText"), so this mapping is the single source of truth
// rather than duplicating the two naming schemes elsewhere.
export const FIELD_TO_EXTRACTION_KEY: Record<string, Exclude<keyof ExtractedLabelData, "backLabelVisible">> = {
  brandName: "brandName",
  classType: "classType",
  abvPercent: "abvPercent",
  netContents: "netContents",
  bottlerInfo: "bottlerInfo",
  countryOfOrigin: "countryOfOrigin",
  warningStatement: "warningStatementText",
};

const FIELD_PROPERTIES: Record<keyof ExtractedLabelData, { type: (string | null)[]; description: string }> = {
  brandName: {
    type: ["string", "null"],
    description: "The brand name on the label, verbatim (original casing/punctuation).",
  },
  classType: {
    type: ["string", "null"],
    description: "The class/type designation, e.g. 'Kentucky Straight Bourbon Whiskey'.",
  },
  abvPercent: {
    type: ["number", "null"],
    description: "Alcohol by volume as a plain percentage number, e.g. 45 for '45% Alc./Vol.'.",
  },
  netContents: {
    type: ["string", "null"],
    description: "Net contents verbatim, e.g. '750 mL'.",
  },
  bottlerInfo: {
    type: ["string", "null"],
    description:
      "The name and address of the bottler, producer, packer or importer, verbatim, including any lead-in such as 'Bottled by' or 'Imported by'. Usually small print on the back or side label.",
  },
  countryOfOrigin: {
    type: ["string", "null"],
    description:
      "The country of origin exactly as printed, e.g. 'Product of Mexico' or 'Imported from Scotland'. Null if the label states no country of origin.",
  },
  warningStatementText: {
    type: ["string", "null"],
    description:
      "The full Government Warning statement, verbatim, including the 'GOVERNMENT WARNING:' header exactly as printed (preserve original casing).",
  },
  backLabelVisible: {
    type: ["boolean"],
    description:
      "True if ANY supplied image shows a face of the packaging other than the primary front label - a back, reverse, side, or neck label - including a single image that shows front and back together. False if every image shows only the front.",
  },
};

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_label_fields",
  description: "Records the fields read from a photo of an alcohol beverage label, exactly as printed.",
  input_schema: {
    type: "object",
    properties: FIELD_PROPERTIES,
    required: Object.keys(FIELD_PROPERTIES),
  },
};

function buildFocusedTool(extractionKeys: (keyof ExtractedLabelData)[]): Anthropic.Tool {
  const properties: Record<string, { type: (string | null)[]; description: string }> = {};
  for (const key of extractionKeys) {
    properties[key] = FIELD_PROPERTIES[key];
  }
  return {
    name: "record_label_fields",
    description: "Records the requested fields read from a photo of an alcohol beverage label, exactly as printed.",
    input_schema: {
      type: "object",
      properties,
      required: extractionKeys,
    },
  };
}

// Anthropic.APIError messages embed the raw HTTP status + JSON error body
// (e.g. `401 {"type":"error","error":{"type":"authentication_error",...}}`).
// That's fine in a server log, not fine rendered straight into the agent's
// UI, so API errors get mapped to plain-language messages before they leave
// this module.
function toFriendlyErrorMessage(err: unknown): string {
  if (err instanceof APIError) {
    if (err.status === 401 || err.status === 403) {
      return "Label verification isn't configured correctly (invalid API key). Contact your administrator.";
    }
    if (err.status === 429) {
      return "The verification service is busy right now. Please try again in a moment.";
    }
    if (err.status === undefined || err.status >= 500) {
      return "The verification service is temporarily unavailable. Please try again.";
    }
  }
  return "Could not read this label. Please try again with a clearer photo.";
}

export interface EncodedImage {
  base64: string;
  mediaType: AcceptedImageType;
}

async function runExtractionCall(
  model: string,
  tool: Anthropic.Tool,
  images: EncodedImage[],
  instructionText: string
): Promise<Record<string, unknown>> {
  let response;
  try {
    response = await getClient().messages.create({
      model,
      max_tokens: 1024,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content: [
            // All photos go in one call rather than one call per image: a
            // single request that sees front and back together can find a
            // field that only appears on one of them, and costs less than
            // re-sending the prompt per image.
            ...images.map((image) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 },
            })),
            { type: "text", text: instructionText },
          ],
        },
      ],
    });
  } catch (err) {
    throw new Error(toFriendlyErrorMessage(err));
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error("Model did not return structured extraction output.");
  }
  return toolUse.input as Record<string, unknown>;
}

const SHARED_INSTRUCTIONS =
  "These images are multiple photos of the same product's labels (typically front and back, sometimes a side or neck label). A given field may appear on only one of them, so check every image before concluding a field is absent. Extract each field exactly as printed, preserving original casing and punctuation verbatim. The Government Warning statement is usually small print on the back or side label. Read it carefully and transcribe it word for word, including the 'GOVERNMENT WARNING:' header. The name and address of the bottler or producer, and the country of origin if there is one, are also usually small print on the back or side. Also report whether any image shows a face other than the front of the packaging, so that a field which is absent can be distinguished from a face nobody photographed. Only use null for a field that is genuinely not present on any image; do not use null merely because text is small or hard to read.";

/**
 * Words a model reaches for instead of returning null, even when the schema
 * allows null and the prompt asks for it. Observed in practice: a front-only
 * label came back with the literal string "<UNKNOWN>" for the Government
 * Warning.
 *
 * That is not a cosmetic difference. A non-empty string means "the label says
 * this", so "<UNKNOWN>" was compared against the statutory text and reported
 * as a wording violation, which is exactly the false finding the evidence-gap
 * handling exists to prevent. Absence has to reach the comparison as absence.
 */
const ABSENT_SENTINEL =
  /^[\s<[("'*-]*(?:unknown|none|null|nil|n\/?a|blank|empty|missing|not\s+(?:found|present|visible|shown|stated|specified|listed|applicable|available)|no\s+(?:value|text|data))[\s>\])"'*.-]*$/i;

/**
 * A value made only of whitespace, dots and dashes: the same statement with no
 * words in it. Built from escapes rather than written as a literal so the
 * dash characters survive reformatting, and so the hyphen stays first and
 * cannot be read as the start of a character range.
 */
const BLANKISH = new RegExp("^[-\\s._\\u2013\\u2014]+$");

/**
 * Normalises one extracted text field. Anything that is not a usable string,
 * or that is one of the placeholders above, becomes null.
 */
export function normalizeExtractedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ABSENT_SENTINEL.test(trimmed)) return null;
  // A lone dash or ellipsis is the same statement with no words in it.
  if (BLANKISH.test(trimmed)) return null;
  return trimmed;
}

function normalizeExtractedNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = normalizeExtractedText(value);
  if (text === null) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Turns whatever the tool call produced into an ExtractedLabelData we can
 * trust. The SDK hands back the model's JSON unvalidated, so this is the only
 * point where its shape is actually established rather than asserted.
 */
export function toExtractedLabelData(input: Record<string, unknown>): ExtractedLabelData {
  return {
    brandName: normalizeExtractedText(input.brandName),
    classType: normalizeExtractedText(input.classType),
    abvPercent: normalizeExtractedNumber(input.abvPercent),
    netContents: normalizeExtractedText(input.netContents),
    bottlerInfo: normalizeExtractedText(input.bottlerInfo),
    countryOfOrigin: normalizeExtractedText(input.countryOfOrigin),
    warningStatementText: normalizeExtractedText(input.warningStatementText),
    // Coerced deliberately, not left to fall through as `undefined`: if the
    // model ever omits this field, the safe default is "no back label
    // visible" (an evidence gap gets reported, not a fabricated violation),
    // and Boolean(...) makes that default explicit rather than accidental.
    backLabelVisible: Boolean(input.backLabelVisible),
  };
}

export async function extractLabelData(images: EncodedImage[]): Promise<ExtractedLabelData> {
  const input = await runExtractionCall(MODEL, EXTRACTION_TOOL, images, SHARED_INSTRUCTIONS);
  return toExtractedLabelData(input);
}

/**
 * Independently re-reads only the given fields with a stronger model - used
 * to double-check fields the first pass didn't cleanly match. Deliberately
 * doesn't reveal what Haiku read or what the application claims, so this is
 * a genuinely independent second read, not a biased confirmation check.
 */
export async function getSecondOpinion(
  images: EncodedImage[],
  fieldKeys: string[]
): Promise<Partial<ExtractedLabelData>> {
  const extractionKeys = fieldKeys
    .map((key) => FIELD_TO_EXTRACTION_KEY[key])
    .filter((key): key is Exclude<keyof ExtractedLabelData, "backLabelVisible"> => Boolean(key));
  if (extractionKeys.length === 0) return {};

  const input = await runExtractionCall(
    SECOND_OPINION_MODEL,
    buildFocusedTool(extractionKeys),
    images,
    `${SHARED_INSTRUCTIONS} Extract only the requested fields.`
  );
  // Normalised the same way as the first pass, and narrowed to the fields
  // actually asked for. A second opinion of "<UNKNOWN>" would otherwise be
  // shown to the reviewer as what the stronger model read.
  const normalized = toExtractedLabelData(input);
  const result: Partial<ExtractedLabelData> = {};
  for (const key of extractionKeys) {
    if (key in input) {
      // Safe: extractionKeys excludes backLabelVisible, so every key here is
      // one of the nullable value fields.
      (result as Record<string, unknown>)[key] = normalized[key];
    }
  }
  return result;
}
