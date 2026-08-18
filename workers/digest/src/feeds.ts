/**
 * RSS/Atom fetching + parsing for the Workers runtime.
 * Replaces rss-parser (Node-only) with fast-xml-parser.
 */
import { XMLParser } from 'fast-xml-parser';

const MAX_ITEMS_PER_SOURCE = 5;
const FETCH_TIMEOUT_MS = 15_000;

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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

/** fast-xml-parser values can be string | number | {'#text': ...}. */
function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const t = (v as Record<string, unknown>)['#text'];
    if (t != null) return text(t);
  }
  return '';
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

type RawEntry = Record<string, unknown>;

function entryLink(e: RawEntry): string {
  // RSS 2.0: <link>url</link>. Atom: <link href="..." rel="alternate"/>.
  const link = e.link;
  if (typeof link === 'string') return link.trim();
  const links = asArray(link as RawEntry | RawEntry[]);
  const alternate =
    links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
  if (alternate) return text(alternate['@_href'] ?? alternate).trim();
  return text(e.guid).trim();
}

function entryDate(e: RawEntry): number | null {
  const raw =
    text(e.pubDate) || text(e.published) || text(e.updated) || text(e['dc:date']);
  if (!raw) return null;
  const ts = new Date(raw).getTime();
  return Number.isNaN(ts) ? null : ts;
}

function entryExcerpt(e: RawEntry): string {
  const raw =
    text(e.description) ||
    text(e['content:encoded']) ||
    text(e.summary) ||
    text(e.content);
  return stripHtml(raw).slice(0, 1000);
}

export async function fetchSourceItems(
  source: FeedSource,
  windowMs: number,
): Promise<ParsedItem[]> {
  try {
    const resp = await fetch(source.url, {
      headers: {
        'User-Agent': 'rickys-blog-digest/2.0 (+https://rickys-blog.pages.dev)',
        Accept:
          'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    const doc = parser.parse(xml) as RawEntry;

    const rssChannel = (doc.rss as RawEntry | undefined)?.channel as RawEntry | undefined;
    const atomFeed = doc.feed as RawEntry | undefined;
    const entries = rssChannel
      ? asArray(rssChannel.item as RawEntry | RawEntry[])
      : asArray(atomFeed?.entry as RawEntry | RawEntry[]);

    const cutoff = Date.now() - windowMs;

    return entries
      .filter((e) => {
        const ts = entryDate(e);
        return ts === null || ts > cutoff;
      })
      .slice(0, MAX_ITEMS_PER_SOURCE)
      .map((e) => ({
        source_id: source.id,
        source_label: source.label,
        source_section: source.section,
        url: entryLink(e),
        title: stripHtml(text(e.title)).slice(0, 500) || '(untitled)',
        raw_excerpt: entryExcerpt(e),
      }))
      .filter((i) => i.url.startsWith('http'));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`feed ${source.label}: ${msg.slice(0, 100)}`);
    return [];
  }
}
