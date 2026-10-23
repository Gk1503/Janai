// Change Password (POST /auth/change-password). The endpoint already existed but had no test coverage;
// these pin down its behaviour so the new owner/staff UI can rely on it. The database is stubbed and the
// passwords here are throwaway fixtures hashed in-process — no real credentials, no network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { changePassword, updateProfile } from '../controllers/authController.js';
import User from '../models/User.js';
import authRouter from '../routes/authRoutes.js';
import { requireAuth, requireAuthAllowingPasswordChange } from '../middleware/auth.js';

const CURRENT = 'current-fixture-pw';
const NEXT = 'replacement-fixture-pw';

function run(handler, user, body = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler({ user, body }, res, (error) => resolve({ status: 500, error }));
  });
}

// A stand-in for the Mongoose document the controller loads with .select('+password'). `save` records
// what would have been persisted; the real pre-save hook does the hashing, so the controller is expected
// to hand over the new plaintext and let the model hash it.
function stubUser({ role = 'admin', mustChangePassword = false } = {}) {
  const state = { saved: false, password: null, mustChangePassword };
  const doc = {
    id: 'u1',
    _id: 'u1',
    role,
    get mustChangePassword() { return state.mustChangePassword; },
    set mustChangePassword(value) { state.mustChangePassword = value; },
    get password() { return state.password; },
    set password(value) { state.password = value; },
    async save() { state.saved = true; return this; },
    toSafeJSON() { return { _id: 'u1', role, mustChangePassword: state.mustChangePassword }; },
  };
  return { doc, state };
}

async function withStubbedUser(doc, fn) {
  const original = User.findById;
  User.findById = () => ({ select: async () => doc });
  try {
    return await fn();
  } finally {
    User.findById = original;
  }
}

describe('changePassword: route wiring', () => {
  it('stays reachable while a forced password change is pending (requireAuthAllowingPasswordChange, not requireAuth)', () => {
    const layer = authRouter.stack.find((entry) => entry.route?.path === '/change-password' && entry.route.methods.post);
    assert.ok(layer, 'POST /change-password must exist');
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.deepEqual(handlers, [requireAuthAllowingPasswordChange, changePassword]);
    assert.ok(!handlers.includes(requireAuth), 'requireAuth would lock out the forced first-login flow');
  });

  it('is authorised by session alone — no role or permission middleware, so owner and staff both reach it', () => {
    const layer = authRouter.stack.find((entry) => entry.route?.path === '/change-password' && entry.route.methods.post);
    assert.equal(layer.route.stack.length, 2, 'exactly one auth middleware plus the handler');
  });
});

describe('changePassword: successful change', () => {
  it('verifies the current password, stores the new one and clears mustChangePassword', async () => {
    const { doc, state } = stubUser({ mustChangePassword: true });
    state.password = await bcrypt.hash(CURRENT, 10);
    const result = await withStubbedUser(doc, () => run(changePassword, { id: 'u1', role: 'admin' }, {
      currentPassword: CURRENT, newPassword: NEXT, confirmPassword: NEXT,
    }));
    assert.equal(result.status, 200);
    assert.equal(result.body.message, 'Password updated.');
    assert.equal(state.saved, true, 'the change must be persisted');
    assert.equal(state.password, NEXT, 'the controller hands the plaintext to the model, whose pre-save hook hashes it');
    assert.equal(state.mustChangePassword, false, 'a forced change is satisfied by a successful change');
  });

  it('works the same for a staff account — unlike updateProfile, this is not owner-only', async () => {
    const { doc, state } = stubUser({ role: 'staff' });
    state.password = await bcrypt.hash(CURRENT, 10);
    const result = await withStubbedUser(doc, () => run(changePassword, { id: 'u1', role: 'staff' }, {
      currentPassword: CURRENT, newPassword: NEXT, confirmPassword: NEXT,
    }));
    assert.equal(result.status, 200);
    assert.equal(state.password, NEXT);

    // Guard the distinction the UI depends on: staff may change their password but still may not rename
    // themselves, which is existing behaviour this step must not alter.
    const profile = await run(updateProfile, { role: 'staff' }, { firstName: 'Renamed' });
    assert.equal(profile.status, 403);
  });

  it('never returns the password or its hash in the response', async () => {
    const { doc, state } = stubUser();
    state.password = await bcrypt.hash(CURRENT, 10);
    const result = await withStubbedUser(doc, () => run(changePassword, { id: 'u1', role: 'admin' }, {
      currentPassword: CURRENT, newPassword: NEXT, confirmPassword: NEXT,
    }));
    const serialised = JSON.stringify(result.body);
    assert.ok(!serialised.includes(NEXT), 'the new password must never be echoed back');
    assert.ok(!serialised.includes(CURRENT));
    assert.ok(!serialised.includes('$2b$'), 'no bcrypt hash may appear in the response');
    assert.ok(!('password' in (result.body.user || {})));
  });
});

describe('changePassword: rejections', () => {
  it('rejects an incorrect current password with 401 and saves nothing', async () => {
    const { doc, state } = stubUser();
    state.password = await bcrypt.hash(CURRENT, 10);
    const result = await withStubbedUser(doc, () => run(changePassword, { id: 'u1', role: 'admin' }, {
      currentPassword: 'not-the-current-one', newPassword: NEXT, confirmPassword: NEXT,
    }));
    assert.equal(result.status, 401);
    assert.match(result.body.message, /current password is incorrect/i);
    assert.equal(state.saved, false, 'a failed verification must never persist a change');
    assert.notEqual(state.password, NEXT);
  });

  it('rejects a confirmation mismatch with 400, before touching the database', async () => {
    const { doc, state } = stubUser();
    state.password = await bcrypt.hash(CURRENT, 10);
    let loaded = false;
    const original = User.findById;
    User.findById = () => { loaded = true; return { select: async () => doc }; };
    try {
      const result = await run(changePassword, { id: 'u1', role: 'admin' }, {
        currentPassword: CURRENT, newPassword: NEXT, confirmPassword: 'something-else',
      });
      assert.equal(result.status, 400);
      assert.match(result.body.message, /do not match/i);
      assert.equal(loaded, false, 'input validation runs before the account is loaded');
      assert.equal(state.saved, false);
    } finally {
      User.findById = original;
    }
  });

  it('rejects reusing the current password with 400', async () => {
    const { doc, state } = stubUser();
    state.password = await bcrypt.hash(CURRENT, 10);
    const result = await withStubbedUser(doc, () => run(changePassword, { id: 'u1', role: 'admin' }, {
      currentPassword: CURRENT, newPassword: CURRENT, confirmPassword: CURRENT,
    }));
    assert.equal(result.status, 400);
    assert.match(result.body.message, /different from your current one/i);
    assert.equal(state.saved, false);
  });

  it('enforces the existing 8-character minimum, and nothing stricter', async () => {
    const { doc } = stubUser();
    const short = 'abc1234'; // 7 characters
    const result = await withStubbedUser(doc, () => run(changePassword, { id: 'u1', role: 'admin' }, {
      currentPassword: CURRENT, newPassword: short, confirmPassword: short,
    }));
    assert.equal(result.status, 400);
    assert.match(result.body.message, /at least 8 characters/i);

    // Exactly 8 characters, with no complexity requirement, is accepted — the UI must not demand more.
    const { doc: doc2, state: state2 } = stubUser();
    state2.password = await bcrypt.hash(CURRENT, 10);
    const eight = 'abcdefgh';
    const accepted = await withStubbedUser(doc2, () => run(changePassword, { id: 'u1', role: 'admin' }, {
      currentPassword: CURRENT, newPassword: eight, confirmPassword: eight,
    }));
    assert.equal(accepted.status, 200);
    assert.equal(state2.password, eight);
  });

  it('rejects missing or non-string fields with 400', async () => {
    const { doc } = stubUser();
    const bodies = [
      {},
      { currentPassword: CURRENT },
      { newPassword: NEXT, confirmPassword: NEXT },
      { currentPassword: '', newPassword: NEXT, confirmPassword: NEXT },
      { currentPassword: CURRENT, newPassword: '', confirmPassword: '' },
      { currentPassword: 12345, newPassword: NEXT, confirmPassword: NEXT },
      { currentPassword: CURRENT, newPassword: { a: 1 }, confirmPassword: { a: 1 } },
    ];
    for (const body of bodies) {
      const result = await withStubbedUser(doc, () => run(changePassword, { id: 'u1', role: 'admin' }, body));
      assert.equal(result.status, 400, JSON.stringify(body));
    }
  });
});
