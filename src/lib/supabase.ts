import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.SUPABASE_URL;
const anonKey = import.meta.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment');
}

// Always scoped to the `blog` schema — never touches public or other schemas.
export const supabase = createClient(url, anonKey, {
  db: { schema: 'blog' },
  auth: { persistSession: false },
});

export type WeeklyDigest = {
  slug: string;
  title: string;
  curators_note_en: string | null;
  curators_note_cn: string | null;
  body_md: string;
  deep_dive_url: string | null;
  deep_dive_summary_en: string | null;
  deep_dive_summary_cn: string | null;
  published_at: string;
};
