import 'dotenv/config';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { PERMISSION_LIST, ROLE_PRESETS, validatePermissionSet } from '../config/permissions.js';
import { register } from '../controllers/authController.js';
import { toStaffDTO } from '../controllers/staffController.js';
import { requireOwner } from '../middleware/auth.js';
import User from '../models/User.js';
import adminRouter from '../routes/adminRoutes.js';
import staffRouter from '../routes/staffRoutes.js';
import {
  normalizeLoginId, normalizeOptionalEmail, normalizeOptionalMobile, splitFullName, validateTemporaryPassword,
} from '../utils/staffValidation.js';

describe('staff input validation', () => {
  it('normalises and validates login IDs', () => {
    assert.equal(normalizeLoginId('  Order.Mgr_1 ').value, 'order.mgr_1');
    for (const bad of ['', 'ab', '-abc', 'has space', 'a'.repeat(31), 'bad/char', null, 42]) assert.ok(normalizeLoginId(bad).error, String(bad));
  });

  it('splits full names into the existing first/last fields', () => {
    assert.deepEqual(splitFullName('  Asha   Rao Kumar ').value, { firstName: 'Asha', lastName: 'Rao Kumar' });
    assert.deepEqual(splitFullName('Madonna').value, { firstName: 'Madonna', lastName: '' });
    assert.ok(splitFullName('').error);
    assert.ok(splitFullName('x'.repeat(130)).error);
  });

  it('enforces the temporary password policy', () => {
    assert.equal(validateTemporaryPassword('Temp-pass-42', 'sam').value, 'Temp-pass-42');
    for (const bad of ['short1', 'allletterslong', '1234567890123', '', null]) assert.ok(validateTemporaryPassword(bad, 'sam').error, String(bad));
    assert.ok(validateTemporaryPassword('Sam1234567', 'sam1234567').error); // equals login ID
  });

  it('treats empty email/mobile as not provided and never invents values', () => {
    assert.equal(normalizeOptionalEmail('').value, undefined);
    assert.equal(normalizeOptionalEmail(undefined).value, undefined);
    assert.equal(normalizeOptionalEmail(' A@B.com ').value, 'a@b.com');
    assert.ok(normalizeOptionalEmail('nope').error);
    assert.equal(normalizeOptionalMobile('').value, undefined);
    assert.equal(normalizeOptionalMobile('+91 98765 43210').value, '9876543210');
    assert.ok(normalizeOptionalMobile('12345').error);
  });
});

describe('permission set validation', () => {
  it('accepts catalog permissions that satisfy their prerequisites', () => {
    assert.equal(validatePermissionSet(['orders:view', 'orders:update_status', 'orders:cancel']).ok, true);
    assert.equal(validatePermissionSet([]).ok, true);
  });

  it('rejects unknown permissions, owner-style names and missing prerequisites', () => {
    const unknown = validatePermissionSet(['orders:view', 'staff:manage', 'admin']);
    assert.equal(unknown.ok, false);
    assert.deepEqual(unknown.unknown, ['staff:manage', 'admin']);
    const missing = validatePermissionSet(['orders:cancel']);
    assert.equal(missing.ok, false);
    assert.match(missing.error, /orders:view/);
    assert.equal(validatePermissionSet('orders:view').ok, false);
    assert.equal(validatePermissionSet([{ a: 1 }]).ok, false);
  });

  it('deduplicates', () => {
    assert.deepEqual(validatePermissionSet(['orders:view', 'orders:view']).permissions, ['orders:view']);
  });
});

describe('role presets match the specification exactly', () => {
  const expected = {
    order_manager: ['orders:view', 'orders:update_status', 'orders:cancel', 'customers:view_contact'],
    preorder_manager: ['preorders:view', 'preorders:update', 'customers:view_contact'],
    bulk_order_manager: ['bulk:view', 'bulk:update'],
    inventory_manager: ['products:view', 'inventory:update'],
    customer_support: ['orders:view', 'customers:view', 'customers:view_contact', 'contact:view'],
    delivery_staff: ['delivery:view', 'delivery:update'],
    custom: [],
  };

  it('has exactly these presets with these permissions', () => {
    assert.deepEqual(Object.keys(ROLE_PRESETS).sort(), Object.keys(expected).sort());
    for (const [key, permissions] of Object.entries(expected)) assert.deepEqual([...ROLE_PRESETS[key].permissions].sort(), [...permissions].sort(), key);
  });

  it('every preset passes strict validation and uses only catalog names', () => {
    for (const preset of Object.values(ROLE_PRESETS)) {
      assert.equal(validatePermissionSet(preset.permissions).ok, true);
      assert.ok(preset.permissions.every((permission) => PERMISSION_LIST.includes(permission)));
    }
  });
});

describe('staff responses and schema', () => {
  it('the safe DTO contains no password hash or authentication fields', () => {
    const dto = toStaffDTO({
      _id: 'a1', firstName: 'Sam', lastName: 'Staff', adminId: 'sam', password: '$2b$12$hash', role: 'staff', staffRole: 'order_manager',
      permissions: ['orders:view', 'bogus'], isActive: true, mustChangePassword: true, createdAt: new Date(), createdBy: { _id: 'o1', firstName: 'Janai', lastName: 'Admin' },
      __v: 0, addresses: [{ street: 'x' }], toObject() { return { ...this }; },
    });
    assert.deepEqual(Object.keys(dto).sort(), ['_id', 'createdAt', 'createdBy', 'email', 'fullName', 'isActive', 'lastLoginAt', 'loginId', 'mustChangePassword', 'permissions', 'phone', 'preset']);
    assert.ok(!JSON.stringify(dto).includes('$2b$'));
    assert.deepEqual(dto.permissions, ['orders:view']);
    assert.deepEqual(dto.preset, { key: 'order_manager', label: 'Order Manager' });
    assert.equal(dto.createdBy.name, 'Janai Admin');
  });

  it('staff documents validate without email, phone or last name', () => {
    const staff = new User({ firstName: 'Sam', adminId: 'sam', password: 'x', role: 'staff' });
    assert.equal(staff.validateSync(), undefined);
    assert.equal('email' in staff.toObject(), false);
  });

  it('customers require phone and last name but NOT email (mobile OTP is their sign-in method)', () => {
    const noEmail = new User({ firstName: 'C', lastName: 'U', phone: '9876543210', password: 'x' });
    assert.equal(noEmail.validateSync(), undefined);
    assert.equal('email' in noEmail.toObject(), false);
    const incomplete = new User({ firstName: 'C', password: 'x' });
    const errors = incomplete.validateSync().errors;
    assert.ok(!errors.email, 'email must not be required for a customer');
    assert.ok(errors.phone && errors.lastName);
  });

  it('the owner account still requires an email', () => {
    const owner = new User({ firstName: 'Owner', lastName: 'Admin', phone: '9876543210', adminId: 'admin', password: 'x', role: 'admin' });
    const errors = owner.validateSync().errors;
    assert.ok(errors.email);
  });

  it('declares email uniqueness as a partial index (only where an email exists)', () => {
    const index = User.schema.indexes().find(([fields]) => fields.email === 1 && Object.keys(fields).length === 1);
    assert.ok(index);
    assert.equal(index[1].unique, true);
    assert.deepEqual(index[1].partialFilterExpression, { email: { $type: 'string' } });
  });

  it('staff endpoints are mounted once, behind requireOwner', () => {
    const layers = adminRouter.stack.filter((layer) => layer.handle === requireOwner || layer.handle === staffRouter);
    const ownerIndex = adminRouter.stack.findIndex((layer) => layer.handle === requireOwner && layer.matchers?.[0]?.('/staff'));
    const staffIndex = adminRouter.stack.findIndex((layer) => layer.handle === staffRouter);
    assert.ok(ownerIndex >= 0 && staffIndex > ownerIndex, 'requireOwner must precede the staff router');
    assert.equal(layers.filter((layer) => layer.handle === staffRouter).length, 1);
    assert.deepEqual(staffRouter.stack.map((layer) => Object.keys(layer.route.methods)[0] + ' ' + layer.route.path), [
      'get /', 'post /', 'get /:id', 'patch /:id', 'patch /:id/permissions', 'patch /:id/status', 'post /:id/reset-password',
    ]);
  });
});

// ---- customer registration: email optional (handler-level, stubbed model methods, no database) ----
function run(handler, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler({ body }, res, (error) => resolve({ status: 500, error }));
  });
}

const validBody = (overrides = {}) => ({ firstName: 'A', lastName: 'B', phone: '9876543210', password: 'longenough1', confirmPassword: 'longenough1', ...overrides });

describe('customer registration (email optional)', () => {
  const originals = { exists: User.exists, create: User.create };
  let createdPayload = null;

  afterEach(() => Object.assign(User, originals));

  function stub({ exists = false } = {}) {
    createdPayload = null;
    User.exists = async () => exists;
    User.create = async (payload) => {
      createdPayload = payload;
      return { id: 'new-user-1', toSafeJSON: () => ({ _id: 'new-user-1', ...payload, password: undefined }) };
    };
  }

  it('registers successfully with no email at all, and never stores an empty-string email', async () => {
    stub();
    const result = await run(register, validBody());
    assert.equal(result.status, 201);
    assert.ok(!('email' in createdPayload), 'email key must be omitted from the create payload, not sent as an empty string');
    assert.equal(result.body.user.email, undefined);
    assert.ok(result.body.token);
  });

  it('still registers successfully with a valid email, unchanged from before', async () => {
    stub();
    const result = await run(register, validBody({ email: ' A.User@Example.com ' }));
    assert.equal(result.status, 201);
    // The controller trims and passes the email through to User.create() as before; lowercasing is the
    // schema's job (email: { lowercase: true }), which this stub bypasses, so it isn't re-asserted here.
    assert.equal(createdPayload.email, 'A.User@Example.com');
  });

  it('rejects an invalid email format without ever touching the database', async () => {
    stub();
    const result = await run(register, validBody({ email: 'not-an-email' }));
    assert.equal(result.status, 400);
    assert.equal(createdPayload, null);
  });

  it('rejects a duplicate email with 409, but skips the uniqueness check entirely when no email is given', async () => {
    stub({ exists: true });
    const withEmail = await run(register, validBody({ email: 'taken@example.com' }));
    assert.equal(withEmail.status, 409);
    const withoutEmail = await run(register, validBody());
    assert.equal(withoutEmail.status, 201); // User.exists stubbed to true is irrelevant with no email to check
  });

  it('still requires first name, last name, phone and password (email is the only field that became optional)', async () => {
    stub();
    for (const missing of ['firstName', 'lastName', 'phone', 'password']) {
      const body = validBody();
      delete body[missing];
      const result = await run(register, body);
      assert.equal(result.status, 400, `missing ${missing} should still 400`);
    }
    assert.equal(createdPayload, null);
  });

  it('still enforces minimum password length and matching confirmation, unchanged', async () => {
    stub();
    const short = await run(register, validBody({ password: 'short', confirmPassword: 'short' }));
    assert.equal(short.status, 400);
    const mismatch = await run(register, validBody({ confirmPassword: 'different1' }));
    assert.equal(mismatch.status, 400);
    assert.equal(createdPayload, null);
  });

  it('duplicate mobile numbers are not restricted by this change (pre-existing, unchanged behaviour)', async () => {
    stub();
    const first = await run(register, validBody({ phone: '9876500000' }));
    const second = await run(register, validBody({ phone: '9876500000' }));
    assert.equal(first.status, 201);
    assert.equal(second.status, 201); // register() has never checked phone uniqueness; this test pins that down
  });
});
