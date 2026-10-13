# Integrating the SMS Gateway into your website (OTP login)

## 1. How it fits together

```
Browser ──(1) phone number──▶ YOUR website backend ──(2) POST /v1/otp/send──▶ SMS Gateway server ──▶ phone ──▶ user's SMS
Browser ──(3) code typed ───▶ YOUR website backend ──(4) POST /v1/otp/verify─▶ SMS Gateway server
                              YOUR backend creates the login session if valid
```

**Rule 1: the API key lives only on your backend.** Never put `sg_...` in frontend code (React, HTML, mobile app). Anyone who sees it can send SMS from your SIM.

**Rule 2: your backend must be able to reach the gateway server.**
- Website and gateway on the same PC: use `http://localhost:4000`.
- Website hosted online: the gateway server must also be hosted online with HTTPS (e.g. `https://sms.yourdomain.com`). The phone app then pairs using that same URL. A gateway on your home PC at `192.168.x.x` is not reachable from the internet.

## 2. What you need
| Item | Where to get it |
|---|---|
| Gateway base URL | `http://localhost:4000` (dev) or your deployed URL |
| API key `sg_...` | Dashboard → API keys → Generate key (shown once) |
| A phone that is **online** | Android app: Connected + Gateway started; dashboard shows "online" |

Store them in environment variables on your website backend:
```
SMS_GATEWAY_URL=http://localhost:4000
SMS_GATEWAY_KEY=sg_xxxxxxxxxxxxxxxx
```

## 3. API reference (OTP)

All requests: header `x-api-key: <key>`, `content-type: application/json`.

### Send a code
`POST /v1/otp/send`

| Field | Required | Notes |
|---|---|---|
| `to` | yes | International format, e.g. `+919876543210`. Spaces and dashes are removed. |
| `message` | no | Custom text. Use `{code}` where the code goes. Default: `Your verification code is {code}. It expires in 5 minutes.` |
| `device_id` | no | Send through a specific phone. Default: the most recently active phone. |

Success `202`:
```json
{ "otp_id": "5b1c…", "message_id": "9f3e…", "expires_in": 300 }
```
Keep `otp_id` (return it to the browser or store it in the user's session). You need it to verify.

### Verify a code
`POST /v1/otp/verify`
```json
{ "otp_id": "5b1c…", "code": "123456" }
```
- Valid `200`: `{ "valid": true, "phone": "+919876543210" }`
- Invalid `400`: `{ "valid": false, "error": "incorrect code" }` or `"code expired or not found"`

### Rules enforced by the gateway
- Code is 6 digits, valid for **5 minutes**, **single use**.
- Max **5 wrong attempts** per code, after which it is dead and the user must request a new one.
- One new code per phone number every **30 seconds** (`429` otherwise).
- 120 API requests per minute per key.

### Errors
| Status | Meaning | What to do |
|---|---|---|
| 400 | Bad phone number / missing field | Fix input, show a message |
| 401 | Missing or wrong API key | Check `SMS_GATEWAY_KEY` |
| 409 | No phone registered for this account | Pair the Android app |
| 429 | Too many requests / resend too soon | Ask user to wait |

`202` means the SMS is **queued**, not yet delivered. If the phone is offline, delivery waits until it reconnects, so a dead phone looks like "code never arrives". Monitor the dashboard's device status, or use webhooks (section 7).

## 4. Node.js / Express example (your website backend)

```js
// otp.js  (Node 18+ has global fetch)
import express from 'express';

const GATEWAY = process.env.SMS_GATEWAY_URL;
const KEY = process.env.SMS_GATEWAY_KEY;

async function gateway(path, body) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

export const otpRouter = express.Router();

// Step 1: browser sends the phone number
otpRouter.post('/auth/otp/request', async (req, res) => {
  const { phone } = req.body;
  const { status, data } = await gateway('/v1/otp/send', {
    to: phone,
    message: 'MyShop login code: {code}. Do not share it.',
  });
  if (status !== 202) return res.status(status === 429 ? 429 : 400).json({ error: data.error || 'Could not send code' });
  res.json({ otpId: data.otp_id, expiresIn: data.expires_in });
});

// Step 2: browser sends the code the user typed
otpRouter.post('/auth/otp/verify', async (req, res) => {
  const { otpId, code } = req.body;
  const { data } = await gateway('/v1/otp/verify', { otp_id: otpId, code });
  if (!data.valid) return res.status(401).json({ error: data.error || 'Invalid code' });

  // The phone number is now proven. Find or create the user, then start YOUR session:
  // const user = await db.users.upsert({ phone: data.phone });
  // req.session.userId = user.id;      // or issue a JWT
  res.json({ ok: true, phone: data.phone });
});
```

## 5. Frontend example (React)

```jsx
import { useState } from 'react';

export default function OtpLogin() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [otpId, setOtpId] = useState(null);
  const [error, setError] = useState('');

  const post = (url, body) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(async (r) => ({ ok: r.ok, data: await r.json() }));

  async function requestCode() {
    setError('');
    const { ok, data } = await post('/auth/otp/request', { phone });
    ok ? setOtpId(data.otpId) : setError(data.error);
  }

  async function verify() {
    setError('');
    const { ok, data } = await post('/auth/otp/verify', { otpId, code });
    ok ? (window.location = '/dashboard') : setError(data.error);
  }

  return !otpId ? (
    <>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
      <button onClick={requestCode}>Send code</button>
      {error && <p>{error}</p>}
    </>
  ) : (
    <>
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" />
      <button onClick={verify}>Verify</button>
      {error && <p>{error}</p>}
    </>
  );
}
```
The browser only talks to **your** backend (`/auth/otp/...`), never directly to the gateway.

## 6. Other languages (same two calls)

**Python**
```python
import os, requests
H = {"x-api-key": os.environ["SMS_GATEWAY_KEY"]}
B = os.environ["SMS_GATEWAY_URL"]

r = requests.post(f"{B}/v1/otp/send", json={"to": "+919876543210"}, headers=H)
otp_id = r.json()["otp_id"]

r = requests.post(f"{B}/v1/otp/verify", json={"otp_id": otp_id, "code": "123456"}, headers=H)
print(r.json())   # {"valid": True, "phone": "+919876543210"}
```

**PHP**
```php
function gateway($path, $body) {
  $ch = curl_init(getenv('SMS_GATEWAY_URL') . $path);
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['x-api-key: ' . getenv('SMS_GATEWAY_KEY'), 'content-type: application/json'],
    CURLOPT_POSTFIELDS => json_encode($body),
  ]);
  $out = json_decode(curl_exec($ch), true);
  curl_close($ch);
  return $out;
}
$sent = gateway('/v1/otp/send', ['to' => '+919876543210']);
$check = gateway('/v1/otp/verify', ['otp_id' => $sent['otp_id'], 'code' => '123456']);
```

**curl**
```bash
curl -X POST $SMS_GATEWAY_URL/v1/otp/send -H "x-api-key: $KEY" -H "content-type: application/json" -d '{"to":"+919876543210"}'
curl -X POST $SMS_GATEWAY_URL/v1/otp/verify -H "x-api-key: $KEY" -H "content-type: application/json" -d '{"otp_id":"...","code":"123456"}'
```

## 7. Sending normal / promotional SMS and receiving replies

Send:
```
POST /v1/messages   {"to":"+919876543210","body":"Big sale today!"}   -> 202 {id, status:"pending", ...}
GET  /v1/messages/<id>        status: pending -> processing -> sent -> delivered | failed
GET  /v1/messages?direction=in   incoming SMS
```

**Webhooks** (optional): set a URL in the dashboard to get `sms.received`, `sms.sent`, `sms.delivered`, `sms.failed`.
Each POST has header `X-SMSGateway-Signature: sha256=<hex>`. Verify it against the **raw body** with the signing secret shown in the dashboard:

```js
import crypto from 'node:crypto';

app.post('/sms-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(req.body).digest('hex');
  const got = req.headers['x-smsgateway-signature'] || '';
  if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return res.sendStatus(401);
  }
  const { event, data } = JSON.parse(req.body);   // data: { id, address, body, status, ... }
  // e.g. event === 'sms.received' -> handle a reply like "STOP"
  res.sendStatus(200);          // any non-2xx makes the gateway retry (4 attempts)
});
```

## 8. Production checklist

- [ ] Gateway server deployed with **HTTPS** and a persistent `DATA_DIR` (keeps keys, devices, messages).
- [ ] Phone app paired using the **public** URL; battery set to Unrestricted; phone plugged in and on Wi-Fi/data.
- [ ] API key stored in an environment variable on the backend, not in git or frontend.
- [ ] Your backend rate-limits `/auth/otp/request` per IP and per phone (the gateway also limits resends, but protect your SIM balance from abuse).
- [ ] Your backend creates the user session only after `valid: true`.
- [ ] Don't reveal whether a phone number is registered (same response for known and unknown numbers).
- [ ] Alerts if the phone goes offline (dashboard "online" status, or `GET /v1/devices`).
- [ ] Promotional SMS: consent, opt-out handling, and local rules (DLT in India). Keep volume modest; carriers throttle or block SIMs that send bulk SMS.

## 9. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `409 no device registered` | Phone not paired with this account's API key |
| Code never arrives, API returned 202 | Phone offline / gateway stopped / no SIM balance. Check dashboard status and the Messages table |
| `401` from the gateway | Wrong or revoked key |
| `429` on send | Resend within 30 s or rate limit |
| Works on localhost, fails when deployed | Website backend can't reach the gateway URL, or the phone is still paired to a LAN address |
