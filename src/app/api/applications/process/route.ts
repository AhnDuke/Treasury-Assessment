import { NextResponse } from "next/server";
import { processPendingApplications } from "@/lib/processQueue";

export const runtime = "nodejs";

/**
 * Manually advances the queue by one pass. Exists because Vercel's Hobby
 * plan caps cron jobs at once per day, so the automated sweep can't be the
 * near-real-time backstop it is on Pro — this gives a reviewer a way to
 * resume an import that didn't finish inline without waiting for it.
 *
 * Unauthenticated like the rest of the app, which is safe here in a way the
 * cron route isn't: this only advances work that's already queued, so it
 * can't be used to run up API cost beyond what an import already committed to.
 */
export async function POST() {
  const claimedCount = await processPendingApplications();
  return NextResponse.json({ claimedCount });
}
