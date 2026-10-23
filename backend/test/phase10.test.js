// Customer SMS order notifications. Every test here mocks the gateway (global fetch) and the database
// (stubbed model methods) — no real SMS is ever sent and no SMS server needs to be running.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { isSmsGatewayConfigured, MAX_SMS_BODY_LENGTH, queueSms } from '../utils/smsGateway.js';
import {
  __flushOrderNotificationsForTests, buildMessage, dispatchStatusNotification, loadNotificationSettings,
  notifyOrderEvent, orderReference, pendingNotificationCount, resolveRecipient, toE164India,
} from '../utils/orderNotifications.js';
import { NOTIFICATION_SETTING_KEYS, normalizeNotificationSettings } from '../utils/settingsValidation.js';
import { getNotificationSettings, updateNotificationSettings } from '../controllers/settingsController.js';
import { cancelPreOrder, createOrder, updateOrderStatus } from '../controllers/orderController.js';
import { updateMyDeliveryOrderStatus } from '../controllers/deliveryController.js';
import Settings from '../models/Settings.js';
import User from '../models/User.js';
import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import settingsRouter from '../routes/settingsRoutes.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';

/* ------------------------------------------------------------------ */
/* Harness: a fake gateway + stubbed settings, restored after each test */
/* ------------------------------------------------------------------ */
const ALL_ON = { enabled: true, orderPlaced: true, outForDelivery: true, delivered: true, orderCancelled: true };
const restores = [];
afterEach(async () => {
  await __flushOrderNotificationsForTests();
  while (restores.length) restores.pop()();
});

function stubEnv(values) {
  const original = {};
  for (const [key, value] of Object.entries(values)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  restores.push(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// Records every gateway call so tests can assert on what was (or was not) sent, without a network.
function stubGateway(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options?.body || '{}') });
    return handler(calls.length);
  };
  restores.push(() => { globalThis.fetch = original; });
  stubEnv({ SMS_GATEWAY_URL: 'http://gateway.test', SMS_GATEWAY_KEY: 'sg_test_key' });
  return calls;
}

const queuedResponse = (id = 'msg-1') => ({
  status: 202,
  json: async () => ({ id, status: 'pending', address: '+919876543210', body: 'ignored' }),
});

function stubNotificationSettings(notifications) {
  const original = Settings.findOne;
  Settings.findOne = () => ({ lean: async () => ({ notifications }) });
  restores.push(() => { Settings.findOne = original; });
}

const orderFixture = (overrides = {}) => ({
  _id: '0123456789abcdef01a2b3c4',
  orderType: 'normal',
  orderStatus: 'placed',
  deliveryAddress: { recipient: 'Asha', phone: '9876543210', street: 'MG Road', postalCode: '411001' },
  user: { _id: 'cust1', phone: '9811111111' },
  deliveryDate: new Date('2026-11-02T00:00:00Z'),
  ...overrides,
});

/* ------------------------------------------------------------------ */
/* SMS client (utils/smsGateway.js)                                    */
/* ------------------------------------------------------------------ */
describe('smsGateway: general /v1/messages client', () => {
  it('reports missing configuration instead of attempting a request', async () => {
    stubEnv({ SMS_GATEWAY_URL: undefined, SMS_GATEWAY_KEY: undefined });
    assert.equal(isSmsGatewayConfigured(), false);
    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = async () => { called = true; };
    restores.push(() => { globalThis.fetch = original; });
    const result = await queueSms({ to: '+919876543210', body: 'hi' });
    assert.deepEqual(result, { queued: false, reason: 'gateway_not_configured' });
    assert.equal(called, false, 'must not call the gateway when it is not configured');
  });

  it('posts to /v1/messages with the api-key header and the documented payload shape', async () => {
    const calls = stubGateway(() => queuedResponse('msg-abc'));
    const result = await queueSms({ to: '+919876543210', body: 'Janai: test' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://gateway.test/v1/messages');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['x-api-key'], 'sg_test_key');
    assert.deepEqual(calls[0].body, { to: '+919876543210', body: 'Janai: test' });
    // 202 means QUEUED for the paired Android phone — never proof of delivery.
    assert.deepEqual(result, { queued: true, messageId: 'msg-abc', status: 202 });
  });

  it('never calls the OTP endpoints', async () => {
    const calls = stubGateway(() => queuedResponse());
    await queueSms({ to: '+919876543210', body: 'Janai: test' });
    for (const call of calls) assert.ok(!call.url.includes('/otp/'), `must not touch an OTP endpoint: ${call.url}`);
  });

  it('handles a rate limit, a gateway error, an unreachable gateway and a timeout safely', async () => {
    const cases = [
      [() => ({ status: 429, json: async () => ({ error: 'rate limit exceeded' }) }), 'rate_limited', 429],
      [() => ({ status: 409, json: async () => ({ error: 'no device registered' }) }), 'gateway_error', 409],
      [() => ({ status: 401, json: async () => ({ error: 'invalid api key' }) }), 'gateway_error', 401],
      [() => { throw new Error('ECONNREFUSED'); }, 'gateway_unreachable', undefined],
      [() => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); }, 'gateway_timeout', undefined],
    ];
    for (const [handler, reason, status] of cases) {
      stubGateway(handler);
      const result = await queueSms({ to: '+919876543210', body: 'Janai: test' });
      assert.equal(result.queued, false, reason);
      assert.equal(result.reason, reason);
      assert.equal(result.status, status);
      restores.pop()();
      restores.pop()();
    }
  });

  it('treats a malformed 202 body as not queued rather than inventing a message id', async () => {
    stubGateway(() => ({ status: 202, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
    const result = await queueSms({ to: '+919876543210', body: 'Janai: test' });
    assert.deepEqual(result, { queued: false, reason: 'malformed_gateway_response', status: 202 });
  });

  it('refuses a body longer than the gateway accepts, and an empty one', async () => {
    const calls = stubGateway(() => queuedResponse());
    assert.equal((await queueSms({ to: '+919876543210', body: 'x'.repeat(MAX_SMS_BODY_LENGTH + 1) })).reason, 'body_too_long');
    assert.equal((await queueSms({ to: '+919876543210', body: '   ' })).reason, 'empty_body');
    assert.equal((await queueSms({ to: '', body: 'hi' })).reason, 'no_recipient');
    assert.equal(calls.length, 0, 'nothing invalid should ever reach the gateway');
  });
});

/* ------------------------------------------------------------------ */
/* Recipient resolution and templates                                  */
/* ------------------------------------------------------------------ */
describe('recipient resolution', () => {
  it('normalises the Indian formats actually stored in this app to E.164', () => {
    for (const input of ['9876543210', '+919876543210', '919876543210', '+91 98765 43210', '98765-43210']) {
      assert.equal(toE164India(input), '+919876543210', input);
    }
  });

  it('refuses anything it cannot validate instead of guessing missing digits', () => {
    for (const bad of ['', '   ', '12345', '1234567890', '98765', '+1 415 555 0123', 'not a phone', null, undefined, {}]) {
      assert.equal(toE164India(bad), null, JSON.stringify(bad));
    }
  });

  it('prefers the delivery address phone', async () => {
    const result = await resolveRecipient(orderFixture());
    assert.deepEqual(result, { phone: '+919876543210', source: 'deliveryAddress' });
  });

  it('falls back to the account phone when the delivery phone is missing', async () => {
    const order = orderFixture({ deliveryAddress: { phone: '' } });
    assert.deepEqual(await resolveRecipient(order), { phone: '+919811111111', source: 'account' });
  });

  it('falls back to the account phone when the delivery phone is invalid, never a "corrected" guess', async () => {
    const order = orderFixture({ deliveryAddress: { phone: '12345' } });
    assert.deepEqual(await resolveRecipient(order), { phone: '+919811111111', source: 'account' });
  });

  it('looks the account phone up when order.user is still just an id (straight after Order.create)', async () => {
    const original = User.findById;
    User.findById = () => ({ select: () => ({ lean: async () => ({ phone: '+91 98222 22222' }) }) });
    restores.push(() => { User.findById = original; });
    const order = orderFixture({ deliveryAddress: { phone: '' }, user: 'cust1' });
    assert.deepEqual(await resolveRecipient(order), { phone: '+919822222222', source: 'account' });
  });

  it('looks the account phone up when order.user is an unpopulated ObjectId, which is also typeof "object"', async () => {
    // Regression guard: Order.create and cancelPreOrder both leave order.user as an ObjectId, so a
    // naive `typeof user === 'object'` check would treat it as a loaded document and never fall back.
    const objectIdLike = { _id: 'cust1', toString: () => 'cust1' };
    assert.equal(typeof objectIdLike, 'object');
    assert.ok(!('phone' in objectIdLike));
    let lookedUp = null;
    const original = User.findById;
    User.findById = (id) => { lookedUp = id; return { select: () => ({ lean: async () => ({ phone: '9833333333' }) }) }; };
    restores.push(() => { User.findById = original; });
    const order = orderFixture({ deliveryAddress: { phone: '' }, user: objectIdLike });
    assert.deepEqual(await resolveRecipient(order), { phone: '+919833333333', source: 'account' });
    assert.equal(lookedUp, 'cust1', 'the account must actually be looked up by its id');
  });

  it('falls back to a lookup when a populated account carries an unusable phone', async () => {
    const original = User.findById;
    User.findById = () => ({ select: () => ({ lean: async () => ({ phone: '9844444444' }) }) });
    restores.push(() => { User.findById = original; });
    const order = orderFixture({ deliveryAddress: { phone: '' }, user: { _id: 'cust1', phone: '' } });
    assert.deepEqual(await resolveRecipient(order), { phone: '+919844444444', source: 'account' });
  });

  it('survives a failed account lookup without throwing', async () => {
    const original = User.findById;
    User.findById = () => ({ select: () => ({ lean: async () => { throw new Error('db down'); } }) });
    restores.push(() => { User.findById = original; });
    const order = orderFixture({ deliveryAddress: { phone: '' }, user: { _id: 'cust1' } });
    assert.deepEqual(await resolveRecipient(order), { phone: null, source: null });
  });

  it('resolves to nothing when neither number is valid', async () => {
    const order = orderFixture({ deliveryAddress: { phone: 'nope' }, user: { phone: '' } });
    assert.deepEqual(await resolveRecipient(order), { phone: null, source: null });
  });
});

describe('message templates', () => {
  it('uses the same 8-character order reference the app already shows customers', () => {
    assert.equal(orderReference(orderFixture()), '01A2B3C4');
  });

  it('builds a message per event, with no address, name, totals or payment details', () => {
    const order = orderFixture();
    const expectations = {
      orderPlaced: /placed successfully/,
      outForDelivery: /out for delivery/,
      delivered: /marked delivered/,
      orderCancelled: /cancelled/,
    };
    for (const [event, pattern] of Object.entries(expectations)) {
      const body = buildMessage(order, event);
      assert.match(body, /^Janai: /, event);
      assert.match(body, /01A2B3C4/, event);
      assert.match(body, pattern, event);
      assert.ok(body.length <= MAX_SMS_BODY_LENGTH);
      for (const leak of ['MG Road', '411001', 'Asha', '9876543210']) {
        assert.ok(!body.includes(leak), `${event} must not include ${leak}`);
      }
    }
  });

  it('tells a pre-order customer it is a pre-order, with the scheduled date when valid', () => {
    const body = buildMessage(orderFixture({ orderType: 'preorder' }), 'orderPlaced');
    assert.match(body, /pre-order/i);
    assert.match(body, /2 Nov 2026/);
  });

  it('omits an invalid or missing scheduled date rather than printing a broken one', () => {
    for (const deliveryDate of [undefined, null, 'not-a-date']) {
      const body = buildMessage(orderFixture({ orderType: 'preorder', deliveryDate }), 'orderPlaced');
      assert.match(body, /pre-order/i);
      assert.ok(!/Invalid Date|NaN|undefined|null/.test(body), String(deliveryDate));
    }
  });

  it('returns nothing for an unknown event or an order with no id', () => {
    assert.equal(buildMessage(orderFixture(), 'somethingElse'), null);
    assert.equal(buildMessage({ ...orderFixture(), _id: undefined }, 'orderPlaced'), null);
  });
});

/* ------------------------------------------------------------------ */
/* Settings gating                                                     */
/* ------------------------------------------------------------------ */
describe('notification settings gating', () => {
  it('is disabled by default: a never-configured store reads every switch as off', () => {
    const doc = new Settings({});
    for (const key of NOTIFICATION_SETTING_KEYS) assert.equal(doc.notifications[key], false, key);
  });

  it('reads an existing document that predates this category as all-off', async () => {
    stubNotificationSettings(undefined);
    assert.deepEqual(await loadNotificationSettings(), { enabled: false, orderPlaced: false, outForDelivery: false, delivered: false, orderCancelled: false });
  });

  it('fails closed when the settings read throws — no SMS on a database problem', async () => {
    const original = Settings.findOne;
    Settings.findOne = () => ({ lean: async () => { throw new Error('db down'); } });
    restores.push(() => { Settings.findOne = original; });
    const settings = await loadNotificationSettings();
    assert.equal(settings.enabled, false);

    const calls = stubGateway(() => queuedResponse());
    const result = await notifyOrderEvent(orderFixture(), 'orderPlaced');
    assert.equal(result.reason, 'notifications_disabled');
    assert.equal(calls.length, 0);
  });

  it('sends nothing at all while the master switch is off, even with every event switch on', async () => {
    stubNotificationSettings({ ...ALL_ON, enabled: false });
    const calls = stubGateway(() => queuedResponse());
    for (const event of ['orderPlaced', 'outForDelivery', 'delivered', 'orderCancelled']) {
      const result = await notifyOrderEvent(orderFixture(), event);
      assert.equal(result.reason, 'notifications_disabled', event);
    }
    assert.equal(calls.length, 0);
  });

  it('sends only the events whose own switch is on', async () => {
    stubNotificationSettings({ enabled: true, orderPlaced: true, outForDelivery: false, delivered: false, orderCancelled: false });
    const calls = stubGateway(() => queuedResponse());
    assert.equal((await notifyOrderEvent(orderFixture(), 'orderPlaced')).queued, true);
    for (const event of ['outForDelivery', 'delivered', 'orderCancelled']) {
      assert.equal((await notifyOrderEvent(orderFixture(), event)).reason, 'event_disabled', event);
    }
    assert.equal(calls.length, 1, 'only the enabled event should reach the gateway');
  });

  it('skips safely, without sending, when no valid recipient exists', async () => {
    stubNotificationSettings(ALL_ON);
    const calls = stubGateway(() => queuedResponse());
    const order = orderFixture({ deliveryAddress: { phone: 'nope' }, user: { phone: '' } });
    assert.equal((await notifyOrderEvent(order, 'orderPlaced')).reason, 'no_valid_recipient');
    assert.equal(calls.length, 0);
  });

  it('skips safely when the gateway is not configured', async () => {
    stubNotificationSettings(ALL_ON);
    stubEnv({ SMS_GATEWAY_URL: undefined, SMS_GATEWAY_KEY: undefined });
    assert.equal((await notifyOrderEvent(orderFixture(), 'orderPlaced')).reason, 'gateway_not_configured');
  });

  it('never sends for a bulk order type (out of scope in this version)', async () => {
    stubNotificationSettings(ALL_ON);
    const calls = stubGateway(() => queuedResponse());
    assert.equal((await notifyOrderEvent(orderFixture({ orderType: 'bulk' }), 'orderPlaced')).reason, 'unsupported_order_type');
    assert.equal(calls.length, 0);
  });

  it('reports a queued message as queued, never as delivered', async () => {
    stubNotificationSettings(ALL_ON);
    stubGateway(() => queuedResponse('msg-7'));
    const result = await notifyOrderEvent(orderFixture(), 'orderPlaced');
    assert.deepEqual(result, { queued: true, messageId: 'msg-7', status: 202, event: 'orderPlaced', source: 'deliveryAddress' });
    assert.ok(!('delivered' in result) && !('sent' in result), 'the result must not claim delivery');
  });

  it('never rejects, whatever the gateway does', async () => {
    stubNotificationSettings(ALL_ON);
    stubGateway(() => { throw new Error('boom'); });
    const result = await notifyOrderEvent(orderFixture(), 'delivered');
    assert.equal(result.queued, false);
  });
});

/* ------------------------------------------------------------------ */
/* Settings API: owner-only                                            */
/* ------------------------------------------------------------------ */
describe('notification settings validation', () => {
  it('normalises anything missing or non-boolean to false, so a partial body can only turn SMS off', () => {
    assert.deepEqual(normalizeNotificationSettings(undefined).value, { enabled: false, orderPlaced: false, outForDelivery: false, delivered: false, orderCancelled: false });
    assert.deepEqual(normalizeNotificationSettings({ enabled: true }).value, { enabled: true, orderPlaced: false, outForDelivery: false, delivered: false, orderCancelled: false });
  });

  it('rejects a non-boolean switch and a non-object body', () => {
    assert.ok(normalizeNotificationSettings({ enabled: 'yes' }).error);
    assert.ok(normalizeNotificationSettings({ orderPlaced: 1 }).error);
    assert.ok(normalizeNotificationSettings('nope').error);
  });
});

describe('notification settings routes: only the owner may read or write', () => {
  it('GET /notifications requires authentication AND ownership — it is never public', () => {
    const layer = settingsRouter.stack.find((entry) => entry.route?.path === '/notifications' && entry.route.methods.get);
    assert.ok(layer, 'GET /notifications must exist');
    assert.deepEqual(layer.route.stack.map((entry) => entry.handle), [requireAuth, requireOwner, getNotificationSettings]);
  });

  it('PATCH /notifications requires authentication AND ownership, in that order', () => {
    const layer = settingsRouter.stack.find((entry) => entry.route?.path === '/notifications' && entry.route.methods.patch);
    assert.ok(layer, 'PATCH /notifications must exist');
    assert.deepEqual(layer.route.stack.map((entry) => entry.handle), [requireAuth, requireOwner, updateNotificationSettings]);
  });

  it('requireOwner rejects regular staff, delivery-only staff and customers', () => {
    const rejected = [];
    const res = { status(code) { this.code = code; return this; }, json(payload) { rejected.push({ code: this.code, payload }); return this; } };
    for (const user of [
      { role: 'staff', permissions: ['orders:view'] },
      { role: 'staff', permissions: ['delivery:view', 'delivery:update'] },
      { role: 'customer' },
      undefined,
    ]) {
      let passed = false;
      requireOwner({ user }, res, () => { passed = true; });
      assert.equal(passed, false, `${JSON.stringify(user)} must not reach the handler`);
    }
    assert.equal(rejected.length, 4);
    for (const entry of rejected) assert.equal(entry.code, 403);
  });

  it('the public general and orders-delivery responses never carry notification settings or gateway config', async () => {
    const original = Settings.findOneAndUpdate;
    Settings.findOneAndUpdate = async () => ({
      general: { businessName: 'Janai', logo: '', phone: '', email: '', address: {}, operatingHours: {} },
      orderSettings: { deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 },
      notifications: { ...ALL_ON },
      updatedAt: new Date(),
    });
    restores.push(() => { Settings.findOneAndUpdate = original; });
    const { getGeneralSettings, getOrderSettings } = await import('../controllers/settingsController.js');
    for (const handler of [getGeneralSettings, getOrderSettings]) {
      const result = await run(handler, { role: 'customer' });
      const keys = Object.keys(result.body.settings);
      for (const leaked of [...NOTIFICATION_SETTING_KEYS, 'notifications', 'SMS_GATEWAY_URL', 'SMS_GATEWAY_KEY']) {
        assert.ok(!keys.includes(leaked), `public settings response must not expose ${leaked}`);
      }
    }
  });
});

function run(handler, user, body = {}, extra = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler({ user, body, ...extra }, res, (error) => resolve({ status: 500, error }));
  });
}

const owner = { _id: 'owner1', id: 'owner1', role: 'admin' };

describe('getNotificationSettings / updateNotificationSettings (stubbed model)', () => {
  it('reads back all-off for a never-configured store', async () => {
    const original = Settings.findOneAndUpdate;
    Settings.findOneAndUpdate = async () => ({ notifications: {}, updatedAt: new Date() });
    restores.push(() => { Settings.findOneAndUpdate = original; });
    const result = await run(getNotificationSettings, owner);
    assert.equal(result.status, 200);
    for (const key of NOTIFICATION_SETTING_KEYS) assert.equal(result.body.settings[key], false, key);
  });

  it('the owner can save switches, which round-trip exactly, into the single canonical document', async () => {
    const original = Settings.findOneAndUpdate;
    let writtenFilter = null;
    let writtenUpdate = null;
    Settings.findOneAndUpdate = async (filter, update) => {
      writtenFilter = filter;
      writtenUpdate = update;
      return { notifications: update.$set.notifications, updatedAt: new Date() };
    };
    restores.push(() => { Settings.findOneAndUpdate = original; });
    const result = await run(updateNotificationSettings, owner, { enabled: true, orderPlaced: true, delivered: true });
    assert.equal(result.status, 200);
    assert.deepEqual(writtenFilter, {}, 'must write the single canonical document, never a caller-supplied id');
    assert.equal(writtenUpdate.$set.updatedBy, owner._id);
    assert.deepEqual(result.body.settings.enabled, true);
    assert.deepEqual(result.body.settings.orderPlaced, true);
    assert.deepEqual(result.body.settings.outForDelivery, false);
    assert.equal(result.body.message, 'Settings saved.');
  });

  it('rejects an unsupported field outright, never touching the database (no mass assignment)', async () => {
    const original = Settings.findOneAndUpdate;
    let called = false;
    Settings.findOneAndUpdate = async () => { called = true; };
    restores.push(() => { Settings.findOneAndUpdate = original; });
    const result = await run(updateNotificationSettings, owner, { enabled: true, deliveryFee: 0, businessName: 'Hacked' });
    assert.equal(result.status, 400);
    assert.match(result.body.message, /Unsupported field/);
    assert.equal(called, false);
  });

  it('never returns updatedBy or any internal field', async () => {
    const original = Settings.findOneAndUpdate;
    Settings.findOneAndUpdate = async () => ({ notifications: { ...ALL_ON }, updatedBy: 'owner1', __v: 0, updatedAt: new Date() });
    restores.push(() => { Settings.findOneAndUpdate = original; });
    const result = await run(getNotificationSettings, owner);
    assert.deepEqual(Object.keys(result.body.settings).sort(), [...NOTIFICATION_SETTING_KEYS, 'updatedAt'].sort());
  });
});

/* ------------------------------------------------------------------ */
/* Lifecycle hooks: the real controllers                               */
/* ------------------------------------------------------------------ */
function stubOrderCreation() {
  const originals = { cartFindOne: Cart.findOne, productFind: Product.find, productUpdate: Product.findOneAndUpdate, orderCreate: Order.create };
  Cart.findOne = async () => null;
  Product.find = async () => [{ id: 'p1', name: 'Apples', price: 300, unit: 'kg', stock: 10, images: [], preOrderAvailable: true }];
  Product.findOneAndUpdate = async () => ({ id: 'p1', stock: 8 });
  let created = null;
  Order.create = async (payload) => {
    created = { ...payload, _id: '0123456789abcdef01a2b3c4' };
    return created;
  };
  restores.push(() => {
    Cart.findOne = originals.cartFindOne;
    Product.find = originals.productFind;
    Product.findOneAndUpdate = originals.productUpdate;
    Order.create = originals.orderCreate;
  });
  return { created: () => created };
}

const customer = { id: 'cust1', _id: 'cust1', role: 'customer' };
const validAddress = { recipient: 'Asha', phone: '9876543210', street: 'MG Road', postalCode: '411001' };
function futureDateString(daysAhead = 1) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}
// createOrder reads BOTH categories from the one settings document: orderPricing asks for
// `orderSettings` and this feature asks for `notifications`. The stub returns only `notifications`, so
// orderPricing falls back to its defaults (delivery on, no minimum) — exactly what these tests want.
function stubSettingsForOrderCreation() {
  return stubNotificationSettings(ALL_ON);
}

describe('order placement notifications (orderController.createOrder)', () => {
  it('queues one SMS after a regular order is created', async () => {
    stubSettingsForOrderCreation();
    stubOrderCreation();
    const calls = stubGateway(() => queuedResponse());
    const result = await run(createOrder('normal'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 2 }] });
    assert.equal(result.status, 201);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.to, '+919876543210');
    assert.match(calls[0].body.body, /placed successfully/);
  });

  it('queues a pre-order-specific SMS after a pre-order is created', async () => {
    stubSettingsForOrderCreation();
    stubOrderCreation();
    const calls = stubGateway(() => queuedResponse());
    const result = await run(createOrder('preorder'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(3), items: [{ productId: 'p1', quantity: 2 }] });
    assert.equal(result.status, 201);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.body, /pre-order/i);
  });

  it('sends nothing when order creation never succeeds (validation rejected)', async () => {
    stubSettingsForOrderCreation();
    stubOrderCreation();
    const calls = stubGateway(() => queuedResponse());
    const result = await run(createOrder('normal'), customer, { deliveryAddress: { recipient: '' }, deliveryDate: futureDateString() });
    assert.equal(result.status, 400);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 0);
  });

  it('sends nothing when the stock reservation fails', async () => {
    stubSettingsForOrderCreation();
    stubOrderCreation();
    const originalUpdate = Product.findOneAndUpdate;
    Product.findOneAndUpdate = async () => null; // lost the stock race
    restores.push(() => { Product.findOneAndUpdate = originalUpdate; });
    const originalUpdateOne = Product.updateOne;
    Product.updateOne = async () => ({});
    restores.push(() => { Product.updateOne = originalUpdateOne; });
    const calls = stubGateway(() => queuedResponse());
    const result = await run(createOrder('normal'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 2 }] });
    assert.equal(result.status, 500, 'the thrown stock error is passed to the error handler');
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 0);
  });

  it('still creates the order successfully when the gateway is down (SMS never breaks checkout)', async () => {
    stubSettingsForOrderCreation();
    const creation = stubOrderCreation();
    stubGateway(() => { throw new Error('ECONNREFUSED'); });
    const result = await run(createOrder('normal'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 2 }] });
    assert.equal(result.status, 201, 'the order must still be placed');
    assert.ok(creation.created(), 'the order was created');
    await __flushOrderNotificationsForTests();
  });
});

describe('status-change notifications (admin + rider handlers)', () => {
  const adminOwner = { _id: 'owner1', id: 'owner1', role: 'admin', permissions: [] };

  function stubStatusUpdate({ current, winner = true }) {
    const originals = { findById: Order.findById, findOneAndUpdate: Order.findOneAndUpdate, findOne: Order.findOne };
    Order.findById = async () => current;
    Order.findOne = async () => current;
    const updated = { ...current, orderStatus: 'pending-set' };
    Order.findOneAndUpdate = (filter, update) => {
      const next = { ...current, orderStatus: update.$set?.orderStatus || updated.orderStatus, items: current.items || [] };
      const chain = { select: () => chain, populate: () => chain, then: (resolve, reject) => Promise.resolve(winner ? next : null).then(resolve, reject) };
      return chain;
    };
    restores.push(() => {
      Order.findById = originals.findById;
      Order.findOneAndUpdate = originals.findOneAndUpdate;
      Order.findOne = originals.findOne;
    });
  }

  const baseOrder = {
    _id: '0123456789abcdef01a2b3c4',
    id: '0123456789abcdef01a2b3c4',
    orderType: 'normal',
    items: [],
    deliveryAddress: { phone: '9876543210' },
    user: { _id: 'cust1', phone: '9811111111' },
    assignedDeliveryStaff: 'rider1',
  };

  it('queues an out-for-delivery SMS after a successful admin transition', async () => {
    stubNotificationSettings(ALL_ON);
    stubStatusUpdate({ current: { ...baseOrder, orderStatus: 'preparing' } });
    const calls = stubGateway(() => queuedResponse());
    const result = await run(updateOrderStatus, adminOwner, { orderStatus: 'out_for_delivery' }, { params: { id: baseOrder.id } });
    assert.equal(result.status, 200);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.body, /out for delivery/);
  });

  it('queues a delivered SMS after a successful admin transition', async () => {
    stubNotificationSettings(ALL_ON);
    stubStatusUpdate({ current: { ...baseOrder, orderStatus: 'out_for_delivery' } });
    const calls = stubGateway(() => queuedResponse());
    await run(updateOrderStatus, adminOwner, { orderStatus: 'delivered' }, { params: { id: baseOrder.id } });
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.body, /marked delivered/);
  });

  it('queues a cancellation SMS after an authorized admin cancellation', async () => {
    stubNotificationSettings(ALL_ON);
    stubStatusUpdate({ current: { ...baseOrder, orderStatus: 'placed', items: [] } });
    const calls = stubGateway(() => queuedResponse());
    await run(updateOrderStatus, adminOwner, { orderStatus: 'cancelled' }, { params: { id: baseOrder.id } });
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.body, /cancelled/);
  });

  it('sends nothing for the internal confirmed/preparing steps', async () => {
    stubNotificationSettings(ALL_ON);
    stubStatusUpdate({ current: { ...baseOrder, orderStatus: 'placed' } });
    const calls = stubGateway(() => queuedResponse());
    await run(updateOrderStatus, adminOwner, { orderStatus: 'confirmed' }, { params: { id: baseOrder.id } });
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 0, 'customers are only told about out-for-delivery, delivered and cancelled');
  });

  it('sends nothing when a competing request already won the transition (409)', async () => {
    stubNotificationSettings(ALL_ON);
    stubStatusUpdate({ current: { ...baseOrder, orderStatus: 'out_for_delivery' }, winner: false });
    const calls = stubGateway(() => queuedResponse());
    const result = await run(updateOrderStatus, adminOwner, { orderStatus: 'delivered' }, { params: { id: baseOrder.id } });
    assert.equal(result.status, 409);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 0, 'only the request that actually won the transition may notify');
  });

  it('sends nothing when the transition is rejected as invalid', async () => {
    stubNotificationSettings(ALL_ON);
    stubStatusUpdate({ current: { ...baseOrder, orderStatus: 'delivered' } });
    const calls = stubGateway(() => queuedResponse());
    const result = await run(updateOrderStatus, adminOwner, { orderStatus: 'out_for_delivery' }, { params: { id: baseOrder.id } });
    assert.equal(result.status, 409);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 0);
  });

  it('sends nothing when the caller lacks permission', async () => {
    stubNotificationSettings(ALL_ON);
    stubStatusUpdate({ current: { ...baseOrder, orderStatus: 'preparing' } });
    const calls = stubGateway(() => queuedResponse());
    const unprivileged = { _id: 's1', id: 's1', role: 'staff', permissions: [] };
    const result = await run(updateOrderStatus, unprivileged, { orderStatus: 'out_for_delivery' }, { params: { id: baseOrder.id } });
    assert.equal(result.status, 403);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 0);
  });

  it('queues the SMS when the assigned rider marks an order delivered', async () => {
    stubNotificationSettings(ALL_ON);
    stubStatusUpdate({ current: { ...baseOrder, orderStatus: 'out_for_delivery' } });
    const rider = { _id: 'rider1', id: 'rider1', role: 'staff', permissions: ['delivery:view', 'delivery:update'] };
    const calls = stubGateway(() => queuedResponse());
    const result = await run(updateMyDeliveryOrderStatus, rider, { orderStatus: 'delivered' }, { params: { id: baseOrder.id } });
    assert.equal(result.status, 200);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.body, /marked delivered/);
  });

  it('a rider losing the race notifies nobody', async () => {
    stubNotificationSettings(ALL_ON);
    stubStatusUpdate({ current: { ...baseOrder, orderStatus: 'out_for_delivery' }, winner: false });
    const rider = { _id: 'rider1', id: 'rider1', role: 'staff', permissions: ['delivery:view', 'delivery:update'] };
    const calls = stubGateway(() => queuedResponse());
    const result = await run(updateMyDeliveryOrderStatus, rider, { orderStatus: 'delivered' }, { params: { id: baseOrder.id } });
    assert.equal(result.status, 409);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 0);
  });

  it('a failing SMS never reverses a successful status transition', async () => {
    stubNotificationSettings(ALL_ON);
    stubStatusUpdate({ current: { ...baseOrder, orderStatus: 'out_for_delivery' } });
    stubGateway(() => { throw new Error('gateway exploded'); });
    const result = await run(updateOrderStatus, adminOwner, { orderStatus: 'delivered' }, { params: { id: baseOrder.id } });
    assert.equal(result.status, 200, 'the transition stands regardless of the SMS outcome');
    assert.equal(result.body.order.orderStatus, 'delivered');
    await __flushOrderNotificationsForTests();
  });
});

describe('customer pre-order cancellation notification (orderController.cancelPreOrder)', () => {
  function stubCancel({ winner = true } = {}) {
    const originals = { findOne: Order.findOne, findOneAndUpdate: Order.findOneAndUpdate };
    const current = {
      _id: '0123456789abcdef01a2b3c4',
      id: '0123456789abcdef01a2b3c4',
      orderType: 'preorder',
      orderStatus: 'placed',
      deliveryDate: new Date(Date.now() + 86_400_000),
      deliveryAddress: { phone: '9876543210' },
      user: { _id: 'cust1', phone: '9811111111' },
    };
    Order.findOne = async () => current;
    Order.findOneAndUpdate = async () => (winner ? { ...current, orderStatus: 'cancelled', toObject() { return { ...this }; } } : null);
    restores.push(() => {
      Order.findOne = originals.findOne;
      Order.findOneAndUpdate = originals.findOneAndUpdate;
    });
  }

  it('queues a cancellation SMS after the customer successfully cancels', async () => {
    stubNotificationSettings(ALL_ON);
    stubCancel();
    const calls = stubGateway(() => queuedResponse());
    const result = await run(cancelPreOrder, customer, {}, { params: { id: '0123456789abcdef01a2b3c4' } });
    assert.equal(result.status, 200);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 1);
    assert.match(calls[0].body.body, /cancelled/);
  });

  it('sends nothing when another request already cancelled it (409)', async () => {
    stubNotificationSettings(ALL_ON);
    stubCancel({ winner: false });
    const calls = stubGateway(() => queuedResponse());
    const result = await run(cancelPreOrder, customer, {}, { params: { id: '0123456789abcdef01a2b3c4' } });
    assert.equal(result.status, 409);
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 0);
  });

  it('still cancels successfully when the SMS fails', async () => {
    stubNotificationSettings(ALL_ON);
    stubCancel();
    stubGateway(() => ({ status: 500, json: async () => ({ error: 'internal error' }) }));
    const result = await run(cancelPreOrder, customer, {}, { params: { id: '0123456789abcdef01a2b3c4' } });
    assert.equal(result.status, 200);
    await __flushOrderNotificationsForTests();
  });
});

describe('duplicate protection', () => {
  it('one successful event queues exactly one message, even when dispatched repeatedly for separate wins', async () => {
    stubNotificationSettings(ALL_ON);
    const calls = stubGateway(() => queuedResponse());
    // Two riders/admins racing the same transition: only one gets a non-null order back from the
    // conditional update, so only one reaches dispatchStatusNotification at all.
    dispatchStatusNotification({ ...orderFixture(), orderStatus: 'delivered' });
    dispatchStatusNotification(null); // the loser's null result
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 1);
  });

  it('does not retain in-flight notifications after they settle (no unbounded growth per order)', async () => {
    stubNotificationSettings(ALL_ON);
    stubGateway(() => queuedResponse());
    for (let i = 0; i < 25; i += 1) dispatchStatusNotification({ ...orderFixture(), orderStatus: 'delivered' });
    assert.equal(pendingNotificationCount(), 25, 'they are tracked while in flight');
    await __flushOrderNotificationsForTests();
    assert.equal(pendingNotificationCount(), 0, 'every entry must release itself once settled');
  });

  it('ignores a status with no customer-facing notification', async () => {
    stubNotificationSettings(ALL_ON);
    const calls = stubGateway(() => queuedResponse());
    for (const orderStatus of ['placed', 'confirmed', 'preparing']) {
      assert.equal(dispatchStatusNotification({ ...orderFixture(), orderStatus }), null, orderStatus);
    }
    await __flushOrderNotificationsForTests();
    assert.equal(calls.length, 0);
  });
});
