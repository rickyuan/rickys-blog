import type Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are Ricky Yuan's weekly content editor. Voice: sharp, business-aware, no fluff. EN-first, CN second.`;

export type WeeklyCandidate = {
  id: string;
  url: string;
  title: string;
  ai_summary_en: string | null;
  ai_summary_cn: string | null;
  ai_section: string;
  ai_score: number;
  source_label: string;
  source_section: string;
  priority_score: number;
};

export type WeeklySynthesis = {
  iso_week: string;
  title: string;
  curators_note_en: string;
  curators_note_cn: string;
  selected_item_ids: string[];
  body_md: string;
  deep_dive_url: string | null;
  deep_dive_summary_en: string | null;
  deep_dive_summary_cn: string | null;
};

export function isoWeekSGT(date = new Date()): string {
  // Convert to SGT (UTC+8) for week-of-year calc
  const sgt = new Date(date.getTime() + (8 * 60 - date.getTimezoneOffset()) * 60000);
  const d = new Date(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export async function synthesizeWeekly(
  client: Anthropic,
  candidates: WeeklyCandidate[],
  isoWeek: string,
): Promise<WeeklySynthesis | null> {
  if (candidates.length === 0) return null;

  const dateFrom = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const dateTo = new Date().toISOString().slice(0, 10);

  const userMsg = `Week: ${isoWeek}
Date range: ${dateFrom} to ${dateTo}
Candidates (top ${candidates.length}, JSON array):

${JSON.stringify(candidates, null, 2)}

Select EXACTLY 8 items distributed: 3 competitive + 2 ai_voice + 2 sea_market + 1 gtm. If a section has fewer strong items, borrow from competitive or sea_market. Then pick 1 deep_dive (any section, may overlap, may be null).

For body_md: 4 H2 sections (Competitive Pulse / AI Voice & Agent / SEA + India Signals / GTM & Partnership Plays). Each item formatted as:
▸ **[Title](URL)** — *Source*
EN one-liner.
中文一句。

Use the emit_weekly_digest tool to return the result.`;

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM,
    tools: [
      {
        name: 'emit_weekly_digest',
        description: 'Emit the synthesized weekly digest.',
        input_schema: {
          type: 'object',
          properties: {
            iso_week: { type: 'string' },
            title: { type: 'string' },
            curators_note_en: { type: 'string' },
            curators_note_cn: { type: 'string' },
            selected_item_ids: { type: 'array', items: { type: 'string' } },
            body_md: { type: 'string' },
            deep_dive_url: { type: ['string', 'null'] },
            deep_dive_summary_en: { type: ['string', 'null'] },
            deep_dive_summary_cn: { type: ['string', 'null'] },
          },
          required: [
            'iso_week',
            'title',
            'curators_note_en',
            'curators_note_cn',
            'selected_item_ids',
            'body_md',
          ],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_weekly_digest' },
    messages: [{ role: 'user', content: userMsg }],
  });

  const toolUse = resp.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(`Sonnet did not return tool_use. stop_reason=${resp.stop_reason}`);
  }
  return toolUse.input as WeeklySynthesis;
}
