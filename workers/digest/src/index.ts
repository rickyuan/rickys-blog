/**
 * rickys-blog-digest — Cloudflare Worker.
 *
 * Cron triggers (UTC):
 *   "0 0 * * SUN"  → weekly digest  (Sunday 08:00 SGT)
 *   "0 23 * * *"   → GTM signal collection (07:00 SGT next day)
 *
 * Manual trigger (for testing / backfill), guarded by the RUN_TOKEN secret:
 *   GET /run/weekly?token=...
 *   GET /run/gtm?token=...
 */
import type { D1Database } from '../../../src/lib/d1-types';
import { runWeeklyDigest } from './weekly';
import { runGtmCollect } from './gtm';

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  RUN_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

type ScheduledEvent = { cron: string; scheduledTime: number };
type ExecutionContext = { waitUntil(p: Promise<unknown>): void };

export default {
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 23 * * *') {
      await runGtmCollect(env);
    } else {
      await runWeeklyDigest(env);
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!env.RUN_TOKEN || token !== env.RUN_TOKEN) {
      return new Response('not found', { status: 404 });
    }
    if (url.pathname === '/run/weekly') {
      const stats = await runWeeklyDigest(env);
      return Response.json(stats);
    }
    if (url.pathname === '/run/gtm') {
      const stats = await runGtmCollect(env);
      return Response.json(stats);
    }
    return new Response('not found', { status: 404 });
  },
};
