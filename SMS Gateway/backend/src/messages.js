import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { db } from './db.js';

/** Wakes up a phone's long-poll when a new message is queued for it. */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

const PHONE_RE = /^\+?[0-9]{5,15}$/;
export const ONLINE_WINDOW_MS = 2 * 60_000;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function normalizePhone(raw) {
  const p = String(raw || '').replace(/[\s\-()]/g, '');
  if (!PHONE_RE.test(p)) throw new ApiError(400, 'invalid phone number (use international format, e.g. +919876543210)');
  return p;
}

function pickDevice(userId, requestedId) {
  if (requestedId) {
    const d = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?').get(requestedId, userId);
    if (!d) throw new ApiError(404, 'device not found');
    return d.id;
  }
  const d = db
    .prepare('SELECT id FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC NULLS LAST LIMIT 1')
    .get(userId);
  if (!d) throw new ApiError(409, 'no device registered - install the Android app and connect it first');
  return d.id;
}

export function queueSms(userId, { to, body, deviceId }) {
  if (typeof body !== 'string' || !body.trim()) throw new ApiError(400, 'body is required');
  if (body.length > 1600) throw new ApiError(400, 'body too long (max 1600 chars)');
  const address = normalizePhone(to);
  const device = pickDevice(userId, deviceId);
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO messages (id, user_id, device_id, direction, address, body, status, created_at, updated_at)
     VALUES (?, ?, ?, 'out', ?, ?, 'pending', ?, ?)`,
  ).run(id, userId, device, address, body, now, now);
  bus.emit(`device:${device}`);
  return getMessage(userId, id);
}

const publicFields = 'id, device_id, direction, address, body, status, error, created_at, updated_at';

export function getMessage(userId, id) {
  return db.prepare(`SELECT ${publicFields} FROM messages WHERE id = ? AND user_id = ?`).get(id, userId);
}

export function listMessages(userId, { direction, status, limit = 50, offset = 0 } = {}) {
  const where = ['user_id = ?'];
  const args = [userId];
  if (direction) { where.push('direction = ?'); args.push(direction); }
  if (status) { where.push('status = ?'); args.push(status); }
  args.push(Math.min(Number(limit) || 50, 200), Number(offset) || 0);
  return db
    .prepare(`SELECT ${publicFields} FROM messages WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...args);
}

/** Atomically claims up to `max` pending messages for a device. */
export function claimPending(deviceId, max = 10) {
  const rows = db
    .prepare(
      `SELECT id, address, body FROM messages
       WHERE device_id = ? AND direction = 'out' AND status = 'pending'
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(deviceId, max);
  const mark = db.prepare("UPDATE messages SET status = 'processing', updated_at = ? WHERE id = ?");
  const now = Date.now();
  for (const r of rows) mark.run(now, r.id);
  return rows;
}

/** Messages claimed by a phone that never reported back go back to the queue. */
export function requeueStale(olderThanMs = 5 * 60_000) {
  db.prepare("UPDATE messages SET status = 'pending', updated_at = ? WHERE status = 'processing' AND updated_at < ?")
    .run(Date.now(), Date.now() - olderThanMs);
}
