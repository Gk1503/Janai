// In-memory failed-login throttling for the admin login endpoint. State resets on restart and is
// per-process, which is fine for a single instance. Failures are keyed by IP + login ID (so a remote
// attacker can't lock the real owner out) and by IP alone (so one IP can't spray many IDs).
const WINDOW_MS = 15 * 60_000;
const MAX_PER_ACCOUNT = 5;
const MAX_PER_IP = 30;
const failures = new Map();

function entry(key, now) {
  const current = failures.get(key);
  if (current && current.resetAt > now) return current;
  if (failures.size > 5000) for (const [mapKey, value] of failures) if (value.resetAt <= now) failures.delete(mapKey);
  const fresh = { count: 0, resetAt: now + WINDOW_MS };
  failures.set(key, fresh);
  return fresh;
}

const keysFor = (req) => {
  const ip = req.ip || 'unknown';
  const id = String(req.body?.adminId || '').toLowerCase().trim().slice(0, 100);
  return { account: `acct:${ip}|${id}`, ip: `ip:${ip}` };
};

export function adminLoginLimiter(req, res, next) {
  const now = Date.now();
  const keys = keysFor(req);
  const account = failures.get(keys.account);
  const ip = failures.get(keys.ip);
  const blockedUntil = Math.max(
    account && account.resetAt > now && account.count >= MAX_PER_ACCOUNT ? account.resetAt : 0,
    ip && ip.resetAt > now && ip.count >= MAX_PER_IP ? ip.resetAt : 0,
  );
  if (blockedUntil) {
    res.set('Retry-After', String(Math.ceil((blockedUntil - now) / 1000)));
    return res.status(429).json({ message: 'Too many failed sign-in attempts. Please try again in a few minutes.' });
  }
  return next();
}

export function recordAdminLoginFailure(req) {
  const now = Date.now();
  const keys = keysFor(req);
  entry(keys.account, now).count += 1;
  entry(keys.ip, now).count += 1;
}

export function clearAdminLoginFailures(req) {
  failures.delete(keysFor(req).account);
}

export function resetAdminLoginLimiter() {
  failures.clear();
}
