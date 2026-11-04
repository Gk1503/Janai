import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Vendor from '../models/Vendor.js';
import Product from '../models/Product.js';
import VendorPurchase from '../models/VendorPurchase.js';
import VendorPriceHistory from '../models/VendorPriceHistory.js';
import { getVendorPriceHistory, getVendorProducts, getVendorPurchases } from '../controllers/adminVendorController.js';
import { createPurchase, receivePurchase } from '../controllers/vendorController.js';
import vendorRouter from '../routes/vendorRoutes.js';
import { requireAuth, requireAnyPermission } from '../middleware/auth.js';

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

const vendorId = 'vendor1';
function stubFind(returnValue) {
  return () => ({ sort: () => Promise.resolve(returnValue) });
}

describe('vendorRoutes: detail-profile endpoints wired with the same permission guard (Stage 4)', () => {
  it('GET /:id/products, /:id/purchases and /:id/price-history all require auth then products:manage/inventory:update', () => {
    const expectations = [
      { path: '/:id/products', handler: getVendorProducts },
      { path: '/:id/purchases', handler: getVendorPurchases },
      { path: '/:id/price-history', handler: getVendorPriceHistory },
    ];
    for (const { path, handler } of expectations) {
      const layer = vendorRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods.get);
      assert.ok(layer, `GET ${path} must exist`);
      const handlers = layer.route.stack.map((entry) => entry.handle);
      assert.equal(handlers.length, 3);
      assert.equal(handlers[0], requireAuth);
      assert.equal(handlers[2], handler);
    }
  });

  it('unauthorized users (other staff, delivery-only, customers) are rejected by the same requireAnyPermission used elsewhere on this router', () => {
    const vendorAccess = requireAnyPermission('products:manage', 'inventory:update');
    const rejected = [
      { role: 'staff', permissions: ['orders:view'] },
      { role: 'staff', permissions: ['delivery:view', 'delivery:update'] },
      { role: 'customer' },
      undefined,
    ];
    for (const user of rejected) {
      let passed = false;
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
      vendorAccess({ user }, res, () => { passed = true; });
      assert.equal(passed, false, JSON.stringify(user));
      assert.equal(res.statusCode, 403);
    }
  });
});

describe('getVendorProducts (stubbed, no database)', () => {
  it('returns 404 for a vendor that does not exist', async () => {
    const original = Vendor.findById;
    Vendor.findById = async () => null;
    try {
      const result = await run(getVendorProducts, { params: { id: 'missing' } });
      assert.equal(result.status, 404);
    } finally { Vendor.findById = original; }
  });

  it('resolves products strictly by vendorRef — a product whose vendors array has no matching vendorRef row contributes nothing, even if Product.find returned it', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    let capturedFilter = null;
    Vendor.findById = async () => ({ _id: vendorId, name: 'Rajesh Vegetable Supplier', status: 'Active' });
    Product.find = (filter) => {
      capturedFilter = filter;
      // A legacy row with no vendorRef at all, and a row linked to a DIFFERENT vendor — neither must
      // ever be attributed to this vendor, even though this stub (unrealistically) returns the
      // product at all; the controller's own filter must do the real narrowing, not just trust Mongo.
      return { sort: () => Promise.resolve([
        { _id: 'p1', name: 'Potato', category: 'Vegetables', vendors: [{ _id: 'e1', vendorRef: vendorId, purchasePrice: 20, moq: '10kg' }] },
        { _id: 'p2', name: 'Onion', category: 'Vegetables', vendors: [{ _id: 'e2', vendorRef: null, purchasePrice: 10 }, { _id: 'e3', vendorRef: 'otherVendor', purchasePrice: 12 }] },
      ]) };
    };
    try {
      const result = await run(getVendorProducts, { params: { id: vendorId } });
      assert.equal(result.status, 200);
      assert.deepEqual(capturedFilter, { 'vendors.vendorRef': vendorId });
      assert.equal(result.body.products.length, 1, 'only the genuinely linked row must appear');
      assert.equal(result.body.products[0].productId, 'p1');
      assert.equal(result.body.products[0].moq, '10kg');
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; }
  });

  it('a single product with two embedded rows linked to the same central vendor produces two rows, not one merged row', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    Vendor.findById = async () => ({ _id: vendorId, name: 'Rajesh Vegetable Supplier', status: 'Active' });
    Product.find = stubFind([
      { _id: 'p1', name: 'Potato', category: 'Vegetables', vendors: [
        { _id: 'e1', vendorRef: vendorId, purchasePrice: 20, moq: '10kg' },
        { _id: 'e2', vendorRef: vendorId, purchasePrice: 22, moq: '50kg' },
      ] },
    ]);
    try {
      const result = await run(getVendorProducts, { params: { id: vendorId } });
      assert.equal(result.body.products.length, 2);
      assert.deepEqual(result.body.products.map((row) => row.vendorId), ['e1', 'e2']);
      // But the distinct PRODUCT count is still 1 — Product.find already dedupes at the document level.
      assert.equal(result.body.productCount, 1);
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; }
  });

  it('Stage 6: includes the product\'s own unit, needed for Record Purchase to default the unit field', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    let capturedProjection = null;
    Vendor.findById = async () => ({ _id: vendorId, name: 'Rajesh Vegetable Supplier', status: 'Active' });
    Product.find = (filter, projection) => { capturedProjection = projection; return { sort: () => Promise.resolve([
      { _id: 'p1', name: 'Potato', category: 'Vegetables', unit: 'kg', vendors: [{ _id: 'e1', vendorRef: vendorId, purchasePrice: 20, moq: '10kg' }] },
    ]) }; };
    try {
      const result = await run(getVendorProducts, { params: { id: vendorId } });
      assert.equal(result.body.products[0].unit, 'kg');
      assert.equal(capturedProjection.unit, 1, 'unit must actually be requested from the database, not just assumed');
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; }
  });

  it('productCount and categories reflect every linked product, and are returned alongside the per-row list', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    Vendor.findById = async () => ({ _id: vendorId, name: 'Rajesh Vegetable Supplier', status: 'Active' });
    Product.find = stubFind([
      { _id: 'p1', name: 'Potato', category: 'Vegetables', vendors: [{ _id: 'e1', vendorRef: vendorId, purchasePrice: 20 }] },
      { _id: 'p2', name: 'Milk', category: 'Dairy', vendors: [{ _id: 'e2', vendorRef: vendorId, purchasePrice: 30 }] },
    ]);
    try {
      const result = await run(getVendorProducts, { params: { id: vendorId } });
      assert.equal(result.body.productCount, 2);
      assert.deepEqual(result.body.categories, ['Dairy', 'Vegetables']);
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; }
  });

  it('a vendor with no linked products returns an accurate empty profile, not an error', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    Vendor.findById = async () => ({ _id: vendorId, name: 'Rajesh Vegetable Supplier', status: 'Active' });
    Product.find = stubFind([]);
    try {
      const result = await run(getVendorProducts, { params: { id: vendorId } });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.products, []);
      assert.equal(result.body.productCount, 0);
      assert.deepEqual(result.body.categories, []);
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; }
  });
});

describe('getVendorPurchases (stubbed, no database)', () => {
  it('returns 404 for a vendor that does not exist', async () => {
    const original = Vendor.findById;
    Vendor.findById = async () => null;
    try {
      const result = await run(getVendorPurchases, { params: { id: 'missing' }, query: {} });
      assert.equal(result.status, 404);
    } finally { Vendor.findById = original; }
  });

  it('a vendor with linked products but zero purchases returns an empty, correctly-shaped summary without ever querying VendorPurchase', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    const originalPurchase = VendorPurchase.find;
    let purchaseQueried = false;
    Vendor.findById = async () => ({ _id: vendorId, name: 'X', status: 'Active' });
    Product.find = stubFind([]); // no linked products at all -> nothing to resolve
    VendorPurchase.find = () => { purchaseQueried = true; return { sort: () => Promise.resolve([]) }; };
    try {
      const result = await run(getVendorPurchases, { params: { id: vendorId }, query: {} });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.purchases, []);
      assert.deepEqual(result.body.summary, { ordered: { count: 0, amount: 0, quantityByUnit: [] }, received: { count: 0, amount: 0, quantityByUnit: [] } });
      assert.equal(purchaseQueried, false, 'no embedded vendor ids to search for, so VendorPurchase is never queried at all');
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; VendorPurchase.find = originalPurchase; }
  });

  it('Stage 7: includes notes, needed by the Vendor Detail Page\'s purchase detail view', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    const originalPurchase = VendorPurchase.find;
    Vendor.findById = async () => ({ _id: vendorId, name: 'X', status: 'Active' });
    Product.find = stubFind([{ _id: 'p1', name: 'Potato', category: 'Vegetables', vendors: [{ _id: 'e1', vendorRef: vendorId }] }]);
    VendorPurchase.find = () => ({ sort: () => Promise.resolve([
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-01'), quantity: 1, unit: 'kg', rate: 10, totalAmount: 10, status: 'Ordered', receivedQuantity: 0, notes: 'Fragile — handle with care' },
    ]) });
    try {
      const result = await run(getVendorPurchases, { params: { id: vendorId }, query: {} });
      assert.equal(result.body.purchases[0].notes, 'Fragile — handle with care');
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; VendorPurchase.find = originalPurchase; }
  });

  it('resolves purchases via every embedded vendor id linked to this vendor, filters by that set with a single $in query', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    const originalPurchase = VendorPurchase.find;
    let capturedFilter = null;
    Vendor.findById = async () => ({ _id: vendorId, name: 'X', status: 'Active' });
    Product.find = stubFind([
      { _id: 'p1', name: 'Potato', category: 'Vegetables', vendors: [{ _id: 'e1', vendorRef: vendorId }] },
      { _id: 'p2', name: 'Onion', category: 'Vegetables', vendors: [{ _id: 'e2', vendorRef: vendorId }] },
    ]);
    VendorPurchase.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([]) }; };
    try {
      await run(getVendorPurchases, { params: { id: vendorId }, query: {} });
      assert.deepEqual(capturedFilter.vendor.$in, ['e1', 'e2']);
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; VendorPurchase.find = originalPurchase; }
  });

  it('keeps Ordered and Received amounts/quantities in entirely separate buckets, grouped by unit, never summed together', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    const originalPurchase = VendorPurchase.find;
    Vendor.findById = async () => ({ _id: vendorId, name: 'X', status: 'Active' });
    Product.find = stubFind([{ _id: 'p1', name: 'Potato', category: 'Vegetables', vendors: [{ _id: 'e1', vendorRef: vendorId }] }]);
    VendorPurchase.find = () => ({ sort: () => Promise.resolve([
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-01'), quantity: 10, unit: 'kg', rate: 20, totalAmount: 200, status: 'Received', receivedQuantity: 10, invoiceNumber: 'INV1' },
      { _id: 'pu2', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-05'), quantity: 5, unit: 'L', rate: 50, totalAmount: 250, status: 'Received', receivedQuantity: 5, invoiceNumber: '' },
      { _id: 'pu3', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-10'), quantity: 8, unit: 'kg', rate: 22, totalAmount: 176, status: 'Ordered', receivedQuantity: 0, invoiceNumber: '' },
    ]) });
    try {
      const result = await run(getVendorPurchases, { params: { id: vendorId }, query: {} });
      const { summary } = result.body;
      assert.equal(summary.received.count, 2);
      assert.equal(summary.received.amount, 10 * 20 + 5 * 50); // receivedQuantity * rate for each
      assert.deepEqual(summary.received.quantityByUnit.sort((a, b) => a.unit.localeCompare(b.unit)), [{ unit: 'kg', quantity: 10 }, { unit: 'L', quantity: 5 }]);
      assert.equal(summary.ordered.count, 1);
      assert.equal(summary.ordered.amount, 176); // totalAmount for the still-Ordered row
      assert.deepEqual(summary.ordered.quantityByUnit, [{ unit: 'kg', quantity: 8 }]);
      // Every purchase here lands in exactly one bucket — nothing dropped, nothing double-counted.
      assert.equal(summary.received.count + summary.ordered.count, 3);
      assert.equal(result.body.purchases.length, 3);
      assert.equal(result.body.purchases[0].productName, 'Potato');
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; VendorPurchase.find = originalPurchase; }
  });

  it('applies an optional productId filter and an optional date range on top of the vendor-id set', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    const originalPurchase = VendorPurchase.find;
    let capturedFilter = null;
    Vendor.findById = async () => ({ _id: vendorId, name: 'X', status: 'Active' });
    Product.find = stubFind([{ _id: 'p1', name: 'Potato', category: 'Vegetables', vendors: [{ _id: 'e1', vendorRef: vendorId }] }]);
    VendorPurchase.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([]) }; };
    try {
      await run(getVendorPurchases, { params: { id: vendorId }, query: { productId: 'p1', from: '2026-01-01', to: '2026-01-31' } });
      assert.equal(capturedFilter.product, 'p1');
      assert.equal(capturedFilter.purchaseDate.$gte.toISOString().slice(0, 10), '2026-01-01');
      assert.equal(capturedFilter.purchaseDate.$lte.toISOString().slice(0, 10), '2026-01-31');
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; VendorPurchase.find = originalPurchase; }
  });

  it('Stage 4.1 fix: a Received purchase with receivedQuantity 0 (anomalous — not reachable via the normal flow) contributes to neither bucket, matching listPurchases\' own existing guard', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    const originalPurchase = VendorPurchase.find;
    Vendor.findById = async () => ({ _id: vendorId, name: 'X', status: 'Active' });
    Product.find = stubFind([{ _id: 'p1', name: 'Potato', category: 'Vegetables', vendors: [{ _id: 'e1', vendorRef: vendorId }] }]);
    VendorPurchase.find = () => ({ sort: () => Promise.resolve([
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-01'), quantity: 10, unit: 'kg', rate: 20, totalAmount: 200, status: 'Received', receivedQuantity: 0, invoiceNumber: '' },
      { _id: 'pu2', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-02'), quantity: 4, unit: 'kg', rate: 20, totalAmount: 80, status: 'Received', receivedQuantity: 4, invoiceNumber: '' },
    ]) });
    try {
      const result = await run(getVendorPurchases, { params: { id: vendorId }, query: {} });
      const { summary } = result.body;
      assert.equal(summary.received.count, 1, 'only the genuinely-received row counts');
      assert.equal(summary.received.amount, 4 * 20);
      assert.deepEqual(summary.received.quantityByUnit, [{ unit: 'kg', quantity: 4 }]);
      assert.equal(summary.ordered.count, 0, 'the anomalous row is excluded entirely — it is not counted as Ordered either');
      // The raw purchases list is untouched by this guard — only the summary excludes the anomalous row.
      assert.equal(result.body.purchases.length, 2);
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; VendorPurchase.find = originalPurchase; }
  });

  it('every valid Ordered or Received purchase contributes to exactly one summary bucket (no double-counting, nothing dropped)', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    const originalPurchase = VendorPurchase.find;
    Vendor.findById = async () => ({ _id: vendorId, name: 'X', status: 'Active' });
    Product.find = stubFind([{ _id: 'p1', name: 'Potato', category: 'Vegetables', vendors: [{ _id: 'e1', vendorRef: vendorId }] }]);
    const validPurchases = [
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-01'), quantity: 10, unit: 'kg', rate: 20, totalAmount: 200, status: 'Received', receivedQuantity: 10 },
      { _id: 'pu2', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-02'), quantity: 6, unit: 'kg', rate: 20, totalAmount: 120, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu3', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-03'), quantity: 2, unit: 'L', rate: 50, totalAmount: 100, status: 'Received', receivedQuantity: 2 },
    ];
    VendorPurchase.find = () => ({ sort: () => Promise.resolve(validPurchases) });
    try {
      const result = await run(getVendorPurchases, { params: { id: vendorId }, query: {} });
      const { summary } = result.body;
      assert.equal(summary.received.count + summary.ordered.count, validPurchases.length, 'every valid purchase must land in exactly one bucket');
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; VendorPurchase.find = originalPurchase; }
  });
});

describe('receivePurchase (vendorController.js): full-receipt-only regression (Stage 4.1 inspection finding)', () => {
  it('always sets receivedQuantity to the FULL ordered quantity — confirming there is still no partial-receipt path', async () => {
    const originalFindOneAndUpdate = VendorPurchase.findOneAndUpdate;
    const originalUpdateOne = VendorPurchase.updateOne;
    const originalFindById = VendorPurchase.findById;
    const originalProductUpdateOne = Product.updateOne;
    let capturedReceivedQuantity = null;
    // "before" represents the Ordered document this atomically flips from — 100 kg was ordered.
    VendorPurchase.findOneAndUpdate = async () => ({ _id: 'pu1', product: 'p1', quantity: 100 });
    VendorPurchase.updateOne = async (filter, update) => { capturedReceivedQuantity = update.$set.receivedQuantity; return { acknowledged: true }; };
    VendorPurchase.findById = async (id) => ({ _id: id, status: 'Received', receivedQuantity: capturedReceivedQuantity });
    Product.updateOne = async () => ({ acknowledged: true });
    try {
      const result = await run(receivePurchase, { params: { productId: 'p1', vendorId: 'e1', purchaseId: 'pu1' } });
      assert.equal(result.status, 200);
      assert.equal(capturedReceivedQuantity, 100, 'receivedQuantity must be set to the full ordered quantity, never a partial amount — there is no partial-receipt workflow');
    } finally {
      VendorPurchase.findOneAndUpdate = originalFindOneAndUpdate;
      VendorPurchase.updateOne = originalUpdateOne;
      VendorPurchase.findById = originalFindById;
      Product.updateOne = originalProductUpdateOne;
    }
  });
});

describe('createPurchase (vendorController.js): inactive central vendor is blocked (Stage 6.1)', () => {
  function stubProductWithVendor(embeddedVendorOverrides) {
    return async () => ({ _id: 'p1', vendors: [{ _id: 'e1', name: 'Rajesh', purchasePrice: 20, ...embeddedVendorOverrides }] });
  }
  const validBody = { purchaseDate: '2026-01-01', quantity: 10, unit: 'kg', rate: 20, status: 'Ordered' };

  it('allows a purchase when the linked central vendor is Active', async () => {
    const originalProductFindById = Product.findById;
    const originalVendorFindById = Vendor.findById;
    const originalCreate = VendorPurchase.create;
    let created = false;
    Product.findById = stubProductWithVendor({ vendorRef: 'central1' });
    Vendor.findById = async () => ({ _id: 'central1', status: 'Active' });
    VendorPurchase.create = async (doc) => { created = true; return { _id: 'pu1', ...doc }; };
    try {
      const result = await run(createPurchase, { params: { productId: 'p1', vendorId: 'e1' }, body: validBody });
      assert.equal(result.status, 201);
      assert.equal(created, true);
    } finally { Product.findById = originalProductFindById; Vendor.findById = originalVendorFindById; VendorPurchase.create = originalCreate; }
  });

  it('rejects a purchase when the linked central vendor is Inactive, without ever creating the purchase', async () => {
    const originalProductFindById = Product.findById;
    const originalVendorFindById = Vendor.findById;
    const originalCreate = VendorPurchase.create;
    let created = false;
    Product.findById = stubProductWithVendor({ vendorRef: 'central1' });
    Vendor.findById = async () => ({ _id: 'central1', status: 'Inactive' });
    VendorPurchase.create = async () => { created = true; };
    try {
      const result = await run(createPurchase, { params: { productId: 'p1', vendorId: 'e1' }, body: validBody });
      assert.equal(result.status, 400);
      assert.match(result.body.message, /inactive/i);
      assert.equal(created, false, 'no purchase must be created when the central vendor is inactive');
    } finally { Product.findById = originalProductFindById; Vendor.findById = originalVendorFindById; VendorPurchase.create = originalCreate; }
  });

  it('never confuses the central Vendor id with the embedded vendor id passed in the URL', async () => {
    const originalProductFindById = Product.findById;
    const originalVendorFindById = Vendor.findById;
    const originalCreate = VendorPurchase.create;
    let capturedVendorLookupId = null;
    Product.findById = stubProductWithVendor({ vendorRef: 'central-different-from-e1' });
    Vendor.findById = async (id) => { capturedVendorLookupId = id; return { _id: id, status: 'Active' }; };
    VendorPurchase.create = async (doc) => ({ _id: 'pu1', ...doc });
    try {
      await run(createPurchase, { params: { productId: 'p1', vendorId: 'e1' }, body: validBody });
      assert.equal(capturedVendorLookupId, 'central-different-from-e1', 'must look up by the embedded row\'s vendorRef, never by the embedded vendor id (e1) from the URL');
      assert.notEqual(capturedVendorLookupId, 'e1');
    } finally { Product.findById = originalProductFindById; Vendor.findById = originalVendorFindById; VendorPurchase.create = originalCreate; }
  });

  it('a legacy embedded row with no vendorRef preserves existing behavior exactly — the central Vendor is never looked up at all', async () => {
    const originalProductFindById = Product.findById;
    const originalVendorFindById = Vendor.findById;
    const originalCreate = VendorPurchase.create;
    let vendorLookupCalled = false;
    let created = false;
    Product.findById = stubProductWithVendor({ vendorRef: null });
    Vendor.findById = async () => { vendorLookupCalled = true; return null; };
    VendorPurchase.create = async (doc) => { created = true; return { _id: 'pu1', ...doc }; };
    try {
      const result = await run(createPurchase, { params: { productId: 'p1', vendorId: 'e1' }, body: validBody });
      assert.equal(result.status, 201);
      assert.equal(created, true);
      assert.equal(vendorLookupCalled, false, 'no vendorRef means no central Vendor lookup at all — existing legacy behavior, unchanged');
    } finally { Product.findById = originalProductFindById; Vendor.findById = originalVendorFindById; VendorPurchase.create = originalCreate; }
  });

  it('a vendorRef that no longer resolves to a real central Vendor is handled safely — the purchase proceeds rather than crashing or silently blocking', async () => {
    const originalProductFindById = Product.findById;
    const originalVendorFindById = Vendor.findById;
    const originalCreate = VendorPurchase.create;
    let created = false;
    Product.findById = stubProductWithVendor({ vendorRef: 'ghost-vendor' });
    Vendor.findById = async () => null; // dangling reference
    VendorPurchase.create = async (doc) => { created = true; return { _id: 'pu1', ...doc }; };
    try {
      const result = await run(createPurchase, { params: { productId: 'p1', vendorId: 'e1' }, body: validBody });
      assert.equal(result.status, 201);
      assert.equal(created, true);
    } finally { Product.findById = originalProductFindById; Vendor.findById = originalVendorFindById; VendorPurchase.create = originalCreate; }
  });
});

describe('getVendorPriceHistory (stubbed, no database)', () => {
  it('returns 404 for a vendor that does not exist', async () => {
    const original = Vendor.findById;
    Vendor.findById = async () => null;
    try {
      const result = await run(getVendorPriceHistory, { params: { id: 'missing' } });
      assert.equal(result.status, 404);
    } finally { Vendor.findById = original; }
  });

  it('a vendor with no linked products returns empty history without ever querying VendorPriceHistory', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    const originalHistory = VendorPriceHistory.find;
    let queried = false;
    Vendor.findById = async () => ({ _id: vendorId, name: 'X', status: 'Active' });
    Product.find = stubFind([]);
    VendorPriceHistory.find = () => { queried = true; return { sort: () => Promise.resolve([]) }; };
    try {
      const result = await run(getVendorPriceHistory, { params: { id: vendorId } });
      assert.deepEqual(result.body.history, []);
      assert.equal(queried, false);
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; VendorPriceHistory.find = originalHistory; }
  });

  it('resolves history across every embedded vendor id linked to this vendor, chronological (newest first), with product names attached', async () => {
    const originalVendor = Vendor.findById;
    const originalProduct = Product.find;
    const originalHistory = VendorPriceHistory.find;
    let capturedFilter = null;
    let capturedSort = null;
    Vendor.findById = async () => ({ _id: vendorId, name: 'X', status: 'Active' });
    Product.find = stubFind([
      { _id: 'p1', name: 'Potato', category: 'Vegetables', vendors: [{ _id: 'e1', vendorRef: vendorId }] },
      { _id: 'p2', name: 'Onion', category: 'Vegetables', vendors: [{ _id: 'e2', vendorRef: vendorId }] },
    ]);
    VendorPriceHistory.find = (filter) => {
      capturedFilter = filter;
      return { sort: (sortArg) => { capturedSort = sortArg; return Promise.resolve([
        { _id: 'h1', product: 'p2', vendor: 'e2', previousPrice: 10, newPrice: 12, reason: 'Season change', createdAt: new Date('2026-02-01') },
        { _id: 'h2', product: 'p1', vendor: 'e1', previousPrice: 20, newPrice: 22, reason: '', createdAt: new Date('2026-01-01') },
      ]); } };
    };
    try {
      const result = await run(getVendorPriceHistory, { params: { id: vendorId } });
      assert.deepEqual(capturedFilter.vendor.$in, ['e1', 'e2']);
      assert.deepEqual(capturedSort, { createdAt: -1 });
      assert.equal(result.body.history[0].productName, 'Onion');
      assert.equal(result.body.history[1].productName, 'Potato');
      assert.equal(result.body.history[0].reason, 'Season change');
    } finally { Vendor.findById = originalVendor; Product.find = originalProduct; VendorPriceHistory.find = originalHistory; }
  });
});
