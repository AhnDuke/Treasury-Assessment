import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { AcceptedImageType, ExtractedLabelData } from "./types";

// Haiku, not Sonnet/Opus: label field extraction is a bounded, low-ambiguity
// read task, and the 5-second turnaround Sarah described rules out a slower
// model for what is otherwise a one-shot vision call.
const MODEL = "claude-haiku-4-5-20251001";

// Used only to re-check fields the first pass didn't cleanly match — see
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
// keys — they differ for the warning statement ("warningStatement" vs.
// "warningStatementText"), so this mapping is the single source of truth
// rather than duplicating the two naming schemes elsewhere.
export const FIELD_TO_EXTRACTION_KEY: Record<string, keyof ExtractedLabelData> = {
  brandName: "brandName",
  classType: "classType",
  abvPercent: "abvPercent",
  netContents: "netContents",
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
  warningStatementText: {
    type: ["string", "null"],
    description:
      "The full Government Warning statement, verbatim, including the 'GOVERNMENT WARNING:' header exactly as printed (preserve original casing).",
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

async function runExtractionCall(
  model: string,
  tool: Anthropic.Tool,
  imageBase64: string,
  mediaType: AcceptedImageType,
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
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
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

export async function extractLabelData(imageBase64: string, mediaType: AcceptedImageType): Promise<ExtractedLabelData> {
  const input = await runExtractionCall(
    MODEL,
    EXTRACTION_TOOL,
    imageBase64,
    mediaType,
    "Read this alcohol beverage label and extract the requested fields exactly as printed. Preserve original casing and punctuation verbatim — this matters most for the Government Warning statement. If a field is not visible or not present on the label, use null for it rather than guessing."
  );
  return input as unknown as ExtractedLabelData;
}

/**
 * Independently re-reads only the given fields with a stronger model — used
 * to double-check fields the first pass didn't cleanly match. Deliberately
 * doesn't reveal what Haiku read or what the application claims, so this is
 * a genuinely independent second read, not a biased confirmation check.
 */
export async function getSecondOpinion(
  imageBase64: string,
  mediaType: AcceptedImageType,
  fieldKeys: string[]
): Promise<Partial<ExtractedLabelData>> {
  const extractionKeys = fieldKeys
    .map((key) => FIELD_TO_EXTRACTION_KEY[key])
    .filter((key): key is keyof ExtractedLabelData => Boolean(key));
  if (extractionKeys.length === 0) return {};

  const input = await runExtractionCall(
    SECOND_OPINION_MODEL,
    buildFocusedTool(extractionKeys),
    imageBase64,
    mediaType,
    "Read this alcohol beverage label carefully and extract only the requested fields, exactly as printed. Preserve original casing and punctuation verbatim. If a field is not visible or not present, use null rather than guessing."
  );
  return input as unknown as Partial<ExtractedLabelData>;
}
