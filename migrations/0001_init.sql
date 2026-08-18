-- =====================================================
-- rickys-blog · D1 0001_init
-- Full schema for the Cloudflare-only architecture.
-- Ported from supabase/migrations/* (Postgres) to SQLite.
-- Timestamps are ISO-8601 UTC strings; enrichment is a JSON string.
-- =====================================================

CREATE TABLE IF NOT EXISTS feed_sources (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('rss', 'api', 'newsletter')),
  url         TEXT NOT NULL,
  label       TEXT,
  section     TEXT NOT NULL CHECK (section IN ('competitive', 'ai_voice', 'sea_market', 'gtm', 'inspiration')),
  weight      INTEGER NOT NULL DEFAULT 1,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_feed_sources_enabled_section
  ON feed_sources(enabled, section);

CREATE TABLE IF NOT EXISTS feed_items (
  id              TEXT PRIMARY KEY,
  source_id       TEXT REFERENCES feed_sources(id) ON DELETE SET NULL,
  url             TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  raw_excerpt     TEXT,
  ai_summary_en   TEXT,
  ai_summary_cn   TEXT,
  ai_section      TEXT CHECK (ai_section IN ('competitive', 'ai_voice', 'sea_market', 'gtm', 'inspiration')),
  ai_score        INTEGER DEFAULT 0,
  filter_status   TEXT CHECK (filter_status IN ('pre_filtered_out', 'classified', 'failed')),
  fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  used_in_weekly  TEXT  -- references weekly_digests.slug (loose link, no FK)
);

CREATE INDEX IF NOT EXISTS idx_feed_items_unused
  ON feed_items(used_in_weekly, ai_score DESC);

CREATE INDEX IF NOT EXISTS idx_feed_items_fetched
  ON feed_items(fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_feed_items_filter_status
  ON feed_items(filter_status);

CREATE TABLE IF NOT EXISTS weekly_digests (
  slug                    TEXT PRIMARY KEY,  -- e.g. '2026-W34'
  title                   TEXT NOT NULL,
  curators_note_en        TEXT,
  curators_note_cn        TEXT,
  body_md                 TEXT NOT NULL,
  deep_dive_url           TEXT,
  deep_dive_summary_en    TEXT,
  deep_dive_summary_cn    TEXT,
  published_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_digests_published
  ON weekly_digests(published_at DESC);

CREATE TABLE IF NOT EXISTS cron_runs (
  id                   TEXT PRIMARY KEY,
  job                  TEXT NOT NULL DEFAULT 'weekly_digest'
                         CHECK (job IN ('weekly_digest', 'gtm_collect')),
  started_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at          TEXT,
  status               TEXT NOT NULL DEFAULT 'partial'
                         CHECK (status IN ('success', 'partial', 'failed')),
  items_fetched        INTEGER NOT NULL DEFAULT 0,
  items_pre_filtered   INTEGER NOT NULL DEFAULT 0,
  items_classified     INTEGER NOT NULL DEFAULT 0,
  items_with_errors    INTEGER NOT NULL DEFAULT 0,
  digest_slug          TEXT,
  llm_cost_usd         REAL NOT NULL DEFAULT 0,
  error_log            TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_started
  ON cron_runs(started_at DESC);

-- GTM intelligence signals (was public.signals in Supabase, fed by n8n;
-- now fed by the daily gtm_collect cron in workers/digest)
CREATE TABLE IF NOT EXISTS signals (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  url           TEXT UNIQUE,
  company_name  TEXT,
  country       TEXT,
  signal_type   TEXT NOT NULL DEFAULT 'other'
                  CHECK (signal_type IN ('competitor_blog', 'product_launch', 'funding_round',
                                         'hiring_signal', 'regulation_update', 'partnership',
                                         'expansion', 'other')),
  icp_score     REAL,
  entry_point   TEXT,
  enrichment    TEXT,  -- JSON: {score, industry, reasoning, entry_angle, competitor_displaced, ...}
  status        TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'qualified', 'watch', 'ignore')),
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_signals_created
  ON signals(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signals_score
  ON signals(icp_score DESC);

-- ----------------------------------------------------
-- Seed: feed_sources (same 36 free sources as Supabase seed)
-- weight 3 = competitive · 2 = ai_voice / sea_market · 1 = gtm / inspiration
-- ----------------------------------------------------
INSERT OR IGNORE INTO feed_sources (id, kind, url, label, section, weight) VALUES
  -- competitive (RTC / Chat / CCaaS vendors)
  ('src-agora',        'rss', 'https://www.agora.io/en/blog/feed/',                    'Agora Blog',           'competitive', 3),
  ('src-twilio',       'rss', 'https://www.twilio.com/blog/feed',                      'Twilio Blog',          'competitive', 3),
  ('src-livekit',      'rss', 'https://blog.livekit.io/rss/',                          'LiveKit Blog',         'competitive', 3),
  ('src-daily',        'rss', 'https://www.daily.co/blog/rss/',                        'Daily.co Blog',        'competitive', 3),
  ('src-sendbird',     'rss', 'https://sendbird.com/feed.xml',                         'Sendbird Blog',        'competitive', 3),
  ('src-100ms',        'rss', 'https://www.100ms.live/blog/rss.xml',                   '100ms Blog',           'competitive', 3),
  ('src-zegocloud',    'rss', 'https://www.zegocloud.com/blog/feed',                   'ZEGOCLOUD Blog',       'competitive', 3),
  ('src-vonage',       'rss', 'https://www.vonage.com/communications-apis/blog/feed/', 'Vonage API Blog',      'competitive', 3),
  ('src-nojitter',     'rss', 'https://www.nojitter.com/rss.xml',                      'No Jitter (UC ind.)',  'competitive', 3),
  ('src-uctoday',      'rss', 'https://www.uctoday.com/feed/',                         'UC Today',             'competitive', 3),

  -- ai_voice (AI Voice & Agent ecosystem)
  ('src-vapi',         'rss', 'https://vapi.ai/blog/rss.xml',                          'Vapi',                 'ai_voice',    2),
  ('src-retell',       'rss', 'https://www.retellai.com/blog/rss.xml',                 'Retell AI',            'ai_voice',    2),
  ('src-elevenlabs',   'rss', 'https://elevenlabs.io/blog/rss',                        'ElevenLabs',           'ai_voice',    2),
  ('src-cartesia',     'rss', 'https://cartesia.ai/blog/rss.xml',                      'Cartesia',             'ai_voice',    2),
  ('src-deepgram',     'rss', 'https://deepgram.com/learn/rss.xml',                    'Deepgram',             'ai_voice',    2),
  ('src-anthropic',    'rss', 'https://www.anthropic.com/news/rss.xml',                'Anthropic News',       'ai_voice',    2),
  ('src-openai',       'rss', 'https://openai.com/blog/rss.xml',                       'OpenAI Blog',          'ai_voice',    2),
  ('src-latentspace',  'rss', 'https://www.latent.space/feed',                         'Latent Space',         'ai_voice',    2),
  ('src-hn-voice',     'rss', 'https://hnrss.org/newest?q=voice+agent+OR+conversational+AI', 'HN: Voice Agent', 'ai_voice',   2),

  -- sea_market (SEA + India)
  ('src-techinasia',   'rss', 'https://www.techinasia.com/feed',                       'Tech in Asia',         'sea_market',  2),
  ('src-e27',          'rss', 'https://e27.co/feed/',                                  'e27',                  'sea_market',  2),
  ('src-dealstreet',   'rss', 'https://www.dealstreetasia.com/feed/',                  'DealStreetAsia',       'sea_market',  2),
  ('src-krasia',       'rss', 'https://kr-asia.com/feed',                              'KrAsia',               'sea_market',  2),
  ('src-btimes-sg',    'rss', 'https://www.businesstimes.com.sg/rss/companies-markets', 'Business Times SG',   'sea_market',  2),
  ('src-cna-tech',     'rss', 'https://www.channelnewsasia.com/rssfeeds/8395986',      'CNA Tech',             'sea_market',  2),
  ('src-entrackr',     'rss', 'https://entrackr.com/feed/',                            'Entrackr (India)',     'sea_market',  2),
  ('src-inc42',        'rss', 'https://inc42.com/feed/',                               'Inc42 (India)',        'sea_market',  2),

  -- gtm (GTM & Partnership)
  ('src-stratechery',  'rss', 'https://stratechery.com/feed/',                         'Stratechery',          'gtm',         1),
  ('src-tunguz',       'rss', 'https://tomtunguz.com/index.xml',                       'Tomasz Tunguz',        'gtm',         1),
  ('src-a16z',         'rss', 'https://a16z.com/feed/',                                'a16z',                 'gtm',         1),
  ('src-saastr',       'rss', 'https://www.saastr.com/feed/',                          'SaaStr',               'gtm',         1),

  -- inspiration (writing inspiration; NOT into weekly, into dossier topic pool)
  ('src-hn-front',     'rss', 'https://hnrss.org/frontpage',                           'HN Frontpage',         'inspiration', 1),
  ('src-lobsters',     'rss', 'https://lobste.rs/rss',                                 'Lobsters',             'inspiration', 1),
  ('src-sspai',        'rss', 'https://sspai.com/feed',                                '少数派',               'inspiration', 1),
  ('src-jiqizhixin',   'rss', 'https://www.jiqizhixin.com/rss',                        '机器之心',             'inspiration', 1),
  ('src-webrtchacks',  'rss', 'https://webrtchacks.com/feed/',                         'webrtcHacks',          'inspiration', 1),
  ('src-bloggeek',     'rss', 'https://bloggeek.me/feed/',                             'BlogGeek.me',          'inspiration', 1);
