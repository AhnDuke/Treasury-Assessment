/**
 * The bar the stakeholder interviews set on turnaround. Sarah Chen on the
 * scanning-vendor pilot that failed: it "would take 30, 40 seconds sometimes
 * to process a single label. Our agents just went back to doing it by eye...
 * If we can't get results back in about 5 seconds, nobody's going to use it."
 *
 * Treated as a real threshold rather than a nice-to-have, which is why the
 * duration is stored per application and shown in the queue: a target nobody
 * measures is a target nobody can be held to.
 */
export const TARGET_PROCESSING_MS = 5000;

/**
 * How a recorded duration should be read in the queue.
 *
 * "within" and "over" are deliberately not "pass" and "fail". Exceeding the
 * target on one label is not a defect in that application, it is information
 * about the check, and an agent reading the column should not think the label
 * did something wrong.
 */
export type ProcessingSpeed = "within" | "over" | "unknown";

export function classifyProcessingTime(ms: number | null | undefined): ProcessingSpeed {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "unknown";
  return ms <= TARGET_PROCESSING_MS ? "within" : "over";
}

/**
 * Renders a duration for someone who wants to know "was that quick?", not for
 * someone benchmarking. Sub-second times round to one decimal because the
 * difference between 0.4s and 0.9s is visible to a person waiting; past ten
 * seconds the decimal is noise.
 */
export function formatProcessingTime(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export interface ProcessingStats {
  count: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  withinTarget: number;
  overTarget: number;
}

/**
 * Summarises a set of durations. Reports the median and p95 rather than the
 * mean: latency distributions here are skewed by the escalation path (a field
 * that doesn't cleanly match earns a second, slower model call), so an average
 * would describe a case that rarely happens.
 */
export function summariseProcessingTimes(samples: number[]): ProcessingStats | null {
  const valid = samples.filter((ms) => typeof ms === "number" && Number.isFinite(ms) && ms >= 0).sort((a, b) => a - b);
  if (valid.length === 0) return null;

  const at = (fraction: number) => valid[Math.min(valid.length - 1, Math.floor(fraction * valid.length))];

  return {
    count: valid.length,
    min: valid[0],
    median: at(0.5),
    p95: at(0.95),
    max: valid[valid.length - 1],
    withinTarget: valid.filter((ms) => ms <= TARGET_PROCESSING_MS).length,
    overTarget: valid.filter((ms) => ms > TARGET_PROCESSING_MS).length,
  };
}
