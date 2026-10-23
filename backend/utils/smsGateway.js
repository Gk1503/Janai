// Minimal client for the self-hosted SMS gateway's general transactional endpoint
// (POST /v1/messages). Deliberately separate from the OTP flow in controllers/otpController.js:
// /v1/otp/send generates and stores a verification code and enforces its own 30s-per-phone cooldown,
// which is the wrong behaviour for order notifications. That controller is untouched by this module.
//
// Terminology: the gateway replies 202 when a message has been QUEUED for the paired Android phone to
// send over its SIM. It is not proof of delivery, so nothing here ever reports a message as "sent" or
// "delivered" — only "queued".

// Matches the gateway's own ceiling (SMS Gateway/backend/src/messages.js: body too long > 1600).
export const MAX_SMS_BODY_LENGTH = 1600;
const REQUEST_TIMEOUT_MS = 8000;

export function isSmsGatewayConfigured() {
  const { SMS_GATEWAY_URL, SMS_GATEWAY_KEY } = process.env;
  return Boolean(SMS_GATEWAY_URL && SMS_GATEWAY_KEY);
}

// Never throws and never returns a recipient number or message body, so a caller can log the result
// as-is without leaking personal data.
export async function queueSms({ to, body }) {
  const { SMS_GATEWAY_URL: baseUrl, SMS_GATEWAY_KEY: apiKey } = process.env;
  // Checked before the request so a store with no gateway configured simply skips, rather than
  // producing a confusing network error. The values themselves are never logged or returned.
  if (!baseUrl || !apiKey) return { queued: false, reason: 'gateway_not_configured' };
  if (typeof to !== 'string' || !to) return { queued: false, reason: 'no_recipient' };
  if (typeof body !== 'string' || !body.trim()) return { queued: false, reason: 'empty_body' };
  if (body.length > MAX_SMS_BODY_LENGTH) return { queued: false, reason: 'body_too_long' };

  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to, body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Covers an unreachable gateway, DNS failure and the abort timeout alike. The gateway URL is not
    // included in the result: callers log these reasons, and it is configuration, not diagnostics.
    return { queued: false, reason: error?.name === 'TimeoutError' ? 'gateway_timeout' : 'gateway_unreachable' };
  }

  // A gateway that answers with HTML or a truncated body must not throw here.
  const data = await response.json().catch(() => null);

  if (response.status === 202) {
    // The gateway returns the queued message record; only its id is kept (never `address`/`body`,
    // which hold the customer's number and the full message text).
    const messageId = data && typeof data.id === 'string' ? data.id : null;
    if (!messageId) return { queued: false, reason: 'malformed_gateway_response', status: 202 };
    return { queued: true, messageId, status: 202 };
  }

  if (response.status === 429) return { queued: false, reason: 'rate_limited', status: 429 };
  // 409 is the gateway's "no Android device paired" case; 401 a bad/revoked key; 400 a rejected number.
  return { queued: false, reason: 'gateway_error', status: response.status };
}
