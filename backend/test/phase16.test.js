import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Writable } from 'node:stream';
import Vendor from '../models/Vendor.js';
import Product from '../models/Product.js';
import VendorPurchase from '../models/VendorPurchase.js';
import { exportVendorPurchases, getVendorAnalytics } from '../controllers/vendorAnalyticsController.js';
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

function stubFind(returnValue) {
  return () => Promise.resolve(returnValue);
}
function stubFindSorted(returnValue) {
  return () => ({ sort: () => Promise.resolve(returnValue) });
}

// A representative, two-vendor, two-product dataset reused across most tests below.
//   v1 (Active, "Rajesh") supplies p1 (Potato, kg) via e1, and p2 (Milk, L) via e2.
//   v2 (Inactive, "OldSupplier") also supplies p2 (Milk, L) via e3 — so p2 has two distinct vendors.
//   p2 also carries a LEGACY row (e4, no vendorRef) — it must never appear anywhere in this report.
function stubCatalog() {
  Product.find = stubFind([
    { _id: 'p1', name: 'Potato', category: 'Vegetables', unit: 'kg', vendors: [{ _id: 'e1', vendorRef: 'v1' }] },
    { _id: 'p2', name: 'Milk', category: 'Dairy', unit: 'L', vendors: [{ _id: 'e2', vendorRef: 'v1' }, { _id: 'e3', vendorRef: 'v2' }, { _id: 'e4', vendorRef: null }] },
  ]);
  Vendor.find = stubFind([{ _id: 'v1', name: 'Rajesh', status: 'Active' }, { _id: 'v2', name: 'OldSupplier', status: 'Inactive' }]);
}

describe('vendorRoutes: analytics endpoints wired with the same permission guard, before :id (Stage 8)', () => {
  it('GET /analytics and /analytics/export both require auth then products:manage/inventory:update, and are registered before the generic /:id route', () => {
    const expectations = [
      { path: '/analytics', handler: getVendorAnalytics },
      { path: '/analytics/export', handler: exportVendorPurchases },
    ];
    for (const { path, handler } of expectations) {
      const layer = vendorRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods.get);
      assert.ok(layer, `GET ${path} must exist`);
      const handlers = layer.route.stack.map((entry) => entry.handle);
      assert.equal(handlers.length, 3);
      assert.equal(handlers[0], requireAuth);
      assert.equal(handlers[2], handler);
    }
    const analyticsIndex = vendorRouter.stack.findIndex((entry) => entry.route?.path === '/analytics');
    const genericIdIndex = vendorRouter.stack.findIndex((entry) => entry.route?.path === '/:id' && entry.route.methods.get);
    assert.ok(analyticsIndex < genericIdIndex, '/analytics must be registered before /:id, or /:id would swallow it as an id value');
  });

  it('unauthorized users (other staff, delivery-only, customers) are rejected by the same requireAnyPermission used elsewhere on this router', () => {
    const vendorAccess = requireAnyPermission('products:manage', 'inventory:update');
    for (const user of [{ role: 'staff', permissions: ['orders:view'] }, { role: 'customer' }, undefined]) {
      let passed = false;
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
      vendorAccess({ user }, res, () => { passed = true; });
      assert.equal(passed, false, JSON.stringify(user));
      assert.equal(res.statusCode, 403);
    }
  });
});

describe('getVendorAnalytics: vendor-wise, product-wise and summary aggregation (Stage 8)', () => {
  it('excludes a legacy embedded row with no vendorRef entirely — it can never appear in any table', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    let capturedProductFilter = null;
    Product.find = (filter) => { capturedProductFilter = filter; return stubFind([
      { _id: 'p2', name: 'Milk', category: 'Dairy', unit: 'L', vendors: [{ _id: 'e3', vendorRef: 'v2' }, { _id: 'e4', vendorRef: null }] },
    ])(); };
    Vendor.find = stubFind([{ _id: 'v2', name: 'OldSupplier', status: 'Active' }]);
    VendorPurchase.find = (filter) => {
      // Only e3 may ever appear in the $in set passed to VendorPurchase.find — e4 (legacy) must not.
      assert.ok(filter.vendor.$in.includes('e3'));
      assert.ok(!filter.vendor.$in.includes('e4'));
      return stubFindSorted([
        { _id: 'pu1', product: 'p2', vendor: 'e3', purchaseDate: new Date('2026-01-01'), quantity: 5, unit: 'L', rate: 40, totalAmount: 200, status: 'Ordered', receivedQuantity: 0 },
      ])();
    };
    try {
      const result = await run(getVendorAnalytics, { query: {} });
      assert.equal(result.status, 200);
      assert.deepEqual(capturedProductFilter, { 'vendors.vendorRef': { $ne: null } });
      assert.equal(result.body.byVendor.length, 1);
      assert.equal(result.body.byVendor[0].vendorId, 'v2');
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });

  it('computes vendor-wise purchase count, Ordered/Received amounts (kept separate) and the most recent purchase date', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    VendorPurchase.find = stubFindSorted([
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-01'), quantity: 10, unit: 'kg', rate: 20, totalAmount: 200, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu2', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-02-01'), quantity: 5, unit: 'kg', rate: 22, totalAmount: 110, status: 'Received', receivedQuantity: 5 },
      { _id: 'pu3', product: 'p2', vendor: 'e2', purchaseDate: new Date('2026-01-15'), quantity: 3, unit: 'L', rate: 50, totalAmount: 150, status: 'Received', receivedQuantity: 3 },
    ]);
    try {
      const result = await run(getVendorAnalytics, { query: {} });
      const v1 = result.body.byVendor.find((v) => v.vendorId === 'v1');
      assert.equal(v1.purchaseCount, 3);
      assert.equal(v1.orderedAmount, 200);
      assert.equal(v1.receivedAmount, 5 * 22 + 3 * 50);
      assert.equal(new Date(v1.lastPurchaseDate).toISOString().slice(0, 10), '2026-02-01');
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });

  it('a Received purchase with receivedQuantity 0 still counts toward purchaseCount, but contributes nothing to amounts or quantities anywhere', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    VendorPurchase.find = stubFindSorted([
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-01'), quantity: 10, unit: 'kg', rate: 20, totalAmount: 200, status: 'Received', receivedQuantity: 0 },
    ]);
    try {
      const result = await run(getVendorAnalytics, { query: {} });
      const v1 = result.body.byVendor.find((v) => v.vendorId === 'v1');
      assert.equal(v1.purchaseCount, 1, 'the record itself is still counted');
      assert.equal(v1.receivedAmount, 0, 'but it contributes nothing to the received amount');
      assert.equal(result.body.summary.received.amount, 0);
      assert.deepEqual(result.body.summary.received.quantityByUnit, []);
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });

  it('groups quantity strictly by unit — kg and L are never combined, in the summary or the product table', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    VendorPurchase.find = stubFindSorted([
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-01'), quantity: 10, unit: 'kg', rate: 20, totalAmount: 200, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu2', product: 'p2', vendor: 'e2', purchaseDate: new Date('2026-01-02'), quantity: 5, unit: 'L', rate: 50, totalAmount: 250, status: 'Ordered', receivedQuantity: 0 },
    ]);
    try {
      const result = await run(getVendorAnalytics, { query: {} });
      const byUnit = result.body.summary.ordered.quantityByUnit.sort((a, b) => a.unit.localeCompare(b.unit));
      assert.deepEqual(byUnit, [{ unit: 'kg', quantity: 10 }, { unit: 'L', quantity: 5 }]);
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });

  it('"Total active vendors" counts only distinct vendors that are Active and actually appear among the filtered purchases', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog(); // v1 Active, v2 Inactive
    VendorPurchase.find = stubFindSorted([
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-01'), quantity: 10, unit: 'kg', rate: 20, totalAmount: 200, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu2', product: 'p2', vendor: 'e3', purchaseDate: new Date('2026-01-02'), quantity: 5, unit: 'L', rate: 50, totalAmount: 250, status: 'Ordered', receivedQuantity: 0 },
    ]);
    try {
      const result = await run(getVendorAnalytics, { query: {} });
      assert.equal(result.body.summary.activeVendorCount, 1, 'only v1 (Active) counts — v2 (Inactive) does not');
      assert.equal(result.body.summary.linkedProductCount, 2);
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });

  it('groups monthly trends by calendar month, keeping Ordered and Received amounts separate, and skips a purchase with an invalid date rather than crashing', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    VendorPurchase.find = stubFindSorted([
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-05'), quantity: 10, unit: 'kg', rate: 20, totalAmount: 200, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu2', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-20'), quantity: 4, unit: 'kg', rate: 20, totalAmount: 80, status: 'Received', receivedQuantity: 4 },
      { _id: 'pu3', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-02-01'), quantity: 2, unit: 'kg', rate: 25, totalAmount: 50, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu4', product: 'p1', vendor: 'e1', purchaseDate: new Date('invalid-date'), quantity: 1, unit: 'kg', rate: 1, totalAmount: 1, status: 'Ordered', receivedQuantity: 0 },
    ]);
    try {
      const result = await run(getVendorAnalytics, { query: {} });
      assert.deepEqual(result.body.monthly, [
        { month: '2026-01', purchaseCount: 2, orderedAmount: 200, receivedAmount: 80 },
        { month: '2026-02', purchaseCount: 1, orderedAmount: 50, receivedAmount: 0 },
      ]);
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });
});

describe('getVendorAnalytics: price comparison (Stage 8)', () => {
  it('includes a product only when it has purchases from more than one distinct central vendor', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    VendorPurchase.find = stubFindSorted([
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-01'), quantity: 10, unit: 'kg', rate: 20, totalAmount: 200, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu2', product: 'p2', vendor: 'e2', purchaseDate: new Date('2026-01-02'), quantity: 5, unit: 'L', rate: 50, totalAmount: 250, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu3', product: 'p2', vendor: 'e3', purchaseDate: new Date('2026-01-03'), quantity: 5, unit: 'L', rate: 48, totalAmount: 240, status: 'Ordered', receivedQuantity: 0 },
    ]);
    try {
      const result = await run(getVendorAnalytics, { query: {} });
      const productIds = new Set(result.body.priceComparison.map((row) => row.productId));
      assert.deepEqual(productIds, new Set(['p2']), 'p1 (single vendor) must be excluded; p2 (two vendors) must be included');
      assert.equal(result.body.priceComparison.length, 2, 'one row per (product, vendor) pair');
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });

  it('computes a vendor\'s own previous rate and difference only against its OWN prior purchase of the SAME unit — never a different vendor, never a different unit', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    VendorPurchase.find = stubFindSorted([
      // e2 (v1): an older kg-equivalent-looking purchase in a DIFFERENT unit (g) must not be used as "previous".
      { _id: 'pu0', product: 'p2', vendor: 'e2', purchaseDate: new Date('2025-11-01'), quantity: 5000, unit: 'g', rate: 0.04, totalAmount: 200, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu1', product: 'p2', vendor: 'e2', purchaseDate: new Date('2025-12-01'), quantity: 5, unit: 'L', rate: 45, totalAmount: 225, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu2', product: 'p2', vendor: 'e2', purchaseDate: new Date('2026-01-01'), quantity: 5, unit: 'L', rate: 50, totalAmount: 250, status: 'Ordered', receivedQuantity: 0 },
      { _id: 'pu3', product: 'p2', vendor: 'e3', purchaseDate: new Date('2026-01-02'), quantity: 5, unit: 'L', rate: 48, totalAmount: 240, status: 'Ordered', receivedQuantity: 0 },
    ]);
    try {
      const result = await run(getVendorAnalytics, { query: {} });
      const v1Row = result.body.priceComparison.find((row) => row.vendorId === 'v1');
      assert.equal(v1Row.latestRate, 50);
      assert.equal(v1Row.unit, 'L');
      assert.equal(v1Row.previousRate, 45, 'must skip the mismatched-unit (g) row and use the most recent compatible (L) one');
      assert.equal(v1Row.difference, 5);
      const v2Row = result.body.priceComparison.find((row) => row.vendorId === 'v2');
      assert.equal(v2Row.previousRate, null, 'v2 has only one purchase for this product, so no previous rate exists');
      assert.equal(v2Row.difference, null);
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });
});

describe('getVendorAnalytics: filters (Stage 8)', () => {
  it('a vendor filter narrows the embedded-id set passed to VendorPurchase.find to just that central vendor\'s rows', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    let capturedFilter = null;
    VendorPurchase.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([]) }; };
    try {
      await run(getVendorAnalytics, { query: { vendorId: 'v2' } });
      assert.deepEqual(capturedFilter.vendor.$in.sort(), ['e3']);
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });

  it('product, status and date-range filters are applied to the same VendorPurchase query, alongside the resolved vendor-id set', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    let capturedFilter = null;
    VendorPurchase.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([]) }; };
    try {
      await run(getVendorAnalytics, { query: { productId: 'p1', status: 'Received', from: '2026-01-01', to: '2026-01-31' } });
      assert.equal(capturedFilter.product, 'p1');
      assert.equal(capturedFilter.status, 'Received');
      assert.equal(capturedFilter.purchaseDate.$gte.toISOString().slice(0, 10), '2026-01-01');
      assert.equal(capturedFilter.purchaseDate.$lte.toISOString().slice(0, 10), '2026-01-31');
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });

  it('an invalid status value is simply ignored rather than applied or causing an error', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    let capturedFilter = null;
    VendorPurchase.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([]) }; };
    try {
      const result = await run(getVendorAnalytics, { query: { status: 'NotARealStatus' } });
      assert.equal(result.status, 200);
      assert.equal(capturedFilter.status, undefined);
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });

  it('a vendor filter matching no embedded rows (invalid/unknown vendor) returns an empty, safe report without ever querying VendorPurchase', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    let purchaseQueried = false;
    VendorPurchase.find = () => { purchaseQueried = true; return { sort: () => Promise.resolve([]) }; };
    try {
      const result = await run(getVendorAnalytics, { query: { vendorId: 'does-not-exist' } });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.byVendor, []);
      assert.equal(purchaseQueried, false);
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });
});

describe('exportVendorPurchases (Stage 8)', () => {
  function createWritableRes() {
    const chunks = [];
    const headers = {};
    const writable = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
    writable.setHeader = (name, value) => { headers[name] = value; };
    return { writable, chunks, headers };
  }

  it('streams a real, non-empty .xlsx file with the correct headers and a dated filename', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    VendorPurchase.find = stubFindSorted([
      { _id: 'pu1', product: 'p1', vendor: 'e1', purchaseDate: new Date('2026-01-01'), quantity: 10, unit: 'kg', rate: 20, totalAmount: 200, status: 'Ordered', receivedQuantity: 0, invoiceNumber: 'INV-1', notes: 'Fragile' },
    ]);
    const { writable, chunks, headers } = createWritableRes();
    try {
      await exportVendorPurchases({ query: {} }, writable, (error) => { throw error; });
      assert.equal(headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      assert.match(headers['Content-Disposition'], /^attachment; filename="vendor-purchases-\d{4}-\d{2}-\d{2}\.xlsx"$/);
      assert.ok(Buffer.concat(chunks).length > 0, 'a real xlsx file must be written');
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });

  it('respects the same filters as the analytics endpoint — reuses resolveFilteredPurchases, not a second purchase API', async () => {
    const originalProduct = Product.find;
    const originalVendor = Vendor.find;
    const originalPurchase = VendorPurchase.find;
    stubCatalog();
    let capturedFilter = null;
    VendorPurchase.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([]) }; };
    const { writable } = createWritableRes();
    try {
      await exportVendorPurchases({ query: { vendorId: 'v1', status: 'Ordered' } }, writable, (error) => { throw error; });
      assert.deepEqual(capturedFilter.vendor.$in.sort(), ['e1', 'e2']);
      assert.equal(capturedFilter.status, 'Ordered');
    } finally { Product.find = originalProduct; Vendor.find = originalVendor; VendorPurchase.find = originalPurchase; }
  });
});
