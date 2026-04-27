// Read env vars lazily inside the function — module-load time happens before
// our .env loader runs (ESM imports are hoisted).

export async function notifyFailure(message: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.log('  (Telegram not configured — skipping alert)');
    return;
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🚨 *rickys-blog cron failed*\n\n\`\`\`\n${message.slice(0, 3500)}\n\`\`\``,
        parse_mode: 'Markdown',
      }),
    });
    if (!resp.ok) {
      console.warn(`  Telegram send failed: ${resp.status}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  Telegram error: ${msg}`);
  }
}
