/**
 * D1 data layer for the site (read-only queries).
 * The database binding (DB) is per-request on Cloudflare, so every helper
 * takes the D1Database from Astro.locals.runtime.env.
 */

import type { D1Database } from './d1-types';

export type WeeklyDigest = {
  slug: string;
  title: string;
  curators_note_en: string | null;
  curators_note_cn: string | null;
  body_md: string;
  deep_dive_url: string | null;
  deep_dive_summary_en: string | null;
  deep_dive_summary_cn: string | null;
  published_at: string;
};

export type WeeklyListItem = Pick<WeeklyDigest, 'slug' | 'title' | 'published_at'>;

export type SignalEnrichment = {
  score: number;
  industry: string | null;
  reasoning: string | null;
  entry_angle: string | null;
  competitor_displaced: string | null;
  company_name_refined: string | null;
  country_refined: string | null;
  signal_type_refined: string | null;
} | null;

export type Signal = {
  id: string;
  title: string;
  url: string | null;
  company_name: string | null;
  country: string | null;
  signal_type: string;
  icp_score: number | null;
  entry_point: string | null;
  enrichment: SignalEnrichment;
  published_at: string | null;
  created_at: string;
  status: string;
};

type SignalRow = Omit<Signal, 'enrichment'> & { enrichment: string | null };

function parseSignal(row: SignalRow): Signal {
  let enrichment: SignalEnrichment = null;
  if (row.enrichment) {
    try {
      enrichment = JSON.parse(row.enrichment) as SignalEnrichment;
    } catch {
      enrichment = null;
    }
  }
  return { ...row, enrichment };
}

const SIGNAL_COLS =
  'id, title, url, company_name, country, signal_type, icp_score, entry_point, enrichment, published_at, created_at, status';

export async function getLatestWeekly(db: D1Database): Promise<WeeklyListItem & {
  curators_note_en: string | null;
  curators_note_cn: string | null;
} | null> {
  return db
    .prepare(
      'SELECT slug, title, curators_note_cn, curators_note_en, published_at FROM weekly_digests ORDER BY published_at DESC LIMIT 1',
    )
    .first();
}

export async function getWeeklyCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM weekly_digests').first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listWeeklies(db: D1Database, limit = 50): Promise<WeeklyListItem[]> {
  const { results } = await db
    .prepare('SELECT slug, title, published_at FROM weekly_digests ORDER BY published_at DESC LIMIT ?')
    .bind(limit)
    .all<WeeklyListItem>();
  return results ?? [];
}

export async function getWeeklyBySlug(db: D1Database, slug: string): Promise<WeeklyDigest | null> {
  return db.prepare('SELECT * FROM weekly_digests WHERE slug = ?').bind(slug).first<WeeklyDigest>();
}

/** Scored signals, excluding watch/ignore, newest first. */
export async function listScoredSignals(db: D1Database, limit = 500): Promise<Signal[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SIGNAL_COLS} FROM signals
       WHERE icp_score IS NOT NULL AND status NOT IN ('watch', 'ignore')
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<SignalRow>();
  return (results ?? []).map(parseSignal);
}

/** Signals created on a given SGT calendar date (YYYY-MM-DD), sorted by score. */
export async function listSignalsForDate(db: D1Database, date: string): Promise<Signal[]> {
  // created_at is stored as UTC ISO; convert the SGT day window to UTC bounds.
  const dayStartUtc = new Date(`${date}T00:00:00+08:00`).toISOString();
  const dayEndUtc = new Date(`${date}T23:59:59.999+08:00`).toISOString();
  const { results } = await db
    .prepare(
      `SELECT ${SIGNAL_COLS} FROM signals
       WHERE icp_score IS NOT NULL AND status NOT IN ('watch', 'ignore')
         AND created_at >= ? AND created_at <= ?
       ORDER BY icp_score DESC`,
    )
    .bind(dayStartUtc, dayEndUtc)
    .all<SignalRow>();
  return (results ?? []).map(parseSignal);
}

export async function getSignalById(db: D1Database, id: string): Promise<Signal | null> {
  const row = await db
    .prepare(`SELECT ${SIGNAL_COLS} FROM signals WHERE id = ?`)
    .bind(id)
    .first<SignalRow>();
  return row ? parseSignal(row) : null;
}
