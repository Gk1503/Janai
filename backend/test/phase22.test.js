// Phase 6: Produce Ordering Rules & MOQ Management. Stubbed-model unit tests, no real database
// connection — matches every other file in this suite. Settings.findOne is stubbed immediately so these
// tests don't pay the ~10s real-DB-timeout delay that createOrder's loadOrderPricingRules() otherwise
// incurs in a DB-less test run (see phase9/phase17's own tests, which already accept that cost).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import BulkOrder from '../models/BulkOrder.js';
import Cart from '../models/Cart.js';
import Settings from '../models/Settings.js';
import StockMovement from '../models/StockMovement.js';
import { effectiveMoq } from '../utils/productVariations.js';
import { validateOrderQuantity } from '../utils/quantity.js';
import { createOrder, updateOrderStatus } from '../controllers/orderController.js';
import { createBulkOrder, resolveBulkOrderItems, updateAdminBulkOrderStatus } from '../controllers/bulkOrderController.js';
import { transactionHelper } from '../utils/withTransaction.js';

Settings.findOne = () => ({ lean: async () => ({ orderSettings: { deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 } }) });
transactionHelper.run = async (work) => work({ id: 'fake-session' });
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

const customer = { id: 'cust1', _id: 'cust1', role: 'customer' };
const admin = { _id: 'owner1', id: 'owner1', role: 'admin', firstName: 'Owner', permissions: [] };
const validAddress = { recipient: 'Asha', phone: '9876543210', street: 'MG Road', postalCode: '411001' };
function futureDateString(daysAhead = 1) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
describe('effectiveMoq (pure)', () => {
  const base = { normalMoq: null, bulkMoq: null, preOrderMoq: null };
  it('returns normalMoq for normal orders', () => {
    assert.equal(effectiveMoq({ ...base, normalMoq: 5 }, 'normal'), 5);
  });
  it('bulk override takes precedence over normalMoq', () => {
    assert.equal(effectiveMoq({ ...base, normalMoq: 5, bulkMoq: 20 }, 'bulk'), 20);
  });
  it('pre-order override takes precedence over normalMoq', () => {
    assert.equal(effectiveMoq({ ...base, normalMoq: 5, preOrderMoq: 10 }, 'preorder'), 10);
  });
  it('bulk falls back to normalMoq when bulkMoq is unset', () => {
    assert.equal(effectiveMoq({ ...base, normalMoq: 5 }, 'bulk'), 5);
  });
  it('pre-order falls back to normalMoq when preOrderMoq is unset', () => {
    assert.equal(effectiveMoq({ ...base, normalMoq: 5 }, 'preorder'), 5);
  });
  it('missing normalMoq means no minimum for any order type', () => {
    assert.equal(effectiveMoq(base, 'normal'), null);
    assert.equal(effectiveMoq(base, 'bulk'), null);
    assert.equal(effectiveMoq(base, 'preorder'), null);
  });
  it('an explicit 0 means no minimum, and is never confused with "unconfigured" by a truthiness check', () => {
    assert.equal(effectiveMoq({ ...base, normalMoq: 0 }, 'normal'), 0);
    // A truthiness-based implementation would wrongly fall through past this explicit 0.
    assert.equal(effectiveMoq({ ...base, normalMoq: 10, bulkMoq: 0 }, 'bulk'), 0);
  });
  it('decimal MOQ values work', () => {
    assert.equal(effectiveMoq({ ...base, normalMoq: 2.5 }, 'normal'), 2.5);
  });
});

// ---------------------------------------------------------------------------
describe('validateOrderQuantity (pure)', () => {
  it('accepts a fractional quantity with exactly three decimal places', () => {
    assert.deepEqual(validateOrderQuantity(1.125), { value: 1.125 });
  });
  it('rejects more than three decimal places', () => {
    assert.ok(validateOrderQuantity(1.1234).error);
  });
  it('rejects zero, negative, NaN, Infinity and malformed strings', () => {
    for (const bad of [0, -1, NaN, Infinity, 'abc', '1.2.3']) assert.ok(validateOrderQuantity(bad).error, String(bad));
  });
  it('respects a lower min for MOQ-style validation (0 allowed)', () => {
    assert.deepEqual(validateOrderQuantity(0, { min: 0 }), { value: 0 });
  });
});

// ---------------------------------------------------------------------------
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
      if (update.$inc) variation.stock += update.$inc['variations.$[elem].stock'];
      return product;
    }
    if (update?.$inc?.stock !== undefined) { product.stock += update.$inc.stock; return product; }
    return null;
  };
  return () => { Product.find = originalFind; Product.findById = originalFindById; Product.findOneAndUpdate = originalFOU; };
}

function legacyProduct(overrides = {}) {
  return { _id: 'p1', id: 'p1', name: 'Tomato', price: 50, unit: 'kg', stock: 100, images: [], preOrderAvailable: true, variations: [], normalMoq: null, bulkMoq: null, preOrderMoq: null, ...overrides };
}

function stubCartAndOrderCreate(cart = null) {
  const originalCart = Cart.findOne;
  const originalCreate = Order.create;
  Cart.findOne = async () => cart;
  Order.create = async (payloadOrArray) => {
    const isArray = Array.isArray(payloadOrArray);
    const payload = isArray ? payloadOrArray[0] : payloadOrArray;
    const result = { ...payload, _id: 'order1', id: 'order1' };
    return isArray ? [result] : result;
  };
  return () => { Cart.findOne = originalCart; Order.create = originalCreate; };
}

describe('Phase 6: normal order MOQ (createOrder)', () => {
  it('a quantity exactly at MOQ succeeds', async () => {
    const product = legacyProduct({ normalMoq: 5 });
    const restoreProduct = stubProductStock(product);
    const restoreCart = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 5 }] } });
      assert.equal(result.status, 201);
    } finally { restoreProduct(); restoreCart(); }
  });

  it('a quantity below MOQ fails with a structured error', async () => {
    const product = legacyProduct({ normalMoq: 5 });
    const restoreProduct = stubProductStock(product);
    const restoreCart = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 4 }] } });
      assert.equal(result.status, 400);
      assert.equal(result.body.product, 'Tomato');
      assert.equal(result.body.requestedQuantity, 4);
      assert.equal(result.body.requiredMoq, 5);
      assert.equal(result.body.unit, 'kg');
      assert.equal(result.body.orderType, 'normal');
    } finally { restoreProduct(); restoreCart(); }
  });

  it('a quantity above MOQ succeeds', async () => {
    const product = legacyProduct({ normalMoq: 5 });
    const restoreProduct = stubProductStock(product);
    const restoreCart = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 10 }] } });
      assert.equal(result.status, 201);
    } finally { restoreProduct(); restoreCart(); }
  });

  it('a fractional quantity with three decimal places succeeds when otherwise valid', async () => {
    const product = legacyProduct({ normalMoq: 2 });
    const restoreProduct = stubProductStock(product);
    const restoreCart = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 2.125 }] } });
      assert.equal(result.status, 201);
    } finally { restoreProduct(); restoreCart(); }
  });

  it('more than three decimal places fails', async () => {
    const product = legacyProduct();
    const restoreProduct = stubProductStock(product);
    const restoreCart = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 2.1234 }] } });
      assert.equal(result.status, 400);
    } finally { restoreProduct(); restoreCart(); }
  });

  it('invalid and non-positive quantities fail (zero, negative)', async () => {
    const product = legacyProduct();
    const restoreProduct = stubProductStock(product);
    const restoreCart = stubCartAndOrderCreate();
    try {
      for (const quantity of [0, -1]) {
        const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity }] } });
        assert.equal(result.status, 400, `quantity ${quantity}`);
      }
    } finally { restoreProduct(); restoreCart(); }
  });

  it('a missing normalMoq means no minimum is enforced', async () => {
    const product = legacyProduct({ normalMoq: null });
    const restoreProduct = stubProductStock(product);
    const restoreCart = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 1 }] } });
      assert.equal(result.status, 201);
    } finally { restoreProduct(); restoreCart(); }
  });

  it('each product line is checked independently — one line below MOQ fails even if another is fine', async () => {
    const productA = legacyProduct({ _id: 'pA', id: 'pA', normalMoq: 10, stock: 100 });
    const productB = legacyProduct({ _id: 'pB', id: 'pB', name: 'Onion', normalMoq: null, stock: 100 });
    const byId = { pA: productA, pB: productB };
    const originalFind = Product.find;
    const originalFOU = Product.findOneAndUpdate;
    Product.find = async () => [productA, productB];
    Product.findOneAndUpdate = async (filter, update) => {
      const product = byId[filter._id];
      if (!product || product.stock < filter.stock.$gte) return null;
      product.stock += update.$inc.stock;
      return product;
    };
    const restoreCart = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('normal'), {
        user: customer,
        body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'pB', quantity: 50 }, { productId: 'pA', quantity: 2 }] },
      });
      assert.equal(result.status, 400);
      assert.equal(result.body.product, 'Tomato'); // pA, the one actually below its own MOQ
    } finally { Product.find = originalFind; Product.findOneAndUpdate = originalFOU; restoreCart(); }
  });

  it('a direct backend API submission (bypassing any cart) cannot bypass MOQ', async () => {
    const product = legacyProduct({ normalMoq: 5 });
    const restoreProduct = stubProductStock(product);
    const restoreCart = stubCartAndOrderCreate(null);
    try {
      const result = await run(createOrder('normal'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 1 }] } });
      assert.equal(result.status, 400);
      assert.equal(result.body.requiredMoq, 5);
    } finally { restoreProduct(); restoreCart(); }
  });
});

// ---------------------------------------------------------------------------
describe('Phase 6: pre-order MOQ (createOrder(\'preorder\'))', () => {
  it('effective pre-order MOQ (override) is enforced at submission', async () => {
    const product = legacyProduct({ normalMoq: 2, preOrderMoq: 10 });
    const restoreProduct = stubProductStock(product);
    const restoreCart = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('preorder'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(3), items: [{ productId: 'p1', quantity: 5 }] } });
      assert.equal(result.status, 400);
      assert.equal(result.body.requiredMoq, 10);
      assert.equal(result.body.orderType, 'preorder');
    } finally { restoreProduct(); restoreCart(); }
  });

  it('falls back to normalMoq when preOrderMoq is unset', async () => {
    const product = legacyProduct({ normalMoq: 8, preOrderMoq: null });
    const restoreProduct = stubProductStock(product);
    const restoreCart = stubCartAndOrderCreate();
    try {
      const result = await run(createOrder('preorder'), { user: customer, body: { deliveryAddress: validAddress, deliveryDate: futureDateString(3), items: [{ productId: 'p1', quantity: 5 }] } });
      assert.equal(result.status, 400);
      assert.equal(result.body.requiredMoq, 8);
    } finally { restoreProduct(); restoreCart(); }
  });
});

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

describe('Phase 6: pre-order confirmation never revalidates MOQ', () => {
  it('confirms successfully even though the product\'s MOQ has since been raised far above the order\'s quantity', async () => {
    // This product's CURRENT normalMoq (100) would reject the order's quantity (4) if confirmation
    // re-checked MOQ — it must not, since MOQ is enforced only at submission (createOrder).
    const product = legacyProduct({ normalMoq: 100, stock: 50 });
    const restoreProduct = stubProductStock(product);
    const order = { _id: 'order1', orderType: 'preorder', orderStatus: 'placed', stockDeductedAt: null, stockRestoredAt: null, items: [{ product: 'p1', name: 'Tomato', quantity: 4, variationId: null, unit: 'kg' }] };
    const restoreOrder = stubOrderForStatus(order);
    try {
      const result = await run(updateOrderStatus, { user: admin, params: { id: 'order1' }, body: { orderStatus: 'confirmed' } });
      assert.equal(result.status, 200);
      assert.equal(order.orderStatus, 'confirmed');
    } finally { restoreProduct(); restoreOrder(); }
  });
});

// ---------------------------------------------------------------------------
describe('Phase 6: bulk order quantity format (createBulkOrder)', () => {
  function stubBulkOrderCreate() {
    const original = BulkOrder.create;
    BulkOrder.create = async (doc) => ({ _id: 'bulk1', ...doc });
    return () => { BulkOrder.create = original; };
  }

  it('accepts a decimal quantity above the minimum', async () => {
    const restore = stubBulkOrderCreate();
    try {
      const result = await run(createBulkOrder, { user: customer, body: { name: 'Asha', phone: '9876543210', email: 'a@b.com', deliveryAddress: '123 MG Road', requiredDate: futureDateString(3), products: [{ name: 'Tomato', quantity: 2.5, unit: 'kg' }] } });
      assert.equal(result.status, 201);
    } finally { restore(); }
  });
  it('rejects more than three decimal places', async () => {
    const restore = stubBulkOrderCreate();
    try {
      const result = await run(createBulkOrder, { user: customer, body: { name: 'Asha', phone: '9876543210', email: 'a@b.com', deliveryAddress: '123 MG Road', requiredDate: futureDateString(3), products: [{ name: 'Tomato', quantity: 2.1234, unit: 'kg' }] } });
      assert.equal(result.status, 400);
    } finally { restore(); }
  });
});

describe('Phase 6: bulk MOQ is enforced at resolution (resolveBulkOrderItems)', () => {
  // mongoose.isValidObjectId gates resolveBulkOrderItems before anything else — 'p1' (fine for every
  // other stubbed Product.findById in this suite) is rejected by that check alone, before ever reaching
  // the MOQ logic, so these tests need a real-looking ObjectId string instead.
  const FAKE_PRODUCT_ID = '507f1f77bcf86cd799439011';
  function stubBulkOrderFind(request) {
    const originalFindById = BulkOrder.findById;
    // Chainable (not a bare async function): changeRequestStatus (used by updateAdminBulkOrderStatus,
    // exercised later in this block) calls .select('+statusHistory') on this for an admin request.
    BulkOrder.findById = () => selectableResult(request);
    return () => { BulkOrder.findById = originalFindById; };
  }

  it('blocks resolution below the bulk MOQ override, with a structured error, and modifies nothing', async () => {
    const product = legacyProduct({ bulkMoq: 20 });
    const restoreProduct = stubProductStock(product);
    const request = { _id: 'bulk1', status: 'Pending', products: [{ name: 'Tomato', quantity: 5, unit: 'kg', productId: null, variationId: null }], save: async () => {} };
    const restoreOrder = stubBulkOrderFind(request);
    try {
      const result = await run(resolveBulkOrderItems, { user: admin, params: { id: 'bulk1' }, body: { items: [{ index: 0, productId: FAKE_PRODUCT_ID, variationId: null }] } });
      assert.equal(result.status, 400);
      assert.equal(result.body.product, 'Tomato');
      assert.equal(result.body.requestedQuantity, 5);
      assert.equal(result.body.requiredMoq, 20);
      assert.equal(result.body.orderType, 'bulk');
      assert.equal(request.products[0].productId, null, 'the line must remain unresolved — no partial resolution');
    } finally { restoreProduct(); restoreOrder(); }
  });

  it('falls back to normalMoq when bulkMoq is unset', async () => {
    const product = legacyProduct({ normalMoq: 15, bulkMoq: null });
    const restoreProduct = stubProductStock(product);
    const request = { _id: 'bulk1', status: 'Pending', products: [{ name: 'Tomato', quantity: 5, unit: 'kg', productId: null, variationId: null }], save: async () => {} };
    const restoreOrder = stubBulkOrderFind(request);
    try {
      const result = await run(resolveBulkOrderItems, { user: admin, params: { id: 'bulk1' }, body: { items: [{ index: 0, productId: FAKE_PRODUCT_ID, variationId: null }] } });
      assert.equal(result.status, 400);
      assert.equal(result.body.requiredMoq, 15);
    } finally { restoreProduct(); restoreOrder(); }
  });

  it('resolution at or above the effective MOQ succeeds', async () => {
    const product = legacyProduct({ bulkMoq: 5 });
    const restoreProduct = stubProductStock(product);
    const request = { _id: 'bulk1', status: 'Pending', products: [{ name: 'Tomato', quantity: 5, unit: 'kg', productId: null, variationId: null }], save: async () => {} };
    const restoreOrder = stubBulkOrderFind(request);
    try {
      const result = await run(resolveBulkOrderItems, { user: admin, params: { id: 'bulk1' }, body: { items: [{ index: 0, productId: FAKE_PRODUCT_ID, variationId: null }] } });
      assert.equal(result.status, 200);
      // Product.findById is stubbed to ignore the requested id and always return the fixture product
      // (whose own _id is 'p1') — this assigns product._id, not the id that was requested.
      assert.equal(String(request.products[0].productId), 'p1');
    } finally { restoreProduct(); restoreOrder(); }
  });

  it('a product with no effective MOQ permits resolution subject to existing validation', async () => {
    const product = legacyProduct({ normalMoq: null, bulkMoq: null });
    const restoreProduct = stubProductStock(product);
    const request = { _id: 'bulk1', status: 'Pending', products: [{ name: 'Tomato', quantity: 0.5, unit: 'kg', productId: null, variationId: null }], save: async () => {} };
    const restoreOrder = stubBulkOrderFind(request);
    try {
      const result = await run(resolveBulkOrderItems, { user: admin, params: { id: 'bulk1' }, body: { items: [{ index: 0, productId: FAKE_PRODUCT_ID, variationId: null }] } });
      assert.equal(result.status, 200);
    } finally { restoreProduct(); restoreOrder(); }
  });

  it('changing the product MOQ after successful resolution does not block later approval', async () => {
    const product = legacyProduct({ bulkMoq: 5, stock: 100 });
    const restoreProduct = stubProductStock(product);
    const request = { _id: 'bulk1', status: 'Pending', stockDeductedAt: null, stockRestoredAt: null, products: [{ _id: 'line1', name: 'Tomato', quantity: 5, unit: 'kg', productId: null, variationId: null }], save: async () => {} };
    const restoreOrder = stubBulkOrderFind(request);
    try {
      const resolveResult = await run(resolveBulkOrderItems, { user: admin, params: { id: 'bulk1' }, body: { items: [{ index: 0, productId: FAKE_PRODUCT_ID, variationId: null }] } });
      assert.equal(resolveResult.status, 200);
      request.status = 'Quoted';
      request.quotation = { items: [{ name: 'Tomato', quantity: 5, unit: 'kg', unitPrice: 20, lineTotal: 100 }], deliveryCharge: 0, totalAmount: 100 };
      // Raise the MOQ far above the already-resolved quantity — approval must not re-check it.
      product.bulkMoq = 1000;

      const originalBulkFOU = BulkOrder.findOneAndUpdate;
      BulkOrder.findOneAndUpdate = (filter, update) => {
        if ('stockDeductedAt' in filter) {
          if (filter.status !== request.status || request.stockDeductedAt !== null) return selectableResult(null);
          request.stockDeductedAt = update.$set.stockDeductedAt;
          return selectableResult({ ...request });
        }
        if (filter.status !== undefined) {
          if (filter.status !== request.status) return selectableResult(null);
          request.status = update.$set.status;
          return selectableResult({ ...request, id: request._id });
        }
        return selectableResult(null);
      };
      try {
        const approveResult = await run(updateAdminBulkOrderStatus, { user: admin, params: { id: 'bulk1' }, body: { status: 'Approved' } });
        assert.equal(approveResult.status, 200);
        assert.equal(request.status, 'Approved');
      } finally { BulkOrder.findOneAndUpdate = originalBulkFOU; }
    } finally { restoreProduct(); restoreOrder(); }
  });
});
