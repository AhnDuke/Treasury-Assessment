import { downloadLabelImage } from "./blob";
import { claimNextPending, updateApplicationResult } from "./db";
import { runVerification } from "./verify";
import { mapWithConcurrency } from "./concurrency";
import type { ApplicationRecord } from "./types";

// How many Claude calls run at once - the whole reason this queue exists is
// so a 500-row import doesn't fire 500 concurrent calls.
const PROCESS_CONCURRENCY = Number(process.env.PROCESS_CONCURRENCY ?? 4);
// How many rows one processing pass claims - larger than PROCESS_CONCURRENCY
// so a single invocation (the post-import waitUntil pass, or one cron tick)
// makes meaningful progress rather than just topping up the in-flight count.
const CLAIM_BATCH_SIZE = PROCESS_CONCURRENCY * 5;

async function processOne(application: ApplicationRecord): Promise<void> {
  try {
    const images = await Promise.all(
      application.images.map(async (image) => ({
        base64: (await downloadLabelImage(image.url)).toString("base64"),
        mediaType: image.contentType,
      }))
    );
    const outcome = await runVerification(images, {
      brandName: application.brandName,
      classType: application.classType,
      abvPercent: application.abvPercent,
      netContents: application.netContents,
    });
    await updateApplicationResult(application.id, {
      status: "done",
      triageStatus: outcome.triageStatus,
      fields: outcome.fields,
    });
  } catch (err) {
    await updateApplicationResult(application.id, {
      status: "error",
      errorMessage: err instanceof Error ? err.message : "Unknown error during verification.",
    });
  }
}

/**
 * Claims and processes a chunk of pending applications, bounded by
 * PROCESS_CONCURRENCY concurrent Claude calls. Safe to call concurrently
 * from multiple triggers (the post-import waitUntil pass and the cron
 * sweep) - claimNextPending's `FOR UPDATE SKIP LOCKED` guarantees they never
 * claim the same row twice. Returns how many rows it claimed, so a caller
 * can decide whether to loop (more work) or stop (queue drained).
 */
export async function processPendingApplications(): Promise<number> {
  const claimed = await claimNextPending(CLAIM_BATCH_SIZE);
  if (claimed.length === 0) return 0;
  await mapWithConcurrency(claimed, PROCESS_CONCURRENCY, processOne);
  return claimed.length;
}

/**
 * Loops processPendingApplications until the queue is drained or a wall-clock
 * budget runs out. Used right after an import so most batches finish inline;
 * the cron sweep (a single processPendingApplications() call per tick) is
 * what guarantees anything left over eventually gets processed too, since a
 * serverless invocation's lifetime - even extended via `after()` - isn't
 * unbounded.
 */
export async function drainPendingApplications(budgetMs = 4 * 60 * 1000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const claimedCount = await processPendingApplications();
    if (claimedCount === 0) return;
  }
}
