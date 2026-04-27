# Ricky's Space — Architecture

> Personal site + AI-curated weekly intelligence platform for Ricky Yuan
> (Product Architect Director, Tencent Cloud TRTC + Chat + TCCC, Singapore, SEA + India lead).

---

## 1. What this site is

Three layers of content:

| Layer | URL | Type | Cadence | Voice |
|---|---|---|---|---|
| **Weekly intel** | `/weekly/<iso-week>` | AI-curated 4-section digest (Competitive Pulse / AI Voice / SEA + India / GTM) | Sunday 08:00 SGT auto | EN-first / CN second |
| **Dossiers** | `/dossiers/<category>/<slug>` | Long-form thought leadership | Ad-hoc, 1–2 / month | EN-first / CN bilingual |
| **SG-Life** | `/sg-life/...` | Singapore life notes | Ad-hoc | CN |

Plus homepage (`/`) as the front door, surfacing latest weekly + dossier.

**Out of scope (Phase 2)**: email subscription, paywall, user login, comments.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend / SSG+SSR | **Astro 6** + MDX | Static-first, fast, SSR for dynamic pages |
| Hosting (site) | **Cloudflare Pages** + Pages Functions | Best edge coverage in Asia; free tier covers traffic |
| Hosting (cron) | **Railway** (existing paid plan) | Native cron, single dashboard, no GH hibernation risk |
| Data | **Supabase (Postgres)** — `blog` schema only | Existing project (`ricky-gtm`); isolated by schema |
| Markdown render | `marked` | Simple, edge-compatible |
| Weekly automation | **Railway Cron Service** + TypeScript script | Replaces n8n; one TS file, native scheduling |
| LLM (classify) | **Anthropic Claude Haiku 4.5** (batched) | Cheap, fast, sufficient for tagging |
| LLM (synthesize) | **Anthropic Claude Sonnet 4.6** | Quality matters for the final digest |
| Local dev | `npm run dev` (Astro) + `npx tsx scripts/weekly-digest.ts` (cron) | One command each |

**Platform split rationale**: keep Astro on Cloudflare Pages (Asia-edge CDN, free, optimal for readers), put the cron on Railway (already paid, native cron, no hibernation, unified env vars with future admin tooling). Don't co-locate.

---

## 3. Repo layout

```
rickys-blog/
├── src/
│   ├── content/
│   │   ├── dossiers/                 # Markdown long-form (future)
│   │   └── sg-life/                  # Markdown SG life notes (future)
│   ├── content.config.ts             # Astro Content Collections schema
│   ├── layouts/
│   │   ├── BaseLayout.astro          # Cyberpunk dark — homepage / list
│   │   ├── EditorialLayout.astro     # Editorial magazine — dossier
│   │   └── TelexLayout.astro         # Light simplified — weekly
│   ├── lib/
│   │   ├── supabase.ts               # Supabase JS client, scoped to `blog` schema
│   │   └── anthropic.ts              # Anthropic SDK client + helpers
│   ├── pages/
│   │   ├── index.astro               # Homepage (SSR) — Weekly callout + post list
│   │   ├── weekly/
│   │   │   ├── index.astro           # Archive (SSR)
│   │   │   └── [slug].astro          # Issue detail (SSR, noindex)
│   │   ├── dossiers/culture/
│   │   │   └── 90s-pop-culture.astro # Migrated long-form
│   │   ├── sg-life/                  # (placeholder)
│   │   └── weekly/                   # (above)
│   └── styles/
│       ├── cyberpunk.css             # Theme 1: homepage
│       ├── editorial.css             # Theme 2: dossier
│       └── telex.css                 # Theme 3: weekly
├── scripts/
│   ├── weekly-digest.ts              # Cron job entry point (~250 lines)
│   ├── lib/
│   │   ├── fetch-feeds.ts            # RSS fetching + dedup
│   │   ├── pre-filter.ts             # Keyword whitelist (free tier)
│   │   ├── classify.ts               # Batch Haiku classification
│   │   ├── synthesize.ts             # Sonnet final digest
│   │   └── notify.ts                 # Failure webhook (Telegram)
│   └── keywords.json                 # Pre-filter whitelist
├── supabase/
│   └── migrations/
│       ├── 0001_init.sql             # Schema + seed feed_sources
│       ├── 0002_weekly_candidates_view.sql
│       ├── 0003_cron_runs_table.sql
│       └── 0004_candidates_time_decay.sql
├── astro.config.mjs                  # CF adapter
├── wrangler.jsonc                    # CF Pages config
├── railway.toml                      # Railway service config
├── package.json
└── ARCHITECTURE.md                   # This file
```

**Removed from earlier iterations**: `n8n/` directory, `.github/workflows/weekly-digest.yml`.

---

## 4. Data model (Supabase, `blog` schema)

### Tables

```
blog.feed_sources            # Where to scrape
  id          uuid PK
  kind        text (rss|api|newsletter|github_releases)
  url         text
  label       text             # 'Twilio Blog'
  section     text             # competitive | ai_voice | sea_market | gtm | inspiration
  weight      int              # 3=competitive, 2=ai_voice/sea_market, 1=gtm/inspiration
  enabled     boolean

blog.feed_items              # Each item AI-summarized
  id              uuid PK
  source_id       uuid FK → feed_sources
  url             text UNIQUE   # natural dedup key
  title           text
  raw_excerpt     text
  ai_summary_en   text
  ai_summary_cn   text
  ai_section      text          # AI's classification
  ai_score        int (0-100)   # AI's priority score
  fetched_at      timestamptz
  used_in_weekly  text          # → weekly_digests.slug, NULL if unused
  filter_status   text          # pre_filtered_out | classified | failed

blog.weekly_digests          # One row = one published issue
  slug                    text PK    # '2026-W17'
  title                   text
  curators_note_en        text
  curators_note_cn        text
  body_md                 text       # Full Markdown, 4 sections
  deep_dive_url           text
  deep_dive_summary_en    text
  deep_dive_summary_cn    text
  published_at            timestamptz

blog.cron_runs               # Audit log for every cron execution
  id                 uuid PK
  started_at         timestamptz
  finished_at        timestamptz
  status             text       -- success | partial | failed
  items_fetched      int
  items_pre_filtered int
  items_classified   int
  items_with_errors  int
  digest_slug        text
  llm_cost_usd       numeric(6,4)
  error_log          text
```

### Views

```
blog.weekly_candidates       # Items eligible for next digest, with time-decayed score
  -- 14-day window with exponential decay (half-life ~7 days)
  -- priority_score = ai_score × source_weight × exp(-days_since_fetched / 7.0)
  -- Carries over high-value items not yet used; new items naturally weighted higher
```

### Migration: time-decay view (`0004_candidates_time_decay.sql`)

```sql
CREATE OR REPLACE VIEW blog.weekly_candidates AS
SELECT
  fi.id,
  fi.url,
  fi.title,
  fi.ai_summary_en,
  fi.ai_summary_cn,
  fi.ai_section,
  fi.ai_score,
  fs.label AS source_label,
  fs.weight AS source_weight,
  fi.fetched_at,
  EXTRACT(EPOCH FROM (NOW() - fi.fetched_at)) / 86400.0 AS days_since_fetched,
  ROUND(
    fi.ai_score
    * fs.weight
    * EXP(-EXTRACT(EPOCH FROM (NOW() - fi.fetched_at)) / 86400.0 / 7.0)
  ) AS priority_score
FROM blog.feed_items fi
JOIN blog.feed_sources fs ON fs.id = fi.source_id
WHERE fi.used_in_weekly IS NULL
  AND fi.filter_status = 'classified'
  AND fi.fetched_at > NOW() - INTERVAL '14 days'
ORDER BY priority_score DESC;
```

### RLS policy

- `anon` can `SELECT` `weekly_digests` only (public site reads).
- `feed_sources` / `feed_items` / `cron_runs` invisible to anon (no GRANT).
- Cron script uses `service_role` key → bypasses RLS.
- **Phase 2**: migrate cron to dedicated `blog_cron` user with minimum grants (see §11).

---

## 5. AI pipeline (the whole loop)

```
                   ┌─────────────────────────────────────┐
                   │   Railway Cron Service              │
                   │   Cron Schedule: 0 0 * * 0          │
                   │   (= 08:00 SGT, gives 1hr buffer)   │
                   └──────────────────┬──────────────────┘
                                      │ runs scripts/weekly-digest.ts
                                      ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ scripts/weekly-digest.ts (Node 22, TypeScript)                   │
   │                                                                  │
   │  STAGE 0 — Free pre-filter                                       │
   │  1. SELECT enabled feed_sources         ← Supabase               │
   │  2. PARALLEL fetch ~36 RSS via fetch() + rss-parser              │
   │  3. Filter past 7 days                                           │
   │  4. SELECT existing url FROM feed_items, dedupe                  │
   │  5. Apply keyword whitelist regex (keywords.json)                │
   │     → Drops ~40-60% obvious noise, FREE                          │
   │     Items that fail filter stored with filter_status =           │
   │     'pre_filtered_out' for audit                                 │
   │                                                                  │
   │  STAGE 1 — Haiku batch classification                            │
   │  6. Chunk surviving items in batches of 10-15                    │
   │  7. ONE Anthropic.messages.create(model: haiku-4-5) per batch    │
   │     → JSON array [{summary_en, summary_cn, section, score}, ...] │
   │  8. INSERT INTO feed_items (auto-handles dupes via UNIQUE)       │
   │     ~5-10 LLM calls/week instead of 150-300                      │
   │                                                                  │
   │  STAGE 2 — Sonnet synthesis                                      │
   │  9. SELECT * FROM blog.weekly_candidates LIMIT 30                │
   │     (already time-decayed and weighted)                          │
   │ 10. Anthropic.messages.create(model: sonnet-4-6)                 │
   │     → JSON {title, curators_note_en/cn, body_md, deep_dive_*}    │
   │ 11. UPSERT INTO weekly_digests (slug = ISO week)                 │
   │ 12. UPDATE feed_items SET used_in_weekly                         │
   │ 13. INSERT INTO cron_runs (audit row)                            │
   │ 14. On any uncaught error → notify.ts pings Telegram             │
   └─────────────────────────────┬────────────────────────────────────┘
                                 │ writes
                                 ▼
                       ┌───────────────────┐
                       │   Supabase blog.* │
                       │   tables          │
                       └─────────┬─────────┘
                                 │ reads (anon key, only weekly_digests)
                                 ▼
                  ┌───────────────────────────────┐
                  │  Astro on Cloudflare Pages    │
                  │  SSR: /weekly/[slug]          │
                  │  SSR: /weekly                 │
                  │  SSR: / (homepage callout)    │
                  └───────────────────────────────┘
                                 │
                                 ▼
                            Ricky in browser
```

### Cost per week (post-optimization)

| Item | Calls | Est. cost |
|---|---|---|
| Stage 0 pre-filter | 0 LLM | $0 |
| Stage 1 Haiku batch classify | 5–10 calls | ~$0.05 |
| Stage 2 Sonnet synthesis | 1 call | ~$0.05 |
| **Total LLM** | | **~$0.10/wk** |
| Railway cron compute | <1 min/wk | ~$0 (within paid plan) |
| Supabase | | $0 (free tier) |
| Cloudflare Pages | | $0 (free tier) |

Original naive design (per-item Sonnet) would have been ~$1.40/wk. ~14× reduction.

---

## 6. Why Railway Cron (not GH Actions, not n8n)

### vs n8n (the original attempt)

| Issue with n8n | How Railway + TS solves |
|---|---|
| Postgres node `Map Automatically` quirks across versions | Plain Supabase JS SDK, one consistent API |
| `queryReplacement` syntax broke in v2.5 | Plain SQL strings or `supabase.from().insert()` |
| Header Auth credential / env var access denied | `process.env.ANTHROPIC_API_KEY` works trivially |
| IF condition format changes between versions | `if (...)` in TypeScript |
| Visual workflow + 4 reimports to fix bugs | One TypeScript file, edit and push |
| Logs scattered, hard to debug | Railway dashboard logs per run |
| 401 errors with no clear cause | Stack traces, line numbers, real errors |

### vs GitHub Actions (the previous plan)

| Dimension | GH Actions | Railway Cron | Winner |
|---|---|---|---|
| Marginal cost | $0 (free tier) | $0 (already paid) | Tie |
| Config | YAML + 3 GH Secrets | UI checkbox + Variables | **Railway** |
| Env var management | GH Secrets (separate system) | Same as future Railway services | **Railway** |
| Logs | Per-run, Actions UI | Service-level dashboard | **Railway** |
| 60-day hibernation risk | Yes (inactive repo auto-disables) | No | **Railway** |
| Execution drift | 15–60 min in worst case | Few minutes | **Railway** slight edge |
| Manual trigger | `workflow_dispatch` button | Redeploy button | Tie |
| Local dev parity | `npx tsx scripts/...` | Identical | Tie |

**Trade-off accepted**: lose the GH Actions visual canvas. Acceptable since Railway dashboard is at least as good and unified with future tooling.

---

## 7. Three visual themes

Distinct on purpose — readers know "where they are":

| Layout | Used for | Palette | Font |
|---|---|---|---|
| **Cyberpunk** (BaseLayout) | Home, lists | `#0a0a0f` deep + cyan/purple gradient | JetBrains Mono + Inter |
| **Editorial** (EditorialLayout) | Dossier long-form | `#f4ecd8` paper + red/green/gold | Bodoni Moda + Noto Serif SC |
| **Telex** (TelexLayout) | Weekly digest | `#fafaf7` light + ink/red | JetBrains Mono + Inter (compact) |

---

## 8. Status

| # | Step | Status | Notes |
|---|---|---|---|
| 1 | Astro scaffold + visual migration | ✅ Done | 90s post migrated as `.astro` |
| 2 | Supabase data layer + 36 seed feeds | ✅ Done | RLS works, `blog` schema isolated |
| 3 | Weekly automation pipeline | ⏳ **In progress** | Railway cron + optimized AI pipeline |
| 4 | Weekly SSR + homepage callout | ✅ Done | `/weekly/2026-W17` renders sample |
| 5 | Bilingual Dossier layout | 🔜 Pending | EN-first / CN second |
| 6 | `/sg-life` sub-section | 🔜 Pending | |
| 7 | RSS feeds + About + robots.txt + analytics | 🔜 Pending | |

---

## 9. Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-04-26 | Pivot from static HTML to Astro 6 | Sustainable content workflow |
| 2026-04-26 | Drop email subscription | User explicitly doesn't want it; just open URL |
| 2026-04-26 | Weekly = public + `<meta noindex>` | Visible without login but not SEO-indexed during stabilization |
| 2026-04-26 | Reuse existing `ricky-gtm` Supabase project, isolated schema `blog` | No new vendor, schemas safely separate |
| 2026-04-26 | Fixed 4-section weekly: Competitive / AI Voice / SEA+India / GTM | Matches Ricky's role |
| 2026-04-26 | **Replace n8n with TypeScript cron script** | n8n debugging burned hours; TS in same repo eliminates impedance |
| 2026-04-26 | **Run cron on Railway (not GH Actions)** | Already paid; no hibernation risk; unified env/logs with future tooling |
| 2026-04-26 | **Three-stage AI pipeline (pre-filter → Haiku batch → Sonnet synth)** | ~14× cost reduction vs naive per-item Sonnet; faster too |
| 2026-04-26 | **14-day candidate window with 7-day half-life decay** | Avoid losing high-value items that didn't fit one week |
| 2026-04-26 | **Add `cron_runs` audit table** | GH Actions / Railway logs aren't enough for ongoing ops |

---

## 10. Implementation plan

### Files to add

```
scripts/
  weekly-digest.ts                  # Entry point, ~150 lines
  lib/
    fetch-feeds.ts                  # RSS fetch + 7-day filter + dedup
    pre-filter.ts                   # Keyword whitelist regex
    classify.ts                     # Batch Haiku classification
    synthesize.ts                   # Sonnet 8-item digest
    notify.ts                       # Telegram failure webhook
  keywords.json                     # ~50 whitelist terms

supabase/migrations/
  0003_cron_runs_table.sql
  0004_candidates_time_decay.sql

railway.toml                        # Railway build config (optional, UI works too)
```

### `keywords.json` starter (tune as you go)

Categorized whitelist; an item passes Stage 0 if title or excerpt matches **any** term. Keep this in version control so you can audit what's filtering through.

```json
{
  "competitors": [
    "twilio", "agora", "vonage", "sinch", "zegocloud", "sendbird",
    "livekit", "genesys", "pubnub", "nexmo", "openai realtime",
    "daily.co", "chime", "amazon connect"
  ],
  "tech": [
    "rtc", "webrtc", "real-time", "voice ai", "conversational ai",
    "stt", "tts", "asr", "sip", "rtp", "codec", "cpaas", "ccaas",
    "video sdk", "live streaming", "low latency"
  ],
  "sea_india": [
    "singapore", "indonesia", "malaysia", "thailand", "vietnam",
    "philippines", "india", "grab", "gojek", "shopee", "lazada",
    "sea region", "asean"
  ],
  "gtm": [
    "developer", "api pricing", "platform launch", "partnership",
    "integration", "enterprise", "case study"
  ]
}
```

### Local dev experience

```bash
# Set up once
cp .env.example .env
# Edit .env to add:
#   SUPABASE_URL=https://mjhpylgbgagostbtnvtx.supabase.co
#   SUPABASE_SERVICE_KEY=...   (Settings → API → service_role)
#   ANTHROPIC_API_KEY=sk-ant-api03-...
#   TELEGRAM_BOT_TOKEN=...     (optional, for failure alerts)
#   TELEGRAM_CHAT_ID=...

# Run the cron script ad-hoc
npx tsx scripts/weekly-digest.ts

# Logs print to terminal; iterate fast
```

### Railway deployment (one-time)

1. **Project → New Service → Deploy from GitHub Repo** (`rickys-blog`)
2. **Service name**: `weekly-digest-cron`
3. **Settings → Build**:
   - Root Directory: `/`
   - Build Command: `npm install`
   - Start Command: `npx tsx scripts/weekly-digest.ts`
4. **Settings → Cron Schedule**: `0 0 * * 0`
   *(= 08:00 SGT Sunday — gives 1hr buffer for Railway's execution drift before Ricky checks the site at 09:00)*
5. **Variables** — add 5:

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | `https://mjhpylgbgagostbtnvtx.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | service_role key |
   | `ANTHROPIC_API_KEY` | `sk-ant-api03-…` |
   | `TELEGRAM_BOT_TOKEN` | (optional) |
   | `TELEGRAM_CHAT_ID` | (optional) |

6. **Deploy** → click **Redeploy** to manually trigger first run
7. Check Logs in Railway dashboard
8. Verify in Supabase: `SELECT count(*) FROM blog.feed_items WHERE ai_summary_en IS NOT NULL;`
9. Verify on site: `https://your-site.pages.dev/weekly` shows the new issue

### Failure modes and fallbacks

| Failure | Fallback |
|---|---|
| Some RSS URLs are 404 / dead | Per-source try/catch; bad sources flagged in logs, set `enabled = false` in Supabase |
| Anthropic API hiccup | Per-batch try/catch; failed batches re-queued in next run via `filter_status = 'failed'` |
| Railway cron drift / outage | Manual Redeploy from UI; nothing lost (RSS always fetches latest 7 days) |
| Supabase down | Run later; idempotent on `feed_items.url UNIQUE` |
| Whole job crashes | `notify.ts` sends Telegram alert; `cron_runs` row written with `status='failed'` |

### Verification checklist (post-deploy, every Sunday for first month)

- [ ] Railway service shows green run in dashboard
- [ ] `SELECT * FROM blog.cron_runs ORDER BY started_at DESC LIMIT 1;` shows `status = 'success'`
- [ ] `items_fetched > 0`, `items_classified > 0`, `items_with_errors` is small
- [ ] `/weekly` shows new issue with this week's ISO slug
- [ ] No Telegram alert fired

---

## 11. Phase 2 (later, not now)

- **Email subscription** via Resend (if Ricky decides he wants it after all)
- **Paywall** via Stripe + Supabase Auth → reserve some weekly issues / dossiers as paid
- **Comments** via Giscus
- **True i18n** with locale routing (`/en/...` `/zh/...`)
- **More dossier categories** (e.g., `/dossiers/movies`, `/dossiers/books`)
- **Per-week metrics / open-rate proxy**
- **Dedicated `blog_cron` Postgres user** (replace service_role for cron):
  ```sql
  CREATE ROLE blog_cron LOGIN PASSWORD '...';
  GRANT USAGE ON SCHEMA blog TO blog_cron;
  GRANT INSERT, UPDATE, SELECT ON blog.feed_items TO blog_cron;
  GRANT SELECT ON blog.feed_sources TO blog_cron;
  GRANT INSERT, UPDATE ON blog.weekly_digests TO blog_cron;
  GRANT INSERT ON blog.cron_runs TO blog_cron;
  -- No DELETE, no access to other schemas
  ```
- **GitHub Releases as competitive intel feed** — add competitors' `releases.atom` URLs (Twilio / Agora / LiveKit / Sinch repos) as `kind = github_releases` sources. Free signal on product launches.
- **Admin panel** at `/admin/runs` (token-protected) — render `cron_runs` table as a dashboard. Trivial since Astro + Supabase is already set up.

---

*Last updated: 2026-04-26 (Railway pivot + AI pipeline optimization)*
