-- Applications table: one row per label submitted for review, whether added
-- one at a time or through a bulk import. A "batch" is just the set of rows
-- sharing an import_batch_id — there's no separate batches table to keep in
-- sync.
--
-- The runner (scripts/migrate.mjs) executes these statements one at a time
-- with no enclosing transaction, so an interrupted run can leave the schema
-- part-migrated. Re-running this file is the recovery, which is why every
-- statement below is idempotent.
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id UUID,

  brand_name TEXT NOT NULL,
  class_type TEXT NOT NULL,
  abv_percent NUMERIC NOT NULL,
  net_contents TEXT NOT NULL,

  image_url TEXT NOT NULL,
  image_filename TEXT NOT NULL,
  image_content_type TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'cancelled', 'error')),
  triage_status TEXT
    CHECK (triage_status IN ('clean', 'review', 'discrepancy')),
  fields_json JSONB,
  error_message TEXT,
  decision TEXT
    CHECK (decision IN ('approved', 'rejected')),
  decision_reason TEXT,
  decided_at TIMESTAMPTZ,
  decision_flagged_fields JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS applications_status_idx ON applications (status);
CREATE INDEX IF NOT EXISTS applications_import_batch_idx ON applications (import_batch_id);
CREATE INDEX IF NOT EXISTS applications_created_at_idx ON applications (created_at DESC);

-- Migration: one image per application -> many (front, back, ...).
-- These run after the CREATE TABLE above rather than replacing its columns,
-- so the backfill below always has the legacy columns to read from — on a
-- fresh database they're created and then dropped, on an existing one the
-- rows are migrated. (The runner executes statements in order and can't
-- handle DO blocks, which is why this is plain sequential DDL.)
--
-- The backfill reads the legacy columns through to_jsonb(applications)
-- rather than naming them directly. A direct reference stops parsing once
-- the DROP below has run, which made this file fail on every run after the
-- first with `column "image_url" does not exist` — the opposite of the
-- idempotence it claimed. Through to_jsonb the statement parses either way
-- and simply matches no rows once the columns are gone.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS images JSONB;

UPDATE applications
SET images = jsonb_build_array(
  jsonb_build_object(
    'url', to_jsonb(applications) ->> 'image_url',
    'filename', to_jsonb(applications) ->> 'image_filename',
    'contentType', to_jsonb(applications) ->> 'image_content_type'
  )
)
WHERE images IS NULL AND to_jsonb(applications) ->> 'image_url' IS NOT NULL;

ALTER TABLE applications DROP COLUMN IF EXISTS image_url;
ALTER TABLE applications DROP COLUMN IF EXISTS image_filename;
ALTER TABLE applications DROP COLUMN IF EXISTS image_content_type;

-- Migration: the automated verdict is a triage signal, not a decision.
-- "approved"/"rejected" now belong exclusively to a human reviewer's
-- decision (added below), so the automated column is renamed and revalued to
-- keep the two vocabularies from colliding in the UI.
--
-- Note the asymmetry: a fresh database gets triage_status from the CREATE
-- TABLE above, with its CHECK constraint. An existing database gets it from
-- the ALTER here, without one. Postgres has no `ADD CONSTRAINT IF NOT
-- EXISTS`, and this file must stay re-runnable, so the constraint is not
-- retrofitted. Writes go through updateApplicationResult in src/lib/db.ts,
-- which is typed to TriageStatus.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS triage_status TEXT;

-- Reads overall_status through to_jsonb(applications) rather than naming it,
-- for the same reason as the images backfill above: a direct reference stops
-- parsing once the DROP below has run, which would make this file fail on
-- every subsequent migration. See Task 0.
UPDATE applications
SET triage_status = CASE to_jsonb(applications) ->> 'overall_status'
  WHEN 'approved' THEN 'clean'
  WHEN 'flagged' THEN 'review'
  WHEN 'rejected' THEN 'discrepancy'
END
WHERE triage_status IS NULL AND to_jsonb(applications) ->> 'overall_status' IS NOT NULL;

ALTER TABLE applications DROP COLUMN IF EXISTS overall_status;

-- A human reviewer's decision. Separate from triage_status on purpose: the
-- automated check never decides anything, and every application is signed off
-- by a person.
--
-- decision_flagged_fields snapshots which fields the automated check had
-- flagged at the moment of sign-off. An agent approving an application the
-- check flagged is the most useful signal this system produces — it is the
-- calibration data for the matching thresholds, which are currently
-- reasonable defaults rather than anything tuned against real adjudications.
--
-- Same asymmetry as triage_status above, and the same reason: a fresh
-- database gets the CHECK (decision IN ('approved', 'rejected')) constraint
-- from the CREATE TABLE, an existing database gets this bare ALTER instead,
-- because Postgres has no `ADD CONSTRAINT IF NOT EXISTS` and this file must
-- stay re-runnable.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decision TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decision_reason TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decision_flagged_fields JSONB;

-- The review queue's tabs split on this, so it is the one new access path.
CREATE INDEX IF NOT EXISTS applications_decision_idx ON applications (decision);
