-- =====================================================
-- 0003_cron_runs_table
-- Audit log for the Railway cron job + filter_status column on feed_items.
-- =====================================================

-- 1. cron_runs audit table
CREATE TABLE IF NOT EXISTS blog.cron_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  status               text NOT NULL DEFAULT 'partial'
                         CHECK (status IN ('success', 'partial', 'failed')),
  items_fetched        int NOT NULL DEFAULT 0,
  items_pre_filtered   int NOT NULL DEFAULT 0,
  items_classified     int NOT NULL DEFAULT 0,
  items_with_errors    int NOT NULL DEFAULT 0,
  digest_slug          text,
  llm_cost_usd         numeric(8, 4) NOT NULL DEFAULT 0,
  error_log            text
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_started
  ON blog.cron_runs(started_at DESC);

-- service_role bypasses RLS, but explicit grants for clarity
ALTER TABLE blog.cron_runs ENABLE ROW LEVEL SECURITY;
GRANT INSERT, UPDATE, SELECT ON blog.cron_runs TO service_role;
-- anon: no access (no policy + no grant)

-- 2. Add filter_status column to feed_items
ALTER TABLE blog.feed_items
  ADD COLUMN IF NOT EXISTS filter_status text
  CHECK (filter_status IN ('pre_filtered_out', 'classified', 'failed'));

CREATE INDEX IF NOT EXISTS idx_feed_items_filter_status
  ON blog.feed_items(filter_status);

-- Backfill existing rows: any row with an AI summary is 'classified'
UPDATE blog.feed_items
SET filter_status = 'classified'
WHERE filter_status IS NULL AND ai_summary_en IS NOT NULL;

-- Rows with no AI summary stay NULL until next pipeline run touches them
