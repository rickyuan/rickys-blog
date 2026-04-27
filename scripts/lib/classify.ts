import type Anthropic from '@anthropic-ai/sdk';
import type { ParsedItem } from './fetch-feeds.js';

const SYSTEM = `You are an editorial assistant for Ricky Yuan, Product Architect Director at Tencent Cloud TRTC + Chat + TCCC, Singapore, leading SEA + India business growth. He cares about RTC/WebRTC, Chat/IM, CCaaS, AI Voice & Agent, SEA + India market signals, enterprise SaaS GTM.

Output STRICTLY a valid JSON array. No prose, no markdown fences. Each element corresponds to one input item, in the same order.`;

export type Classification = {
  ai_summary_en: string | null;
  ai_summary_cn: string | null;
  ai_section: string;
  ai_score: number;
};

const VALID_SECTIONS = ['competitive', 'ai_voice', 'sea_market', 'gtm', 'inspiration'] as const;

export async function classifyBatch(
  client: Anthropic,
  items: ParsedItem[],
): Promise<Classification[]> {
  if (items.length === 0) return [];

  const itemsBlock = items
    .map(
      (item, idx) =>
        `[${idx}] Source: ${item.source_label} | Section hint: ${item.source_section}\nURL: ${item.url}\nTitle: ${item.title}\nExcerpt: ${item.raw_excerpt.slice(0, 500)}`,
    )
    .join('\n\n---\n\n');

  const userMsg = `${items.length} items to classify:

${itemsBlock}

Return a JSON array with EXACTLY ${items.length} elements, in the same order:
[
  {"summary_en": "1-2 EN sentences", "summary_cn": "1-2 句中文", "section": "competitive|ai_voice|sea_market|gtm|inspiration", "score": 0-100},
  ...
]

Scoring: 90+ direct competitor moves / major SEA-India signals; 70-89 notable AI Voice or enterprise deals; 50-69 general industry; <50 tangential.

Return ONLY the JSON array.`;

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    });

    const text = resp.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('');

    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected JSON array, got ${typeof parsed}`);
    }

    return items.map((_, idx) => normaliseClassification(parsed[idx]));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  ⚠️  Haiku batch failed: ${msg.slice(0, 200)}`);
    return items.map(() => ({
      ai_summary_en: null,
      ai_summary_cn: null,
      ai_section: 'inspiration',
      ai_score: 0,
    }));
  }
}

function normaliseClassification(p: unknown): Classification {
  const obj = (p ?? {}) as {
    summary_en?: unknown;
    summary_cn?: unknown;
    section?: unknown;
    score?: unknown;
  };
  const section =
    typeof obj.section === 'string' && (VALID_SECTIONS as readonly string[]).includes(obj.section)
      ? (obj.section as string)
      : 'inspiration';
  return {
    ai_summary_en: typeof obj.summary_en === 'string' ? obj.summary_en : null,
    ai_summary_cn: typeof obj.summary_cn === 'string' ? obj.summary_cn : null,
    ai_section: section,
    ai_score: typeof obj.score === 'number' ? Math.max(0, Math.min(100, Math.round(obj.score))) : 0,
  };
}

export function chunkBatches<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
