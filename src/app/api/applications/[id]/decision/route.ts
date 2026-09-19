import { NextResponse } from "next/server";
import { getApplication, recordDecision } from "@/lib/db";
import type { ReviewDecision } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Records an agent's sign-off on an application.
 *
 * A rejection must carry a reason: a compliance decision without a recorded
 * basis is not useful to anyone downstream, and the reviewer is the only one
 * who knows it. An approval doesn't, because the common case is "everything
 * matched" and forcing a note there would just train people to type "ok".
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const decision = payload.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: 'Decision must be either "approved" or "rejected".' }, { status: 400 });
  }

  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (decision === "rejected" && !reason) {
    return NextResponse.json({ error: "A rejection needs a reason." }, { status: 400 });
  }

  const existing = await getApplication(id);
  if (!existing) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  if (existing.status !== "done") {
    // Deciding on a row that hasn't been checked yet would record a sign-off
    // against results that don't exist, and the flagged-field snapshot would
    // be empty for the wrong reason.
    return NextResponse.json(
      { error: "This application hasn't finished its automated check yet." },
      { status: 409 }
    );
  }

  const application = await recordDecision(id, decision as ReviewDecision, reason || null);
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  return NextResponse.json({ application });
}
