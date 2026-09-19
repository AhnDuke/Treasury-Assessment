import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { ApplicationData, ApplicationRecord, ApplicationStatus, BatchProgress, FieldResult, LabelImage, ReviewDecision, TriageStatus } from "./types";

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
    images: row.images ?? [],
    status: row.status,
    triageStatus: row.triage_status,
    fields: row.fields_json,
    errorMessage: row.error_message,
    decision: row.decision,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at,
    decisionFlaggedFields: row.decision_flagged_fields,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createApplication(
  data: ApplicationData,
  images: LabelImage[],
  status: ApplicationStatus,
  importBatchId: string | null = null
): Promise<ApplicationRecord> {
  const db = getSql();
  const rows = await db`
    INSERT INTO applications (import_batch_id, brand_name, class_type, abv_percent, net_contents, images, status)
    VALUES (${importBatchId}, ${data.brandName}, ${data.classType}, ${data.abvPercent}, ${data.netContents}, ${JSON.stringify(images)}, ${status})
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
    triageStatus?: TriageStatus | null;
    fields?: FieldResult[] | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  const db = getSql();
  await db`
    UPDATE applications
    SET status = ${update.status},
        triage_status = ${update.triageStatus ?? null},
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

/**
 * Records an agent's sign-off. The flagged-field snapshot is computed here
 * from the row's own stored results rather than taken from the client, so it
 * reflects what the agent was actually shown and can't be spoofed by a
 * caller. Returns null if no such application exists.
 */
export async function recordDecision(
  id: string,
  decision: ReviewDecision,
  reason: string | null
): Promise<ApplicationRecord | null> {
  const db = getSql();
  const rows = await db`
    UPDATE applications
    SET decision = ${decision},
        decision_reason = ${reason},
        decided_at = now(),
        decision_flagged_fields = COALESCE(
          (
            SELECT jsonb_agg(field_entry->>'field')
            FROM jsonb_array_elements(fields_json) AS field_entry
            WHERE field_entry->>'status' <> 'match'
          ),
          '[]'::jsonb
        ),
        updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  return rows[0] ? toApplicationRecord(rows[0]) : null;
}
