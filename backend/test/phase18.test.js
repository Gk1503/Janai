import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Product from '../models/Product.js';
import VendorPurchase from '../models/VendorPurchase.js';
import Order from '../models/Order.js';
import BulkOrder from '../models/BulkOrder.js';
import { getInventoryOverview } from '../controllers/inventoryController.js';
import inventoryRouter from '../routes/inventoryRoutes.js';
import { requireAnyPermission, requireAuth } from '../middleware/auth.js';

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

const findStub = (returnValue) => () => Promise.resolve(returnValue);
const chainable = (returnValue = []) => () => ({ sort: () => ({ limit: () => Promise.resolve(returnValue) }) });
function stubEmptyActivity() {
  // 'Ordered' purchases are awaited directly (no chain); 'Received' ones are sorted+limited.
  VendorPurchase.find = (filter) => (filter.status === 'Ordered' ? Promise.resolve([]) : chainable()());
  Order.find = chainable();
  BulkOrder.find = chainable();
}

const viewerWithCosts = { role: 'staff', isActive: true, permissions: ['products:view'] };
const inventoryOnlyViewer = { role: 'staff', isActive: true, permissions: ['inventory:update'] };

describe('inventoryRoutes: GET /overview permission wiring', () => {
  it('requires auth then one of products:view/products:manage/inventory:update', () => {
    const layer = inventoryRouter.stack.find((entry) => entry.route?.path === '/overview' && entry.route.methods.get);
    assert.ok(layer, 'GET /overview must exist');
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.equal(handlers[0], requireAuth);
    assert.equal(handlers[2], getInventoryOverview);
    assert.equal(handlers.length, 3);
  });
});

describe('getInventoryOverview: legacy products (no real variations) — current real-data shape', () => {
  it('aggregates stock, counts every legacy product as one implicit variation, and treats threshold 0 as unconfigured, not healthy', async () => {
    const originalProductFind = Product.find;
    const originalVPFind = VendorPurchase.find;
    const originalOrderFind = Order.find;
    const originalBulkFind = BulkOrder.find;
    Product.find = findStub([
      { _id: 'p1', name: 'Tomato', stock: 0, unit: 'kg', variations: [] }, // out of stock
      { _id: 'p2', name: 'Potato', stock: 50, unit: 'kg', variations: [] }, // in stock, no threshold -> unconfigured
      { _id: 'p3', name: 'Milk', stock: 10, unit: 'L', variations: [] },
    ]);
    stubEmptyActivity();
    try {
      const result = await run(getInventoryOverview, { user: viewerWithCosts });
      assert.equal(result.status, 200);
      const { summary, attention } = result.body;
      assert.equal(summary.totalProducts, 3);
      assert.equal(summary.totalActiveVariations, 3, 'every legacy product counts as exactly one implicit variation');
      assert.deepEqual(summary.stockByUnit.sort((a, b) => a.unit.localeCompare(b.unit)), [{ unit: 'kg', quantity: 50 }, { unit: 'L', quantity: 10 }], 'kg and L must never be combined into one total');
      assert.equal(summary.outOfStockCount, 1);
      assert.equal(summary.lowStockCount, 0, 'no legacy product has a real threshold, so none can be "low"');
      assert.equal(summary.healthyConfiguredCount, 0);
      assert.equal(summary.unconfiguredThresholdCount, 2, 'the two in-stock legacy products are unconfigured, not confirmed healthy');
      assert.equal(attention.outOfStock.length, 1);
      assert.equal(attention.outOfStock[0].productName, 'Tomato');
      assert.equal(attention.lowStock.length, 0);
    } finally {
      Product.find = originalProductFind; VendorPurchase.find = originalVPFind; Order.find = originalOrderFind; BulkOrder.find = originalBulkFind;
    }
  });
});

describe('getInventoryOverview: products with real variations', () => {
  it('counts each active real variation, excludes inactive ones, and buckets low/healthy correctly', async () => {
    const originalProductFind = Product.find;
    const originalVPFind = VendorPurchase.find;
    const originalOrderFind = Order.find;
    const originalBulkFind = BulkOrder.find;
    stubEmptyActivity();
    Product.find = findStub([
      {
        _id: 'p1', name: 'Rice', stock: 0, unit: 'kg',
        variations: [
          { _id: 'v1', label: '500 g', unit: 'pack', stock: 2, minStockThreshold: 5, isActive: true }, // low
          { _id: 'v2', label: '1 kg', unit: 'pack', stock: 20, minStockThreshold: 5, isActive: true }, // healthy
          { _id: 'v3', label: 'Discontinued', unit: 'pack', stock: 0, minStockThreshold: 1, isActive: false }, // excluded
        ],
      },
    ]);
    stubEmptyActivity();
    try {
      const result = await run(getInventoryOverview, { user: viewerWithCosts });
      const { summary, attention } = result.body;
      assert.equal(summary.totalActiveVariations, 2, 'the inactive variation must not be counted');
      assert.equal(summary.lowStockCount, 1);
      assert.equal(summary.healthyConfiguredCount, 1);
      assert.equal(summary.outOfStockCount, 0, 'the inactive, zero-stock variation must not count as out-of-stock either');
      assert.equal(attention.lowStock[0].variationLabel, '500 g');
    } finally {
      Product.find = originalProductFind; VendorPurchase.find = originalVPFind; Order.find = originalOrderFind; BulkOrder.find = originalBulkFind;
    }
  });
});

describe('getInventoryOverview: incoming purchases and recent activity', () => {
  it('sums incoming Ordered purchases by unit without touching received ones', async () => {
    const originalProductFind = Product.find;
    const originalVPFind = VendorPurchase.find;
    const originalOrderFind = Order.find;
    const originalBulkFind = BulkOrder.find;
    Product.find = findStub([{ _id: 'p1', name: 'Tomato', stock: 10, unit: 'kg', variations: [] }]);
    VendorPurchase.find = (filter, projection) => {
      if (filter.status === 'Ordered') return Promise.resolve([{ quantity: 20, unit: 'kg' }, { quantity: 5, unit: 'kg' }]);
      return { sort: () => ({ limit: () => Promise.resolve([{ product: 'p1', vendorName: 'Fresh Farms', quantity: 30, unit: 'kg', rate: 25, totalAmount: 750, receivedAt: new Date() }]) }) };
    };
    const chainable = () => ({ sort: () => ({ limit: () => Promise.resolve([]) }) });
    Order.find = chainable; BulkOrder.find = chainable;
    try {
      const result = await run(getInventoryOverview, { user: viewerWithCosts });
      const { summary, recentActivity } = result.body;
      assert.equal(summary.incoming.count, 2);
      assert.deepEqual(summary.incoming.quantityByUnit, [{ unit: 'kg', quantity: 25 }]);
      assert.equal(recentActivity.receivedPurchases[0].productName, 'Tomato');
      assert.equal(recentActivity.receivedPurchases[0].productExists, true);
      assert.equal(recentActivity.receivedPurchases[0].totalAmount, 750);
    } finally {
      Product.find = originalProductFind; VendorPurchase.find = originalVPFind; Order.find = originalOrderFind; BulkOrder.find = originalBulkFind;
    }
  });

  it('a received purchase referencing a since-deleted product shows a clear fallback, never a blank name — root cause of the real orphaned data found in this database', async () => {
    const originalProductFind = Product.find;
    const originalVPFind = VendorPurchase.find;
    const originalOrderFind = Order.find;
    const originalBulkFind = BulkOrder.find;
    // No product with this id exists any more — deleteProduct has never cascaded to VendorPurchase
    // history (by design: purchase history is preserved, not deleted alongside the product).
    Product.find = findStub([{ _id: 'p-still-here', name: 'Onion', stock: 10, unit: 'kg', variations: [] }]);
    VendorPurchase.find = (filter) => (filter.status === 'Ordered' ? Promise.resolve([]) : {
      sort: () => ({ limit: () => Promise.resolve([{ product: 'p-deleted-long-ago', vendorName: 'Fresh Farms', quantity: 12, unit: 'kg', rate: 10, totalAmount: 120, receivedAt: new Date() }]) }),
    });
    const chainable = () => ({ sort: () => ({ limit: () => Promise.resolve([]) }) });
    Order.find = chainable; BulkOrder.find = chainable;
    try {
      const result = await run(getInventoryOverview, { user: viewerWithCosts });
      const row = result.body.recentActivity.receivedPurchases[0];
      assert.equal(row.productExists, false);
      assert.equal(row.productName, 'Product unavailable');
      assert.equal(row.quantity, 12, 'quantity/vendor/amount/date must still display normally — only the name is a fallback');
      assert.equal(row.totalAmount, 120);
    } finally {
      Product.find = originalProductFind; VendorPurchase.find = originalVPFind; Order.find = originalOrderFind; BulkOrder.find = originalBulkFind;
    }
  });

  it('labels order-derived events accurately as deducted or restored, never as a permanent ledger entry', async () => {
    const originalProductFind = Product.find;
    const originalVPFind = VendorPurchase.find;
    const originalOrderFind = Order.find;
    const originalBulkFind = BulkOrder.find;
    Product.find = findStub([]);
    VendorPurchase.find = (filter) => (filter.status === 'Ordered' ? Promise.resolve([]) : { sort: () => ({ limit: () => Promise.resolve([]) }) });
    Order.find = () => ({ sort: () => ({ limit: () => Promise.resolve([{ _id: 'o1', orderType: 'preorder', stockDeductedAt: new Date('2026-01-01'), stockRestoredAt: new Date('2026-01-02') }]) }) });
    BulkOrder.find = () => ({ sort: () => ({ limit: () => Promise.resolve([{ _id: 'b1', stockDeductedAt: new Date('2026-01-03'), stockRestoredAt: null }]) }) });
    try {
      const result = await run(getInventoryOverview, { user: viewerWithCosts });
      const events = result.body.recentActivity.orderEvents;
      const order = events.find((event) => event.type === 'order');
      const bulk = events.find((event) => event.type === 'bulk_order');
      assert.equal(order.event, 'restored');
      assert.equal(bulk.event, 'deducted');
    } finally {
      Product.find = originalProductFind; VendorPurchase.find = originalVPFind; Order.find = originalOrderFind; BulkOrder.find = originalBulkFind;
    }
  });
});

describe('getInventoryOverview: supplier-cost masking', () => {
  it('a viewer holding only inventory:update never receives purchase rate/totalAmount', async () => {
    const originalProductFind = Product.find;
    const originalVPFind = VendorPurchase.find;
    const originalOrderFind = Order.find;
    const originalBulkFind = BulkOrder.find;
    Product.find = findStub([{ _id: 'p1', name: 'Tomato', stock: 10, unit: 'kg', variations: [] }]);
    VendorPurchase.find = (filter) => {
      if (filter.status === 'Ordered') return Promise.resolve([]);
      return { sort: () => ({ limit: () => Promise.resolve([{ product: 'p1', vendorName: 'Fresh Farms', quantity: 30, unit: 'kg', rate: 25, totalAmount: 750, receivedAt: new Date() }]) }) };
    };
    const chainable = () => ({ sort: () => ({ limit: () => Promise.resolve([]) }) });
    Order.find = chainable; BulkOrder.find = chainable;
    try {
      const result = await run(getInventoryOverview, { user: inventoryOnlyViewer });
      assert.equal(result.body.canViewPurchaseValues, false);
      const row = result.body.recentActivity.receivedPurchases[0];
      assert.equal('rate' in row, false);
      assert.equal('totalAmount' in row, false);
      assert.equal(row.quantity, 30, 'quantity itself is still visible — only money is masked');

      const withCosts = await run(getInventoryOverview, { user: viewerWithCosts });
      assert.equal(withCosts.body.canViewPurchaseValues, true);
      assert.equal(withCosts.body.recentActivity.receivedPurchases[0].totalAmount, 750);
    } finally {
      Product.find = originalProductFind; VendorPurchase.find = originalVPFind; Order.find = originalOrderFind; BulkOrder.find = originalBulkFind;
    }
  });
});
