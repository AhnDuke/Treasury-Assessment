-- Applications table: one row per label submitted for review, whether added
-- one at a time or through a bulk import. A "batch" is just the set of rows
-- sharing an import_batch_id — there's no separate batches table to keep in
-- sync.
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
  overall_status TEXT
    CHECK (overall_status IN ('approved', 'flagged', 'rejected')),
  fields_json JSONB,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS applications_status_idx ON applications (status);
CREATE INDEX IF NOT EXISTS applications_import_batch_idx ON applications (import_batch_id);
CREATE INDEX IF NOT EXISTS applications_created_at_idx ON applications (created_at DESC);
