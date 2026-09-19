import { after, NextResponse } from "next/server";
import { drainPendingApplications } from "@/lib/processQueue";

export const runtime = "nodejs";

/**
 * Starts working through everything currently queued, and returns straight
 * away rather than waiting for it.
 *
 * Two callers: the **Resume processing** button in the review queue, and a
 * guided import once every row has been submitted or scrapped. Imports queue
 * their rows without checking any of them, so that an agent working a long
 * sheet isn't competing with Claude calls for the same invocation - this is
 * what kicks the batch off afterwards.
 *
 * It drains rather than running a single pass: a pass claims a bounded chunk,
 * so a 40-row import would have needed the button pressed three times. The
 * drain runs in `after()` so the response isn't held open for the whole batch,
 * and it's bounded by its own wall-clock budget; anything still left over is
 * picked up by the next press or the cron sweep.
 *
 * Unauthenticated like the rest of the app, which is safe here in a way the
 * cron route isn't: this only advances work that's already queued, so it
 * can't be used to run up API cost beyond what an import already committed to.
 */
export async function POST() {
  after(() => drainPendingApplications());
  return NextResponse.json({ started: true });
}
