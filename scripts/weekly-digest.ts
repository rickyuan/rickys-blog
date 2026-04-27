/**
 * Ricky's Weekly Digest — main cron entry point.
 * Runs on Railway Cron Service every Sunday 08:00 SGT.
 *
 * Pipeline:
 *   Stage 0  fetch + dedupe + free pre-filter (keyword whitelist)
 *   Stage 1  Haiku 4.5 batch classification (5–10 calls)
 *   Stage 2  Sonnet 4.6 synthesis → 1 weekly_digests row
 *   Audit    cron_runs row written; Telegram alert on failure
 */

import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// Local dev: load .env if present, with FORCE OVERRIDE.
// (Node's --env-file and process.loadEnvFile do NOT override pre-existing env vars.
//  Some shells / harnesses set our keys to empty strings, which then win — so we override.)
// Railway injects env vars directly and there's no .env file, so this block is a no-op there.
if (existsSync('.env')) {
  try {
    const content = readFileSync('.env', 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (key && value) process.env[key] = value;
    }
  } catch (e) {
    console.warn('Could not load .env:', e instanceof Error ? e.message : String(e));
  }
}
import {
  getEnabledSources,
  fetchSourceItems,
  filterExistingUrls,
  type ParsedItem,
} from './lib/fetch-feeds.js';
import { passesPreFilter, keywordCount } from './lib/pre-filter.js';
import { classifyBatch, chunkBatches } from './lib/classify.js';
import { synthesizeWeekly, isoWeekSGT, type WeeklyCandidate } from './lib/synthesize.js';
import { notifyFailure } from './lib/notify.js';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  db: { schema: 'blog' },
  auth: { persistSession: false },
});

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const BATCH_SIZE = 12;
const TOP_CANDIDATES = 30;
const INSERT_CHUNK = 50;

type Status = 'success' | 'partial' | 'failed';

async function main(): Promise<void> {
  const startedAt = new Date();
  let cronRunId: string | null = null;

  // Audit row — open
  try {
    const { data, error } = await supabase
      .from('cron_runs')
      .insert({ started_at: startedAt.toISOString(), status: 'partial' })
      .select('id')
      .single();
    if (error) console.warn('cron_runs open insert failed:', error.message);
    else cronRunId = data.id;
  } catch (e: unknown) {
    console.warn('cron_runs open exception:', e instanceof Error ? e.message : String(e));
  }

  const stats = {
    items_fetched: 0,
    items_pre_filtered: 0,
    items_classified: 0,
    items_with_errors: 0,
    digest_slug: null as string | null,
    llm_cost_usd: 0,
    error_log: '' as string | null,
    status: 'success' as Status,
  };

  try {
    // ──────────────────────────────────────────────────────────
    // Stage 0 · Fetch + dedupe + pre-filter
    // ──────────────────────────────────────────────────────────
    console.log('🔌 Fetching enabled sources…');
    const sources = await getEnabledSources(supabase);
    console.log(`  ${sources.length} sources`);

    console.log('📥 Parallel RSS fetch (past 7d)…');
    const allItemsNested = await Promise.all(sources.map(fetchSourceItems));
    const allItems = allItemsNested.flat();
    stats.items_fetched = allItems.length;
    console.log(`  ${allItems.length} items`);

    console.log('🔍 Dedupe against feed_items…');
    const newItems = await filterExistingUrls(supabase, allItems);
    console.log(`  ${newItems.length} new`);

    console.log(`🪶 Pre-filter (${keywordCount()} keywords)…`);
    const passed: ParsedItem[] = [];
    const filteredOut: ParsedItem[] = [];
    for (const item of newItems) {
      const haystack = `${item.title}\n${item.raw_excerpt}`;
      if (passesPreFilter(haystack)) passed.push(item);
      else filteredOut.push(item);
    }
    stats.items_pre_filtered = filteredOut.length;
    console.log(`  ${passed.length} passed | ${filteredOut.length} filtered out`);

    // Persist filtered-out items for audit (so we can tune keywords.json)
    if (filteredOut.length > 0) {
      const rows = filteredOut.map((i) => ({
        source_id: i.source_id,
        url: i.url,
        title: i.title,
        raw_excerpt: i.raw_excerpt,
        filter_status: 'pre_filtered_out' as const,
      }));
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = rows.slice(i, i + INSERT_CHUNK);
        const { error } = await supabase.from('feed_items').insert(chunk);
        if (error && !error.message.includes('duplicate key')) {
          console.warn(`  insert pre_filtered_out chunk ${i}: ${error.message}`);
        }
      }
    }

    // ──────────────────────────────────────────────────────────
    // Stage 1 · Haiku batch classification
    // ──────────────────────────────────────────────────────────
    let classifiedCount = 0;
    let errorCount = 0;
    if (passed.length > 0) {
      const batches = chunkBatches(passed, BATCH_SIZE);
      console.log(`🧠 Stage 1 — Haiku 4.5 (${batches.length} batches × ≤${BATCH_SIZE})…`);
      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        console.log(`  Batch ${bi + 1}/${batches.length} (${batch.length} items)`);
        const classifications = await classifyBatch(anthropic, batch);

        const rows = batch.map((item, j) => ({
          source_id: item.source_id,
          url: item.url,
          title: item.title,
          raw_excerpt: item.raw_excerpt,
          ai_summary_en: classifications[j].ai_summary_en,
          ai_summary_cn: classifications[j].ai_summary_cn,
          ai_section: classifications[j].ai_section,
          ai_score: classifications[j].ai_score,
          filter_status: classifications[j].ai_summary_en ? ('classified' as const) : ('failed' as const),
        }));

        const { error } = await supabase.from('feed_items').insert(rows);
        if (error && !error.message.includes('duplicate key')) {
          console.warn(`  insert classified chunk failed: ${error.message}`);
          errorCount += batch.length;
        } else {
          classifiedCount += rows.filter((r) => r.filter_status === 'classified').length;
          errorCount += rows.filter((r) => r.filter_status === 'failed').length;
        }
      }
    }
    stats.items_classified = classifiedCount;
    stats.items_with_errors = errorCount;

    // ──────────────────────────────────────────────────────────
    // Stage 2 · Sonnet synthesis
    // ──────────────────────────────────────────────────────────
    console.log('📊 Querying weekly_candidates view…');
    const { data: candidates, error: candErr } = await supabase
      .from('weekly_candidates')
      .select(
        'id, url, title, ai_summary_en, ai_summary_cn, ai_section, ai_score, source_label, source_section, priority_score',
      )
      .limit(TOP_CANDIDATES);
    if (candErr) throw candErr;
    console.log(`  ${candidates?.length ?? 0} candidates`);

    const slug = isoWeekSGT();
    console.log(`✏️  Stage 2 — Sonnet 4.6 (${slug})…`);
    const synthesis = await synthesizeWeekly(
      anthropic,
      (candidates ?? []) as WeeklyCandidate[],
      slug,
    );

    if (!synthesis) {
      console.log('  ⚠️  No synthesis (no candidates)');
      stats.status = 'partial';
    } else {
      console.log('  Upserting weekly_digests…');
      const { error: insErr } = await supabase
        .from('weekly_digests')
        .upsert(
          {
            slug: synthesis.iso_week,
            title: synthesis.title,
            curators_note_en: synthesis.curators_note_en,
            curators_note_cn: synthesis.curators_note_cn,
            body_md: synthesis.body_md,
            deep_dive_url: synthesis.deep_dive_url ?? null,
            deep_dive_summary_en: synthesis.deep_dive_summary_en ?? null,
            deep_dive_summary_cn: synthesis.deep_dive_summary_cn ?? null,
            published_at: new Date().toISOString(),
          },
          { onConflict: 'slug' },
        );
      if (insErr) throw insErr;
      stats.digest_slug = synthesis.iso_week;

      // Mark items used (UUID-validated)
      const validIds = (synthesis.selected_item_ids ?? []).filter((id) =>
        /^[0-9a-f-]{36}$/i.test(String(id)),
      );
      if (validIds.length > 0) {
        console.log(`  Marking ${validIds.length} items as used…`);
        const { error: markErr } = await supabase
          .from('feed_items')
          .update({ used_in_weekly: synthesis.iso_week })
          .in('id', validIds);
        if (markErr) console.warn(`  mark used failed: ${markErr.message}`);
      }
    }

    if (errorCount > 0 && stats.status === 'success') stats.status = 'partial';
    console.log(`✅ Done — status: ${stats.status}`);
  } catch (e: unknown) {
    stats.status = 'failed';
    stats.error_log = e instanceof Error ? e.stack ?? e.message : String(e);
    console.error('💥 Fatal:', e);
    await notifyFailure(stats.error_log ?? 'unknown error');
  } finally {
    if (cronRunId) {
      await supabase
        .from('cron_runs')
        .update({
          finished_at: new Date().toISOString(),
          status: stats.status,
          items_fetched: stats.items_fetched,
          items_pre_filtered: stats.items_pre_filtered,
          items_classified: stats.items_classified,
          items_with_errors: stats.items_with_errors,
          digest_slug: stats.digest_slug,
          llm_cost_usd: stats.llm_cost_usd,
          error_log: stats.error_log || null,
        })
        .eq('id', cronRunId);
    }
    if (stats.status === 'failed') process.exit(1);
  }
}

main();
