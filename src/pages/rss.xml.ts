import { getCollection } from 'astro:content';

export const prerender = true;

const SITE = 'https://rickys.space';

export async function GET() {
  const dossiers = (await getCollection('dossiers', ({ data }) => !data.draft))
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

  const sgLife = (await getCollection('sg-life', ({ data }) => !data.draft))
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

  const items = [
    ...dossiers.map((d) => ({
      title: d.data.title,
      link: `${SITE}/dossiers/${d.id}`,
      description: d.data.description,
      pubDate: d.data.pubDate.toUTCString(),
    })),
    ...sgLife.map((e) => ({
      title: e.data.title,
      link: `${SITE}/sg-life/${e.id}`,
      description: e.data.description,
      pubDate: e.data.pubDate.toUTCString(),
    })),
  ].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Ricky's Space</title>
    <link>${SITE}</link>
    <description>文化 · 生活 · 工作 — Ricky Yuan's writing</description>
    <language>zh-CN</language>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />
    ${items.map((item) => `
    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.link}</link>
      <guid>${item.link}</guid>
      <description><![CDATA[${item.description}]]></description>
      <pubDate>${item.pubDate}</pubDate>
    </item>`).join('')}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
