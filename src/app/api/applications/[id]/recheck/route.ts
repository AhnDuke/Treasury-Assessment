import { after, NextResponse } from "next/server";
import { getApplication, updateApplicationResult } from "@/lib/db";
import { drainPendingApplications } from "@/lib/processQueue";

export const runtime = "nodejs";

/**
 * Puts an application back in the queue to be checked again.
 *
 * An application's results are a snapshot of the checks that existed when it
 * was processed. When a check is added or a rule corrected, everything already
 * in the queue keeps the old answer, and there is otherwise no way to bring it
 * forward short of deleting the application and adding it again. That is the
 * common case here: rows checked before the bottler and country-of-origin
 * checks existed simply have no result for those fields.
 *
 * A recorded decision is deliberately left alone. The automated check is not a
 * verdict, so re-running it cannot unmake a person's sign-off; the agent can
 * decide again if the new result warrants it.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const existing = await getApplication(id);
  if (!existing) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  if (existing.status === "pending" || existing.status === "processing") {
    return NextResponse.json({ error: "This application is already waiting to be checked." }, { status: 409 });
  }

  // Clearing the old result rather than leaving it in place while the new one
  // runs: a stale set of fields shown as current is worse than an empty one
  // shown as pending.
  await updateApplicationResult(id, {
    status: "pending",
    triageStatus: null,
    fields: null,
    errorMessage: null,
    processingMs: null,
  });
  after(() => drainPendingApplications());

  const application = await getApplication(id);
  return NextResponse.json({ application });
}
