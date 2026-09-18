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
  // Best-effort: a failed image delete shouldn't leave the row undeletable.
  await Promise.all(
    deleted.images.map((image) => deleteLabelImage(image.url).catch(() => undefined))
  );
  return NextResponse.json({ ok: true });
}
