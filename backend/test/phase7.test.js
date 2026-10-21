import 'dotenv/config';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resendDeliveryOtp, resendLoginOtp, sendDeliveryOtp, sendLoginOtp, verifyDeliveryOtp, verifyLoginOtp,
} from '../controllers/otpController.js';
import { createStaff, updateStaff, updateStaffPermissions } from '../controllers/staffController.js';
import { listDeliveryOrders, listMyDeliveryOrders, updateMyDeliveryOrderStatus } from '../controllers/deliveryController.js';
import { orderTypeCondition } from '../config/permissions.js';
import { maskOrder, maskOrderForAssignedRider } from '../utils/privacy.js';
import LoginOtp from '../models/LoginOtp.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import authRouter from '../routes/authRoutes.js';
import deliveryRouter from '../routes/deliveryRoutes.js';
import { requireAuthAllowingPasswordChange } from '../middleware/auth.js';

// ---------------------------------------------------------------------------
// Shared no-database test harness (mirrors the stubbed-model style already
// used in test/phase3.test.js and test/phase6.test.js).
// ---------------------------------------------------------------------------
function run(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler({ body: {}, params: {}, query: {}, ...req }, res, (error) => resolve({ status: 500, error }));
  });
}

function matchesFilter(user, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === 'phone' && cond && typeof cond === 'object' && Array.isArray(cond.$in)) return cond.$in.includes(user.phone);
    if (key === 'permissions' && typeof cond === 'string') return Array.isArray(user.permissions) && user.permissions.includes(cond);
    return user[key] === cond;
  });
}

// Stands in for a User collection: otpController's eligibility queries are exercised for real against
// this roster, rather than being told in advance who is "eligible" — so the test proves the actual
// role/isActive/permission filter, not just the handler's downstream behaviour.
function stubUserDatabase(users) {
  const original = User.findOne;
  User.findOne = (filter) => Promise.resolve(users.find((user) => matchesFilter(user, filter)) || null);
  return () => { User.findOne = original; };
}

function stubUserFindById(result) {
  const original = User.findById;
  User.findById = () => Promise.resolve(result);
  return () => { User.findById = original; };
}

function stubUserFindOne(result) {
  const original = User.findOne;
  User.findOne = () => Promise.resolve(result);
  return () => { User.findOne = original; };
}

function stubUserExists(predicate) {
  const original = User.exists;
  const calls = [];
  User.exists = (filter) => { calls.push(filter); return Promise.resolve(predicate(filter)); };
  return { calls, restore: () => { User.exists = original; } };
}

function stubLoginOtp({ findOneAndUpdate = () => null, findOne = () => null } = {}) {
  const originals = { findOneAndUpdate: LoginOtp.findOneAndUpdate, findOne: LoginOtp.findOne };
  const calls = { upserts: [], finds: [] };
  LoginOtp.findOneAndUpdate = (filter, update, options) => { calls.upserts.push({ filter, update, options }); return Promise.resolve(findOneAndUpdate(filter, update, options)); };
  LoginOtp.findOne = (filter) => { calls.finds.push(filter); return Promise.resolve(findOne(filter)); };
  return { calls, restore: () => Object.assign(LoginOtp, originals) };
}

function mockGatewaySend(otpId = 'gw-otp-1') {
  global.fetch = async () => ({ status: 202, json: async () => ({ otp_id: otpId }) });
}
function mockGatewayVerify(valid = true) {
  global.fetch = async () => ({ status: valid ? 200 : 400, json: async () => ({ valid }) });
}
function restoreFetch(original) { global.fetch = original; }

const future = new Date(Date.now() + 60_000);

const eligibleRider = {
  _id: 'd1', id: 'd1', role: 'staff', isActive: true, permissions: ['delivery:view', 'delivery:update'],
  firstName: 'Ravi', lastName: 'Rider', adminId: 'ravi.r', phone: '9876500001',
  toSafeJSON() { return { _id: this._id, role: this.role, firstName: this.firstName, lastName: this.lastName }; },
  save: async function save() { return this; },
};
const customerUser = {
  _id: 'c1', id: 'c1', role: 'customer', isActive: true, phone: '9876500010', permissions: [],
  toSafeJSON() { return { _id: this._id, role: this.role }; },
};
const ownerUser = { _id: 'o1', id: 'o1', role: 'admin', isActive: true, phone: '9876500011', permissions: [] };
const nonDeliveryStaff = { _id: 's1', id: 's1', role: 'staff', isActive: true, phone: '9876500012', permissions: ['orders:view'] };
const inactiveDeliveryStaff = { _id: 's2', id: 's2', role: 'staff', isActive: false, phone: '9876500013', permissions: ['delivery:view', 'delivery:update'] };

describe('delivery OTP: eligibility', () => {
  it('an eligible, active delivery staff member can request and verify a delivery OTP', async () => {
    const originalFetch = global.fetch;
    const restoreDb = stubUserDatabase([eligibleRider]);
    const restoreFindById = stubUserFindById(eligibleRider);
    const otp = stubLoginOtp({
      findOne: (filter) => (filter.purpose === 'delivery_login' ? { otpId: 'gw-otp-1', expiresAt: future, deleteOne: async () => {} } : null),
    });
    try {
      mockGatewaySend();
      const sent = await run(sendDeliveryOtp, { body: { mobile: eligibleRider.phone } });
      assert.equal(sent.status, 200);
      assert.equal(otp.calls.upserts[0].filter.purpose, 'delivery_login');

      mockGatewayVerify(true);
      const verified = await run(verifyDeliveryOtp, { body: { mobile: eligibleRider.phone, otp: '123456' } });
      assert.equal(verified.status, 200);
      assert.ok(verified.body.token);
      assert.equal(verified.body.user.role, 'staff');
    } finally {
      restoreDb(); restoreFindById(); otp.restore(); restoreFetch(originalFetch);
    }
  });

  it('customers, owners, non-delivery staff and inactive delivery staff all get the same generic rejection', async () => {
    const restoreDb = stubUserDatabase([customerUser, ownerUser, nonDeliveryStaff, inactiveDeliveryStaff, eligibleRider]);
    try {
      const messages = new Set();
      for (const ineligible of [customerUser, ownerUser, nonDeliveryStaff, inactiveDeliveryStaff]) {
        const result = await run(sendDeliveryOtp, { body: { mobile: ineligible.phone } });
        assert.equal(result.status, 404);
        messages.add(result.body.message);
      }
      assert.equal(messages.size, 1, 'every ineligible reason must produce the exact same message');
    } finally {
      restoreDb();
    }
  });

  it('a deactivated account cannot pass the final re-check even if it somehow got past the initial lookup', async () => {
    const originalFetch = global.fetch;
    const restoreDb = stubUserDatabase([eligibleRider]);
    const restoreFindById = stubUserFindById({ ...eligibleRider, isActive: false }); // deactivated between send and verify
    const otp = stubLoginOtp({ findOne: () => ({ otpId: 'gw-otp-1', expiresAt: future, deleteOne: async () => {} }) });
    try {
      mockGatewayVerify(true);
      const verified = await run(verifyDeliveryOtp, { body: { mobile: eligibleRider.phone, otp: '123456' } });
      assert.equal(verified.status, 403);
    } finally {
      restoreDb(); restoreFindById(); otp.restore(); restoreFetch(originalFetch);
    }
  });
});

describe('delivery OTP: purpose isolation', () => {
  it('verifyDeliveryOtp only ever reads the delivery_login OTP record for that mobile', async () => {
    const restoreDb = stubUserDatabase([{ ...eligibleRider, phone: '9876500002' }]);
    const otp = stubLoginOtp({ findOne: () => null }); // no record for either purpose: proves isolation at the query level
    try {
      const result = await run(verifyDeliveryOtp, { body: { mobile: '9876500002', otp: '123456' } });
      assert.equal(result.status, 401);
      assert.deepEqual(otp.calls.finds[0], { mobile: '9876500002', purpose: 'delivery_login' });
    } finally {
      restoreDb(); otp.restore();
    }
  });

  it('verifyLoginOtp only ever reads the customer_login OTP record for that mobile', async () => {
    const restoreDb = stubUserDatabase([{ ...customerUser, phone: '9876500003' }]);
    const otp = stubLoginOtp({ findOne: () => null });
    try {
      const result = await run(verifyLoginOtp, { body: { mobile: '9876500003', otp: '123456' } });
      assert.equal(result.status, 401);
      assert.deepEqual(otp.calls.finds[0], { mobile: '9876500003', purpose: 'customer_login' });
    } finally {
      restoreDb(); otp.restore();
    }
  });

  it('a pending customer-purpose OTP cannot verify a delivery login for the same mobile number, and vice versa', async () => {
    const originalFetch = global.fetch;
    const sharedMobile = '9876500004';
    const restoreDb = stubUserDatabase([
      { ...customerUser, phone: sharedMobile },
      { ...eligibleRider, phone: sharedMobile },
    ]);
    // Only a customer_login record exists; no delivery_login record was ever stored for this mobile.
    const otp = stubLoginOtp({ findOne: (filter) => (filter.purpose === 'customer_login' ? { otpId: 'A', expiresAt: future, deleteOne: async () => {} } : null) });
    try {
      mockGatewayVerify(true);
      const asDelivery = await run(verifyDeliveryOtp, { body: { mobile: sharedMobile, otp: '123456' } });
      assert.equal(asDelivery.status, 401, 'a customer OTP record must not verify a delivery login');
      const asCustomer = await run(verifyLoginOtp, { body: { mobile: sharedMobile, otp: '123456' } });
      assert.equal(asCustomer.status, 200, 'the genuine customer_login record still verifies the customer login');
    } finally {
      restoreDb(); otp.restore(); restoreFetch(originalFetch);
    }
  });

  it('declares OTP uniqueness as a compound (mobile, purpose) index, never mobile alone', () => {
    const indexes = LoginOtp.schema.indexes();
    const compound = indexes.find(([fields]) => fields.mobile === 1 && fields.purpose === 1);
    assert.ok(compound, 'expected a compound (mobile, purpose) index');
    assert.equal(compound[1].unique, true);
    const mobileAlone = indexes.find(([fields]) => fields.mobile === 1 && Object.keys(fields).length === 1);
    assert.equal(mobileAlone, undefined, 'mobile alone must no longer be declared unique');
  });
});

describe('delivery OTP: rate limiting scoped by purpose', () => {
  it('a send cooldown on one purpose does not block the other purpose for the same mobile number', async () => {
    const originalFetch = global.fetch;
    const sharedPhone = '9876511111';
    const restoreDb = stubUserDatabase([
      { ...customerUser, phone: sharedPhone },
      { ...eligibleRider, phone: sharedPhone },
    ]);
    const otp = stubLoginOtp();
    try {
      mockGatewaySend();
      const first = await run(sendLoginOtp, { body: { mobile: sharedPhone } });
      assert.equal(first.status, 200);
      const secondImmediately = await run(sendLoginOtp, { body: { mobile: sharedPhone } });
      assert.equal(secondImmediately.status, 429, 'the customer-purpose cooldown must apply to a second customer send');
      const deliveryAttempt = await run(sendDeliveryOtp, { body: { mobile: sharedPhone } });
      assert.equal(deliveryAttempt.status, 200, 'the delivery purpose must not be blocked by the customer cooldown for the same mobile number');
    } finally {
      restoreDb(); otp.restore(); restoreFetch(originalFetch);
    }
  });

  it('customer OTP send/resend behaviour is byte-identical to before (regression guard)', async () => {
    const originalFetch = global.fetch;
    const restoreDb = stubUserDatabase([{ ...customerUser, phone: '9876522222' }]);
    const otp = stubLoginOtp();
    try {
      mockGatewaySend();
      const sent = await run(sendLoginOtp, { body: { mobile: '9876522222' } });
      assert.equal(sent.status, 200);
      assert.equal(sent.body.message, 'OTP sent successfully.');
      const resend = await run(resendLoginOtp, { body: { mobile: '9876522222' } });
      assert.equal(resend.status, 429); // still inside the 30s cooldown, same as before this change
    } finally {
      restoreDb(); otp.restore(); restoreFetch(originalFetch);
    }
  });
});

describe('delivery staff phone validation (staffController)', () => {
  const oid = (n) => String(n).padStart(24, '0'); // a syntactically valid ObjectId-shaped string
  const TEMP_PASSWORD = 'Temppass123'; // 11 chars, letters+digits, satisfies validateTemporaryPassword

  function ownerReq(overrides) {
    return { user: { _id: oid(9), id: oid(9), role: 'admin' }, body: {}, params: {}, ...overrides };
  }

  it('rejects creating a delivery staff account with no phone number', async () => {
    const result = await run(createStaff, ownerReq({
      body: { fullName: 'No Phone', loginId: 'no.phone.rider', temporaryPassword: TEMP_PASSWORD, preset: 'delivery_staff' },
    }));
    assert.equal(result.status, 400);
    assert.match(result.body.message, /registered mobile number/i);
  });

  it('rejects creating a delivery staff account whose phone is already used by another delivery-eligible staff account, and checks inactive accounts too', async () => {
    const exists = stubUserExists((filter) => filter.permissions === 'delivery:view' && filter.phone === '9876500020');
    try {
      const result = await run(createStaff, ownerReq({
        body: { fullName: 'Second Rider', loginId: 'second.rider', temporaryPassword: TEMP_PASSWORD, preset: 'delivery_staff', phone: '9876500020' },
      }));
      assert.equal(result.status, 409);
      assert.match(result.body.message, /already registered to another delivery staff account/i);
      const phoneCheckFilter = exists.calls.find((filter) => filter.permissions === 'delivery:view');
      assert.ok(phoneCheckFilter, 'expected the delivery-phone conflict check to have run');
      assert.equal('isActive' in phoneCheckFilter, false, 'the conflict check must not exclude inactive accounts');
    } finally {
      exists.restore();
    }
  });

  it('still creates a staff account with no phone at all when it does not need delivery access (unchanged workflow)', async () => {
    const exists = stubUserExists(() => false);
    const originalCreate = User.create;
    let created = null;
    User.create = async (payload) => { created = payload; return { ...payload, _id: oid(8), toObject() { return { ...this }; } }; };
    try {
      const result = await run(createStaff, ownerReq({
        body: { fullName: 'Order Manager', loginId: 'order.manager.x', temporaryPassword: TEMP_PASSWORD, preset: 'order_manager' },
      }));
      assert.equal(result.status, 201);
      assert.equal(created.phone, undefined);
    } finally {
      User.create = originalCreate; exists.restore();
    }
  });

  it('rejects changing an existing delivery staff account to a phone number already used by another delivery-eligible account', async () => {
    const rider = { _id: oid(1), id: oid(1), role: 'staff', isActive: true, permissions: ['delivery:view', 'delivery:update'], phone: '9876500021', save: async function save() { return this; } };
    const restoreFindOne = stubUserFindOne(rider);
    const exists = stubUserExists((filter) => filter.permissions === 'delivery:view' && filter.phone === '9876500099');
    try {
      const result = await run(updateStaff, { params: { id: oid(1) }, body: { phone: '9876500099' } });
      assert.equal(result.status, 409);
    } finally {
      restoreFindOne(); exists.restore();
    }
  });

  it('rejects clearing the phone number on an account that still holds delivery:view', async () => {
    const rider = { _id: oid(2), id: oid(2), role: 'staff', isActive: true, permissions: ['delivery:view', 'delivery:update'], phone: '9876500022', save: async function save() { return this; } };
    const restoreFindOne = stubUserFindOne(rider);
    try {
      const result = await run(updateStaff, { params: { id: oid(2) }, body: { phone: '' } });
      assert.equal(result.status, 400);
    } finally {
      restoreFindOne();
    }
  });

  it('does not re-check phone uniqueness when an unrelated field is edited and phone is untouched', async () => {
    const rider = { _id: oid(3), id: oid(3), role: 'staff', isActive: true, permissions: ['delivery:view', 'delivery:update'], phone: '9876500023', save: async function save() { return this; } };
    const restoreFindOne = stubUserFindOne(rider);
    const exists = stubUserExists(() => { throw new Error('must not check uniqueness when phone is not part of the request'); });
    try {
      const result = await run(updateStaff, { params: { id: oid(3) }, body: { fullName: 'Renamed Rider' } });
      assert.equal(result.status, 200);
    } finally {
      restoreFindOne(); exists.restore();
    }
  });

  it('rejects granting delivery:view to a staff account that has no registered phone number', async () => {
    const staffNoPhone = { _id: oid(4), id: oid(4), role: 'staff', isActive: true, permissions: ['orders:view'], phone: undefined, save: async function save() { return this; } };
    const restoreFindOne = stubUserFindOne(staffNoPhone);
    try {
      const result = await run(updateStaffPermissions, { params: { id: oid(4) }, body: { permissions: ['delivery:view', 'delivery:update'] } });
      assert.equal(result.status, 400);
    } finally {
      restoreFindOne();
    }
  });

  it('rejects granting delivery:view when the existing phone already belongs to another delivery-eligible account', async () => {
    const staffWithPhone = { _id: oid(5), id: oid(5), role: 'staff', isActive: true, permissions: ['orders:view'], phone: '9876500024', save: async function save() { return this; } };
    const restoreFindOne = stubUserFindOne(staffWithPhone);
    const exists = stubUserExists((filter) => filter.permissions === 'delivery:view' && filter.phone === '9876500024');
    try {
      const result = await run(updateStaffPermissions, { params: { id: oid(5) }, body: { permissions: ['delivery:view', 'delivery:update'] } });
      assert.equal(result.status, 409);
    } finally {
      restoreFindOne(); exists.restore();
    }
  });
});

describe('rider order endpoints (deliveryController)', () => {
  const rider = { _id: 'rider1', id: 'rider1', role: 'staff', isActive: true, permissions: ['delivery:view', 'delivery:update'] };

  function stubOrderFind(result) {
    const calls = [];
    const original = Order.find;
    const query = () => { const q = { select: () => q, populate: () => q, sort: () => q, then: (a, b) => Promise.resolve(result).then(a, b) }; return q; };
    Order.find = (filter) => { calls.push(filter); return query(); };
    return { calls, restore: () => { Order.find = original; } };
  }

  it("lists only orders assigned to the authenticated rider, never anyone else's, regardless of query parameters", async () => {
    const stub = stubOrderFind([]);
    try {
      await run(listMyDeliveryOrders, { user: rider, query: { assignedDeliveryStaff: 'someone-else', orderStatus: 'anything' } });
      assert.equal(stub.calls[0].assignedDeliveryStaff, 'rider1');
      assert.deepEqual(stub.calls[0].orderType, orderTypeCondition(['normal', 'preorder']), 'bulk orders must stay structurally excluded');
    } finally {
      stub.restore();
    }
  });

  it('rejects an order status value outside the two delivery-stage transitions outright', async () => {
    const result = await run(updateMyDeliveryOrderStatus, { user: rider, params: { id: 'o1' }, body: { orderStatus: 'cancelled' } });
    assert.equal(result.status, 400);
  });

  it("cannot update another rider's order by id, even though the order genuinely exists", async () => {
    const calls = [];
    const original = Order.findOne;
    Order.findOne = (filter) => { calls.push(filter); return Promise.resolve(null); }; // not assigned to this rider: never matches
    try {
      const result = await run(updateMyDeliveryOrderStatus, { user: rider, params: { id: 'someone-elses-order' }, body: { orderStatus: 'out_for_delivery' } });
      assert.equal(result.status, 404);
      assert.equal(calls[0]._id, 'someone-elses-order');
      assert.equal(calls[0].assignedDeliveryStaff, 'rider1');
    } finally {
      Order.findOne = original;
    }
  });

  it('rejects advancing an order that is already delivered', async () => {
    const original = Order.findOne;
    Order.findOne = () => Promise.resolve({ id: 'o1', orderType: 'normal', orderStatus: 'delivered' });
    try {
      const result = await run(updateMyDeliveryOrderStatus, { user: rider, params: { id: 'o1' }, body: { orderStatus: 'delivered' } });
      assert.equal(result.status, 409);
    } finally {
      Order.findOne = original;
    }
  });

  it('never reads assignment fields from the request body (no self-(re)assignment possible)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../controllers/deliveryController.js', import.meta.url), 'utf8');
    const riderSection = source.slice(source.indexOf('listMyDeliveryOrders'));
    assert.ok(!riderSection.includes('req.body.staffId'));
    assert.ok(!riderSection.includes('req.body.assignedDeliveryStaff'));
  });
});

describe('route wiring', () => {
  it('the three delivery OTP routes are mounted on the correct purpose-scoped handlers', () => {
    const handlersFor = (path) => authRouter.stack.filter((layer) => layer.route?.path === path).flatMap((layer) => layer.route.stack.map((entry) => entry.handle));
    assert.ok(handlersFor('/send-delivery-otp').includes(sendDeliveryOtp));
    assert.ok(handlersFor('/verify-delivery-otp').includes(verifyDeliveryOtp));
    assert.ok(handlersFor('/resend-delivery-otp').includes(resendDeliveryOtp));
    // The existing customer routes are still wired to the customer handlers, unchanged.
    assert.ok(handlersFor('/send-login-otp').includes(sendLoginOtp));
    assert.ok(handlersFor('/verify-login-otp').includes(verifyLoginOtp));
  });

  it('rider routes sit behind requireAuthAllowingPasswordChange (so a deactivated account is rejected, same as every other authenticated route)', () => {
    const authIndex = deliveryRouter.stack.findIndex((layer) => layer.handle === requireAuthAllowingPasswordChange);
    const ordersIndex = deliveryRouter.stack.findIndex((layer) => layer.route?.path === '/my-orders' && layer.route.methods.get);
    const statusIndex = deliveryRouter.stack.findIndex((layer) => layer.route?.path === '/my-orders/:id/status' && layer.route.methods.patch);
    assert.ok(authIndex >= 0);
    assert.ok(authIndex < ordersIndex && authIndex < statusIndex, 'authentication must run before either rider route handler');
  });
});

describe('customer phone visibility for the assigned rider only', () => {
  const riderA = { _id: 'riderA', id: 'riderA', role: 'staff', isActive: true, permissions: ['delivery:view', 'delivery:update'] };
  const riderB = { _id: 'riderB', id: 'riderB', role: 'staff', isActive: true, permissions: ['delivery:view', 'delivery:update'] };
  const ownerViewer = { _id: 'owner1', id: 'owner1', role: 'admin', isActive: true, permissions: [] };

  function makeOrder(overrides = {}) {
    const base = {
      _id: 'orderA', orderType: 'normal', orderStatus: 'preparing',
      deliveryAddress: { recipient: 'Cust', phone: '9999900001', street: 'X', postalCode: '000001' },
      user: { _id: 'cust1', firstName: 'Cust', lastName: 'Omer', email: 'cust@example.com', phone: '9999900001' },
      assignedDeliveryStaff: { _id: 'riderA', firstName: 'Ravi', lastName: 'Rider', adminId: 'ravi.r' },
      totalAmount: 100,
      ...overrides,
    };
    return { ...base, toObject() { return { ...base }; } };
  }

  function stubOrderFind(result) {
    const original = Order.find;
    const query = () => { const q = { select: () => q, populate: () => q, sort: () => q, then: (a, b) => Promise.resolve(result).then(a, b) }; return q; };
    Order.find = () => query();
    return () => { Order.find = original; };
  }

  it("the assigned rider sees the real customer phone needed to deliver their own order", () => {
    const revealed = maskOrderForAssignedRider(makeOrder(), riderA);
    assert.equal(revealed.deliveryAddress.phone, '9999900001', 'the rider assigned to this order must see the real delivery-address phone');
    assert.equal(revealed.user.phone, '9999900001', 'the rider assigned to this order must see the real customer phone');
    assert.notEqual(revealed.user.email, 'cust@example.com', 'email stays masked — only phone is revealed');
  });

  it("the same helper keeps the phone masked for a rider the order is NOT assigned to", () => {
    const stillMasked = maskOrderForAssignedRider(makeOrder(), riderB);
    const plainlyMasked = maskOrder(makeOrder(), riderB);
    assert.deepEqual(stillMasked, plainlyMasked, 'an unassigned rider must get exactly what maskOrder would have produced');
    assert.notEqual(stillMasked.deliveryAddress.phone, '9999900001');
  });

  it('this exception is never reached through a client-supplied id — it re-checks assignment itself and ignores req.body/req.query entirely', async () => {
    const restore = stubOrderFind([makeOrder()]);
    try {
      // riderB requests the list; even if their own request forged query params, the DB filter (and,
      // belt-and-suspenders, maskOrderForAssignedRider's own recheck) both key off req.user only.
      const result = await run(listMyDeliveryOrders, { user: riderB, query: { staffId: 'riderA' } });
      assert.equal(result.status, 200);
      // riderB's query matched nothing for real (filtered to assignedDeliveryStaff: riderB in the real
      // DB); this stub simply proves that even if an order somehow reached the response path, the
      // masking helper itself would still refuse to reveal a phone number for a non-matching viewer.
      assert.equal(result.body.orders[0].deliveryAddress.phone === '9999900001', false);
    } finally {
      restore();
    }
  });

  it('listMyDeliveryOrders reveals the phone for orders genuinely assigned to the caller', async () => {
    const restore = stubOrderFind([makeOrder()]);
    try {
      const result = await run(listMyDeliveryOrders, { user: riderA });
      assert.equal(result.status, 200);
      assert.equal(result.body.orders[0].deliveryAddress.phone, '9999900001');
    } finally {
      restore();
    }
  });

  it('existing staff/customer contact masking on maskOrder itself is unchanged', () => {
    const masked = maskOrder(makeOrder(), riderB);
    assert.notEqual(masked.deliveryAddress.phone, '9999900001');
    assert.notEqual(masked.user.phone, '9999900001');
    const forOwner = maskOrder(makeOrder(), ownerViewer);
    assert.equal(forOwner.deliveryAddress.phone, '9999900001', 'the owner is never masked, unchanged');
  });

  it('existing admin delivery listing is unaffected: it still masks the phone for a delivery:view holder without customers:view_contact, regardless of assignment', async () => {
    const restore = stubOrderFind([makeOrder()]); // order IS assigned to riderA, but riderB is viewing the admin list
    try {
      const result = await run(listDeliveryOrders, { user: riderB });
      assert.equal(result.status, 200);
      assert.notEqual(result.body.orders[0].deliveryAddress.phone, '9999900001', 'the admin-panel listing must keep masking exactly as before this change');
    } finally {
      restore();
    }
  });

  it('the rider-only reveal is wired only into the two rider handlers, never into the admin handlers', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../controllers/deliveryController.js', import.meta.url), 'utf8');
    const adminSection = source.slice(source.indexOf('export const listDeliveryOrders'), source.indexOf('listMyDeliveryOrders'));
    assert.ok(!adminSection.includes('maskOrderForAssignedRider'), 'admin handlers (listDeliveryOrders, assignDeliveryOrder) must keep using plain maskOrder');
  });
});
