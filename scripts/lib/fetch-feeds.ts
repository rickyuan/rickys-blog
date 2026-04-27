import Parser from 'rss-parser';

// Permissive client type — we use a custom `blog` schema, not default "public",
// and supabase-js's generic type chain rejects cross-schema clients without
// generated DB types. Keeping this as `any` is intentional for this script.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbClient = any;

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'rickys-blog-weekly-digest/1.0 (+https://rickys-blog.pages.dev)' },
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS_PER_SOURCE = 5;

export type FeedSource = {
  id: string;
  url: string;
  label: string;
  section: string;
  weight: number;
};

export type ParsedItem = {
  source_id: string;
  source_label: string;
  source_section: string;
  url: string;
  title: string;
  raw_excerpt: string;
};

export async function getEnabledSources(supabase: DbClient): Promise<FeedSource[]> {
  const { data, error } = await supabase
    .from('feed_sources')
    .select('id, url, label, section, weight')
    .eq('enabled', true);
  if (error) throw error;
  return (data ?? []) as FeedSource[];
}

export async function fetchSourceItems(source: FeedSource): Promise<ParsedItem[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const cutoff = Date.now() - SEVEN_DAYS_MS;

    return (feed.items ?? [])
      .filter((item) => {
        const dateStr = item.isoDate ?? item.pubDate;
        if (!dateStr) return true;
        const ts = new Date(dateStr).getTime();
        return !Number.isNaN(ts) && ts > cutoff;
      })
      .slice(0, MAX_ITEMS_PER_SOURCE)
      .map((item) => ({
        source_id: source.id,
        source_label: source.label,
        source_section: source.section,
        url: (item.link ?? '').trim(),
        title: (item.title ?? '(untitled)').trim().slice(0, 500),
        raw_excerpt: ((item.contentSnippet ?? item.content ?? (item as { summary?: string }).summary ?? '')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim())
          .slice(0, 1000),
      }))
      .filter((i) => i.url.length > 0);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  ⚠️  ${source.label}: ${msg.slice(0, 100)}`);
    return [];
  }
}

export async function filterExistingUrls(
  supabase: DbClient,
  items: ParsedItem[],
): Promise<ParsedItem[]> {
  if (items.length === 0) return [];

  const existing = new Set<string>();
  const chunkSize = 100;
  const urls = items.map((i) => i.url);

  for (let i = 0; i < urls.length; i += chunkSize) {
    const chunk = urls.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('feed_items')
      .select('url')
      .in('url', chunk);
    if (error) throw error;
    for (const row of data ?? []) existing.add(row.url as string);
  }

  return items.filter((i) => !existing.has(i.url));
}
