import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import {
  listAdminBulkOrders, listBulkOrders, updateAdminBulkOrderStatus, updateBulkOrderStatus,
} from '../controllers/bulkOrderController.js';
import { updateOrderStatus } from '../controllers/orderController.js';
import BulkOrder from '../models/BulkOrder.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import adminRouter from '../routes/adminRoutes.js';
import bulkRouter from '../routes/bulkOrderRoutes.js';
import {
  buildStatusEntry, presentStatusHistory, statusUpdateWithAudit, withPresentedHistory, withoutStatusHistory,
} from '../utils/statusAudit.js';

const owner = { _id: 'u1', firstName: 'Janai', lastName: 'Admin', adminId: 'admin', role: 'admin' };
const staff = { _id: 'u2', firstName: 'Sam', lastName: 'Staff', adminId: 'sam', role: 'staff' };
const customer = { _id: 'u3', firstName: 'Cust', lastName: 'Omer', role: 'customer' };

describe('buildStatusEntry', () => {
  it('derives the actor from the authenticated account and stamps the server time', () => {
    const now = new Date('2026-01-02T03:04:05Z');
    const entry = buildStatusEntry(staff, 'preorder', 'placed', 'confirmed', now);
    assert.deepEqual(entry, { orderType: 'preorder', fromStatus: 'placed', toStatus: 'confirmed', at: now, actor: { id: 'u2', name: 'Sam Staff', loginId: 'sam', role: 'staff' } });
  });

  it('maps roles to owner / staff / customer and tolerates missing names', () => {
    assert.equal(buildStatusEntry(owner, 'normal', 'a', 'b').actor.role, 'owner');
    assert.equal(buildStatusEntry(customer, 'preorder', 'a', 'b').actor.role, 'customer');
    assert.equal(buildStatusEntry({ _id: 'x', role: 'staff' }, 'bulk', 'a', 'b').actor.name, '');
  });

  it('builds one atomic update that sets the status and appends the entry', () => {
    const entry = buildStatusEntry(owner, 'normal', 'placed', 'confirmed');
    assert.deepEqual(statusUpdateWithAudit('orderStatus', 'confirmed', entry), { $set: { orderStatus: 'confirmed' }, $push: { statusHistory: entry } });
  });
});

describe('presentation', () => {
  const history = [{ orderType: 'normal', fromStatus: 'placed', toStatus: 'confirmed', at: new Date(), actor: { id: 'u2', name: 'Sam Staff', loginId: 'sam', role: 'staff' }, _secret: 'x' }];

  it('gives the owner the actor id and everyone else only name, login ID and role', () => {
    assert.equal(presentStatusHistory(history, owner)[0].actor.id, 'u2');
    const forStaff = presentStatusHistory(history, staff)[0];
    assert.equal('id' in forStaff.actor, false);
    assert.equal(forStaff.actor.loginId, 'sam');
    assert.equal('_secret' in forStaff, false);
  });

  it('removes the field unless explicitly allowed, and never invents entries', () => {
    assert.equal('statusHistory' in withPresentedHistory({ a: 1, statusHistory: history }, owner, false), false);
    assert.deepEqual(withPresentedHistory({ a: 1 }, owner, true).statusHistory, []);
    assert.equal('statusHistory' in withoutStatusHistory({ a: 1, statusHistory: history }), false);
    assert.equal('statusHistory' in withoutStatusHistory({ toObject: () => ({ a: 1, statusHistory: history }) }), false);
  });
});

describe('schema protection', () => {
  it('statusHistory is excluded by default and absent unless written', () => {
    for (const Model of [Order, BulkOrder]) {
      const path = Model.schema.path('statusHistory');
      assert.equal(path.options.select, false);
      assert.equal(path.options.default, undefined);
      const query = Model.find({});
      query._applyPaths();
      assert.deepEqual(query._fields, { statusHistory: 0 });
      const selected = Model.find({}).select('+statusHistory');
      selected._applyPaths();
      assert.deepEqual(selected._fields, {});
    }
    assert.equal(new BulkOrder({ name: 'a' }).toObject().statusHistory, undefined);
  });

  it('request routing never relies on the request path', () => {
    const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(!read('../utils/statusAudit.js').includes('baseUrl'));
    assert.ok(!read('../controllers/bulkOrderController.js').includes('baseUrl'));
    const orders = read('../controllers/orderController.js');
    assert.equal(orders.split('\n').filter((line) => line.includes('+statusHistory')).length, 2); // listAdminOrders, updateOrderStatus
    assert.match(orders, /cancelPreOrder[\s\S]*withoutStatusHistory\(cancelled\)/);
  });
});

// ---- handler-level regressions with stubbed model methods (no database)
const staffWithBulk = { _id: 's1', id: 's1', role: 'staff', isActive: true, permissions: ['bulk:view', 'bulk:update'], firstName: 'S', lastName: 'T', adminId: 'st' };
const ownerUser = { _id: 'o1', id: 'o1', role: 'admin', isActive: true, firstName: 'O', lastName: 'W', adminId: 'admin' };
const customerUser = { _id: 'c1', id: 'c1', role: 'customer', firstName: 'C', lastName: 'U' };
const staffNoBulk = { _id: 's2', id: 's2', role: 'staff', isActive: true, permissions: ['orders:view'] };

function stubBulk() {
  const calls = { selects: [], updates: [] };
  const request = { _id: 'b1', id: 'b1', status: 'Pending', name: 'Cafe', email: 'c@d.com', phone: '9811122233', statusHistory: [{ orderType: 'bulk', fromStatus: 'a', toStatus: 'b', at: new Date(), actor: { id: 'x1', name: 'X', loginId: 'x', role: 'staff' } }], toObject() { return { ...this }; } };
  const query = (result) => {
    const q = { sort: () => q, select: (spec) => { calls.selects.push(spec); return q; }, then: (a, b) => Promise.resolve(result).then(a, b) };
    return q;
  };
  const originals = { find: BulkOrder.find, findById: BulkOrder.findById, findOneAndUpdate: BulkOrder.findOneAndUpdate };
  BulkOrder.find = () => query([request]);
  BulkOrder.findById = () => query(request);
  BulkOrder.findOneAndUpdate = (filter, update) => {
    calls.updates.push(update);
    return query({ ...request, status: update.$set.status, toObject() { return { ...this }; } });
  };
  return { calls, restore: () => Object.assign(BulkOrder, originals) };
}

function run(handler, user, body = { status: 'Reviewing' }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler({ user, body, params: { id: 'b1' }, query: {} }, res, (error) => resolve({ status: 500, error }));
  });
}

describe('customer-facing vs admin bulk handlers', () => {
  let stub;
  afterEach(() => stub?.restore());

  it('customer-facing handlers never select or return history, even for the owner or bulk:view staff', async () => {
    stub = stubBulk();
    for (const user of [ownerUser, staffWithBulk, customerUser]) {
      for (const handler of [listBulkOrders, updateBulkOrderStatus]) {
        const result = await run(handler, user);
        assert.ok(!JSON.stringify(result.body).includes('statusHistory'), `leaked history for ${user.role}`);
      }
    }
    assert.ok(!stub.calls.selects.some((spec) => String(spec).includes('statusHistory')));
  });

  it('customer-facing status updates are still audited in one atomic update', async () => {
    stub = stubBulk();
    const result = await run(updateBulkOrderStatus, staffWithBulk);
    assert.equal(result.status, 200);
    assert.equal(stub.calls.updates.length, 1);
    assert.deepEqual(Object.keys(stub.calls.updates[0]).sort(), ['$push', '$set']);
    assert.equal(stub.calls.updates[0].$push.statusHistory.actor.role, 'staff');
  });

  it('admin handlers select and return history for owner and bulk:view staff only', async () => {
    stub = stubBulk();
    for (const user of [ownerUser, staffWithBulk]) {
      stub.calls.selects.length = 0;
      const list = await run(listAdminBulkOrders, user);
      assert.equal(list.body.requests[0].statusHistory.length, 1);
      assert.ok(stub.calls.selects.includes('+statusHistory'));
      assert.equal('id' in list.body.requests[0].statusHistory[0].actor, user.role === 'admin');
    }
    stub.calls.selects.length = 0;
    const noPermission = await run(listAdminBulkOrders, staffNoBulk);
    assert.ok(!JSON.stringify(noPermission.body).includes('statusHistory'));
    assert.ok(!stub.calls.selects.includes('+statusHistory'));
    const asCustomer = await run(listAdminBulkOrders, customerUser);
    assert.ok(!JSON.stringify(asCustomer.body).includes('statusHistory'));
  });

  it('admin status update returns history; routers wire admin handlers on /admin and customer handlers elsewhere', async () => {
    stub = stubBulk();
    const result = await run(updateAdminBulkOrderStatus, staffWithBulk);
    assert.equal(result.body.request.statusHistory.length, 1);
    const handlersFor = (router, path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.map((entry) => entry.handle);
    assert.ok(handlersFor(adminRouter, '/bulk-orders', 'get').includes(listAdminBulkOrders));
    assert.ok(!handlersFor(adminRouter, '/bulk-orders', 'get').includes(listBulkOrders));
    assert.ok(handlersFor(adminRouter, '/bulk-orders/:id/status', 'patch').includes(updateAdminBulkOrderStatus));
    assert.ok(!handlersFor(adminRouter, '/bulk-orders/:id/status', 'patch').includes(updateBulkOrderStatus));
    assert.ok(handlersFor(bulkRouter, '/', 'get').includes(listBulkOrders));
    assert.ok(!handlersFor(bulkRouter, '/', 'get').includes(listAdminBulkOrders));
    assert.ok(handlersFor(bulkRouter, '/:id/status', 'patch').includes(updateBulkOrderStatus));
    assert.ok(!handlersFor(bulkRouter, '/:id/status', 'patch').includes(updateAdminBulkOrderStatus));
  });
});

describe('stock restoration on cancellation', () => {
  const items = [{ product: 'p1', name: 'Tomato', quantity: 2 }, { product: 'p2', name: 'Onion', quantity: 3 }];
  const originals = { findById: Order.findById, findOneAndUpdate: Order.findOneAndUpdate, updateOne: Product.updateOne };
  afterEach(() => {
    Order.findById = originals.findById;
    Order.findOneAndUpdate = originals.findOneAndUpdate;
    Product.updateOne = originals.updateOne;
  });

  function arrange(updateOne) {
    const current = { id: 'o1', orderStatus: 'placed', orderType: 'normal' };
    const cancelled = { ...current, orderStatus: 'cancelled', items, statusHistory: [], toObject() { return { ...this }; } };
    Order.findById = () => Promise.resolve(current);
    Order.findOneAndUpdate = () => ({ select: () => Promise.resolve(cancelled) });
    const restored = [];
    Product.updateOne = (filter, update) => updateOne(filter, update, restored);
    return restored;
  }
  const cancelAsOwner = () => run(updateOrderStatus, ownerUser, { orderStatus: 'cancelled' });

  it('restores every reserved line exactly once and succeeds', async () => {
    const restored = arrange(async (filter, update, list) => { list.push([filter._id, update.$inc.stock]); return { matchedCount: 1 }; });
    const result = await cancelAsOwner();
    assert.equal(result.status, 200);
    assert.deepEqual(restored, [['p1', 2], ['p2', 3]]);
  });

  it('reports failure explicitly, not plain success, when a restoration write fails', async () => {
    arrange(async (filter) => { if (filter._id === 'p2') throw new Error('write failed'); return { matchedCount: 1 }; });
    const result = await cancelAsOwner();
    assert.equal(result.status, 500);
    assert.equal(result.body.code, 'STOCK_RESTORE_FAILED');
    assert.match(result.body.message, /Onion/);
    assert.ok(!/Tomato/.test(result.body.message));
    assert.equal(result.body.order.orderStatus, 'cancelled'); // the cancellation itself persisted
  });

  it('treats a product that no longer exists as not restored', async () => {
    arrange(async (filter) => ({ matchedCount: filter._id === 'p1' ? 0 : 1 }));
    const result = await cancelAsOwner();
    assert.equal(result.status, 500);
    assert.match(result.body.message, /Tomato/);
  });

  it('does not touch stock for non-cancel transitions or pre-orders', async () => {
    const restored = arrange(async (filter, update, list) => { list.push(filter._id); return { matchedCount: 1 }; });
    Order.findById = () => Promise.resolve({ id: 'o1', orderStatus: 'placed', orderType: 'preorder' });
    Order.findOneAndUpdate = () => ({ select: () => Promise.resolve({ id: 'o1', orderStatus: 'cancelled', orderType: 'preorder', items, toObject() { return { ...this }; } }) });
    const owner = { ...ownerUser, permissions: [] };
    const result = await run(updateOrderStatus, owner, { orderStatus: 'cancelled' });
    assert.equal(result.status, 200);
    assert.deepEqual(restored, []);
  });
});
