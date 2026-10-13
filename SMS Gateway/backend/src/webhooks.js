import crypto from 'node:crypto';
import { db } from './db.js';

const RETRY_DELAYS_MS = [0, 5_000, 30_000, 120_000];

/**
 * Fire-and-forget webhook delivery to the user's configured URL.
 * Body is signed: X-SMSGateway-Signature: sha256=<hmac of raw body using the webhook secret>
 */
export function fireWebhook(userId, event, data) {
  const user = db.prepare('SELECT webhook_url, webhook_secret FROM users WHERE id = ?').get(userId);
  if (!user?.webhook_url) return;
  const body = JSON.stringify({ event, data, sent_at: new Date().toISOString() });
  const signature = 'sha256=' + crypto.createHmac('sha256', user.webhook_secret || '').update(body).digest('hex');

  (async () => {
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        const res = await fetch(user.webhook_url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-smsgateway-event': event, 'x-smsgateway-signature': signature },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return;
      } catch {
        /* retry */
      }
    }
    console.warn(`webhook ${event} to ${user.webhook_url} failed after retries`);
  })();
}
