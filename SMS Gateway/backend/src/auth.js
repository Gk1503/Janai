import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { db, DATA_DIR } from './db.js';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (prefix, bytes = 24) => `${prefix}${crypto.randomBytes(bytes).toString('hex')}`;

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, 'jwt.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
const JWT_SECRET = loadSecret();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export const signSession = (userId) => jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

const unauthorized = (res, msg = 'unauthorized') => res.status(401).json({ error: msg });

/** Dashboard session (JWT). Sets req.userId */
export function requireUser(req, res, next) {
  const token = bearer(req);
  if (!token) return unauthorized(res);
  try {
    req.userId = jwt.verify(token, JWT_SECRET).sub;
    next();
  } catch {
    unauthorized(res, 'invalid or expired session');
  }
}

/** Public API key (x-api-key header). Sets req.userId */
export function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || bearer(req);
  if (!key) return unauthorized(res, 'missing api key');
  const row = db
    .prepare('SELECT id, user_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL')
    .get(sha256(String(key)));
  if (!row) return unauthorized(res, 'invalid api key');
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
  req.userId = row.user_id;
  req.apiKeyId = row.id;
  next();
}

/** Phone app token. Sets req.userId and req.deviceId */
export function requireDevice(req, res, next) {
  const token = bearer(req);
  if (!token) return unauthorized(res);
  const row = db.prepare('SELECT id, user_id FROM devices WHERE token_hash = ?').get(sha256(token));
  if (!row) return unauthorized(res, 'invalid device token');
  db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(Date.now(), row.id);
  req.userId = row.user_id;
  req.deviceId = row.id;
  next();
}

/** Tiny in-memory fixed-window rate limiter keyed by api key / user. */
export function rateLimit({ perMinute }) {
  const hits = new Map();
  setInterval(() => hits.clear(), 60_000).unref();
  return (req, res, next) => {
    const k = req.apiKeyId || req.userId || req.ip;
    const n = (hits.get(k) || 0) + 1;
    hits.set(k, n);
    if (n > perMinute) return res.status(429).json({ error: 'rate limit exceeded' });
    next();
  };
}
