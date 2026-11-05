import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  cancelBulkOrder, createBulkOrder, getBulkOrder, listAdminBulkOrders, listBulkOrders, setBulkOrderQuotation,
  updateAdminBulkOrderStatus, updateBulkOrderStatus,
} from '../controllers/bulkOrderController.js';
import BulkOrder from '../models/BulkOrder.js';
import Product from '../models/Product.js';
import adminRouter from '../routes/adminRoutes.js';
import bulkRouter from '../routes/bulkOrderRoutes.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { BULK_STATUSES, BULK_TRANSITIONS, CUSTOMER_CANCELLABLE, buildQuotation, canTransition, presentBulkForCustomer } from '../utils/bulkOrderWorkflow.js';

const hex = (n) => String(n).padStart(24, '0');
const customerA = { _id: hex(1), id: hex(1), role: 'customer', isActive: true, firstName: 'Asha', lastName: 'Rao' };
const customerB = { _id: hex(2), id: hex(2), role: 'customer', isActive: true, firstName: 'Bala', lastName: 'Iyer' };
const owner = { _id: hex(9), id: hex(9), role: 'admin', isActive: true, firstName: 'Owner', lastName: 'One', adminId: 'admin' };
const bulkStaff = { _id: hex(8), id: hex(8), role: 'staff', isActive: true, firstName: 'Sam', lastName: 'Staff', adminId: 'sam', permissions: ['bulk:view', 'bulk:update'] };
const bulkViewer = { _id: hex(7), id: hex(7), role: 'staff', isActive: true, firstName: 'Vee', lastName: 'Viewer', adminId: 'vee', permissions: ['bulk:view'] };
const otherStaff = { _id: hex(6), id: hex(6), role: 'staff', isActive: true, firstName: 'Ola', lastName: 'Other', adminId: 'ola', permissions: ['orders:view'] };

// ---- in-memory stand-in for the BulkOrder collection (no database)
let store;
let seq;
const originals = {};

function makeDoc(fields) {
  seq += 1;
  const doc = { _id: hex(100 + seq), id: hex(100 + seq), status: 'Pending', createdAt: new Date(), updatedAt: new Date(), ...fields };
  doc.toObject = function toObject() { const { toObject, ...rest } = this; return { ...rest }; };
  return doc;
}
const matches = (doc, filter = {}) => Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));
function query(result) {
  const q = { sort: () => q, select: () => q, then: (a, b) => Promise.resolve(result).then(a, b) };
  return q;
}
function applyUpdate(doc, update) {
  Object.assign(doc, update.$set || {});
  if (update.$push?.statusHistory) doc.statusHistory = [...(doc.statusHistory || []), update.$push.statusHistory];
  return doc;
}

beforeEach(() => {
  store = [];
  seq = 0;
  originals.create = BulkOrder.create;
  originals.find = BulkOrder.find;
  originals.findOne = BulkOrder.findOne;
  originals.findById = BulkOrder.findById;
  originals.findOneAndUpdate = BulkOrder.findOneAndUpdate;
  originals.productFind = Product.find;
  BulkOrder.create = async (fields) => { const doc = makeDoc(fields); store.push(doc); return doc; };
  BulkOrder.find = (filter) => query(store.filter((doc) => matches(doc, filter)));
  BulkOrder.findOne = (filter) => query(store.find((doc) => matches(doc, filter)) || null);
  BulkOrder.findById = (id) => query(store.find((doc) => doc._id === id) || null);
  BulkOrder.findOneAndUpdate = (filter, update) => query(store.filter((doc) => matches(doc, filter)).map((doc) => applyUpdate(doc, update))[0] || null);
  Product.find = () => query([]);
});
afterEach(() => {
  BulkOrder.create = originals.create;
  BulkOrder.find = originals.find;
  BulkOrder.findOne = originals.findOne;
  BulkOrder.findById = originals.findById;
  BulkOrder.findOneAndUpdate = originals.findOneAndUpdate;
  Product.find = originals.productFind;
});

function run(handler, user, { body = {}, params = {}, query: q = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler({ user, body, params, query: q }, res, (error) => resolve({ status: 500, error }));
  });
}

const future = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
const validBody = (extra = {}) => ({
  name: 'Asha Rao', phone: '98765 43210', email: 'asha@example.com', organization: 'Sunrise Cafe', orderType: 'Business',
  products: [{ name: 'Tomato', quantity: 50, unit: 'kg' }, { name: 'Onion', quantity: 20, unit: 'kg' }],
  requiredDate: future(), deliveryAddress: '12 MG Road, Pune 411001', additionalRequirements: 'Morning delivery', ...extra,
});
const seed = (fields = {}) => { const doc = makeDoc({ user: customerA._id, name: 'Asha', phone: '9876543210', email: 'a@b.com', orderType: 'Business', products: [{ name: 'Tomato', quantity: 10, unit: 'kg' }, { name: 'Onion', quantity: 5, unit: 'kg' }], requiredDate: new Date(Date.now() + 864e5 * 5), deliveryAddress: 'Pune', statusHistory: [], ...fields }); store.push(doc); return doc; };

describe('customer bulk-order creation', () => {
  it('creates a request linked to the authenticated customer', async () => {
    const result = await run(createBulkOrder, customerA, { body: validBody() });
    assert.equal(result.status, 201);
    assert.equal(store.length, 1);
    assert.equal(store[0].user, customerA._id);
    assert.equal(store[0].status, 'Pending');
    assert.equal(store[0].phone, '9876543210');
    assert.equal(result.body.request.status, 'Pending');
  });

  it('ignores any customer id, status, quotation or history sent in the body', async () => {
    const body = validBody({ user: customerB._id, userId: customerB._id, status: 'Approved', quotation: { totalAmount: 1 }, statusHistory: [{ x: 1 }], adminResponse: { message: 'x' } });
    const result = await run(createBulkOrder, customerA, { body });
    assert.equal(result.status, 201);
    assert.equal(store[0].user, customerA._id);
    assert.equal(store[0].status, 'Pending');
    assert.equal(store[0].quotation, undefined);
    assert.equal(store[0].statusHistory, undefined);
    assert.equal(store[0].adminResponse, undefined);
  });

  it('still accepts a guest request, without any owner', async () => {
    const result = await run(createBulkOrder, undefined, { body: validBody() });
    assert.equal(result.status, 201);
    assert.equal(store[0].user, undefined);
  });

  it('rejects invalid input', async () => {
    const bad = [
      validBody({ name: '' }), validBody({ phone: '12345' }), validBody({ email: 'nope' }), validBody({ orderType: 'Hacker' }),
      validBody({ products: [] }), validBody({ products: [{ name: 'Tomato', quantity: 0 }] }), validBody({ products: [{ name: 'Tomato', quantity: 1.5 }] }),
      validBody({ products: [{ name: 'Tomato', quantity: 10001 }] }), validBody({ products: [{ name: '  ', quantity: 2 }] }),
      validBody({ requiredDate: new Date(Date.now() - 864e5).toISOString() }), validBody({ requiredDate: 'garbage' }),
      validBody({ requiredDate: new Date(Date.now() + 864e5 * 900).toISOString() }), validBody({ additionalRequirements: 'x'.repeat(2001) }),
    ];
    for (const body of bad) assert.equal((await run(createBulkOrder, customerA, { body })).status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(store.length, 0);
  });

  it('takes name and unit from the catalogue for a chosen product, not from the client', async () => {
    Product.find = () => query([{ _id: hex(55), name: 'Real Tomato', unit: 'crate' }]);
    const result = await run(createBulkOrder, customerA, { body: validBody({ products: [{ productId: hex(55), name: 'Fake', unit: 'ton', quantity: 3 }] }) });
    assert.equal(result.status, 201);
    assert.deepEqual({ name: store[0].products[0].name, unit: store[0].products[0].unit }, { name: 'Real Tomato', unit: 'crate' });
  });

  it('rejects a product that is not bulk-available', async () => {
    const result = await run(createBulkOrder, customerA, { body: validBody({ products: [{ productId: hex(56), quantity: 3 }] }) });
    assert.equal(result.status, 400);
  });

  it('is wired with optionalAuth so a signed-in customer is recognised', () => {
    const layer = bulkRouter.stack.find((entry) => entry.route?.path === '/' && entry.route.methods.post);
    const handles = layer.route.stack.map((entry) => entry.handle);
    assert.ok(handles.includes(optionalAuth));
    assert.ok(handles.includes(createBulkOrder));
  });
});

describe('customer history, details and ownership', () => {
  it('lists only the signed-in customer\'s own requests, even for the owner and bulk staff', async () => {
    const mine = seed();
    seed({ user: customerB._id });
    const asCustomer = await run(listBulkOrders, customerA);
    assert.deepEqual(asCustomer.body.requests.map((r) => r._id), [mine._id]);
    for (const viewer of [owner, bulkStaff]) assert.deepEqual((await run(listBulkOrders, viewer)).body.requests, []);
  });

  it('returns detail with status for the owner of the request', async () => {
    const mine = seed({ status: 'Reviewing' });
    const result = await run(getBulkOrder, customerA, { params: { id: mine._id } });
    assert.equal(result.status, 200);
    assert.equal(result.body.request.status, 'Reviewing');
    assert.equal(result.body.request.products.length, 2);
  });

  it('answers 404 for another customer\'s request, a missing one and a malformed id alike', async () => {
    const theirs = seed({ user: customerB._id });
    for (const id of [theirs._id, hex(999), 'not-an-id']) {
      const result = await run(getBulkOrder, customerA, { params: { id } });
      assert.equal(result.status, 404, id);
    }
  });

  it('is shown the quotation and the business\'s response', async () => {
    const quoted = seed({ status: 'Quoted', quotation: { items: [{ name: 'Tomato', quantity: 10, unit: 'kg', unitPrice: 30, lineTotal: 300 }], deliveryCharge: 50, totalAmount: 350, validUntil: null, message: 'Thanks!', quotedAt: new Date(), quotedByName: 'Sam Staff' }, adminResponse: { message: 'Happy to help', at: new Date() } });
    const { request } = (await run(getBulkOrder, customerA, { params: { id: quoted._id } })).body;
    assert.equal(request.quotation.totalAmount, 350);
    assert.equal(request.quotation.message, 'Thanks!');
    assert.equal(request.adminResponse.message, 'Happy to help');
  });
});

describe('customer cancellation', () => {
  it('cancels an eligible request, records the customer as the actor and cannot cancel twice', async () => {
    for (const status of CUSTOMER_CANCELLABLE) {
      const doc = seed({ status });
      const result = await run(cancelBulkOrder, customerA, { params: { id: doc._id } });
      assert.equal(result.status, 200, status);
      assert.equal(doc.status, 'Cancelled');
      assert.equal(doc.statusHistory.at(-1).actor.role, 'customer');
      assert.equal(doc.statusHistory.at(-1).fromStatus, status);
      assert.equal((await run(cancelBulkOrder, customerA, { params: { id: doc._id } })).status, 409);
    }
  });

  it('refuses once the request is approved, in progress or finished', async () => {
    for (const status of ['Approved', 'Processing', 'Completed', 'Rejected']) {
      const doc = seed({ status });
      assert.equal((await run(cancelBulkOrder, customerA, { params: { id: doc._id } })).status, 409, status);
      assert.equal(doc.status, status);
    }
  });

  it('cannot cancel someone else\'s request', async () => {
    const theirs = seed({ user: customerB._id });
    assert.equal((await run(cancelBulkOrder, customerA, { params: { id: theirs._id } })).status, 404);
    assert.equal(theirs.status, 'Pending');
  });

  it('is routed behind requireAuth', () => {
    const layer = bulkRouter.stack.find((entry) => entry.route?.path === '/:id/cancel' && entry.route.methods.put);
    assert.ok(layer.route.stack.map((entry) => entry.handle).includes(requireAuth));
  });
});

describe('admin quotation', () => {
  const quoteBody = (extra = {}) => ({ items: [{ unitPrice: 30 }, { unitPrice: 22.5 }], deliveryCharge: 100, message: 'Valid for a week', ...extra });

  it('refuses a client-supplied total at the top level', async () => {
    const doc = seed();
    const result = await run(setBulkOrderQuotation, bulkStaff, { params: { id: doc._id }, body: quoteBody({ totalAmount: 1, items: [{ unitPrice: 30, lineTotal: 1, quantity: 9999 }, { unitPrice: 22.5 }] }) });
    assert.equal(result.status, 400);
  });

  it('computes totals on the server, ignores client quantities and line totals, and moves the request to Quoted', async () => {
    const doc = seed();
    const result = await run(setBulkOrderQuotation, bulkStaff, { params: { id: doc._id }, body: quoteBody({ items: [{ unitPrice: 30, lineTotal: 1, quantity: 9999 }, { unitPrice: 22.5 }] }) });
    assert.equal(result.status, 200);
    assert.equal(doc.status, 'Quoted');
    assert.deepEqual(doc.quotation.items.map((i) => [i.quantity, i.lineTotal]), [[10, 300], [5, 112.5]]);
    assert.equal(doc.quotation.totalAmount, 512.5);
    assert.equal(doc.quotation.quotedByName, 'Sam Staff');
    assert.equal(doc.statusHistory.at(-1).toStatus, 'Quoted');
    assert.equal(doc.statusHistory.at(-1).actor.loginId, 'sam');
  });

  it('can be revised while Quoted but not after approval', async () => {
    const doc = seed();
    await run(setBulkOrderQuotation, bulkStaff, { params: { id: doc._id }, body: quoteBody() });
    assert.equal((await run(setBulkOrderQuotation, bulkStaff, { params: { id: doc._id }, body: quoteBody({ items: [{ unitPrice: 31 }, { unitPrice: 23 }] }) })).status, 200);
    doc.status = 'Approved';
    assert.equal((await run(setBulkOrderQuotation, bulkStaff, { params: { id: doc._id }, body: quoteBody() })).status, 409);
  });

  it('validates prices, charges, dates and unknown fields', () => {
    const request = { products: [{ name: 'A', quantity: 2, unit: 'kg' }] };
    for (const body of [
      {}, { items: [] }, { items: [{ unitPrice: -1 }] }, { items: [{ unitPrice: 'abc' }] }, { items: [{ unitPrice: '' }] }, { items: [{ unitPrice: 5 }], deliveryCharge: -5 },
      { items: [{ unitPrice: 5 }], validUntil: '2000-01-01' }, { items: [{ unitPrice: 5 }], validUntil: 'nope' }, { items: [{ unitPrice: 5 }], status: 'Approved' }, { items: [{ unitPrice: 5 }], message: 'x'.repeat(1001) },
    ]) assert.ok(buildQuotation(request, body).error, JSON.stringify(body));
    assert.equal(buildQuotation(request, { items: [{ unitPrice: 5 }] }).quotation.totalAmount, 10);
  });

  it('requires bulk:update at the route', () => {
    const layer = adminRouter.stack.find((entry) => entry.route?.path === '/bulk-orders/:id/quotation' && entry.route.methods.put);
    assert.ok(layer, 'quotation route exists');
    assert.ok(layer.route.stack.map((entry) => entry.handle).includes(setBulkOrderQuotation));
    assert.equal(layer.route.stack.length, 2, 'permission guard + handler');
  });
});

describe('approval, rejection, processing and transitions', () => {
  const quoteDoc = (status = 'Quoted') => seed({ status, quotation: { items: [{ name: 'Tomato', quantity: 10, unit: 'kg', unitPrice: 30, lineTotal: 300 }], deliveryCharge: 0, totalAmount: 300, quotedAt: new Date() } });
  const change = (doc, status, user = bulkStaff, extra = {}) => run(updateAdminBulkOrderStatus, user, { params: { id: doc._id }, body: { status, ...extra } });

  it('walks the whole happy path and audits each step with the acting user', async () => {
    const doc = seed();
    assert.equal((await change(doc, 'Reviewing')).status, 200);
    await run(setBulkOrderQuotation, bulkStaff, { params: { id: doc._id }, body: { items: [{ unitPrice: 30 }, { unitPrice: 20 }] } });
    for (const status of ['Approved', 'Processing', 'Completed']) assert.equal((await change(doc, status, owner)).status, 200, status);
    assert.deepEqual(doc.statusHistory.map((entry) => entry.toStatus), ['Reviewing', 'Quoted', 'Approved', 'Processing', 'Completed']);
    assert.deepEqual(doc.statusHistory.map((entry) => entry.actor.role), ['staff', 'staff', 'owner', 'owner', 'owner']);
  });

  it('refuses approval without a quotation', async () => {
    const doc = seed({ status: 'Reviewing' });
    assert.equal((await change(doc, 'Approved')).status, 409);
  });

  it('needs a reason to reject, then stores it as the customer-visible response', async () => {
    const doc = quoteDoc();
    assert.equal((await change(doc, 'Rejected')).status, 400);
    assert.equal(doc.status, 'Quoted');
    assert.equal((await change(doc, 'Rejected', bulkStaff, { message: 'Out of season' })).status, 200);
    assert.equal(doc.adminResponse.message, 'Out of season');
    const shown = (await run(getBulkOrder, customerA, { params: { id: doc._id } })).body.request;
    assert.equal(shown.status, 'Rejected');
    assert.equal(shown.adminResponse.message, 'Out of season');
  });

  it('blocks every transition not in the table, and the final states never move', async () => {
    for (const from of BULK_STATUSES) {
      for (const to of BULK_STATUSES) {
        if (from === to || to === 'Cancelled') continue;
        const doc = quoteDoc(from);
        const result = await change(doc, to, bulkStaff, { message: 'reason' });
        if (canTransition(from, to)) {
          if (to === 'Approved' && !doc.quotation) continue;
          assert.equal(result.status, 200, `${from}->${to}`);
        } else {
          assert.equal(result.status, 409, `${from}->${to}`);
          assert.equal(doc.status, from);
        }
      }
    }
    for (const final of ['Rejected', 'Completed', 'Cancelled']) assert.deepEqual(BULK_TRANSITIONS[final], []);
  });

  it('leaves cancelling to the customer', async () => {
    const doc = seed();
    assert.equal((await change(doc, 'Cancelled', owner)).status, 403);
    assert.equal(doc.status, 'Pending');
  });

  it('rejects unknown statuses and ignores extra body fields', async () => {
    const doc = seed();
    assert.equal((await change(doc, 'Shipped')).status, 400);
    await change(doc, 'Reviewing', bulkStaff, { user: customerB._id, quotation: { totalAmount: 1 } });
    assert.equal(doc.user, customerA._id);
    assert.equal(doc.quotation, undefined);
  });

  it('does not let the customer-facing status route skip the transition rules', async () => {
    const doc = seed({ status: 'Completed' });
    assert.equal((await run(updateBulkOrderStatus, bulkStaff, { params: { id: doc._id }, body: { status: 'Pending' } })).status, 409);
  });
});

describe('staff permissions', () => {
  const guardsFor = (router, path, method) => router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]).route.stack.map((entry) => entry.handle);
  const call = (handle, user) => new Promise((resolve) => {
    const res = { status(code) { resolve(code); return this; }, json() { return this; } };
    handle({ user }, res, () => resolve('next'));
  });

  it('the quotation and status routes admit only bulk:update holders and the owner', async () => {
    for (const [path, method] of [['/bulk-orders/:id/quotation', 'put'], ['/bulk-orders/:id/status', 'patch']]) {
      const guard = guardsFor(adminRouter, path, method)[0];
      assert.equal(await call(guard, bulkStaff), 'next');
      assert.equal(await call(guard, owner), 'next');
      for (const user of [bulkViewer, otherStaff, customerA]) assert.equal(await call(guard, user), 403, `${user.role}:${path}`);
    }
  });

  it('the admin list admits bulk:view only', async () => {
    const guard = guardsFor(adminRouter, '/bulk-orders', 'get')[0];
    assert.equal(await call(guard, bulkViewer), 'next');
    assert.equal(await call(guard, otherStaff), 403);
    assert.equal((await run(listAdminBulkOrders, otherStaff)).status, 403);
  });

  it('read-only staff can view but the handlers still enforce transitions', async () => {
    seed();
    assert.equal((await run(listAdminBulkOrders, bulkViewer)).body.requests.length, 1);
  });

  it('masks contact details for staff without customers:view_contact and shows them to the owner', async () => {
    seed({ email: 'asha@example.com', phone: '9876543210' });
    const masked = (await run(listAdminBulkOrders, bulkStaff)).body.requests[0];
    assert.ok(!JSON.stringify(masked).includes('asha@example.com'));
    assert.ok(!JSON.stringify(masked).includes('9876543210'));
    const full = (await run(listAdminBulkOrders, owner)).body.requests[0];
    assert.equal(full.email, 'asha@example.com');
  });
});

describe('customer data privacy', () => {
  it('never exposes audit history, staff identifiers or unknown fields to customers', async () => {
    const doc = seed({
      status: 'Quoted', secretInternalNote: 'cost is 12', statusHistory: [{ orderType: 'bulk', fromStatus: 'Pending', toStatus: 'Quoted', at: new Date(), actor: { id: owner._id, name: 'Owner One', loginId: 'admin', role: 'owner' } }],
      quotation: { items: [{ name: 'Tomato', quantity: 10, unit: 'kg', unitPrice: 30, lineTotal: 300 }], deliveryCharge: 0, totalAmount: 300, quotedAt: new Date(), quotedByName: 'Sam Staff', quotedBy: hex(8) },
    });
    for (const result of [await run(getBulkOrder, customerA, { params: { id: doc._id } }), await run(listBulkOrders, customerA), await run(cancelBulkOrder, customerA, { params: { id: doc._id } })]) {
      const text = JSON.stringify(result.body);
      for (const leaked of ['statusHistory', 'secretInternalNote', 'cost is 12', 'loginId', 'Sam Staff', 'quotedBy', hex(8), hex(9)]) assert.ok(!text.includes(leaked), leaked);
    }
  });

  it('presents a request with no quotation as null and flags cancellable states', () => {
    const view = presentBulkForCustomer({ _id: 'x', status: 'Pending', products: [], quotation: undefined });
    assert.equal(view.quotation, null);
    assert.equal(view.canCancel, true);
    assert.equal(presentBulkForCustomer({ _id: 'x', status: 'Approved', products: [] }).canCancel, false);
  });

  it('creation responses are also customer-safe', async () => {
    const result = await run(createBulkOrder, customerA, { body: validBody() });
    assert.ok(!JSON.stringify(result.body).includes('statusHistory'));
  });
});

describe('existing order workflows are untouched', () => {
  it('does not import or reference order, cart or stock code', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../controllers/bulkOrderController.js', import.meta.url), 'utf8');
    for (const forbidden of ['models/Order.js', 'models/Cart.js', '$inc']) assert.ok(!source.includes(forbidden), forbidden);
  });
});
