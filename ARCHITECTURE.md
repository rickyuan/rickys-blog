# rickys-blog — Architecture

> **v3 (2026-08-18): Cloudflare-only.** Supabase, Railway, and n8n are gone.
> Everything runs on Cloudflare: Workers (site + cron), D1 (data), KV (sessions).
> The only external API is Anthropic (content generation itself).

## Live URLs

- **Site**: https://rickys-blog.rickyyuansg.workers.dev (Worker: `rickys-blog`)
- **Digest worker**: https://rickys-blog-digest.rickyyuansg.workers.dev (Worker: `rickys-blog-digest`; the HTTP endpoints are token-guarded manual triggers only)
- The old Cloudflare Pages project (`rickys-blog.pages.dev`) is retired and can be deleted in the dashboard.

## Components

```
┌───────────────────────────── Cloudflare ─────────────────────────────┐
│                                                                      │
│  Worker: rickys-blog (Astro 6 SSR + static assets)                   │
│    /            homepage (latest weekly + dossiers + sg-life)        │
│    /weekly      AI weekly digest archive + issues        ─┐          │
│    /gtm         GTM intelligence feed + signal details    ├─ D1      │
│    /dossiers    MDX content collections (static)          │          │
│    /sg-life     MDX content collections (static)         ─┘          │
│                                                                      │
│  Worker: rickys-blog-digest (cron)                                   │
│    0 0 * * SUN  (08:00 SGT Sunday)  → weekly digest pipeline         │
│    0 23 * * *   (07:00 SGT daily)   → GTM signal collection          │
│                        │                                             │
│                        ▼                                             │
│  D1: rickys-blog-db  (feed_sources / feed_items / weekly_digests /   │
│                       signals / cron_runs)                           │
│  KV: SESSION  (Astro sessions store, auto-wired by the adapter)      │
└──────────────────────────────────────────────────────────────────────┘
                         │
                         ▼ (API calls from the digest worker only)
              Anthropic API (Haiku 4.5 classify · Sonnet 4.6 synthesize/extract)
              Telegram (optional failure alerts)
```

## Site (Astro 6)

- `@astrojs/cloudflare` v13, `output: 'server'`; deployed as a **Worker with
  static assets** — `astro build` emits `dist/server/wrangler.json` (merging
  the root `wrangler.toml` bindings), then `wrangler deploy -c` that file.
- D1 access in pages: `import { env } from 'cloudflare:workers'` → helpers in
  [src/lib/db.ts](src/lib/db.ts). Binding types: [src/env.d.ts](src/env.d.ts) +
  [src/lib/d1-types.ts](src/lib/d1-types.ts) (minimal structural D1 typing, no
  global @cloudflare/workers-types).
- `astro dev` emulates D1/KV locally from the root `wrangler.toml`
  (local data lives in `.wrangler/`).

## Digest worker (workers/digest)

One worker, two cron jobs, sharing the feed pipeline:

**Weekly digest** (Sunday 08:00 SGT)
1. Fetch all enabled `feed_sources` (7-day window), `INSERT OR IGNORE` into
   `feed_items` (URL dedupe).
2. Keyword pre-filter ([workers/digest/src/keywords.json](workers/digest/src/keywords.json))
   over rows with `filter_status IS NULL` — works on DB rows so items ingested
   by the daily job still get classified.
3. Haiku 4.5 batch classification (12/batch) → EN/CN summaries, section, score.
4. Candidates = classified, unused, ≤14 days old; priority = score × source
   weight × exp(−days/7) computed in JS.
5. Sonnet 4.6 synthesis (forced tool call) → upsert `weekly_digests`, mark
   items used.
6. `cron_runs` audit row; optional Telegram alert on failure.

**GTM collection** (daily 07:00 SGT) — replaces the old n8n workflow
1. Same fetch+dedupe (2-day window).
2. Non-inspiration items from the last 25h (≤80) → one Sonnet call with a
   forced `emit_signals` tool: ICP-scored signals with enrichment
   (industry / reasoning / entry angle / competitor displaced).
3. `INSERT OR IGNORE` into `signals` (URL dedupe), status `new`.

**Manual triggers** (testing/backfill): `GET /run/weekly?token=…` and
`GET /run/gtm?token=…` on the digest worker, guarded by the `RUN_TOKEN` secret
(value in local `.env`).

## Data (D1: rickys-blog-db)

Schema in [migrations/0001_init.sql](migrations/0001_init.sql) — apply with
`npm run db:migrate` (local) / `npm run db:migrate:remote`. Tables:

- `feed_sources` — 36 seeded RSS sources across competitive / ai_voice /
  sea_market / gtm / inspiration, weighted.
- `feed_items` — fetched articles + AI classification (`filter_status`:
  NULL → `pre_filtered_out` | `classified` | `failed`; `used_in_weekly` slug).
- `weekly_digests` — one row per ISO week (slug `YYYY-Www`).
- `signals` — GTM signals; `enrichment` is a JSON string column.
- `cron_runs` — audit log for both jobs.

Timestamps are ISO-8601 UTC strings. IDs are `crypto.randomUUID()` (seeds use
readable slugs). Supabase-era data was lost when the free project was
reclaimed; D1 started fresh on 2026-08-18.

## Secrets & config

- Site worker: no secrets (D1 + KV bindings only).
- Digest worker (`wrangler secret put <NAME> -c workers/digest/wrangler.jsonc`):
  `ANTHROPIC_API_KEY` (required), `RUN_TOKEN` (manual triggers),
  `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (optional alerts).

## Commands

```
npm run dev                # local dev with emulated D1/KV
npm run check              # astro check + worker tsc
npm run deploy             # build + deploy site worker
npm run deploy:worker      # deploy digest cron worker
npm run db:migrate[:remote]
```

## Deploy (GitHub Actions)

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs on every push
to `main` (and manually via *Actions → Deploy → Run workflow*):

1. `npm run check` (astro check + worker tsc) and `astro build`
2. `npm run db:migrate:remote` — applies any new `migrations/*.sql` to D1
3. `wrangler deploy -c dist/server/wrangler.json` — site worker
4. `npm run deploy:worker` — digest cron worker (with whatever `crons` its
   config carries; currently none)

Pull requests run step 1 only. The workflow needs two repository secrets
(GitHub → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token created from the **Edit Cloudflare Workers** template, plus **D1 → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard → Workers & Pages → Account ID (or `npx wrangler whoami`) |

Deploying from a laptop (`npm run deploy` / `npm run deploy:worker`) still
works and is the fallback if CI is red.

## History

- **v1** (2026-04): static HTML on Cloudflare Pages.
- **v2** (2026-04): Astro 6 + Supabase (Postgres) + Railway cron + n8n signals.
  Died in 2026-08 when the idle Supabase free project was reclaimed (DNS gone).
- **v3** (2026-08): this document.
