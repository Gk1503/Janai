import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import BulkOrder from '../models/BulkOrder.js';
import StockMovement from '../models/StockMovement.js';
import VendorPurchase from '../models/VendorPurchase.js';
import Vendor from '../models/Vendor.js';
import Cart from '../models/Cart.js';
import Settings from '../models/Settings.js';
import {
  LEGACY_VARIATION_ID, deductVariationStock, getEffectiveVariations, isLegacyTarget, resolveVariation, restoreVariationStock,
} from '../utils/productVariations.js';
import { createOrder, updateOrderStatus, cancelPreOrder } from '../controllers/orderController.js';
import { createPurchase, receivePurchase } from '../controllers/vendorController.js';
import { resolveBulkOrderItems, updateAdminBulkOrderStatus } from '../controllers/bulkOrderController.js';
import { transactionHelper } from '../utils/withTransaction.js';

// Phase 5: normal order placement, pre-order confirmation, order cancellation/rejection restoration,
// bulk approval/rejection, and vendor purchase create/receive all now run inside a real MongoDB
// transaction and write StockMovement record(s). This file has no real database connection, so both are
// replaced with simple pass-throughs — nothing here tests transaction mechanics or ledger content, only
// the pre-existing variation-aware stock behaviour.
transactionHelper.run = async (work) => work({ id: 'fake-session' });
// createOrder reads order and deals settings; without a stub each read waits ~10s for a database.
Settings.findOne = () => ({ lean: async () => ({ orderSettings: { deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 } }) });
StockMovement.create = async (docs) => docs.map((doc, index) => ({ ...doc, _id: `stub-movement-${index}` }));

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

const futureDateString = (daysAhead = 1) => {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
};
const validAddress = { recipient: 'Asha', phone: '9876543210', street: 'MG Road', postalCode: '411001' };
const customer = { id: 'cust1', role: 'customer' };
const admin = { _id: 'owner1', id: 'owner1', role: 'admin', firstName: 'Owner' };

function legacyProduct(overrides = {}) {
  return { _id: 'p1', id: 'p1', name: 'Tomato', price: 50, unit: 'kg', stock: 10, images: [], preOrderAvailable: true, variations: [], ...overrides };
}
function variedProduct(overrides = {}) {
  return {
    _id: 'p1', id: 'p1', name: 'Tomato', price: 50, unit: 'kg', stock: 0, images: [], preOrderAvailable: true,
    variations: [
      { _id: 'v500g', label: '500 g', unit: '500 g', stock: 5, minStockThreshold: 2, isActive: true },
      { _id: 'v1kg', label: '1 kg', unit: 'kg', stock: 3, minStockThreshold: 1, isActive: true },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
describe('utils/productVariations.js (pure)', () => {
  it('a product with no variations resolves to one implicit legacy default backed by top-level stock/unit', () => {
    const product = legacyProduct({ stock: 7, unit: 'kg' });
    const effective = getEffectiveVariations(product);
    assert.equal(effective.length, 1);
    assert.equal(effective[0]._id, LEGACY_VARIATION_ID);
    assert.equal(effective[0].stock, 7);
    assert.equal(effective[0].unit, 'kg');
    assert.equal(isLegacyTarget(product, null), true);
    assert.equal(isLegacyTarget(product, 'anything'), true);
  });

  it('a product with real variations resolves each by id, and an unknown/inactive id resolves to nothing', () => {
    const product = variedProduct();
    assert.equal(resolveVariation(product, 'v500g').stock, 5);
    assert.equal(resolveVariation(product, 'v1kg').unit, 'kg');
    assert.equal(resolveVariation(product, 'does-not-exist'), null);
    assert.equal(isLegacyTarget(product, 'v500g'), false);
    const withInactive = variedProduct({ variations: [{ _id: 'vgone', label: 'Old', unit: 'kg', stock: 9, isActive: false }] });
    assert.equal(resolveVariation(withInactive, 'vgone'), null);
  });
});

// ---------------------------------------------------------------------------
describe('deductVariationStock / restoreVariationStock (atomic guard shape)', () => {
  it('targets top-level stock for the legacy case, and the correct array element for a real variation', async () => {
    const calls = [];
    const original = Product.findOneAndUpdate;
    Product.findOneAndUpdate = async (filter, update, options) => { calls.push({ filter, update, options }); return { ok: true }; };
    try {
      await deductVariationStock(Product, { productId: 'p1', variationId: null, isLegacy: true, quantity: 3 });
      assert.deepEqual(calls[0].filter, { _id: 'p1', stock: { $gte: 3 } });
      assert.deepEqual(calls[0].update, { $inc: { stock: -3 } });

      await deductVariationStock(Product, { productId: 'p1', variationId: 'v500g', isLegacy: false, quantity: 2 });
      assert.deepEqual(calls[1].filter, { _id: 'p1', variations: { $elemMatch: { _id: 'v500g', stock: { $gte: 2 }, isActive: { $ne: false } } } });
      assert.deepEqual(calls[1].update, { $inc: { 'variations.$[elem].stock': -2 } });
      assert.deepEqual(calls[1].options.arrayFilters, [{ 'elem._id': 'v500g' }]);
    } finally { Product.findOneAndUpdate = original; }
  });

  it('restoration increments the correct target unconditionally', async () => {
    const calls = [];
    const original = Product.updateOne;
    Product.updateOne = async (filter, update) => { calls.push({ filter, update }); return { matchedCount: 1 }; };
    try {
      await restoreVariationStock(Product, { productId: 'p1', variationId: null, isLegacy: true, quantity: 4 });
      assert.deepEqual(calls[0], { filter: { _id: 'p1' }, update: { $inc: { stock: 4 } } });
      await restoreVariationStock(Product, { productId: 'p1', variationId: 'v1kg', isLegacy: false, quantity: 1 });
      assert.deepEqual(calls[1], { filter: { _id: 'p1', 'variations._id': 'v1kg' }, update: { $inc: { 'variations.$.stock': 1 } } });
    } finally { Product.updateOne = original; }
  });
});

// ---------------------------------------------------------------------------
// A small, self-contained in-memory Product.findOneAndUpdate/updateOne stub that actually understands
// both the legacy and variation-array guard shapes, so these tests exercise real race/guard behaviour
// rather than a hand-fed success value.
function stubProductStock(product) {
  const originalFOU = Product.findOneAndUpdate;
  const originalUO = Product.updateOne;
  const originalFind = Product.find;
  const originalFindById = Product.findById;
  Product.find = async () => [product];
  Product.findById = async () => product;
  Product.findOneAndUpdate = async (filter, update) => {
    if (filter.stock) {
      // deductVariationStock's legacy branch (guarded decrement).
      if (product.stock < filter.stock.$gte) return null;
      product.stock -= filter.stock.$gte; // delta always equals the guarded quantity here
      return product;
    }
    if (filter.variations?.$elemMatch) {
      // deductVariationStock's real-variation branch (guarded decrement).
      const variation = product.variations.find((entry) => entry._id === filter.variations.$elemMatch._id);
      if (!variation || variation.stock < filter.variations.$elemMatch.stock.$gte || variation.isActive === false) return null;
      variation.stock -= filter.variations.$elemMatch.stock.$gte;
      return product;
    }
    if (filter['variations._id'] !== undefined) {
      // addVariationStock's real-variation branch (Phase 5): plain _id match, unconditional increment.
      const variation = product.variations.find((entry) => entry._id === filter['variations._id']);
      if (!variation) return null;
      variation.stock += update.$inc['variations.$.stock'];
      return product;
    }
    // addVariationStock's legacy branch (Phase 5): no filter conditions beyond _id.
    if (update?.$inc?.stock !== undefined) { product.stock += update.$inc.stock; return product; }
    return null;
  };
  Product.updateOne = async (filter, update) => {
    if ('stock' in (update.$inc)) { product.stock += update.$inc.stock; return { matchedCount: 1 }; }
    const variation = product.variations.find((entry) => entry._id === filter['variations._id']);
    if (!variation) return { matchedCount: 0 };
    variation.stock += update.$inc['variations.$.stock'];
    return { matchedCount: 1 };
  };
  return () => { Product.findOneAndUpdate = originalFOU; Product.updateOne = originalUO; Product.find = originalFind; Product.findById = originalFindById; };
}

function stubCartAndOrderCreate() {
  const originalCart = Cart.findOne;
  const originalCreate = Order.create;
  Cart.findOne = async () => null;
  let created = null;
  // Phase 5: a normal order is created via the array form (Order.create([doc], {session})) — the only
  // shape that actually carries a session in real Mongoose — while a pre-order still uses the original
  // plain-object form. Both are supported here so existing single-object-form assertions keep working.
  Order.create = async (payloadOrArray) => {
    const isArray = Array.isArray(payloadOrArray);
    const payload = isArray ? payloadOrArray[0] : payloadOrArray;
    created = payload;
    const result = { ...payload, _id: 'order1', id: 'order1' };
    return isArray ? [result] : result;
  };
  return { created: () => created, restore() { Cart.findOne = originalCart; Order.create = originalCreate; } };
}

describe('createOrder: variation-aware stock deduction', () => {
  it('a legacy product (no variations) deducts top-level stock exactly as before — regression', async () => {
    const product = legacyProduct({ stock: 10 });
    const restoreProduct = stubProductStock(product);
    const cartOrder = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 3 }] } });
      assert.equal(result.status, 201);
      assert.equal(product.stock, 7);
      assert.equal(cartOrder.created().items[0].variationId, null);
      assert.equal(cartOrder.created().stockDeductedAt instanceof Date, true);
    } finally { restoreProduct(); cartOrder.restore(); }
  });

  it('deducts from the selected variation only, leaving the other variation untouched', async () => {
    const product = variedProduct();
    const restoreProduct = stubProductStock(product);
    const cartOrder = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 2, variationId: 'v500g' }] } });
      assert.equal(result.status, 201);
      assert.equal(product.variations[0].stock, 3); // 5 - 2
      assert.equal(product.variations[1].stock, 3); // untouched
      assert.equal(cartOrder.created().items[0].variationId, 'v500g');
    } finally { restoreProduct(); cartOrder.restore(); }
  });

  it('rejects with 409 and deducts nothing when the chosen variation has insufficient stock', async () => {
    const product = variedProduct();
    const restoreProduct = stubProductStock(product);
    const cartOrder = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 99, variationId: 'v500g' }] } });
      assert.equal(result.status, 409);
      assert.equal(product.variations[0].stock, 5);
      assert.equal(cartOrder.created(), null);
    } finally { restoreProduct(); cartOrder.restore(); }
  });

  it('never partially deducts: a second item failing rolls back the first item already reserved', async () => {
    const product = variedProduct();
    const restoreProduct = stubProductStock(product);
    const cartOrder = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), {
        user: customer,
        body: {
          deliveryAddress: validAddress, deliveryDate: futureDateString(),
          items: [{ productId: 'p1', quantity: 2, variationId: 'v500g' }, { productId: 'p1', quantity: 99, variationId: 'v1kg' }],
        },
      });
      assert.equal(result.status, 409);
      assert.equal(product.variations[0].stock, 5, 'the first item must be rolled back, not left deducted');
      assert.equal(product.variations[1].stock, 3);
    } finally { restoreProduct(); cartOrder.restore(); }
  });

  it('a pre-order never deducts stock at placement, for either a legacy or a variation-level product', async () => {
    const product = variedProduct();
    const restoreProduct = stubProductStock(product);
    const cartOrder = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('preorder'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(2), items: [{ productId: 'p1', quantity: 2, variationId: 'v500g' }] } });
      assert.equal(result.status, 201);
      assert.equal(product.variations[0].stock, 5, 'pre-order placement must not touch stock');
      assert.equal(cartOrder.created().stockDeductedAt, null);
    } finally { restoreProduct(); cartOrder.restore(); }
  });
});

// ---------------------------------------------------------------------------
// Mongoose's findOneAndUpdate/findById return a Query, which is both awaitable AND chainable with
// .select(). A plain async function returning a value isn't chainable (its return is already a
// Promise, which has no .select), so every stub result that might have .select() called on it needs
// to be a plain thenable object instead.
function selectableResult(value) {
  return { then: (resolve) => resolve(value), select: () => Promise.resolve(value) };
}

function stubOrderForStatus(order) {
  const originalFindById = Order.findById;
  const originalFindOneAndUpdate = Order.findOneAndUpdate;
  const originalUpdateOne = Order.updateOne;
  Order.findById = () => selectableResult({ ...order, id: order._id });
  // findOneAndUpdate is used both for the stock-deduction claim and the actual status transition; both
  // are conditional on fields already present on `order`, mirroring the real guarded-update semantics.
  Order.findOneAndUpdate = (filter, update) => {
    // Checked before the deduction-claim branch below: the restoration filter also carries a
    // stockDeductedAt key (as its "has this order actually deducted?" guard), so it must be
    // distinguished by its more specific stockRestoredAt key first.
    if ('stockRestoredAt' in filter) {
      if (order.stockDeductedAt === null || order.stockRestoredAt !== null) return selectableResult(null);
      order.stockRestoredAt = update.$set.stockRestoredAt;
      return selectableResult(order);
    }
    if ('stockDeductedAt' in filter) {
      if (filter.orderStatus !== order.orderStatus || order.stockDeductedAt !== null) return selectableResult(null);
      order.stockDeductedAt = update.$set.stockDeductedAt;
      return selectableResult({ ...order, items: order.items.map((item) => ({ ...item, toObject: () => ({ ...item }) })) });
    }
    if ('orderStatus' in filter && filter.orderStatus !== undefined) {
      if (filter.orderStatus !== order.orderStatus) return selectableResult(null);
      order.orderStatus = update.$set.orderStatus;
      return selectableResult(order);
    }
    return selectableResult(null);
  };
  Order.updateOne = async (filter, update) => {
    if ('stockDeductedAt' in update.$set) order.stockDeductedAt = update.$set.stockDeductedAt;
    return { matchedCount: 1 };
  };
  return () => { Order.findById = originalFindById; Order.findOneAndUpdate = originalFindOneAndUpdate; Order.updateOne = originalUpdateOne; };
}

const orderAccess = { orders: { update: 'orders:update_status', cancel: 'orders:cancel' }, preorders: { update: 'preorders:update', cancel: 'preorders:update' } };
const preorderAdmin = { ...admin, role: 'admin' }; // owner holds every permission

describe('updateOrderStatus: pre-order confirmation deducts stock exactly once', () => {
  it('confirming a placed pre-order deducts the chosen variation and proceeds to confirmed', async () => {
    const product = variedProduct();
    const restoreProduct = stubProductStock(product);
    const order = { _id: 'order1', orderType: 'preorder', orderStatus: 'placed', stockDeductedAt: null, stockRestoredAt: null, items: [{ product: 'p1', name: 'Tomato', quantity: 2, variationId: 'v500g' }] };
    const restoreOrder = stubOrderForStatus(order);
    try {
      const result = await run(updateOrderStatus, { user: preorderAdmin, params: { id: 'order1' }, body: { orderStatus: 'confirmed' } });
      assert.equal(result.status, 200);
      assert.equal(product.variations[0].stock, 3);
      assert.equal(order.orderStatus, 'confirmed');
      assert.notEqual(order.stockDeductedAt, null);
    } finally { restoreProduct(); restoreOrder(); }
  });

  it('a duplicate/concurrent confirm request is rejected and never deducts a second time', async () => {
    const product = variedProduct();
    const restoreProduct = stubProductStock(product);
    const order = { _id: 'order1', orderType: 'preorder', orderStatus: 'placed', stockDeductedAt: new Date(), stockRestoredAt: null, items: [{ product: 'p1', name: 'Tomato', quantity: 2, variationId: 'v500g' }] };
    const restoreOrder = stubOrderForStatus(order);
    try {
      const result = await run(updateOrderStatus, { user: preorderAdmin, params: { id: 'order1' }, body: { orderStatus: 'confirmed' } });
      assert.equal(result.status, 409);
      assert.equal(product.variations[0].stock, 5, 'a second confirm attempt must never deduct');
    } finally { restoreProduct(); restoreOrder(); }
  });

  it('insufficient stock at confirmation blocks it, rolls back, and releases the claim for a later retry', async () => {
    const product = variedProduct({ variations: [{ _id: 'v500g', label: '500 g', unit: '500 g', stock: 1, isActive: true }] });
    const restoreProduct = stubProductStock(product);
    const order = { _id: 'order1', orderType: 'preorder', orderStatus: 'placed', stockDeductedAt: null, stockRestoredAt: null, items: [{ product: 'p1', name: 'Tomato', quantity: 2, variationId: 'v500g' }] };
    const restoreOrder = stubOrderForStatus(order);
    try {
      const result = await run(updateOrderStatus, { user: preorderAdmin, params: { id: 'order1' }, body: { orderStatus: 'confirmed' } });
      assert.equal(result.status, 409);
      assert.equal(order.orderStatus, 'placed', 'must never confirm when stock could not be reserved');
      // Phase 5: the claim is released by the whole transaction aborting, not by a separate explicit
      // compensating write (the old rollbackConfirmation) — this stub calls transactionHelper.run's
      // replacement directly with no real rollback semantics, so it cannot observe that the claim write
      // itself was undone. That guarantee is proven for real in the MongoDB transaction integration test
      // (stockAdjustmentTransaction.test.mjs) instead; here we only check what the stub can actually show.
      assert.equal(product.variations[0].stock, 1, 'stock must be untouched by the failed attempt');
    } finally { restoreProduct(); restoreOrder(); }
  });

  it('cancelling an already-confirmed pre-order restores stock exactly once', async () => {
    const product = variedProduct({ variations: [{ _id: 'v500g', label: '500 g', unit: '500 g', stock: 3, isActive: true }] });
    const restoreProduct = stubProductStock(product);
    const order = {
      _id: 'order1', orderType: 'preorder', orderStatus: 'confirmed', stockDeductedAt: new Date(), stockRestoredAt: null,
      items: [{ product: 'p1', name: 'Tomato', quantity: 2, variationId: 'v500g' }],
    };
    const restoreOrder = stubOrderForStatus(order);
    try {
      const result = await run(updateOrderStatus, { user: preorderAdmin, params: { id: 'order1' }, body: { orderStatus: 'cancelled' } });
      assert.equal(result.status, 200);
      assert.equal(product.variations[0].stock, 5, '2 restored back onto the already-remaining 3');
      assert.notEqual(order.stockRestoredAt, null);
    } finally { restoreProduct(); restoreOrder(); }
  });

  it('a duplicate cancellation request never restores stock a second time', async () => {
    const product = variedProduct({ variations: [{ _id: 'v500g', label: '500 g', unit: '500 g', stock: 5, isActive: true }] });
    const restoreProduct = stubProductStock(product);
    // Already cancelled AND already restored once — a second attempt must find nothing to do.
    const order = {
      _id: 'order1', orderType: 'preorder', orderStatus: 'cancelled', stockDeductedAt: new Date(), stockRestoredAt: new Date(),
      items: [{ product: 'p1', name: 'Tomato', quantity: 2, variationId: 'v500g' }],
    };
    const restoreOrder = stubOrderForStatus(order);
    try {
      // Re-applying 'cancelled' on an already-cancelled order is rejected by the existing nextStatuses
      // guard (cancelled has no further transitions) before restoration logic is even reached.
      const result = await run(updateOrderStatus, { user: preorderAdmin, params: { id: 'order1' }, body: { orderStatus: 'cancelled' } });
      assert.equal(result.status, 409);
      assert.equal(product.variations[0].stock, 5, 'stock must be untouched by the rejected duplicate');
    } finally { restoreProduct(); restoreOrder(); }
  });

  it('a normal order cancellation still restores top-level stock exactly as before — regression', async () => {
    const product = legacyProduct({ stock: 4 });
    const restoreProduct = stubProductStock(product);
    const order = {
      _id: 'order1', orderType: 'normal', orderStatus: 'confirmed', stockDeductedAt: new Date(), stockRestoredAt: null,
      items: [{ product: 'p1', name: 'Tomato', quantity: 3, variationId: null }],
    };
    const restoreOrder = stubOrderForStatus(order);
    try {
      const result = await run(updateOrderStatus, { user: preorderAdmin, params: { id: 'order1' }, body: { orderStatus: 'cancelled' } });
      assert.equal(result.status, 200);
      assert.equal(product.stock, 7);
    } finally { restoreProduct(); restoreOrder(); }
  });
});

describe('cancelPreOrder: a still-placed pre-order never had stock deducted, so cancelling restores nothing', () => {
  it('cancels cleanly with no stock side effect', async () => {
    const product = variedProduct();
    const restoreProduct = stubProductStock(product);
    const originalFindOne = Order.findOne;
    const originalFindOneAndUpdate = Order.findOneAndUpdate;
    const order = { id: 'order1', orderStatus: 'placed', deliveryDate: new Date(Date.now() + 86400000), items: [] };
    Order.findOne = async () => order;
    Order.findOneAndUpdate = async (filter) => (filter.orderStatus === 'placed' ? { ...order, orderStatus: 'cancelled' } : null);
    try {
      const result = await run(cancelPreOrder, { user: customer, params: { id: 'order1' } });
      assert.equal(result.status, 200);
      assert.equal(product.variations[0].stock, 5);
      assert.equal(product.variations[1].stock, 3);
    } finally { restoreProduct(); Order.findOne = originalFindOne; Order.findOneAndUpdate = originalFindOneAndUpdate; }
  });
});

// ---------------------------------------------------------------------------
describe('vendorController: variation-aware purchase create/receive', () => {
  function stubFindProductVendor(product, embedded) {
    const original = Product.findById;
    Product.findById = async () => ({ ...product, vendors: [embedded] });
    return () => { Product.findById = original; };
  }

  it('a direct-to-Received purchase increments the correct variation exactly once', async () => {
    const product = variedProduct();
    const restoreProductStock = stubProductStock(product);
    const restoreFind = stubFindProductVendor(product, { _id: 'e1', name: 'Vendor', vendorRef: null });
    const originalCreate = VendorPurchase.create;
    // Phase 5: a Received-at-creation purchase is created via the array form (the only shape that
    // actually carries a session in real Mongoose).
    VendorPurchase.create = async (docOrArray) => {
      const isArray = Array.isArray(docOrArray);
      const doc = isArray ? docOrArray[0] : docOrArray;
      const result = { _id: 'pu1', ...doc };
      return isArray ? [result] : result;
    };
    try {
      const result = await run(createPurchase, {
        user: admin, params: { productId: 'p1', vendorId: 'e1' },
        body: { purchaseDate: new Date().toISOString(), quantity: 2, unit: '500 g', rate: 40, status: 'Received', variationId: 'v500g' },
      });
      assert.equal(result.status, 201);
      assert.equal(product.variations[0].stock, 7); // 5 + 2
      assert.equal(product.variations[1].stock, 3); // untouched
    } finally { restoreProductStock(); restoreFind(); VendorPurchase.create = originalCreate; }
  });

  it('receiving an Ordered purchase increments the variation stored on the purchase, not the product\'s current state', async () => {
    const product = variedProduct();
    const restoreProductStock = stubProductStock(product);
    const originalFOU = VendorPurchase.findOneAndUpdate;
    const originalUpdateOne = VendorPurchase.updateOne;
    const originalFindById = VendorPurchase.findById;
    VendorPurchase.findOneAndUpdate = async () => ({ _id: 'pu1', product: 'p1', quantity: 2, variationId: 'v1kg' });
    VendorPurchase.updateOne = async () => ({ acknowledged: true });
    VendorPurchase.findById = async () => ({ _id: 'pu1' });
    try {
      // Phase 5: the movement records who received it, so this needs an authenticated actor.
      const result = await run(receivePurchase, { user: admin, params: { productId: 'p1', vendorId: 'e1', purchaseId: 'pu1' } });
      assert.equal(result.status, 200);
      assert.equal(product.variations[1].stock, 5); // 3 + 2
      assert.equal(product.variations[0].stock, 5); // untouched
    } finally { restoreProductStock(); VendorPurchase.findOneAndUpdate = originalFOU; VendorPurchase.updateOne = originalUpdateOne; VendorPurchase.findById = originalFindById; }
  });

  it('duplicate receiving is still blocked by the existing atomic status guard — regression', async () => {
    const originalFOU = VendorPurchase.findOneAndUpdate;
    VendorPurchase.findOneAndUpdate = async () => null; // already Received: nothing matches
    try {
      const result = await run(receivePurchase, { params: { productId: 'p1', vendorId: 'e1', purchaseId: 'pu1' } });
      assert.equal(result.status, 409);
    } finally { VendorPurchase.findOneAndUpdate = originalFOU; }
  });

  it('a legacy product (no variations) still works exactly as before — regression', async () => {
    const product = legacyProduct({ stock: 10 });
    const restoreProductStock = stubProductStock(product);
    const restoreFind = stubFindProductVendor(product, { _id: 'e1', name: 'Vendor', vendorRef: null });
    const originalCreate = VendorPurchase.create;
    VendorPurchase.create = async (docOrArray) => {
      const isArray = Array.isArray(docOrArray);
      const doc = isArray ? docOrArray[0] : docOrArray;
      const result = { _id: 'pu1', ...doc };
      return isArray ? [result] : result;
    };
    try {
      const result = await run(createPurchase, {
        user: admin, params: { productId: 'p1', vendorId: 'e1' },
        body: { purchaseDate: new Date().toISOString(), quantity: 5, unit: 'kg', rate: 40, status: 'Received' },
      });
      assert.equal(result.status, 201);
      assert.equal(product.stock, 15);
    } finally { restoreProductStock(); restoreFind(); VendorPurchase.create = originalCreate; }
  });
});

// ---------------------------------------------------------------------------
function stubBulkOrder(request) {
  const originalFindById = BulkOrder.findById;
  const originalFOU = BulkOrder.findOneAndUpdate;
  const originalUpdateOne = BulkOrder.updateOne;
  BulkOrder.findById = () => {
    const doc = { ...request, id: request._id, save: async function () { Object.assign(request, this); return this; } };
    return selectableResult(doc);
  };
  BulkOrder.findOneAndUpdate = (filter, update) => {
    // Same ordering requirement as Order's own stub above: the restoration filter also carries a
    // stockDeductedAt key, so its more specific stockRestoredAt key must be checked first.
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
  BulkOrder.updateOne = async (filter, update) => {
    if ('stockDeductedAt' in update.$set) request.stockDeductedAt = update.$set.stockDeductedAt;
    return { matchedCount: 1 };
  };
  return () => { BulkOrder.findById = originalFindById; BulkOrder.findOneAndUpdate = originalFOU; BulkOrder.updateOne = originalUpdateOne; };
}

describe('bulkOrderController: item resolution and approval-time deduction', () => {
  it('resolveBulkOrderItems links a line to a real product + variation, never touching the original name/quantity', async () => {
    const product = variedProduct();
    const restoreProductStock = stubProductStock(product);
    const request = { _id: 'bulk1', status: 'Pending', products: [{ name: 'Tomatoes', quantity: 10, unit: 'kg' }] };
    const restoreOrder = stubBulkOrder(request);
    const fakeProductId = '507f1f77bcf86cd799439011'; // Product.findById is stubbed to ignore the id and return `product` regardless
    try {
      const result = await run(resolveBulkOrderItems, { user: admin, params: { id: 'bulk1' }, body: { items: [{ index: 0, productId: fakeProductId, variationId: 'v1kg' }] } });
      assert.equal(result.status, 200);
      assert.equal(request.products[0].productId, product._id);
      assert.equal(request.products[0].variationId, 'v1kg');
      assert.equal(request.products[0].name, 'Tomatoes', 'the customer\'s original free-text line is never rewritten');
    } finally { restoreProductStock(); restoreOrder(); }
  });

  it('approval is blocked while any line is unresolved, and deducts nothing', async () => {
    const product = variedProduct();
    const restoreProductStock = stubProductStock(product);
    const request = { _id: 'bulk1', status: 'Quoted', quotation: { items: [{ name: 'Tomatoes', quantity: 2, unit: 'kg', unitPrice: 20, lineTotal: 40 }], deliveryCharge: 0, totalAmount: 40 }, stockDeductedAt: null, stockRestoredAt: null, products: [{ name: 'Tomatoes', quantity: 2, unit: 'kg', productId: null, variationId: null }] };
    const restoreOrder = stubBulkOrder(request);
    try {
      const result = await run(updateAdminBulkOrderStatus, { user: admin, body: { status: 'Approved' } , params: { id: 'bulk1' }});
      assert.equal(result.status, 409);
      assert.equal(request.status, 'Quoted');
      assert.equal(product.variations[1].stock, 3);
    } finally { restoreProductStock(); restoreOrder(); }
  });

  it('approval deducts every resolved line exactly once and moves to Approved', async () => {
    const product = variedProduct();
    const restoreProductStock = stubProductStock(product);
    const request = { _id: 'bulk1', status: 'Quoted', quotation: { items: [{ name: 'Tomatoes', quantity: 2, unit: 'kg', unitPrice: 20, lineTotal: 40 }], deliveryCharge: 0, totalAmount: 40 }, stockDeductedAt: null, stockRestoredAt: null, products: [{ name: 'Tomatoes', quantity: 2, unit: 'kg', productId: 'p1', variationId: 'v1kg' }] };
    const restoreOrder = stubBulkOrder(request);
    try {
      const result = await run(updateAdminBulkOrderStatus, { user: admin, body: { status: 'Approved' }, params: { id: 'bulk1' } });
      assert.equal(result.status, 200);
      assert.equal(request.status, 'Approved');
      assert.equal(product.variations[1].stock, 1); // 3 - 2
    } finally { restoreProductStock(); restoreOrder(); }
  });

  it('a duplicate approval request never deducts twice', async () => {
    const product = variedProduct();
    const restoreProductStock = stubProductStock(product);
    const request = { _id: 'bulk1', status: 'Approved', stockDeductedAt: new Date(), stockRestoredAt: null, products: [{ name: 'Tomatoes', quantity: 2, unit: 'kg', productId: 'p1', variationId: 'v1kg' }] };
    const restoreOrder = stubBulkOrder(request);
    try {
      // Already Approved: changeRequestStatus's own "same status" short-circuit applies before any
      // deduction logic runs, which is itself a no-op — nothing should change.
      const result = await run(updateAdminBulkOrderStatus, { user: admin, body: { status: 'Approved' }, params: { id: 'bulk1' } });
      assert.equal(result.status, 200);
      assert.equal(product.variations[1].stock, 3, 'no second deduction for an already-approved request');
    } finally { restoreProductStock(); restoreOrder(); }
  });

  it('moving an approved request to Rejected restores stock exactly once', async () => {
    const product = variedProduct({ variations: [{ _id: 'v1kg', label: '1 kg', unit: 'kg', stock: 1, isActive: true }] });
    const restoreProductStock = stubProductStock(product);
    const request = { _id: 'bulk1', status: 'Approved', stockDeductedAt: new Date(), stockRestoredAt: null, products: [{ name: 'Tomatoes', quantity: 2, unit: 'kg', productId: 'p1', variationId: 'v1kg' }] };
    const restoreOrder = stubBulkOrder(request);
    try {
      const result = await run(updateAdminBulkOrderStatus, { user: admin, body: { status: 'Rejected', message: 'Out of stock' }, params: { id: 'bulk1' } });
      assert.equal(result.status, 200);
      assert.equal(product.variations[0].stock, 3); // 1 + 2
      assert.notEqual(request.stockRestoredAt, null);
    } finally { restoreProductStock(); restoreOrder(); }
  });
});
