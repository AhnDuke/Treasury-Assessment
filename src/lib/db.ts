import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { ApplicationData, ApplicationRecord, ApplicationStatus, BatchProgress, FieldResult, OverallStatus } from "./types";

let sql: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (sql) return sql;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example) after provisioning Neon.");
  }
  sql = neon<false, false>(databaseUrl);
  return sql;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toApplicationRecord(row: any): ApplicationRecord {
  return {
    id: row.id,
    importBatchId: row.import_batch_id,
    brandName: row.brand_name,
    classType: row.class_type,
    abvPercent: Number(row.abv_percent),
    netContents: row.net_contents,
    imageUrl: row.image_url,
    imageFilename: row.image_filename,
    imageContentType: row.image_content_type,
    status: row.status,
    overallStatus: row.overall_status,
    fields: row.fields_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createApplication(
  data: ApplicationData,
  image: { url: string; filename: string; contentType: string },
  status: ApplicationStatus,
  importBatchId: string | null = null
): Promise<ApplicationRecord> {
  const db = getSql();
  const rows = await db`
    INSERT INTO applications (import_batch_id, brand_name, class_type, abv_percent, net_contents, image_url, image_filename, image_content_type, status)
    VALUES (${importBatchId}, ${data.brandName}, ${data.classType}, ${data.abvPercent}, ${data.netContents}, ${image.url}, ${image.filename}, ${image.contentType}, ${status})
    RETURNING *
  `;
  return toApplicationRecord(rows[0]);
}

export async function getApplication(id: string): Promise<ApplicationRecord | null> {
  const db = getSql();
  const rows = await db`SELECT * FROM applications WHERE id = ${id}`;
  return rows[0] ? toApplicationRecord(rows[0]) : null;
}

export async function listApplications(status?: ApplicationStatus): Promise<ApplicationRecord[]> {
  const db = getSql();
  const rows = status
    ? await db`SELECT * FROM applications WHERE status = ${status} ORDER BY created_at DESC LIMIT 200`
    : await db`SELECT * FROM applications ORDER BY created_at DESC LIMIT 200`;
  return rows.map(toApplicationRecord);
}

export async function updateApplicationResult(
  id: string,
  update: {
    status: ApplicationStatus;
    overallStatus?: OverallStatus | null;
    fields?: FieldResult[] | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  const db = getSql();
  await db`
    UPDATE applications
    SET status = ${update.status},
        overall_status = ${update.overallStatus ?? null},
        fields_json = ${update.fields ? JSON.stringify(update.fields) : null},
        error_message = ${update.errorMessage ?? null},
        updated_at = now()
    WHERE id = ${id}
  `;
}

/**
 * Atomically claims up to `limit` pending rows by flipping them to
 * "processing" in a single statement (`FOR UPDATE SKIP LOCKED`), so the
 * inline post-import pass and the cron sweep can never both pick up the
 * same row.
 */
export async function claimNextPending(limit: number): Promise<ApplicationRecord[]> {
  const db = getSql();
  const rows = await db`
    UPDATE applications
    SET status = 'processing', updated_at = now()
    WHERE id IN (
      SELECT id FROM applications
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows.map(toApplicationRecord);
}

export async function cancelBatch(importBatchId: string): Promise<number> {
  const db = getSql();
  const rows = await db`
    UPDATE applications SET status = 'cancelled', updated_at = now()
    WHERE import_batch_id = ${importBatchId} AND status = 'pending'
    RETURNING id
  `;
  return rows.length;
}

export async function getBatchProgress(importBatchId: string): Promise<BatchProgress> {
  const db = getSql();
  const rows = await db`
    SELECT status, COUNT(*)::int AS count FROM applications WHERE import_batch_id = ${importBatchId} GROUP BY status
  `;
  const counts: Record<string, number> = {};
  for (const row of rows as { status: string; count: number }[]) counts[row.status] = row.count;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return {
    importBatchId,
    total,
    pending: counts.pending ?? 0,
    processing: counts.processing ?? 0,
    done: counts.done ?? 0,
    cancelled: counts.cancelled ?? 0,
    error: counts.error ?? 0,
  };
}

export async function deleteApplication(id: string): Promise<ApplicationRecord | null> {
  const db = getSql();
  const rows = await db`DELETE FROM applications WHERE id = ${id} RETURNING *`;
  return rows[0] ? toApplicationRecord(rows[0]) : null;
}
