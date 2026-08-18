/**
 * D1 write/read helpers for the digest worker.
 */
import type { D1Database } from '../../../src/lib/d1-types';
import type { FeedSource, ParsedItem } from './feeds';
import type { Classification } from './classify';
import type { WeeklySynthesis } from './synthesize';

const INSERT_CHUNK = 40;

export async function getEnabledSources(db: D1Database): Promise<FeedSource[]> {
  const { results } = await db
    .prepare('SELECT id, url, label, section, weight FROM feed_sources WHERE enabled = 1')
    .all<FeedSource>();
  return results ?? [];
}

/** INSERT OR IGNORE raw items (dedupe on url). Returns number actually inserted. */
export async function insertRawItems(db: D1Database, items: ParsedItem[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < items.length; i += INSERT_CHUNK) {
    const chunk = items.slice(i, i + INSERT_CHUNK);
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO feed_items (id, source_id, url, title, raw_excerpt) VALUES (?, ?, ?, ?, ?)',
    );
    const results = await db.batch(
      chunk.map((it) =>
        stmt.bind(crypto.randomUUID(), it.source_id, it.url, it.title, it.raw_excerpt),
      ),
    );
    for (const r of results) {
      inserted += Number((r.meta as { changes?: number } | undefined)?.changes ?? 0);
    }
  }
  return inserted;
}

export type PendingItem = {
  id: string;
  source_id: string | null;
  source_label: string | null;
  source_section: string | null;
  url: string;
  title: string;
  raw_excerpt: string | null;
};

/** Items fetched in the last `days` days that have not been pre-filtered/classified yet. */
export async function getUnprocessedItems(db: D1Database, days: number): Promise<PendingItem[]> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT fi.id, fi.source_id, fi.url, fi.title, fi.raw_excerpt,
              fs.label AS source_label, fs.section AS source_section
       FROM feed_items fi
       LEFT JOIN feed_sources fs ON fs.id = fi.source_id
       WHERE fi.filter_status IS NULL AND fi.fetched_at > ?`,
    )
    .bind(cutoff)
    .all<PendingItem>();
  return results ?? [];
}

export async function markPreFilteredOut(db: D1Database, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
    const chunk = ids.slice(i, i + INSERT_CHUNK);
    const stmt = db.prepare(
      "UPDATE feed_items SET filter_status = 'pre_filtered_out' WHERE id = ?",
    );
    await db.batch(chunk.map((id) => stmt.bind(id)));
  }
}

export async function updateClassification(
  db: D1Database,
  rows: { id: string; c: Classification }[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const stmt = db.prepare(
      `UPDATE feed_items
       SET ai_summary_en = ?, ai_summary_cn = ?, ai_section = ?, ai_score = ?, filter_status = ?
       WHERE id = ?`,
    );
    await db.batch(
      chunk.map(({ id, c }) =>
        stmt.bind(
          c.ai_summary_en,
          c.ai_summary_cn,
          c.ai_section,
          c.ai_score,
          c.ai_summary_en ? 'classified' : 'failed',
          id,
        ),
      ),
    );
  }
}

export type CandidateRow = {
  id: string;
  url: string;
  title: string;
  ai_summary_en: string | null;
  ai_summary_cn: string | null;
  ai_section: string;
  ai_score: number;
  fetched_at: string;
  source_label: string | null;
  source_section: string | null;
  source_weight: number | null;
};

/**
 * Classified, unused items from the last 14 days. Priority score with the
 * ~7-day-half-life time decay is computed in JS (no reliance on SQLite math fns).
 */
export async function getWeeklyCandidates(
  db: D1Database,
  top: number,
): Promise<(CandidateRow & { priority_score: number })[]> {
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT fi.id, fi.url, fi.title, fi.ai_summary_en, fi.ai_summary_cn,
              fi.ai_section, fi.ai_score, fi.fetched_at,
              fs.label AS source_label, fs.section AS source_section, fs.weight AS source_weight
       FROM feed_items fi
       LEFT JOIN feed_sources fs ON fs.id = fi.source_id
       WHERE fi.used_in_weekly IS NULL
         AND fi.filter_status = 'classified'
         AND fi.fetched_at > ?`,
    )
    .bind(cutoff)
    .all<CandidateRow>();

  return (results ?? [])
    .map((r) => {
      const days = (Date.now() - new Date(r.fetched_at).getTime()) / 86_400_000;
      const priority = Math.round(
        (r.ai_score ?? 0) * (r.source_weight ?? 1) * Math.exp(-days / 7),
      );
      return { ...r, priority_score: priority };
    })
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, top);
}

export async function upsertWeeklyDigest(db: D1Database, s: WeeklySynthesis): Promise<void> {
  await db
    .prepare(
      `INSERT INTO weekly_digests
         (slug, title, curators_note_en, curators_note_cn, body_md,
          deep_dive_url, deep_dive_summary_en, deep_dive_summary_cn, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         title = excluded.title,
         curators_note_en = excluded.curators_note_en,
         curators_note_cn = excluded.curators_note_cn,
         body_md = excluded.body_md,
         deep_dive_url = excluded.deep_dive_url,
         deep_dive_summary_en = excluded.deep_dive_summary_en,
         deep_dive_summary_cn = excluded.deep_dive_summary_cn,
         published_at = excluded.published_at`,
    )
    .bind(
      s.iso_week,
      s.title,
      s.curators_note_en,
      s.curators_note_cn,
      s.body_md,
      s.deep_dive_url ?? null,
      s.deep_dive_summary_en ?? null,
      s.deep_dive_summary_cn ?? null,
      new Date().toISOString(),
    )
    .run();
}

export async function markItemsUsed(db: D1Database, ids: string[], slug: string): Promise<void> {
  const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)));
  if (valid.length === 0) return;
  const stmt = db.prepare('UPDATE feed_items SET used_in_weekly = ? WHERE id = ?');
  await db.batch(valid.map((id) => stmt.bind(slug, id)));
}

// ── cron_runs audit ──────────────────────────────────────────

export async function openCronRun(db: D1Database, job: string): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    await db
      .prepare("INSERT INTO cron_runs (id, job, started_at, status) VALUES (?, ?, ?, 'partial')")
      .bind(id, job, new Date().toISOString())
      .run();
    return id;
  } catch (e: unknown) {
    console.warn(`cron_runs open failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export type CronStats = {
  status: 'success' | 'partial' | 'failed';
  items_fetched: number;
  items_pre_filtered: number;
  items_classified: number;
  items_with_errors: number;
  digest_slug: string | null;
  error_log: string | null;
};

export async function closeCronRun(db: D1Database, id: string | null, s: CronStats): Promise<void> {
  if (!id) return;
  try {
    await db
      .prepare(
        `UPDATE cron_runs SET finished_at = ?, status = ?, items_fetched = ?,
           items_pre_filtered = ?, items_classified = ?, items_with_errors = ?,
           digest_slug = ?, error_log = ?
         WHERE id = ?`,
      )
      .bind(
        new Date().toISOString(),
        s.status,
        s.items_fetched,
        s.items_pre_filtered,
        s.items_classified,
        s.items_with_errors,
        s.digest_slug,
        s.error_log,
        id,
      )
      .run();
  } catch (e: unknown) {
    console.warn(`cron_runs close failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── GTM signals ──────────────────────────────────────────────

export type GtmSourceItem = {
  id: string;
  url: string;
  title: string;
  raw_excerpt: string | null;
  source_label: string | null;
  source_section: string | null;
};

/** Non-inspiration items fetched within the lookback window (for daily signal extraction). */
export async function getRecentItemsForGtm(
  db: D1Database,
  lookbackHours: number,
  limit: number,
): Promise<GtmSourceItem[]> {
  const cutoff = new Date(Date.now() - lookbackHours * 3_600_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT fi.id, fi.url, fi.title, fi.raw_excerpt,
              fs.label AS source_label, fs.section AS source_section
       FROM feed_items fi
       LEFT JOIN feed_sources fs ON fs.id = fi.source_id
       WHERE fi.fetched_at > ?
         AND (fs.section IS NULL OR fs.section != 'inspiration')
       ORDER BY fi.fetched_at DESC
       LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<GtmSourceItem>();
  return results ?? [];
}

export type ExtractedSignal = {
  title: string;
  url: string | null;
  company_name: string | null;
  country: string | null;
  signal_type: string;
  icp_score: number;
  entry_point: string | null;
  industry: string | null;
  reasoning: string | null;
  entry_angle: string | null;
  competitor_displaced: string | null;
  published_at: string | null;
};

export async function insertSignals(db: D1Database, signals: ExtractedSignal[]): Promise<number> {
  if (signals.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO signals
       (id, title, url, company_name, country, signal_type, icp_score,
        entry_point, enrichment, status, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
  );
  let inserted = 0;
  for (let i = 0; i < signals.length; i += INSERT_CHUNK) {
    const chunk = signals.slice(i, i + INSERT_CHUNK);
    const results = await db.batch(
      chunk.map((s) =>
        stmt.bind(
          crypto.randomUUID(),
          s.title,
          s.url,
          s.company_name,
          s.country,
          s.signal_type,
          Math.max(0, Math.min(100, s.icp_score)),
          s.entry_point,
          JSON.stringify({
            score: Math.max(0, Math.min(100, s.icp_score)),
            industry: s.industry,
            reasoning: s.reasoning,
            entry_angle: s.entry_angle,
            competitor_displaced: s.competitor_displaced,
            company_name_refined: null,
            country_refined: null,
            signal_type_refined: null,
          }),
          s.published_at,
          new Date().toISOString(),
        ),
      ),
    );
    for (const r of results) {
      inserted += Number((r.meta as { changes?: number } | undefined)?.changes ?? 0);
    }
  }
  return inserted;
}
