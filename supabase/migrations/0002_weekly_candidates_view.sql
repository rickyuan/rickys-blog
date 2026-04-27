-- =====================================================
-- rickys-blog · 0002_weekly_candidates_view
-- A convenience view used by the n8n weekly synthesis step.
-- Returns unused (not yet picked into a weekly) feed items
-- joined with their source's weight, sorted by priority score.
-- =====================================================

CREATE OR REPLACE VIEW blog.weekly_candidates AS
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
  fs.label         AS source_label,
  fs.section       AS source_section,
  fs.weight        AS source_weight,
  COALESCE(fi.ai_score, 0) * COALESCE(fs.weight, 1) AS priority_score
FROM blog.feed_items fi
LEFT JOIN blog.feed_sources fs ON fi.source_id = fs.id
WHERE fi.used_in_weekly IS NULL
ORDER BY priority_score DESC;
