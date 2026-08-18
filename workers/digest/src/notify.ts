import type { Env } from './index';

/** Optional Telegram failure alert — no-op unless both secrets are set. */
export async function notifyFailure(env: Env, job: string, message: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: `🚨 *rickys-blog ${job} failed*\n\n\`\`\`\n${message.slice(0, 3500)}\n\`\`\``,
          parse_mode: 'Markdown',
        }),
      },
    );
    if (!resp.ok) console.warn(`telegram send failed: ${resp.status}`);
  } catch (e: unknown) {
    console.warn(`telegram error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
