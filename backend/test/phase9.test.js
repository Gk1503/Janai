import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeOrderSettings, ORDER_SETTINGS_DEFAULTS } from '../utils/settingsValidation.js';
import { deliveryFeeFor, loadOrderPricingRules } from '../utils/orderPricing.js';
import { getOrderSettings, updateOrderSettings } from '../controllers/settingsController.js';
import { createOrder } from '../controllers/orderController.js';
import Settings from '../models/Settings.js';
import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import settingsRouter from '../routes/settingsRoutes.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';

describe('normalizeOrderSettings (pure validation)', () => {
  it('fills in the existing hardcoded defaults for a never-configured store', () => {
    const result = normalizeOrderSettings(undefined);
    assert.deepEqual(result.value, ORDER_SETTINGS_DEFAULTS);
  });

  it('falls back per-field to the existing default rather than inventing 0, for anything omitted', () => {
    const result = normalizeOrderSettings({ deliveryFee: 30 });
    assert.deepEqual(result.value, { deliveryEnabled: true, deliveryFee: 30, freeDeliveryThreshold: 500, minimumOrderValue: 0 });
  });

  it('accepts a full custom configuration', () => {
    const result = normalizeOrderSettings({ deliveryEnabled: false, deliveryFee: 40, freeDeliveryThreshold: 750, minimumOrderValue: 100 });
    assert.deepEqual(result.value, { deliveryEnabled: false, deliveryFee: 40, freeDeliveryThreshold: 750, minimumOrderValue: 100 });
  });

  it('rejects negative or non-numeric amounts', () => {
    for (const bad of [{ deliveryFee: -1 }, { deliveryFee: 'free' }, { freeDeliveryThreshold: -5 }, { minimumOrderValue: 'x' }, { deliveryFee: Infinity }]) {
      assert.ok(normalizeOrderSettings(bad).error, JSON.stringify(bad));
    }
  });

  it('rejects an absurdly large amount', () => {
    assert.ok(normalizeOrderSettings({ deliveryFee: 10_000_000 }).error);
  });

  it('coerces deliveryEnabled to a real boolean regardless of what is sent', () => {
    assert.equal(normalizeOrderSettings({ deliveryEnabled: 'false' }).value.deliveryEnabled, true, 'a non-empty string is truthy, same JS semantics as every other boolean in this codebase');
    assert.equal(normalizeOrderSettings({ deliveryEnabled: 0 }).value.deliveryEnabled, false);
    assert.equal(normalizeOrderSettings({ deliveryEnabled: 1 }).value.deliveryEnabled, true);
  });
});

describe('Settings model: orderSettings', () => {
  it('declares safe schema defaults identical to the pre-existing hardcoded rule', () => {
    const doc = new Settings({});
    assert.equal(doc.orderSettings.deliveryEnabled, true);
    assert.equal(doc.orderSettings.deliveryFee, 25);
    assert.equal(doc.orderSettings.freeDeliveryThreshold, 500);
    assert.equal(doc.orderSettings.minimumOrderValue, 0);
    assert.equal(doc.validateSync(), undefined);
  });
});

describe('settings routes: who can read vs write /orders-delivery', () => {
  it('GET /orders-delivery is public (no auth middleware in front of it)', () => {
    const layer = settingsRouter.stack.find((entry) => entry.route?.path === '/orders-delivery' && entry.route.methods.get);
    assert.ok(layer, 'GET /orders-delivery must exist');
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.deepEqual(handlers, [getOrderSettings]);
    assert.ok(!handlers.includes(requireAuth) && !handlers.includes(requireOwner));
  });

  it('PATCH /orders-delivery requires authentication AND ownership, in that order, before the handler', () => {
    const layer = settingsRouter.stack.find((entry) => entry.route?.path === '/orders-delivery' && entry.route.methods.patch);
    assert.ok(layer, 'PATCH /orders-delivery must exist');
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.deepEqual(handlers, [requireAuth, requireOwner, updateOrderSettings]);
  });
});

// ---- handler-level regressions with stubbed model methods (no database) ----
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
const staffUser = { _id: 'staff1', id: 'staff1', role: 'staff' };

describe('getOrderSettings / updateOrderSettings (stubbed model)', () => {
  it('a never-configured store reads back the existing hardcoded defaults', async () => {
    const original = Settings.findOneAndUpdate;
    Settings.findOneAndUpdate = async () => ({ orderSettings: { deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 }, updatedAt: new Date() });
    try {
      const result = await run(getOrderSettings, owner);
      assert.equal(result.status, 200);
      assert.deepEqual({ ...result.body.settings, updatedAt: undefined }, { deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0, updatedAt: undefined });
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('the owner can update settings, and the saved values round-trip exactly, writing the single canonical document', async () => {
    const original = Settings.findOneAndUpdate;
    let writtenFilter = null;
    let writtenUpdate = null;
    Settings.findOneAndUpdate = async (filter, update) => {
      writtenFilter = filter;
      writtenUpdate = update;
      return { orderSettings: update.$set.orderSettings, updatedAt: new Date() };
    };
    try {
      const result = await run(updateOrderSettings, owner, { deliveryEnabled: true, deliveryFee: 35, freeDeliveryThreshold: 600, minimumOrderValue: 150 });
      assert.equal(result.status, 200);
      assert.deepEqual(writtenFilter, {}, 'must always write the single canonical document, never a caller-supplied id');
      assert.equal(writtenUpdate.$set.updatedBy, owner._id);
      assert.equal(result.body.settings.deliveryFee, 35);
      assert.equal(result.body.settings.freeDeliveryThreshold, 600);
      assert.equal(result.body.settings.minimumOrderValue, 150);
      assert.equal(result.body.message, 'Settings saved.');
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('rejects invalid input before ever touching the database', async () => {
    const original = Settings.findOneAndUpdate;
    let called = false;
    Settings.findOneAndUpdate = async () => { called = true; };
    try {
      for (const bad of [{ deliveryFee: -10 }, { freeDeliveryThreshold: 'lots' }, { minimumOrderValue: -1 }]) {
        const result = await run(updateOrderSettings, owner, bad);
        assert.equal(result.status, 400, JSON.stringify(bad));
      }
      assert.equal(called, false, 'invalid input must never reach the database');
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('rejects an unsupported/unknown field outright (no mass assignment)', async () => {
    const original = Settings.findOneAndUpdate;
    let called = false;
    Settings.findOneAndUpdate = async () => { called = true; };
    try {
      const result = await run(updateOrderSettings, owner, { deliveryFee: 25, role: 'admin' });
      assert.equal(result.status, 400);
      assert.match(result.body.message, /Unsupported field/);
      assert.equal(called, false);
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('never returns updatedBy or any internal field', async () => {
    const original = Settings.findOneAndUpdate;
    Settings.findOneAndUpdate = async () => ({ orderSettings: { deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 }, updatedBy: 'owner1', __v: 0, updatedAt: new Date() });
    try {
      const result = await run(getOrderSettings, owner);
      assert.deepEqual(Object.keys(result.body.settings).sort(), ['deliveryEnabled', 'deliveryFee', 'freeDeliveryThreshold', 'minimumOrderValue', 'updatedAt']);
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });
});

describe('loadOrderPricingRules / deliveryFeeFor', () => {
  it('falls back to the existing hardcoded defaults when the settings document has never been saved', async () => {
    const original = Settings.findOne;
    Settings.findOne = () => ({ lean: async () => null });
    try {
      assert.deepEqual(await loadOrderPricingRules(), ORDER_SETTINGS_DEFAULTS);
    } finally {
      Settings.findOne = original;
    }
  });

  it('falls back to the existing hardcoded defaults if the read itself fails — a down settings read must never block checkout', async () => {
    const original = Settings.findOne;
    Settings.findOne = () => ({ lean: async () => { throw new Error('db down'); } });
    try {
      assert.deepEqual(await loadOrderPricingRules(), ORDER_SETTINGS_DEFAULTS);
    } finally {
      Settings.findOne = original;
    }
  });

  it('reads back a saved custom configuration', async () => {
    const original = Settings.findOne;
    Settings.findOne = () => ({ lean: async () => ({ orderSettings: { deliveryEnabled: false, deliveryFee: 40, freeDeliveryThreshold: 750, minimumOrderValue: 200 } }) });
    try {
      assert.deepEqual(await loadOrderPricingRules(), { deliveryEnabled: false, deliveryFee: 40, freeDeliveryThreshold: 750, minimumOrderValue: 200 });
    } finally {
      Settings.findOne = original;
    }
  });

  it('deliveryFeeFor charges the fee below the threshold and is free at/above it', () => {
    const rules = { deliveryFee: 40, freeDeliveryThreshold: 750 };
    assert.equal(deliveryFeeFor(300, rules), 40);
    assert.equal(deliveryFeeFor(750, rules), 0);
    assert.equal(deliveryFeeFor(900, rules), 0);
    assert.equal(deliveryFeeFor(0, rules), 0);
  });
});

// ---- orderController.createOrder: settings actually drive real order creation ----
function stubPricingRules(rules) {
  const original = Settings.findOne;
  Settings.findOne = () => ({ lean: async () => ({ orderSettings: rules }) });
  return () => { Settings.findOne = original; };
}

function stubProducts(products) {
  const originalFind = Product.find;
  const originalFindOneAndUpdate = Product.findOneAndUpdate;
  Product.find = async () => products;
  Product.findOneAndUpdate = async (filter, update) => {
    const product = products.find((item) => String(item.id) === String(filter._id));
    if (!product || product.stock < filter.stock.$gte) return null;
    product.stock -= -update.$inc.stock; // $inc.stock is negative
    return product;
  };
  return () => { Product.find = originalFind; Product.findOneAndUpdate = originalFindOneAndUpdate; };
}

function stubCartAndOrder() {
  const originalCartFindOne = Cart.findOne;
  const originalOrderCreate = Order.create;
  Cart.findOne = async () => null;
  let created = null;
  Order.create = async (payload) => { created = payload; return { ...payload, _id: 'order1' }; };
  return { created: () => created, restore() { Cart.findOne = originalCartFindOne; Order.create = originalOrderCreate; } };
}

const customer = { id: 'cust1', role: 'customer' };
const validAddress = { recipient: 'Asha', phone: '9876543210', street: 'MG Road', postalCode: '411001' };
function futureDateString(daysAhead = 1) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

describe('createOrder: Orders & Delivery settings actually drive order totals', () => {
  it('blocks new normal orders when delivery is disabled, before ever touching products/cart', async () => {
    const restoreRules = stubPricingRules({ deliveryEnabled: false, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 });
    let productsTouched = false;
    const originalFind = Product.find;
    Product.find = async () => { productsTouched = true; return []; };
    try {
      const result = await run(createOrder('normal'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 1 }] });
      assert.equal(result.status, 409);
      assert.match(result.body.message, /unavailable/i);
      assert.equal(productsTouched, false, 'must reject before looking up products once delivery is off');
    } finally {
      restoreRules();
      Product.find = originalFind;
    }
  });

  it('blocks new pre-orders too — both share the same delivery mechanism', async () => {
    const restoreRules = stubPricingRules({ deliveryEnabled: false, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 });
    try {
      const result = await run(createOrder('preorder'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(2), items: [{ productId: 'p1', quantity: 1 }] });
      assert.equal(result.status, 409);
    } finally {
      restoreRules();
    }
  });

  it('enforces the saved minimum order value server-side, and creates no order', async () => {
    const restoreRules = stubPricingRules({ deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 200 });
    const restoreProducts = stubProducts([{ id: 'p1', name: 'Apples', price: 50, unit: 'kg', stock: 10, images: [] }]);
    const cartOrder = stubCartAndOrder();
    try {
      const result = await run(createOrder('normal'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 2 }] }); // subtotal 100 < 200
      assert.equal(result.status, 400);
      assert.match(result.body.message, /Minimum order value/);
      assert.equal(cartOrder.created(), null, 'no order should be created when below the minimum');
    } finally {
      restoreRules();
      restoreProducts();
      cartOrder.restore();
    }
  });

  it('allows an order that meets the minimum, charging the configured fee (not the old hardcoded ₹25/₹500)', async () => {
    const restoreRules = stubPricingRules({ deliveryEnabled: true, deliveryFee: 40, freeDeliveryThreshold: 750, minimumOrderValue: 100 });
    const restoreProducts = stubProducts([{ id: 'p1', name: 'Apples', price: 60, unit: 'kg', stock: 10, images: [] }]);
    const cartOrder = stubCartAndOrder();
    try {
      const result = await run(createOrder('normal'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 2 }] }); // subtotal 120
      assert.equal(result.status, 201);
      assert.equal(result.body.order.totalAmount, 160, '120 subtotal + 40 configured fee, below the 750 free threshold');
    } finally {
      restoreRules();
      restoreProducts();
      cartOrder.restore();
    }
  });

  it('is free at or above the configured free-delivery threshold', async () => {
    const restoreRules = stubPricingRules({ deliveryEnabled: true, deliveryFee: 40, freeDeliveryThreshold: 750, minimumOrderValue: 0 });
    const restoreProducts = stubProducts([{ id: 'p1', name: 'Apples', price: 400, unit: 'kg', stock: 10, images: [] }]);
    const cartOrder = stubCartAndOrder();
    try {
      const result = await run(createOrder('normal'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 2 }] }); // subtotal 800
      assert.equal(result.status, 201);
      assert.equal(result.body.order.totalAmount, 800, 'no delivery fee once the subtotal reaches the free threshold');
    } finally {
      restoreRules();
      restoreProducts();
      cartOrder.restore();
    }
  });

  it('behaves exactly like the old hardcoded rule for a never-configured store (₹25 below ₹500, free at/above)', async () => {
    const restoreRules = stubPricingRules({ deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 });
    const restoreProducts = stubProducts([{ id: 'p1', name: 'Apples', price: 100, unit: 'kg', stock: 10, images: [] }]);
    const cartOrder = stubCartAndOrder();
    try {
      const result = await run(createOrder('normal'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 2 }] }); // subtotal 200
      assert.equal(result.status, 201);
      assert.equal(result.body.order.totalAmount, 225);
    } finally {
      restoreRules();
      restoreProducts();
      cartOrder.restore();
    }
  });

  it('never trusts a client-supplied total — totalAmount is always the server computation', async () => {
    const restoreRules = stubPricingRules({ deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 });
    const restoreProducts = stubProducts([{ id: 'p1', name: 'Apples', price: 100, unit: 'kg', stock: 10, images: [] }]);
    const cartOrder = stubCartAndOrder();
    try {
      const result = await run(createOrder('normal'), customer, { deliveryAddress: validAddress, deliveryDate: futureDateString(), items: [{ productId: 'p1', quantity: 1 }], totalAmount: 1 });
      assert.equal(result.status, 201);
      assert.equal(result.body.order.totalAmount, 125, 'the client-supplied totalAmount of 1 must be ignored entirely');
    } finally {
      restoreRules();
      restoreProducts();
      cartOrder.restore();
    }
  });
});
