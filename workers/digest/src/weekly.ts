/**
 * Weekly digest pipeline — runs every Sunday 08:00 SGT (00:00 UTC).
 *
 * Stage 0  fetch + dedupe into feed_items + keyword pre-filter
 * Stage 1  Haiku batch classification (rows updated in place)
 * Stage 2  Sonnet synthesis → weekly_digests upsert
 * Audit    cron_runs row; optional Telegram alert on failure
 *
 * Unlike the old Railway script, classification operates on DB rows
 * (filter_status IS NULL), so items ingested by the daily GTM collector
 * still get classified here.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './index';
import { fetchSourceItems } from './feeds';
import { passesPreFilter, keywordCount } from './prefilter';
import { classifyBatch, chunkBatches } from './classify';
import { synthesizeWeekly, isoWeekSGT } from './synthesize';
import { notifyFailure } from './notify';
import {
  getEnabledSources,
  insertRawItems,
  getUnprocessedItems,
  markPreFilteredOut,
  updateClassification,
  getWeeklyCandidates,
  upsertWeeklyDigest,
  markItemsUsed,
  openCronRun,
  closeCronRun,
  type CronStats,
} from './db';

const BATCH_SIZE = 12;
const TOP_CANDIDATES = 30;
const SEVEN_DAYS_MS = 7 * 86_400_000;

export async function runWeeklyDigest(env: Env): Promise<CronStats> {
  const db = env.DB;
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const cronRunId = await openCronRun(db, 'weekly_digest');

  const stats: CronStats = {
    status: 'success',
    items_fetched: 0,
    items_pre_filtered: 0,
    items_classified: 0,
    items_with_errors: 0,
    digest_slug: null,
    error_log: null,
  };

  try {
    // Stage 0 · fetch + dedupe + pre-filter
    const sources = await getEnabledSources(db);
    console.log(`fetching ${sources.length} sources (7d window)`);
    const allItems = (
      await Promise.all(sources.map((s) => fetchSourceItems(s, SEVEN_DAYS_MS)))
    ).flat();
    stats.items_fetched = allItems.length;

    const inserted = await insertRawItems(db, allItems);
    console.log(`${allItems.length} items fetched, ${inserted} new`);

    const pending = await getUnprocessedItems(db, 14);
    console.log(`pre-filter (${keywordCount()} keywords) over ${pending.length} pending items`);

    const passed = pending.filter((i) => passesPreFilter(`${i.title}\n${i.raw_excerpt ?? ''}`));
    const failedIds = pending
      .filter((i) => !passesPreFilter(`${i.title}\n${i.raw_excerpt ?? ''}`))
      .map((i) => i.id);
    stats.items_pre_filtered = failedIds.length;
    await markPreFilteredOut(db, failedIds);
    console.log(`${passed.length} passed | ${failedIds.length} filtered out`);

    // Stage 1 · Haiku classification
    for (const batch of chunkBatches(passed, BATCH_SIZE)) {
      const classifications = await classifyBatch(anthropic, batch);
      await updateClassification(
        db,
        batch.map((item, j) => ({ id: item.id, c: classifications[j] })),
      );
      stats.items_classified += classifications.filter((c) => c.ai_summary_en).length;
      stats.items_with_errors += classifications.filter((c) => !c.ai_summary_en).length;
    }

    // Stage 2 · Sonnet synthesis
    const candidates = await getWeeklyCandidates(db, TOP_CANDIDATES);
    console.log(`${candidates.length} weekly candidates`);

    const slug = isoWeekSGT();
    const synthesis = await synthesizeWeekly(anthropic, candidates, slug);

    if (!synthesis) {
      console.log('no synthesis (no candidates)');
      stats.status = 'partial';
    } else {
      await upsertWeeklyDigest(db, synthesis);
      stats.digest_slug = synthesis.iso_week;
      await markItemsUsed(db, synthesis.selected_item_ids ?? [], synthesis.iso_week);
      console.log(`weekly ${synthesis.iso_week} published`);
    }

    if (stats.items_with_errors > 0 && stats.status === 'success') stats.status = 'partial';
  } catch (e: unknown) {
    stats.status = 'failed';
    stats.error_log = e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.error('weekly digest fatal:', stats.error_log);
    await notifyFailure(env, 'weekly digest', stats.error_log);
  } finally {
    await closeCronRun(db, cronRunId, stats);
  }
  return stats;
}
