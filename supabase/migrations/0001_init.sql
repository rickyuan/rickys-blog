-- =====================================================
-- rickys-blog · 0001_init
-- All assets isolated under `blog` schema.
-- DOES NOT touch `public` or any other existing schema.
-- Safe to run on a Supabase project that already has other tables.
-- =====================================================

CREATE SCHEMA IF NOT EXISTS blog;

-- ----------------------------------------------------
-- Tables
-- ----------------------------------------------------

CREATE TABLE IF NOT EXISTS blog.feed_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('rss', 'api', 'newsletter')),
  url         text NOT NULL,
  label       text,
  section     text NOT NULL CHECK (section IN ('competitive', 'ai_voice', 'sea_market', 'gtm', 'inspiration')),
  weight      int  NOT NULL DEFAULT 1,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feed_sources_enabled_section
  ON blog.feed_sources(enabled, section);

CREATE TABLE IF NOT EXISTS blog.feed_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       uuid REFERENCES blog.feed_sources(id) ON DELETE SET NULL,
  url             text UNIQUE NOT NULL,
  title           text NOT NULL,
  raw_excerpt     text,
  ai_summary_en   text,
  ai_summary_cn   text,
  ai_section      text CHECK (ai_section IN ('competitive', 'ai_voice', 'sea_market', 'gtm', 'inspiration')),
  ai_score        int  DEFAULT 0,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  used_in_weekly  text  -- references blog.weekly_digests.slug (loose link, no FK)
);

CREATE INDEX IF NOT EXISTS idx_feed_items_unused
  ON blog.feed_items(used_in_weekly, ai_score DESC)
  WHERE used_in_weekly IS NULL;

CREATE INDEX IF NOT EXISTS idx_feed_items_fetched
  ON blog.feed_items(fetched_at DESC);

CREATE TABLE IF NOT EXISTS blog.weekly_digests (
  slug                    text PRIMARY KEY,  -- e.g. '2026-W17'
  title                   text NOT NULL,
  curators_note_en        text,
  curators_note_cn        text,
  body_md                 text NOT NULL,
  deep_dive_url           text,
  deep_dive_summary_en    text,
  deep_dive_summary_cn    text,
  published_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_digests_published
  ON blog.weekly_digests(published_at DESC);

-- ----------------------------------------------------
-- Row Level Security
--   anon → can ONLY read published weekly digests
--   anon → CANNOT see feed_sources or feed_items
--   service_role → bypasses RLS automatically (n8n will use this)
-- ----------------------------------------------------
ALTER TABLE blog.feed_sources   ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog.feed_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog.weekly_digests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_published_weeklies" ON blog.weekly_digests;
CREATE POLICY "anon_read_published_weeklies"
  ON blog.weekly_digests
  FOR SELECT
  TO anon
  USING (published_at IS NOT NULL AND published_at <= now());

-- ----------------------------------------------------
-- Grants
-- ----------------------------------------------------
GRANT USAGE  ON SCHEMA blog        TO anon, authenticated, service_role;
GRANT SELECT ON blog.weekly_digests TO anon, authenticated;
GRANT ALL    ON ALL TABLES IN SCHEMA blog TO service_role;
GRANT ALL    ON ALL SEQUENCES IN SCHEMA blog TO service_role;

-- ----------------------------------------------------
-- Seed: feed_sources (30+ sources, all free)
-- weight 3 = competitive (highest priority for selection)
-- weight 2 = ai_voice / sea_market
-- weight 1 = gtm / inspiration
-- ----------------------------------------------------
INSERT INTO blog.feed_sources (kind, url, label, section, weight) VALUES
  -- competitive (RTC / Chat / CCaaS vendors)
  ('rss', 'https://www.agora.io/en/blog/feed/',                    'Agora Blog',           'competitive', 3),
  ('rss', 'https://www.twilio.com/blog/feed',                      'Twilio Blog',          'competitive', 3),
  ('rss', 'https://blog.livekit.io/rss/',                          'LiveKit Blog',         'competitive', 3),
  ('rss', 'https://www.daily.co/blog/rss/',                        'Daily.co Blog',        'competitive', 3),
  ('rss', 'https://sendbird.com/feed.xml',                         'Sendbird Blog',        'competitive', 3),
  ('rss', 'https://www.100ms.live/blog/rss.xml',                   '100ms Blog',           'competitive', 3),
  ('rss', 'https://www.zegocloud.com/blog/feed',                   'ZEGOCLOUD Blog',       'competitive', 3),
  ('rss', 'https://www.vonage.com/communications-apis/blog/feed/', 'Vonage API Blog',      'competitive', 3),
  ('rss', 'https://www.nojitter.com/rss.xml',                      'No Jitter (UC ind.)',  'competitive', 3),
  ('rss', 'https://www.uctoday.com/feed/',                         'UC Today',             'competitive', 3),

  -- ai_voice (AI Voice & Agent ecosystem)
  ('rss', 'https://vapi.ai/blog/rss.xml',                          'Vapi',                 'ai_voice',    2),
  ('rss', 'https://www.retellai.com/blog/rss.xml',                 'Retell AI',            'ai_voice',    2),
  ('rss', 'https://elevenlabs.io/blog/rss',                        'ElevenLabs',           'ai_voice',    2),
  ('rss', 'https://cartesia.ai/blog/rss.xml',                      'Cartesia',             'ai_voice',    2),
  ('rss', 'https://deepgram.com/learn/rss.xml',                    'Deepgram',             'ai_voice',    2),
  ('rss', 'https://www.anthropic.com/news/rss.xml',                'Anthropic News',       'ai_voice',    2),
  ('rss', 'https://openai.com/blog/rss.xml',                       'OpenAI Blog',          'ai_voice',    2),
  ('rss', 'https://www.latent.space/feed',                         'Latent Space',         'ai_voice',    2),
  ('rss', 'https://hnrss.org/newest?q=voice+agent+OR+conversational+AI', 'HN: Voice Agent', 'ai_voice',   2),

  -- sea_market (SEA + India)
  ('rss', 'https://www.techinasia.com/feed',                       'Tech in Asia',         'sea_market',  2),
  ('rss', 'https://e27.co/feed/',                                  'e27',                  'sea_market',  2),
  ('rss', 'https://www.dealstreetasia.com/feed/',                  'DealStreetAsia',       'sea_market',  2),
  ('rss', 'https://kr-asia.com/feed',                              'KrAsia',               'sea_market',  2),
  ('rss', 'https://www.businesstimes.com.sg/rss/companies-markets', 'Business Times SG',   'sea_market',  2),
  ('rss', 'https://www.channelnewsasia.com/rssfeeds/8395986',      'CNA Tech',             'sea_market',  2),
  ('rss', 'https://entrackr.com/feed/',                            'Entrackr (India)',     'sea_market',  2),
  ('rss', 'https://inc42.com/feed/',                               'Inc42 (India)',        'sea_market',  2),

  -- gtm (GTM & Partnership)
  ('rss', 'https://stratechery.com/feed/',                         'Stratechery',          'gtm',         1),
  ('rss', 'https://tomtunguz.com/index.xml',                       'Tomasz Tunguz',        'gtm',         1),
  ('rss', 'https://a16z.com/feed/',                                'a16z',                 'gtm',         1),
  ('rss', 'https://www.saastr.com/feed/',                          'SaaStr',               'gtm',         1),

  -- inspiration (writing inspiration; NOT into weekly, into dossier topic pool)
  ('rss', 'https://hnrss.org/frontpage',                           'HN Frontpage',         'inspiration', 1),
  ('rss', 'https://lobste.rs/rss',                                 'Lobsters',             'inspiration', 1),
  ('rss', 'https://sspai.com/feed',                                '少数派',               'inspiration', 1),
  ('rss', 'https://www.jiqizhixin.com/rss',                        '机器之心',             'inspiration', 1),
  ('rss', 'https://webrtchacks.com/feed/',                         'webrtcHacks',          'inspiration', 1),
  ('rss', 'https://bloggeek.me/feed/',                             'BlogGeek.me',          'inspiration', 1)
ON CONFLICT DO NOTHING;
