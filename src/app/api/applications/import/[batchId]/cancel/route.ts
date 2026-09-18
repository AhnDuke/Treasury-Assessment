import { NextResponse } from "next/server";
import { cancelBatch } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await context.params;
  const cancelledCount = await cancelBatch(batchId);
  return NextResponse.json({ cancelledCount });
}
