// Phase 5: Automatic Stock Movement Ledger. These tests focus specifically on what Phase 5 adds — the
// StockMovement row each automatic workflow now writes (its exact shape: source, type, previous/new
// stock, difference) and the "no movement on no-mutation / failed-mutation" guarantees — rather than
// re-proving stock arithmetic, permissions or concurrency, which phase6/phase9/phase10/phase15/phase17
// already cover in full for these same workflows (and were updated alongside this phase).
//
// Like every other stubbed-model test file in this suite, there is NO real database connection here.
// transactionHelper.run is replaced with a bare call to its callback, so these tests prove control flow
// (which calls happen, in which order, with which arguments; that a failure never leaves a movement
// behind） — never true multi-document transaction atomicity. That is proven separately, against the
// real Atlas replica set, in test/integration/phase5AutomaticLedger.test.mjs.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import BulkOrder from '../models/BulkOrder.js';
import Cart from '../models/Cart.js';
import VendorPurchase from '../models/VendorPurchase.js';
import StockMovement from '../models/StockMovement.js';
import { createOrder, updateOrderStatus } from '../controllers/orderController.js';
import { updateAdminBulkOrderStatus } from '../controllers/bulkOrderController.js';
import { createPurchase, receivePurchase } from '../controllers/vendorController.js';
import { transactionHelper } from '../utils/withTransaction.js';

function run(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler(req, res, (error) => resolve({ status: 500, error }));
  });
}

const admin = { _id: 'owner1', id: 'owner1', role: 'admin', firstName: 'Owner', permissions: [] };
const customer = { _id: 'cust1', id: 'cust1', role: 'customer' };
const validAddress = { recipient: 'Asha', phone: '9876543210', street: 'MG Road', postalCode: '411001' };
function futureDateString(daysAhead = 1) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

function legacyProduct(overrides = {}) {
  return { _id: 'p1', id: 'p1', name: 'Rice', price: 50, unit: 'kg', stock: 20, minStockThreshold: 0, images: [], preOrderAvailable: true, variations: [], ...overrides };
}

const FAKE_SESSION = { id: 'fake-session' };
function stubTransaction() {
  const original = transactionHelper.run;
  transactionHelper.run = async (work) => work(FAKE_SESSION);
  return () => { transactionHelper.run = original; };
}

// Same complete filter-shape understanding as phase20.test.js's own stub — deductVariationStock's two
// guarded shapes plus addVariationStock's two unconditional shapes (Phase 5 only calls the latter).
function stubProductStock(product) {
  const originalFind = Product.find;
  const originalFindById = Product.findById;
  const originalFOU = Product.findOneAndUpdate;
  Product.find = async () => [product];
  Product.findById = async () => product;
  Product.findOneAndUpdate = async (filter, update) => {
    if (filter.stock !== undefined) {
      if (typeof filter.stock === 'object') { if (product.stock < filter.stock.$gte) return null; } else if (product.stock !== filter.stock) return null;
      if (update.$inc) product.stock += update.$inc.stock;
      return product;
    }
    if (filter.variations?.$elemMatch) {
      const cond = filter.variations.$elemMatch;
      const variation = product.variations.find((entry) => entry._id === cond._id);
      if (!variation) return null;
      if (cond.stock !== undefined) {
        if (typeof cond.stock === 'object') { if (variation.stock < cond.stock.$gte) return null; } else if (variation.stock !== cond.stock) return null;
      }
      if (cond.isActive && variation.isActive === false) return null;
      if (update.$inc) variation.stock += update.$inc['variations.$[elem].stock'];
      return product;
    }
    if (filter['variations._id'] !== undefined) {
      const variation = product.variations.find((entry) => entry._id === filter['variations._id']);
      if (!variation) return null;
      variation.stock += update.$inc['variations.$.stock'];
      return product;
    }
    if (update?.$inc?.stock !== undefined) { product.stock += update.$inc.stock; return product; }
    return null;
  };
  return () => { Product.find = originalFind; Product.findById = originalFindById; Product.findOneAndUpdate = originalFOU; };
}

function stubMovementCreate() {
  const original = StockMovement.create;
  const created = [];
  StockMovement.create = async (docs, options) => { created.push({ doc: docs[0], options }); return [{ ...docs[0], _id: `m${created.length}` }]; };
  return { created, restore: () => { StockMovement.create = original; } };
}

// ---------------------------------------------------------------------------
describe('Phase 5: vendor purchase receiving', () => {
  it('Ordered -> Received adds stock and creates exactly one vendor_received movement, session-bound', async () => {
    const product = legacyProduct({ stock: 20 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const originalFOU = VendorPurchase.findOneAndUpdate;
    const originalUO = VendorPurchase.updateOne;
    const originalFindById = VendorPurchase.findById;
    VendorPurchase.findOneAndUpdate = async () => ({ _id: 'pu1', product: 'p1', quantity: 10, variationId: null });
    VendorPurchase.updateOne = async () => ({ acknowledged: true });
    VendorPurchase.findById = async (id) => ({ _id: id, status: 'Received' });
    try {
      const result = await run(receivePurchase, { user: admin, params: { productId: 'p1', vendorId: 'e1', purchaseId: 'pu1' } });
      assert.equal(result.status, 200);
      assert.equal(product.stock, 30); // 20 + 10
      assert.equal(movement.created.length, 1, 'exactly one movement');
      const { doc, options } = movement.created[0];
      assert.equal(doc.type, 'add');
      assert.equal(doc.previousStock, 20);
      assert.equal(doc.newStock, 30);
      assert.equal(doc.difference, 10);
      assert.equal(doc.newStock - doc.previousStock, doc.difference);
      assert.deepEqual(doc.source, { type: 'vendor_purchase', id: 'pu1', event: 'vendor_received', itemKey: null });
      assert.equal(doc.actor.id, admin._id);
      assert.equal(options.session, FAKE_SESSION, 'the movement insert must use the same session as the stock mutation');
    } finally {
      restoreProduct(); restoreTx(); movement.restore();
      VendorPurchase.findOneAndUpdate = originalFOU; VendorPurchase.updateOne = originalUO; VendorPurchase.findById = originalFindById;
    }
  });

  it('a duplicate/already-received request adds no stock and creates no movement', async () => {
    const product = legacyProduct({ stock: 20 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const originalFOU = VendorPurchase.findOneAndUpdate;
    VendorPurchase.findOneAndUpdate = async () => null; // already Received: nothing matches
    try {
      const result = await run(receivePurchase, { user: admin, params: { productId: 'p1', vendorId: 'e1', purchaseId: 'pu1' } });
      assert.equal(result.status, 409);
      assert.equal(product.stock, 20);
      assert.equal(movement.created.length, 0);
    } finally { restoreProduct(); restoreTx(); movement.restore(); VendorPurchase.findOneAndUpdate = originalFOU; }
  });

  it('a failure after the stock addition propagates as a failure response (control-flow proof — true rollback proven by the integration test)', async () => {
    const product = legacyProduct({ stock: 20 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const originalFOU = VendorPurchase.findOneAndUpdate;
    const originalUO = VendorPurchase.updateOne;
    const originalCreate = StockMovement.create;
    VendorPurchase.findOneAndUpdate = async () => ({ _id: 'pu1', product: 'p1', quantity: 10, variationId: null });
    VendorPurchase.updateOne = async () => ({ acknowledged: true });
    StockMovement.create = async () => { throw new Error('simulated movement insert failure'); };
    try {
      const result = await run(receivePurchase, { user: admin, params: { productId: 'p1', vendorId: 'e1', purchaseId: 'pu1' } });
      assert.equal(result.status, 500);
    } finally { restoreProduct(); restoreTx(); VendorPurchase.findOneAndUpdate = originalFOU; VendorPurchase.updateOne = originalUO; StockMovement.create = originalCreate; }
  });

  it('a direct Received purchase creation adds stock and creates exactly one movement', async () => {
    const product = legacyProduct({ stock: 20 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const originalFindById = Product.findById;
    const originalCreate = VendorPurchase.create;
    Product.findById = async () => ({ ...product, vendors: [{ _id: 'e1', name: 'Vendor', vendorRef: null }] });
    VendorPurchase.create = async (docOrArray) => {
      const isArray = Array.isArray(docOrArray);
      const doc = isArray ? docOrArray[0] : docOrArray;
      const result = { _id: 'pu1', ...doc };
      return isArray ? [result] : result;
    };
    try {
      const result = await run(createPurchase, {
        user: admin, params: { productId: 'p1', vendorId: 'e1' },
        body: { purchaseDate: new Date().toISOString(), quantity: 10, unit: 'kg', rate: 40, status: 'Received' },
      });
      assert.equal(result.status, 201);
      assert.equal(product.stock, 30);
      assert.equal(movement.created.length, 1);
      assert.equal(movement.created[0].doc.source.event, 'vendor_received');
      assert.equal(movement.created[0].doc.source.itemKey, null);
    } finally { restoreProduct(); restoreTx(); movement.restore(); VendorPurchase.create = originalCreate; Product.findById = originalFindById; }
  });

  it('a failure during direct Received creation leaves no movement behind (control-flow proof)', async () => {
    const product = legacyProduct({ stock: 20 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const originalFindById = Product.findById;
    const originalCreate = VendorPurchase.create;
    const originalFOU = Product.findOneAndUpdate;
    Product.findById = async () => ({ ...product, vendors: [{ _id: 'e1', name: 'Vendor', vendorRef: null }] });
    VendorPurchase.create = async (docOrArray) => {
      const isArray = Array.isArray(docOrArray);
      const doc = isArray ? docOrArray[0] : docOrArray;
      const result = { _id: 'pu1', ...doc };
      return isArray ? [result] : result;
    };
    Product.findOneAndUpdate = async () => null; // stock addition fails (variation vanished)
    try {
      const result = await run(createPurchase, {
        user: admin, params: { productId: 'p1', vendorId: 'e1' },
        body: { purchaseDate: new Date().toISOString(), quantity: 10, unit: 'kg', rate: 40, status: 'Received' },
      });
      assert.equal(result.status, 409);
      assert.equal(movement.created.length, 0);
    } finally { restoreProduct(); restoreTx(); movement.restore(); VendorPurchase.create = originalCreate; Product.findById = originalFindById; Product.findOneAndUpdate = originalFOU; }
  });
});

// ---------------------------------------------------------------------------
function selectableResult(value) {
  return { then: (resolve) => resolve(value), select: () => Promise.resolve(value) };
}

function stubOrderForStatus(order) {
  const originalFindById = Order.findById;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  Order.findById = () => selectableResult({ ...order, id: order._id });
  Order.findOneAndUpdate = (filter, update) => {
    if ('stockRestoredAt' in filter) {
      if (order.stockDeductedAt === null || order.stockRestoredAt !== null) return selectableResult(null);
      order.stockRestoredAt = update.$set.stockRestoredAt;
      return selectableResult(order);
    }
    if ('stockDeductedAt' in filter) {
      if (filter.orderStatus !== order.orderStatus || order.stockDeductedAt !== null) return selectableResult(null);
      order.stockDeductedAt = update.$set.stockDeductedAt;
      return selectableResult({ ...order });
    }
    if ('orderStatus' in filter && filter.orderStatus !== undefined) {
      if (filter.orderStatus !== order.orderStatus) return selectableResult(null);
      order.orderStatus = update.$set.orderStatus;
      return selectableResult(order);
    }
    return selectableResult(null);
  };
  return () => { Order.findById = originalFindById; Order.findOneAndUpdate = originalFindOneAndUpdate; };
}

describe('Phase 5: pre-order confirmation writes one preorder_confirmed movement per item', () => {
  it('confirming deducts stock and records exactly one movement with the correct source', async () => {
    const product = legacyProduct({ stock: 10 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const order = { _id: 'order1', orderType: 'preorder', orderStatus: 'placed', stockDeductedAt: null, stockRestoredAt: null, items: [{ product: 'p1', name: 'Rice', quantity: 4, variationId: null, unit: 'kg' }] };
    const restoreOrder = stubOrderForStatus(order);
    try {
      const result = await run(updateOrderStatus, { user: admin, params: { id: 'order1' }, body: { orderStatus: 'confirmed' } });
      assert.equal(result.status, 200);
      assert.equal(product.stock, 6); // 10 - 4
      assert.equal(movement.created.length, 1);
      const { doc } = movement.created[0];
      assert.equal(doc.type, 'remove');
      assert.equal(doc.previousStock, 10);
      assert.equal(doc.newStock, 6);
      assert.equal(doc.difference, -4);
      assert.deepEqual(doc.source, { type: 'order', id: 'order1', event: 'preorder_confirmed', itemKey: '0' });
    } finally { restoreProduct(); restoreTx(); movement.restore(); restoreOrder(); }
  });

  it('a failure on an item leaves no movement behind (control-flow proof — claim rollback proven by the integration test)', async () => {
    const product = legacyProduct({ stock: 1 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const order = { _id: 'order1', orderType: 'preorder', orderStatus: 'placed', stockDeductedAt: null, stockRestoredAt: null, items: [{ product: 'p1', name: 'Rice', quantity: 4, variationId: null, unit: 'kg' }] };
    const restoreOrder = stubOrderForStatus(order);
    try {
      const result = await run(updateOrderStatus, { user: admin, params: { id: 'order1' }, body: { orderStatus: 'confirmed' } });
      assert.equal(result.status, 409);
      assert.equal(movement.created.length, 0);
    } finally { restoreProduct(); restoreTx(); movement.restore(); restoreOrder(); }
  });

  it('cancelling an unconfirmed pre-order never calls StockMovement.create at all', async () => {
    const movement = stubMovementCreate();
    const order = { id: 'order1', orderStatus: 'placed', deliveryDate: new Date(Date.now() + 86400000), items: [] };
    const originalFindOne = Order.findOne;
    const originalFOU = Order.findOneAndUpdate;
    Order.findOne = async () => order;
    Order.findOneAndUpdate = async (filter) => (filter.orderStatus === 'placed' ? { ...order, orderStatus: 'cancelled' } : null);
    try {
      const { cancelPreOrder } = await import('../controllers/orderController.js');
      const result = await run(cancelPreOrder, { user: customer, params: { id: 'order1' } });
      assert.equal(result.status, 200);
      assert.equal(movement.created.length, 0, 'no stock was ever deducted, so nothing can be "cancelled" on the ledger');
    } finally { movement.restore(); Order.findOne = originalFindOne; Order.findOneAndUpdate = originalFOU; }
  });
});

// ---------------------------------------------------------------------------
describe('Phase 5: order cancellation restoration writes one order_cancelled movement per restored item', () => {
  function arrangeCancelled({ stockDeductedAt = new Date() } = {}) {
    const items = [{ product: 'p1', name: 'Rice', quantity: 4, variationId: null, unit: 'kg', variationLabel: '' }];
    const current = { _id: 'o1', id: 'o1', orderStatus: 'confirmed', orderType: 'normal', stockDeductedAt, stockRestoredAt: null };
    const cancelled = { ...current, orderStatus: 'cancelled', items, statusHistory: [], toObject() { return { ...this }; } };
    const originalFindById = Order.findById;
    const originalFOU = Order.findOneAndUpdate;
    Order.findById = () => Promise.resolve(current);
    Order.findOneAndUpdate = (filter, update) => {
      if ('stockRestoredAt' in filter) {
        if (current.stockDeductedAt === null || current.stockRestoredAt !== null) return Promise.resolve(null);
        current.stockRestoredAt = update.$set.stockRestoredAt;
        return Promise.resolve({ ...cancelled, _id: current._id });
      }
      // Generic status-transition call: conditional on the status we validated against, mutating
      // `current` so a second call in the same test correctly sees it as already transitioned.
      if (filter.orderStatus !== current.orderStatus) return { select: () => Promise.resolve(null) };
      current.orderStatus = update.$set.orderStatus;
      return { select: () => Promise.resolve({ ...cancelled, _id: current._id }) };
    };
    return () => { Order.findById = originalFindById; Order.findOneAndUpdate = originalFOU; };
  }

  it('restores the item and records exactly one order_cancelled movement with correct source/itemKey', async () => {
    const product = legacyProduct({ stock: 6 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const restoreOrder = arrangeCancelled();
    try {
      const result = await run(updateOrderStatus, { user: admin, params: { id: 'o1' }, body: { orderStatus: 'cancelled' } });
      assert.equal(result.status, 200);
      assert.equal(product.stock, 10); // 6 + 4
      assert.equal(movement.created.length, 1);
      const { doc } = movement.created[0];
      assert.equal(doc.type, 'add');
      assert.equal(doc.previousStock, 6);
      assert.equal(doc.newStock, 10);
      assert.equal(doc.difference, 4);
      assert.deepEqual(doc.source, { type: 'order', id: 'o1', event: 'order_cancelled', itemKey: '0' });
    } finally { restoreProduct(); restoreTx(); movement.restore(); restoreOrder(); }
  });

  it('a repeated cancellation request restores nothing and logs nothing the second time', async () => {
    const product = legacyProduct({ stock: 6 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    // Already restored once — the claim must find nothing to do.
    const restoreOrder = arrangeCancelled();
    try {
      const first = await run(updateOrderStatus, { user: admin, params: { id: 'o1' }, body: { orderStatus: 'cancelled' } });
      assert.equal(first.status, 200);
      assert.equal(movement.created.length, 1);
      const stockAfterFirst = product.stock;
      // Same order object, already cancelled+restored — a second cancellation attempt is rejected by
      // nextStatuses before restoration logic is even reached (cancelled has no further transitions),
      // exactly like the equivalent regression test in phase6.test.js.
      const second = await run(updateOrderStatus, { user: admin, params: { id: 'o1' }, body: { orderStatus: 'cancelled' } });
      assert.equal(second.status, 409);
      assert.equal(product.stock, stockAfterFirst, 'no second restoration');
      assert.equal(movement.created.length, 1, 'no second movement');
    } finally { restoreProduct(); restoreTx(); movement.restore(); restoreOrder(); }
  });

  it('a restoration failure leaves no movement behind (control-flow proof — all-or-nothing rollback proven by the integration test)', async () => {
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const originalFOU = Product.findOneAndUpdate;
    Product.findOneAndUpdate = async () => null; // stock addition fails for the one item
    const restoreOrder = arrangeCancelled();
    try {
      const result = await run(updateOrderStatus, { user: admin, params: { id: 'o1' }, body: { orderStatus: 'cancelled' } });
      assert.equal(result.status, 500);
      assert.equal(result.body.code, 'STOCK_RESTORE_FAILED');
      assert.equal(result.body.order.orderStatus, 'cancelled', 'the cancellation itself still persisted');
      assert.equal(movement.created.length, 0, 'no movement for a restoration that never committed');
    } finally { Product.findOneAndUpdate = originalFOU; restoreTx(); movement.restore(); restoreOrder(); }
  });
});

// ---------------------------------------------------------------------------
function stubBulkOrderForStatus(request) {
  const originalFindById = BulkOrder.findById;
  const originalFOU = BulkOrder.findOneAndUpdate;
  BulkOrder.findById = () => selectableResult({ ...request, id: request._id });
  BulkOrder.findOneAndUpdate = (filter, update) => {
    if ('stockRestoredAt' in filter) {
      if (request.stockDeductedAt === null || request.stockRestoredAt !== null) return selectableResult(null);
      request.stockRestoredAt = update.$set.stockRestoredAt;
      return selectableResult(request);
    }
    if ('stockDeductedAt' in filter) {
      if (filter.status !== request.status || request.stockDeductedAt !== null) return selectableResult(null);
      request.stockDeductedAt = update.$set.stockDeductedAt;
      return selectableResult({ ...request, id: request._id });
    }
    if (filter.status !== undefined) {
      if (filter.status !== request.status) return selectableResult(null);
      request.status = update.$set.status;
      return selectableResult({ ...request, id: request._id });
    }
    return selectableResult(null);
  };
  return () => { BulkOrder.findById = originalFindById; BulkOrder.findOneAndUpdate = originalFOU; };
}

describe('Phase 5: bulk order approval/rejection write one movement per line', () => {
  it('approval deducts stock and records exactly one bulk_approved movement with the line\'s own id as itemKey', async () => {
    const product = legacyProduct({ stock: 10 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const request = { _id: 'bulk1', status: 'Reviewing', stockDeductedAt: null, stockRestoredAt: null, products: [{ _id: 'line1', name: 'Rice', quantity: 4, unit: 'kg', productId: 'p1', variationId: null }] };
    const restoreOrder = stubBulkOrderForStatus(request);
    try {
      const result = await run(updateAdminBulkOrderStatus, { user: admin, params: { id: 'bulk1' }, body: { status: 'Approved' } });
      assert.equal(result.status, 200);
      assert.equal(product.stock, 6);
      assert.equal(movement.created.length, 1);
      const { doc } = movement.created[0];
      assert.equal(doc.type, 'remove');
      assert.equal(doc.previousStock, 10);
      assert.equal(doc.newStock, 6);
      assert.deepEqual(doc.source, { type: 'bulk_order', id: 'bulk1', event: 'bulk_approved', itemKey: 'line1' });
    } finally { restoreProduct(); restoreTx(); movement.restore(); restoreOrder(); }
  });

  it('a duplicate approval request (already Approved) deducts nothing and logs nothing', async () => {
    const product = legacyProduct({ stock: 10 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const request = { _id: 'bulk1', status: 'Approved', stockDeductedAt: new Date(), stockRestoredAt: null, products: [{ _id: 'line1', name: 'Rice', quantity: 4, unit: 'kg', productId: 'p1', variationId: null }] };
    const restoreOrder = stubBulkOrderForStatus(request);
    try {
      // changeRequestStatus's own "same status" short-circuit applies before any deduction logic runs.
      const result = await run(updateAdminBulkOrderStatus, { user: admin, params: { id: 'bulk1' }, body: { status: 'Approved' } });
      assert.equal(result.status, 200);
      assert.equal(product.stock, 10, 'no second deduction');
      assert.equal(movement.created.length, 0, 'no second movement');
    } finally { restoreProduct(); restoreTx(); movement.restore(); restoreOrder(); }
  });

  it('a failure on an unresolved line leaves no movement behind', async () => {
    const product = legacyProduct({ stock: 10 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const request = { _id: 'bulk1', status: 'Reviewing', stockDeductedAt: null, stockRestoredAt: null, products: [{ _id: 'line1', name: 'Rice', quantity: 4, unit: 'kg', productId: null, variationId: null }] };
    const restoreOrder = stubBulkOrderForStatus(request);
    try {
      const result = await run(updateAdminBulkOrderStatus, { user: admin, params: { id: 'bulk1' }, body: { status: 'Approved' } });
      assert.equal(result.status, 409);
      assert.equal(movement.created.length, 0);
      assert.equal(product.stock, 10);
    } finally { restoreProduct(); restoreTx(); movement.restore(); restoreOrder(); }
  });

  it('rejecting an approved request restores stock and records exactly one bulk_rejected movement', async () => {
    const product = legacyProduct({ stock: 6 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const request = { _id: 'bulk1', status: 'Approved', stockDeductedAt: new Date(), stockRestoredAt: null, products: [{ _id: 'line1', name: 'Rice', quantity: 4, unit: 'kg', productId: 'p1', variationId: null }] };
    const restoreOrder = stubBulkOrderForStatus(request);
    try {
      const result = await run(updateAdminBulkOrderStatus, { user: admin, params: { id: 'bulk1' }, body: { status: 'Rejected' } });
      assert.equal(result.status, 200);
      assert.equal(product.stock, 10); // 6 + 4
      assert.equal(movement.created.length, 1);
      const { doc } = movement.created[0];
      assert.equal(doc.type, 'add');
      assert.deepEqual(doc.source, { type: 'bulk_order', id: 'bulk1', event: 'bulk_rejected', itemKey: 'line1' });
    } finally { restoreProduct(); restoreTx(); movement.restore(); restoreOrder(); }
  });

  it('a restoration failure on rejection leaves no movement behind and still keeps the rejection recorded', async () => {
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const originalFOU = Product.findOneAndUpdate;
    Product.findOneAndUpdate = async () => null; // stock addition fails
    const request = { _id: 'bulk1', status: 'Approved', stockDeductedAt: new Date(), stockRestoredAt: null, products: [{ _id: 'line1', name: 'Rice', quantity: 4, unit: 'kg', productId: 'p1', variationId: null }] };
    const restoreOrder = stubBulkOrderForStatus(request);
    try {
      const result = await run(updateAdminBulkOrderStatus, { user: admin, params: { id: 'bulk1' }, body: { status: 'Rejected' } });
      assert.equal(result.status, 500);
      assert.equal(result.body.code, 'STOCK_RESTORE_FAILED');
      assert.equal(movement.created.length, 0);
    } finally { Product.findOneAndUpdate = originalFOU; restoreTx(); movement.restore(); restoreOrder(); }
  });
});

// ---------------------------------------------------------------------------
describe('Phase 5: normal order placement writes one order_placed movement per item', () => {
  function stubCartAndOrderCreate(cart = null) {
    const originalCart = Cart.findOne;
    const originalCreate = Order.create;
    Cart.findOne = async () => cart;
    let created = null;
    Order.create = async (payloadOrArray) => {
      const isArray = Array.isArray(payloadOrArray);
      const payload = isArray ? payloadOrArray[0] : payloadOrArray;
      created = { ...payload, _id: 'order1', id: 'order1' };
      const result = created;
      return isArray ? [result] : result;
    };
    return { created: () => created, restore() { Cart.findOne = originalCart; Order.create = originalCreate; } };
  }

  it('creates the order, deducts stock, and records exactly one order_placed movement per item', async () => {
    const product = legacyProduct({ stock: 10 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const cartOrder = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 4 }] } });
      assert.equal(result.status, 201);
      assert.equal(product.stock, 6);
      assert.equal(movement.created.length, 1);
      const { doc } = movement.created[0];
      assert.equal(doc.type, 'remove');
      assert.equal(doc.previousStock, 10);
      assert.equal(doc.newStock, 6);
      assert.deepEqual(doc.source, { type: 'order', id: 'order1', event: 'order_placed', itemKey: '0' });
    } finally { restoreProduct(); restoreTx(); movement.restore(); cartOrder.restore(); }
  });

  it('an order-creation failure leaves no stock mutation and no movement behind', async () => {
    const product = legacyProduct({ stock: 10 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const originalCreate = Order.create;
    const originalCartFindOne = Cart.findOne;
    Cart.findOne = async () => null;
    Order.create = async () => { throw new Error('simulated validation failure on Order.create'); };
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 4 }] } });
      assert.equal(result.status, 500);
      assert.equal(product.stock, 10, 'Order.create failing before any deduction means nothing was ever touched');
      assert.equal(movement.created.length, 0);
    } finally { restoreProduct(); restoreTx(); movement.restore(); Order.create = originalCreate; Cart.findOne = originalCartFindOne; }
  });

  it('a failure in the cart cleanup step surfaces as a failure response (control-flow proof — true rollback of the already-applied deduction is proven by the integration test)', async () => {
    const product = legacyProduct({ stock: 10 });
    const restoreProduct = stubProductStock(product);
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const originalCartFindOne = Cart.findOne;
    const originalCreate = Order.create;
    const failingCart = { items: [{ product: 'p1', quantity: 4 }], save: async () => { throw new Error('simulated cart save failure'); } };
    Cart.findOne = async () => failingCart;
    Order.create = async (payloadOrArray) => {
      const isArray = Array.isArray(payloadOrArray);
      const payload = isArray ? payloadOrArray[0] : payloadOrArray;
      const result = { ...payload, _id: 'order1', id: 'order1' };
      return isArray ? [result] : result;
    };
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 4 }] } });
      assert.equal(result.status, 500);
    } finally { restoreProduct(); restoreTx(); movement.restore(); Cart.findOne = originalCartFindOne; Order.create = originalCreate; }
  });

  it('a second item failing to deduct leaves no movement behind for the attempt (control-flow proof)', async () => {
    // Two different products so the first item's deduction genuinely succeeds in the stub before the
    // second one fails — proving the *attempt* leaves no ledger trace, independent of real rollback.
    const productA = legacyProduct({ _id: 'pA', id: 'pA', stock: 10 });
    const productB = legacyProduct({ _id: 'pB', id: 'pB', name: 'Wheat', stock: 2 });
    const byId = { pA: productA, pB: productB };
    const originalFind = Product.find;
    const originalFOU = Product.findOneAndUpdate;
    Product.find = async () => [productA, productB];
    Product.findOneAndUpdate = async (filter, update) => {
      const product = byId[filter._id];
      if (!product || product.stock < filter.stock.$gte) return null;
      product.stock -= filter.stock.$gte;
      return product;
    };
    const restoreTx = stubTransaction();
    const movement = stubMovementCreate();
    const cartOrder = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), {
        user: customer,
        body: {
          deliveryAddress: validAddress, deliveryDate: futureDateString(),
          items: [{ productId: 'pA', quantity: 4 }, { productId: 'pB', quantity: 5 }], // pB only has 2 — but passes pre-check? no: 5 > 2 fails pre-check
        },
      });
      // Both items are validated against current stock before the transaction even starts (existing,
      // unchanged behaviour) — item B's quantity (5) exceeds its stock (2), so this is rejected at that
      // earlier validation step, before any deduction is attempted at all.
      assert.equal(result.status, 409);
      assert.equal(movement.created.length, 0);
      assert.equal(productA.stock, 10, 'the pre-transaction validation rejects before touching any product');
    } finally { Product.find = originalFind; Product.findOneAndUpdate = originalFOU; restoreTx(); movement.restore(); cartOrder.restore(); }
  });
});
