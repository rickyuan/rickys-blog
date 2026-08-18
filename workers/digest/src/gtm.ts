/**
 * Daily GTM signal collection — runs 07:00 SGT (23:00 UTC previous day).
 * Replaces the old n8n workflow.
 *
 * 1. Fetch all enabled feeds (2-day window) and dedupe into feed_items.
 * 2. Take non-inspiration items fetched in the last ~25h.
 * 3. One Sonnet call extracts actionable GTM signals with ICP scoring
 *    and enrichment (industry / reasoning / entry angle / competitor).
 * 4. INSERT OR IGNORE into signals (dedupe on url).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './index';
import { fetchSourceItems } from './feeds';
import { notifyFailure } from './notify';
import {
  getEnabledSources,
  insertRawItems,
  getRecentItemsForGtm,
  insertSignals,
  openCronRun,
  closeCronRun,
  type CronStats,
  type GtmSourceItem,
  type ExtractedSignal,
} from './db';

const TWO_DAYS_MS = 2 * 86_400_000;
const LOOKBACK_HOURS = 25;
const MAX_ITEMS = 80;

const SYSTEM = `You are a GTM intelligence analyst for Ricky Yuan, Product Architect Director at Tencent Cloud TRTC (real-time audio/video) + Chat (IM) + TCCC (contact center), based in Singapore, leading SEA + India business growth.

His ICP: companies in SEA + India (plus global players expanding there) that need real-time voice/video, in-app chat, contact center, or AI voice agent infrastructure — and situations where Tencent RTC can displace Agora, Twilio, Sendbird, LiveKit, Daily, ZEGOCLOUD, Vonage, or similar vendors.`;

const VALID_TYPES = new Set([
  'competitor_blog',
  'product_launch',
  'funding_round',
  'hiring_signal',
  'regulation_update',
  'partnership',
  'expansion',
  'other',
]);

async function extractSignals(
  client: Anthropic,
  items: GtmSourceItem[],
): Promise<ExtractedSignal[]> {
  if (items.length === 0) return [];

  const itemsBlock = items
    .map(
      (it, idx) =>
        `[${idx}] Source: ${it.source_label ?? 'unknown'} (${it.source_section ?? '?'})\nURL: ${it.url}\nTitle: ${it.title}\nExcerpt: ${(it.raw_excerpt ?? '').slice(0, 400)}`,
    )
    .join('\n\n---\n\n');

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM,
    tools: [
      {
        name: 'emit_signals',
        description: 'Emit the extracted GTM signals. Emit an empty array if nothing qualifies.',
        input_schema: {
          type: 'object',
          properties: {
            signals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  url: { type: ['string', 'null'] },
                  company_name: { type: ['string', 'null'] },
                  country: { type: ['string', 'null'], description: 'ISO-ish country/region label, e.g. Singapore, India, Indonesia, Global' },
                  signal_type: {
                    type: 'string',
                    enum: [...VALID_TYPES],
                  },
                  icp_score: { type: 'number', description: '0-100 fit vs the ICP' },
                  entry_point: { type: ['string', 'null'], description: 'One concrete first move for a seller' },
                  industry: { type: ['string', 'null'] },
                  reasoning: { type: ['string', 'null'], description: '1-2 sentences: why this matters for Tencent RTC GTM' },
                  entry_angle: { type: ['string', 'null'] },
                  competitor_displaced: { type: ['string', 'null'] },
                  published_at: { type: ['string', 'null'], description: 'ISO date if known from the item, else null' },
                },
                required: ['title', 'signal_type', 'icp_score'],
              },
            },
          },
          required: ['signals'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_signals' },
    messages: [
      {
        role: 'user',
        content: `${items.length} news items from the last 24h:

${itemsBlock}

Extract ONLY actionable GTM signals: competitor moves, funding rounds of ICP-fit companies, partnerships, market expansions, regulation changes, product launches that open a selling opportunity. Skip tutorials, generic thought pieces, and anything with no sales relevance. Typically 0-15 signals per day. Score honestly — most days have few 80+ signals.

Use the emit_signals tool.`,
      },
    ],
  });

  const toolUse = resp.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(`Sonnet did not return tool_use. stop_reason=${resp.stop_reason}`);
  }

  const raw = (toolUse.input as { signals?: unknown[] }).signals ?? [];
  return raw
    .map((s): ExtractedSignal | null => {
      const o = (s ?? {}) as Record<string, unknown>;
      if (typeof o.title !== 'string' || typeof o.icp_score !== 'number') return null;
      return {
        title: o.title.slice(0, 500),
        url: typeof o.url === 'string' ? o.url : null,
        company_name: typeof o.company_name === 'string' ? o.company_name : null,
        country: typeof o.country === 'string' ? o.country : null,
        signal_type:
          typeof o.signal_type === 'string' && VALID_TYPES.has(o.signal_type)
            ? o.signal_type
            : 'other',
        icp_score: o.icp_score,
        entry_point: typeof o.entry_point === 'string' ? o.entry_point : null,
        industry: typeof o.industry === 'string' ? o.industry : null,
        reasoning: typeof o.reasoning === 'string' ? o.reasoning : null,
        entry_angle: typeof o.entry_angle === 'string' ? o.entry_angle : null,
        competitor_displaced:
          typeof o.competitor_displaced === 'string' ? o.competitor_displaced : null,
        published_at: typeof o.published_at === 'string' ? o.published_at : null,
      };
    })
    .filter((s): s is ExtractedSignal => s !== null);
}

export async function runGtmCollect(env: Env): Promise<CronStats> {
  const db = env.DB;
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const cronRunId = await openCronRun(db, 'gtm_collect');

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
    const sources = await getEnabledSources(db);
    console.log(`fetching ${sources.length} sources (2d window)`);
    const allItems = (
      await Promise.all(sources.map((s) => fetchSourceItems(s, TWO_DAYS_MS)))
    ).flat();
    stats.items_fetched = allItems.length;
    const inserted = await insertRawItems(db, allItems);
    console.log(`${allItems.length} items fetched, ${inserted} new`);

    const recent = await getRecentItemsForGtm(db, LOOKBACK_HOURS, MAX_ITEMS);
    console.log(`${recent.length} items in GTM window`);

    const signals = await extractSignals(anthropic, recent);
    const written = await insertSignals(db, signals);
    stats.items_classified = written; // reuse the counter: signals written
    console.log(`${signals.length} signals extracted, ${written} new`);
  } catch (e: unknown) {
    stats.status = 'failed';
    stats.error_log = e instanceof Error ? (e.stack ?? e.message) : String(e);
    console.error('gtm collect fatal:', stats.error_log);
    await notifyFailure(env, 'gtm collect', stats.error_log);
  } finally {
    await closeCronRun(db, cronRunId, stats);
  }
  return stats;
}
