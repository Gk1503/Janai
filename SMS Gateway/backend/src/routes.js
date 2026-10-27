import crypto from 'node:crypto';
import express from 'express';
import { db } from './db.js';
import {
  hashPassword, verifyPassword, signSession, sha256, randomToken,
  requireUser, requireApiKey, requireDevice, rateLimit,
} from './auth.js';
import {
  ApiError, bus, claimPending, getMessage, listMessages, normalizePhone, queueSms, ONLINE_WINDOW_MS,
} from './messages.js';
import { fireWebhook } from './webhooks.js';


/* ------------------------------------------------------------------ */
/* Dashboard: /api/*  (JWT session)                                    */
/* ------------------------------------------------------------------ */
export const dashboard = express.Router();

dashboard.post('/auth/register', rateLimit({ perMinute: 20 }), (req, res) => {
  const { email, password } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '')) throw new ApiError(400, 'valid email required');
  if (typeof password !== 'string' || password.length < 8) throw new ApiError(400, 'password must be at least 8 characters');
  const id = crypto.randomUUID();
  try {
    db.prepare('INSERT INTO users (id, email, password_hash, webhook_secret, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, email.toLowerCase(), hashPassword(password), randomToken('whsec_'), Date.now());
  } catch {
    throw new ApiError(409, 'email already registered');
  }
  res.status(201).json({ token: signSession(id) });
});

dashboard.post('/auth/login', rateLimit({ perMinute: 20 }), (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new ApiError(401, 'wrong email or password');
  res.json({ token: signSession(u.id) });
});

dashboard.use(requireUser);

dashboard.get('/me', (req, res) => {
  const u = db.prepare('SELECT email, webhook_url, webhook_secret FROM users WHERE id = ?').get(req.userId);
  res.json(u);
});

dashboard.put('/webhook', (req, res) => {
  const url = req.body?.url ? String(req.body.url).trim() : null;
  if (url && !/^https?:\/\//i.test(url)) throw new ApiError(400, 'webhook url must start with http:// or https://');
  db.prepare('UPDATE users SET webhook_url = ? WHERE id = ?').run(url, req.userId);
  res.json({ ok: true });
});

dashboard.get('/keys', (req, res) => {
  res.json(db.prepare(
    'SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC',
  ).all(req.userId));
});

dashboard.post('/keys', (req, res) => {
  const name = String(req.body?.name || 'default').slice(0, 60);
  const key = randomToken('sg_');
  db.prepare('INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), req.userId, name, key.slice(0, 8), sha256(key), Date.now());
  // The full key is shown exactly once.
  res.status(201).json({ key, name });
});

dashboard.delete('/keys/:id', (req, res) => {
  db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ?').run(Date.now(), req.params.id, req.userId);
  res.json({ ok: true });
});

dashboard.get('/devices', (req, res) => {
  const rows = db.prepare('SELECT id, name, last_seen_at, created_at FROM devices WHERE user_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json(rows.map((d) => ({ ...d, online: !!d.last_seen_at && Date.now() - d.last_seen_at < ONLINE_WINDOW_MS })));
});

dashboard.delete('/devices/:id', (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

dashboard.get('/messages', (req, res) => res.json(listMessages(req.userId, req.query)));

dashboard.post('/messages', (req, res) => {
  res.status(202).json(queueSms(req.userId, { to: req.body?.to, body: req.body?.body }));
});

/* ------------------------------------------------------------------ */
/* Public API: /v1/*  (API key)                                        */
/* ------------------------------------------------------------------ */
export const publicApi = express.Router();
publicApi.use(requireApiKey, rateLimit({ perMinute: 120 }));

publicApi.post('/messages', (req, res) => {
  const { to, body, device_id } = req.body || {};
  res.status(202).json(queueSms(req.userId, { to, body, deviceId: device_id }));
});

publicApi.get('/messages', (req, res) => res.json(listMessages(req.userId, req.query)));

publicApi.get('/messages/:id', (req, res) => {
  const m = getMessage(req.userId, req.params.id);
  if (!m) throw new ApiError(404, 'message not found');
  res.json(m);
});

publicApi.get('/devices', (req, res) => {
  const rows = db.prepare('SELECT id, name, last_seen_at FROM devices WHERE user_id = ?').all(req.userId);
  res.json(rows.map((d) => ({ ...d, online: !!d.last_seen_at && Date.now() - d.last_seen_at < ONLINE_WINDOW_MS })));
});

/* --- OTP helper: the gateway generates, sends and verifies the code --- */
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

publicApi.post('/otp/send', (req, res) => {
  const phone = normalizePhone(req.body?.to);
  const recent = db.prepare('SELECT created_at FROM otps WHERE user_id = ? AND phone = ? ORDER BY created_at DESC LIMIT 1').get(req.userId, phone);
  if (recent && Date.now() - recent.created_at < 30_000) throw new ApiError(429, 'wait 30 seconds before requesting another code');

  const length = Math.min(8, Math.max(4, Number(req.body?.length) || 6));
  const code = String(crypto.randomInt(0, 10 ** length)).padStart(length, '0');
  const template = String(req.body?.message || 'Your verification code is {code}. It expires in 5 minutes.');
  const id = crypto.randomUUID();
  const msg = queueSms(req.userId, { to: phone, body: template.replace('{code}', code), deviceId: req.body?.device_id });
  db.prepare('INSERT INTO otps (id, user_id, phone, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.userId, phone, sha256(`${id}:${code}`), Date.now() + OTP_TTL_MS, Date.now());
  res.status(202).json({ otp_id: id, message_id: msg.id, expires_in: OTP_TTL_MS / 1000 });
});

publicApi.post('/otp/verify', (req, res) => {
  const { otp_id, code } = req.body || {};
  const row = db.prepare('SELECT * FROM otps WHERE id = ? AND user_id = ?').get(String(otp_id || ''), req.userId);
  if (!row || row.used || Date.now() > row.expires_at || row.attempts >= OTP_MAX_ATTEMPTS) {
    return res.status(400).json({ valid: false, error: 'code expired or not found' });
  }
  db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
  const ok = crypto.timingSafeEqual(Buffer.from(sha256(`${row.id}:${String(code)}`)), Buffer.from(row.code_hash));
  if (!ok) return res.status(400).json({ valid: false, error: 'incorrect code' });
  db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(row.id);
  res.json({ valid: true, phone: row.phone });
});

/* ------------------------------------------------------------------ */
/* Phone app: /device/*                                                */
/* ------------------------------------------------------------------ */
export const device = express.Router();

// Pair a phone using an API key; returns a device token used for everything else.
device.post('/register', requireApiKey, (req, res) => {
  const id = crypto.randomUUID();
  const token = randomToken('dv_');
  const name = String(req.body?.name || 'Android phone').slice(0, 60);
  db.prepare('INSERT INTO devices (id, user_id, name, token_hash, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.userId, name, sha256(token), Date.now(), Date.now());
  res.status(201).json({ device_id: id, device_token: token });
});

const LONG_POLL_MS = 25_000;

// Long-poll: returns immediately if work is queued, otherwise waits up to 25s.
device.get('/poll', requireDevice, (req, res) => {
  const first = claimPending(req.deviceId);
  if (first.length) return res.json({ messages: first });

  const event = `device:${req.deviceId}`;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    bus.off(event, onWake);
    if (!res.writableEnded && !res.destroyed) res.json({ messages: claimPending(req.deviceId) });
  };
  const onWake = () => finish();
  const timer = setTimeout(finish, LONG_POLL_MS);
  bus.on(event, onWake);
  req.on('close', () => { // phone went away: stop waiting without claiming anything
    if (done) return;
    done = true;
    clearTimeout(timer);
    bus.off(event, onWake);
  });
});

device.post('/status', requireDevice, (req, res) => {
  const { id, status, error } = req.body || {};
  if (!['sent', 'delivered', 'failed'].includes(status)) throw new ApiError(400, 'status must be sent, delivered or failed');
  const msg = db.prepare("SELECT id, status FROM messages WHERE id = ? AND device_id = ? AND direction = 'out'").get(String(id), req.deviceId);
  if (!msg) throw new ApiError(404, 'message not found');
  // never move backwards (e.g. a late "sent" after "delivered")
  const rank = { pending: 0, processing: 1, sent: 2, failed: 3, delivered: 3 };
  if (rank[status] >= rank[msg.status] && msg.status !== 'delivered') {
    db.prepare('UPDATE messages SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .run(status, error ? String(error).slice(0, 200) : null, Date.now(), msg.id);
    fireWebhook(req.userId, `sms.${status}`, getMessage(req.userId, msg.id));
  }
  res.json({ ok: true });
});

device.post('/incoming', requireDevice, (req, res) => {
  const { from, body, received_at } = req.body || {};
  if (!from || typeof body !== 'string') throw new ApiError(400, 'from and body required');
  const id = crypto.randomUUID();
  const ts = Number(received_at) || Date.now();
  db.prepare(
    `INSERT INTO messages (id, user_id, device_id, direction, address, body, status, created_at, updated_at)
     VALUES (?, ?, ?, 'in', ?, ?, 'received', ?, ?)`,
  ).run(id, req.userId, req.deviceId, String(from).slice(0, 40), body, ts, Date.now());
  fireWebhook(req.userId, 'sms.received', getMessage(req.userId, id));
  res.status(201).json({ id });
});

