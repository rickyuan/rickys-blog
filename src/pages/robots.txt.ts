export const prerender = true;

export function GET() {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /weekly/',
    '',
    'Sitemap: https://rickys.space/sitemap.xml',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
