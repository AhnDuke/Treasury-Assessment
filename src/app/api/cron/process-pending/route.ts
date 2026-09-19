import { NextRequest, NextResponse } from "next/server";
import { processPendingApplications } from "@/lib/processQueue";

export const runtime = "nodejs";

// Vercel sends `Authorization: Bearer $CRON_SECRET` on its own Cron
// invocations when CRON_SECRET is set. This endpoint calls the Anthropic API
// on every hit, so - unlike the rest of this no-auth prototype - it's worth
// gating: without this check, anyone who found the URL could trigger repeated
// paid API calls on demand. Fails closed: a missing CRON_SECRET rejects
// every request rather than silently leaving the endpoint open.
function isAuthorizedCronRequest(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const claimedCount = await processPendingApplications();
  return NextResponse.json({ claimedCount });
}
