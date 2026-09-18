import { NextResponse } from "next/server";
import { getBatchProgress } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await context.params;
  const progress = await getBatchProgress(batchId);
  return NextResponse.json({ progress });
}
