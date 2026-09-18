import { NextResponse } from "next/server";
import { deleteLabelImage } from "@/lib/blob";
import { deleteApplication, getApplication } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const application = await getApplication(id);
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  return NextResponse.json({ application });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const deleted = await deleteApplication(id);
  if (!deleted) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  await deleteLabelImage(deleted.imageUrl);
  return NextResponse.json({ ok: true });
}
