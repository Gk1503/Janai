import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Product from '../models/Product.js';
import { listStockRows, updateStockThreshold } from '../controllers/stockController.js';
import stockRouter from '../routes/stockRoutes.js';
import { requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth.js';

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

const findStub = (returnValue) => () => ({ sort: () => Promise.resolve(returnValue) });
const viewer = { role: 'staff', isActive: true, permissions: ['products:view'] };
const inventoryOnlyViewer = { role: 'staff', isActive: true, permissions: ['inventory:update'] };
const manager = { role: 'staff', isActive: true, permissions: ['products:manage', 'products:view'] };

describe('stockRoutes: wiring and permissions', () => {
  it('GET / requires auth then one of products:view/products:manage/inventory:update', () => {
    const layer = stockRouter.stack.find((entry) => entry.route?.path === '/' && entry.route.methods.get);
    assert.ok(layer);
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.equal(handlers[0], requireAuth);
    assert.equal(handlers[2], listStockRows);
  });

  it('PATCH .../threshold requires auth then products:manage specifically, not inventory:update', () => {
    const layer = stockRouter.stack.find((entry) => entry.route?.path === '/:productId/variations/:variationId/threshold' && entry.route.methods.patch);
    assert.ok(layer);
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.equal(handlers[0], requireAuth);
    assert.equal(handlers[2], updateStockThreshold);
  });
});

describe('listStockRows: one row per effective variation', () => {
  it('a legacy product with an unconfigured threshold produces exactly one Default row, status unconfigured', async () => {
    const original = Product.find;
    Product.find = findStub([{ _id: 'p1', name: 'Tomato', category: 'Vegetables', images: [], stock: 10, unit: 'kg', minStockThreshold: 0, variations: [] }]);
    try {
      const result = await run(listStockRows, { user: viewer, query: {} });
      assert.equal(result.status, 200);
      assert.equal(result.body.rows.length, 1);
      assert.equal(result.body.rows[0].variationLabel, 'Default');
      assert.equal(result.body.rows[0].status, 'unconfigured');
      assert.equal(result.body.rows[0].isLegacy, true);
    } finally { Product.find = original; }
  });

  it('a legacy product with a configured, persisted threshold shows low or healthy correctly, never unconfigured', async () => {
    const original = Product.find;
    Product.find = findStub([{ _id: 'p1', name: 'Tomato', category: 'Vegetables', images: [], stock: 4, unit: 'kg', minStockThreshold: 5, variations: [] }]);
    try {
      const result = await run(listStockRows, { user: viewer, query: {} });
      assert.equal(result.body.rows[0].status, 'lowStock');
      assert.equal(result.body.rows[0].minStockThreshold, 5);
    } finally { Product.find = original; }
  });

  it('real variations keep independent thresholds, and an inactive variation is excluded entirely', async () => {
    const original = Product.find;
    Product.find = findStub([{
      _id: 'p1', name: 'Rice', category: 'Groceries', images: [],
      variations: [
        { _id: 'v1', label: '500 g', unit: 'pack', stock: 2, minStockThreshold: 5, isActive: true },
        { _id: 'v2', label: '1 kg', unit: 'pack', stock: 20, minStockThreshold: 0, isActive: true },
        { _id: 'v3', label: 'Old', unit: 'pack', stock: 0, minStockThreshold: 1, isActive: false },
      ],
    }]);
    try {
      const result = await run(listStockRows, { user: viewer, query: {} });
      assert.equal(result.body.rows.length, 2, 'the inactive variation must not appear as a row');
      assert.equal(result.body.rows[0].status, 'lowStock');
      assert.equal(result.body.rows[1].status, 'unconfigured');
    } finally { Product.find = original; }
  });

  it('filters by status after expansion, and rejects an unknown status value', async () => {
    const original = Product.find;
    Product.find = findStub([
      { _id: 'p1', name: 'A', category: 'X', images: [], stock: 0, unit: 'kg', minStockThreshold: 0, variations: [] },
      { _id: 'p2', name: 'B', category: 'X', images: [], stock: 10, unit: 'kg', minStockThreshold: 0, variations: [] },
    ]);
    try {
      const outOfStock = await run(listStockRows, { user: viewer, query: { status: 'outOfStock' } });
      assert.equal(outOfStock.body.rows.length, 1);
      assert.equal(outOfStock.body.rows[0].productName, 'A');
      const invalid = await run(listStockRows, { user: viewer, query: { status: 'not-a-real-status' } });
      assert.equal(invalid.status, 400);
    } finally { Product.find = original; }
  });

  it('paginates the expanded row list, not the product list', async () => {
    const original = Product.find;
    const products = Array.from({ length: 5 }, (_, index) => ({ _id: `p${index}`, name: `P${index}`, category: 'X', images: [], stock: 10, unit: 'kg', minStockThreshold: 0, variations: [] }));
    Product.find = findStub(products);
    try {
      const result = await run(listStockRows, { user: viewer, query: { page: '2', limit: '2' } });
      assert.equal(result.body.total, 5);
      assert.equal(result.body.pages, 3);
      assert.equal(result.body.rows.length, 2);
      assert.equal(result.body.rows[0].productName, 'P2');
    } finally { Product.find = original; }
  });
});

describe('updateStockThreshold: authorization, validation and correct targeting', () => {
  it('persists a legacy product threshold without touching stock or any other field', async () => {
    const originalFindById = Product.findById;
    const product = { _id: 'p1', stock: 42, unit: 'kg', minStockThreshold: 0, variations: [], save: async function () { return this; } };
    Product.findById = async () => product;
    try {
      const result = await run(updateStockThreshold, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { minStockThreshold: 7 } });
      assert.equal(result.status, 200);
      assert.equal(product.minStockThreshold, 7);
      assert.equal(product.stock, 42, 'stock itself must never change');
    } finally { Product.findById = originalFindById; }
  });

  it('persists a real variation threshold independently of its sibling variations', async () => {
    const originalFindById = Product.findById;
    const v1 = '507f1f77bcf86cd799439011';
    const v2 = '507f1f77bcf86cd799439012';
    const product = {
      _id: 'p1',
      variations: [{ _id: v1, stock: 2, minStockThreshold: 1 }, { _id: v2, stock: 20, minStockThreshold: 3 }],
      save: async function () { return this; },
    };
    Product.findById = async () => product;
    try {
      const result = await run(updateStockThreshold, { user: manager, params: { productId: 'p1', variationId: v1 }, body: { minStockThreshold: 10 } });
      assert.equal(result.status, 200);
      assert.equal(product.variations[0].minStockThreshold, 10);
      assert.equal(product.variations[1].minStockThreshold, 3, 'the sibling variation must be untouched');
    } finally { Product.findById = originalFindById; }
  });

  it('rejects a negative or non-numeric threshold without writing anything', async () => {
    const originalFindById = Product.findById;
    let saved = false;
    const product = { _id: 'p1', variations: [], minStockThreshold: 0, save: async function () { saved = true; return this; } };
    Product.findById = async () => product;
    try {
      const negative = await run(updateStockThreshold, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { minStockThreshold: -1 } });
      assert.equal(negative.status, 400);
      const notANumber = await run(updateStockThreshold, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { minStockThreshold: 'abc' } });
      assert.equal(notANumber.status, 400);
      assert.equal(saved, false);
    } finally { Product.findById = originalFindById; }
  });

  it('returns 404 for a variation id that does not exist on the product', async () => {
    const originalFindById = Product.findById;
    const product = { _id: 'p1', variations: [{ _id: '507f1f77bcf86cd799439011', stock: 1, minStockThreshold: 0 }], save: async () => {} };
    Product.findById = async () => product;
    try {
      const result = await run(updateStockThreshold, { user: manager, params: { productId: 'p1', variationId: '507f1f77bcf86cd799439099' }, body: { minStockThreshold: 2 } });
      assert.equal(result.status, 404);
    } finally { Product.findById = originalFindById; }
  });

  it('the route\'s own permission middleware requires products:manage — inventory:update alone is rejected before the handler ever runs', async () => {
    const layer = stockRouter.stack.find((entry) => entry.route?.path === '/:productId/variations/:variationId/threshold' && entry.route.methods.patch);
    const permissionMiddleware = layer.route.stack[1].handle;
    const rejected = await run((req, res, next) => permissionMiddleware(req, res, next), { user: inventoryOnlyViewer });
    assert.equal(rejected.status, 403);
    const allowed = await new Promise((resolve) => permissionMiddleware({ user: manager }, {}, () => resolve('next-called')));
    assert.equal(allowed, 'next-called');
  });
});
