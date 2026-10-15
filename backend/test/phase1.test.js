import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { assertSecureConfig } from '../config/startupChecks.js';
import { adminLoginLimiter, recordAdminLoginFailure, resetAdminLoginLimiter } from '../utils/loginRateLimit.js';

const makeReq = (adminId = 'owner', ip = '1.1.1.1') => ({ ip, body: { adminId } });
function run(req) {
  const result = { next: false, status: null, headers: {} };
  const res = { set: (key, value) => { result.headers[key] = value; }, status(code) { result.status = code; return this; }, json() { return this; } };
  adminLoginLimiter(req, res, () => { result.next = true; });
  return result;
}

describe('admin login limiter', () => {
  afterEach(resetAdminLoginLimiter);

  it('allows attempts until the per-account failure limit, then blocks with Retry-After', () => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal(run(makeReq()).next, true);
      recordAdminLoginFailure(makeReq());
    }
    const blocked = run(makeReq());
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers['Retry-After']) > 0);
  });

  it('does not lock out the same login ID from a different IP', () => {
    for (let i = 0; i < 5; i += 1) recordAdminLoginFailure(makeReq('owner', '9.9.9.9'));
    assert.equal(run(makeReq('owner', '9.9.9.9')).status, 429);
    assert.equal(run(makeReq('owner', '2.2.2.2')).next, true);
  });

  it('blocks one IP spraying many login IDs', () => {
    for (let i = 0; i < 30; i += 1) recordAdminLoginFailure(makeReq(`user${i}`, '7.7.7.7'));
    assert.equal(run(makeReq('another', '7.7.7.7')).status, 429);
  });
});

describe('production configuration check', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('is skipped outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_PASSWORD = 'admin123';
    assert.doesNotThrow(assertSecureConfig);
  });

  it('rejects default or weak credentials in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'x'.repeat(40);
    process.env.ADMIN_PASSWORD = 'admin123';
    assert.throws(assertSecureConfig, /ADMIN_PASSWORD/);
    delete process.env.ADMIN_PASSWORD;
    assert.throws(assertSecureConfig, /ADMIN_PASSWORD/);
  });

  it('rejects a weak JWT secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short';
    process.env.ADMIN_PASSWORD = 'a-long-unique-passphrase';
    assert.throws(assertSecureConfig, /JWT_SECRET/);
  });

  it('accepts strong credentials in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'x'.repeat(40);
    process.env.ADMIN_PASSWORD = 'a-long-unique-passphrase';
    assert.doesNotThrow(assertSecureConfig);
  });
});
