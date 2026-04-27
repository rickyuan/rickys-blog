-- =====================================================
-- 0004_candidates_time_decay
-- Replaces blog.weekly_candidates view with a time-decayed version.
-- 14-day window, exponential decay with ~7-day half-life.
-- High-value items not picked one week can carry over.
-- =====================================================

-- DROP first because adding a new column (days_since_fetched) shifts column
-- positions, which CREATE OR REPLACE VIEW does not allow.
DROP VIEW IF EXISTS blog.weekly_candidates;

CREATE VIEW blog.weekly_candidates AS
SELECT
  fi.id,
  fi.url,
  fi.title,
  fi.raw_excerpt,
  fi.ai_summary_en,
  fi.ai_summary_cn,
  fi.ai_section,
  fi.ai_score,
  fi.fetched_at,
  fs.label   AS source_label,
  fs.section AS source_section,
  fs.weight  AS source_weight,
  EXTRACT(EPOCH FROM (NOW() - fi.fetched_at)) / 86400.0 AS days_since_fetched,
  ROUND(
    COALESCE(fi.ai_score, 0)
    * COALESCE(fs.weight, 1)
    * EXP(-EXTRACT(EPOCH FROM (NOW() - fi.fetched_at)) / 86400.0 / 7.0)
  )::int AS priority_score
FROM blog.feed_items fi
LEFT JOIN blog.feed_sources fs ON fs.id = fi.source_id
WHERE fi.used_in_weekly IS NULL
  AND fi.filter_status = 'classified'
  AND fi.fetched_at > NOW() - INTERVAL '14 days'
ORDER BY priority_score DESC;

-- Grants (DROP VIEW above wiped them, must re-grant)
GRANT SELECT ON blog.weekly_candidates TO service_role;
GRANT SELECT ON blog.weekly_candidates TO authenticated;
-- anon: intentionally NOT granted
