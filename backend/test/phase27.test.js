import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import Vendor, { normalizeVendorName } from '../models/Vendor.js';
import Product from '../models/Product.js';
import VendorPriceHistory from '../models/VendorPriceHistory.js';
import { createVendor, deactivateVendor, getVendor, listVendors, updateVendor } from '../controllers/adminVendorController.js';
import { createProduct, updateProduct } from '../controllers/productController.js';
import { listPriceHistory, listPurchases, createPurchase, receivePurchase } from '../controllers/vendorController.js';
import vendorRouter from '../routes/vendorRoutes.js';
import productRouter from '../routes/productRoutes.js';
import { requireAnyPermission, requireAuth } from '../middleware/auth.js';
import { applyApprovedMappings, buildDryRunReport, groupEmbeddedVendorsByName } from '../scripts/vendorBackfillLogic.js';

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

const owner = { _id: 'owner1', id: 'owner1', role: 'admin' };

describe('Vendor model validation', () => {
  it('requires a name', () => {
    const doc = new Vendor({});
    const error = doc.validateSync();
    assert.ok(error);
    assert.ok(error.errors.name);
  });

  it('defaults status to Active and every optional field to an empty string', () => {
    const doc = new Vendor({ name: 'Rajesh Vegetable Supplier' });
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.status, 'Active');
    assert.equal(doc.contactPerson, '');
    assert.equal(doc.phone, '');
    assert.equal(doc.email, '');
    assert.equal(doc.address, '');
    assert.equal(doc.notes, '');
  });

  it('rejects an invalid status', () => {
    const doc = new Vendor({ name: 'Test', status: 'Pending' });
    assert.ok(doc.validateSync());
  });

  it('computes a case-insensitive, whitespace-normalized normalizedName before validation — on the async validate() path every real write (Vendor.create/.save()) actually uses', async () => {
    const doc = new Vendor({ name: '  Rajesh   Vegetable   Supplier  ' });
    await doc.validate();
    assert.equal(doc.normalizedName, 'rajesh vegetable supplier');
  });

  it('normalizeVendorName lowercases and collapses whitespace independently of the model', () => {
    assert.equal(normalizeVendorName('  Rajesh   Vegetable Supplier '), 'rajesh vegetable supplier');
    assert.equal(normalizeVendorName('RAJESH VEGETABLE SUPPLIER'), 'rajesh vegetable supplier');
    assert.equal(normalizeVendorName(''), '');
    assert.equal(normalizeVendorName(undefined), '');
  });
});

describe('adminVendorController: CRUD (stubbed model, no database)', () => {
  it('listVendors returns every vendor sorted by name when no filters are given', async () => {
    const originalFind = Vendor.find;
    const originalAggregate = Product.aggregate;
    let capturedFilter = null;
    Vendor.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([{ _id: '1', name: 'A', status: 'Active' }]) }; };
    Product.aggregate = async () => [];
    try {
      const result = await run(listVendors, { query: {} });
      assert.equal(result.status, 200);
      assert.deepEqual(capturedFilter, {});
      assert.equal(result.body.vendors.length, 1);
    } finally { Vendor.find = originalFind; Product.aggregate = originalAggregate; }
  });

  it('listVendors filters by status and rejects an invalid one before ever querying', async () => {
    const original = Vendor.find;
    let called = false;
    Vendor.find = () => { called = true; return { sort: () => Promise.resolve([]) }; };
    try {
      const bad = await run(listVendors, { query: { status: 'Pending' } });
      assert.equal(bad.status, 400);
      assert.equal(called, false);

      const good = await run(listVendors, { query: { status: 'Inactive' } });
      assert.equal(good.status, 200);
      assert.equal(called, true);
    } finally { Vendor.find = original; }
  });

  it('listVendors searches by a case-insensitive, regex-escaped normalized name (name/contact/phone search broadened in Stage 2 — see phase14.test.js)', async () => {
    const original = Vendor.find;
    let capturedFilter = null;
    Vendor.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([]) }; };
    try {
      await run(listVendors, { query: { q: 'Raj.*Supplier (new)' } });
      assert.ok(capturedFilter.$or[0].normalizedName.$regex.includes('\\.'), 'regex special characters must be escaped');
    } finally { Vendor.find = original; }
  });

  it('getVendor returns 404 when the vendor does not exist', async () => {
    const original = Vendor.findById;
    Vendor.findById = async () => null;
    try {
      const result = await run(getVendor, { params: { id: 'x' } });
      assert.equal(result.status, 404);
    } finally { Vendor.findById = original; }
  });

  it('createVendor requires a name and a valid status, and never touches the database for invalid input', async () => {
    const originalCreate = Vendor.create;
    const originalFind = Vendor.find;
    let created = false;
    Vendor.create = async () => { created = true; };
    Vendor.find = () => ({ sort: () => Promise.resolve([]) });
    try {
      const missingName = await run(createVendor, { body: { name: '  ' }, user: owner });
      assert.equal(missingName.status, 400);
      const badStatus = await run(createVendor, { body: { name: 'X', status: 'Pending' }, user: owner });
      assert.equal(badStatus.status, 400);
      assert.equal(created, false);
    } finally { Vendor.create = originalCreate; Vendor.find = originalFind; }
  });

  it('createVendor succeeds and surfaces, but never blocks on, an existing same-normalized-name vendor', async () => {
    const originalCreate = Vendor.create;
    const originalFind = Vendor.find;
    let createdPayload = null;
    Vendor.create = async (payload) => { createdPayload = payload; return { _id: 'new1', ...payload }; };
    Vendor.find = (filter) => ({
      sort: () => Promise.resolve(filter.normalizedName === 'rajesh vegetable supplier' ? [{ _id: 'existing1', name: 'Rajesh Vegetable Supplier', status: 'Active' }] : []),
    });
    try {
      const result = await run(createVendor, { body: { name: 'rajesh vegetable supplier ' }, user: owner });
      assert.equal(result.status, 201);
      assert.equal(createdPayload.createdBy, owner._id);
      assert.equal(result.body.possibleDuplicates.length, 1, 'an existing same-normalized-name vendor must be surfaced');
      assert.equal(result.body.possibleDuplicates[0].name, 'Rajesh Vegetable Supplier');
      assert.ok(result.body.vendor, 'creation must still succeed — duplicate names are detected, never blocked');
    } finally { Vendor.create = originalCreate; Vendor.find = originalFind; }
  });

  it('updateVendor recomputes normalizedName whenever name changes, and leaves it untouched otherwise', async () => {
    const original = Vendor.findByIdAndUpdate;
    let capturedUpdate = null;
    Vendor.findByIdAndUpdate = async (id, update) => { capturedUpdate = update; return { _id: id, name: update.name || 'Existing', status: 'Active' }; };
    try {
      await run(updateVendor, { params: { id: 'v1' }, body: { name: 'New Name' } });
      assert.equal(capturedUpdate.normalizedName, 'new name');

      await run(updateVendor, { params: { id: 'v1' }, body: { phone: '999' } });
      assert.equal(capturedUpdate.name, undefined);
      assert.equal(capturedUpdate.normalizedName, undefined);
    } finally { Vendor.findByIdAndUpdate = original; }
  });

  it('updateVendor returns 404 when the vendor no longer exists', async () => {
    const original = Vendor.findByIdAndUpdate;
    Vendor.findByIdAndUpdate = async () => null;
    try {
      const result = await run(updateVendor, { params: { id: 'gone' }, body: { phone: '1' } });
      assert.equal(result.status, 404);
    } finally { Vendor.findByIdAndUpdate = original; }
  });

  it('deactivateVendor sets status to Inactive without touching any other field', async () => {
    const original = Vendor.findByIdAndUpdate;
    let capturedUpdate = null;
    Vendor.findByIdAndUpdate = async (id, update) => { capturedUpdate = update; return { _id: id, status: 'Inactive' }; };
    try {
      const result = await run(deactivateVendor, { params: { id: 'v1' } });
      assert.equal(result.status, 200);
      assert.deepEqual(capturedUpdate, { status: 'Inactive' });
      assert.equal(result.body.vendor.status, 'Inactive');
    } finally { Vendor.findByIdAndUpdate = original; }
  });

  it('deactivateVendor returns 404 when the vendor no longer exists', async () => {
    const original = Vendor.findByIdAndUpdate;
    Vendor.findByIdAndUpdate = async () => null;
    try {
      const result = await run(deactivateVendor, { params: { id: 'gone' } });
      assert.equal(result.status, 404);
    } finally { Vendor.findByIdAndUpdate = original; }
  });
});

describe('vendorRoutes: permission enforcement', () => {
  it('every vendor route requires auth, then the shared products:manage/inventory:update check, before its handler', () => {
    const expectations = [
      { method: 'get', path: '/', handler: listVendors },
      { method: 'get', path: '/:id', handler: getVendor },
      { method: 'post', path: '/', handler: createVendor },
      { method: 'put', path: '/:id', handler: updateVendor },
      { method: 'patch', path: '/:id/deactivate', handler: deactivateVendor },
    ];
    for (const { method, path, handler } of expectations) {
      const layer = vendorRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
      assert.ok(layer, `${method.toUpperCase()} ${path} must exist`);
      const handlers = layer.route.stack.map((entry) => entry.handle);
      assert.equal(handlers.length, 3, `${method.toUpperCase()} ${path} must be exactly requireAuth -> permission check -> handler`);
      assert.equal(handlers[0], requireAuth);
      assert.equal(handlers[2], handler);
    }
  });

  it('the shared permission check accepts the owner and staff holding products:manage or inventory:update', () => {
    const vendorAccess = requireAnyPermission('products:manage', 'inventory:update');
    const allowed = [
      { role: 'admin' },
      // products:manage requires its products:view prerequisite to actually be held (see REQUIRES in
      // config/permissions.js) — real staff accounts always carry it alongside, same as the
      // inventory_manager role template (['products:view', 'inventory:update']).
      { role: 'staff', permissions: ['products:view', 'products:manage'] },
      { role: 'staff', permissions: ['inventory:update'] },
    ];
    for (const user of allowed) {
      let passed = false;
      vendorAccess({ user }, { status() { return this; }, json() { return this; } }, () => { passed = true; });
      assert.equal(passed, true, JSON.stringify(user));
    }
  });

  it('the shared permission check rejects other staff, delivery-only staff, and customers', () => {
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

describe('Product model: vendorRef compatibility (additive, optional)', () => {
  it('an embedded vendor validates fine with no vendorRef at all — identical to before this field existed', () => {
    const doc = new Product({ name: 'Potato', category: 'Vegetables', description: 'x', price: 10, vendors: [{ name: 'Old Vendor', purchasePrice: 5 }] });
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.vendors[0].vendorRef, null);
  });

  it('an embedded vendor accepts a valid vendorRef and keeps every other existing field intact', () => {
    const vendorId = new mongoose.Types.ObjectId();
    const doc = new Product({
      name: 'Potato', category: 'Vegetables', description: 'x', price: 10,
      vendors: [{ name: 'Rajesh', purchasePrice: 5, moq: '10kg', leadTime: '1 day', preferred: true, lastPurchasePrice: 4.5, notes: 'reliable', vendorRef: vendorId }],
    });
    assert.equal(doc.validateSync(), undefined);
    const vendor = doc.vendors[0];
    assert.equal(String(vendor.vendorRef), String(vendorId));
    assert.equal(vendor.name, 'Rajesh');
    assert.equal(vendor.purchasePrice, 5);
    assert.equal(vendor.moq, '10kg');
    assert.equal(vendor.leadTime, '1 day');
    assert.equal(vendor.preferred, true);
    assert.equal(vendor.lastPurchasePrice, 4.5);
    assert.equal(vendor.notes, 'reliable');
  });

  it('an existing embedded vendor _id is never regenerated by the new vendorRef field', () => {
    const existingId = new mongoose.Types.ObjectId();
    const doc = new Product({ name: 'Potato', category: 'Vegetables', description: 'x', price: 10, vendors: [{ _id: existingId, name: 'Rajesh', purchasePrice: 5 }] });
    assert.equal(String(doc.vendors[0]._id), String(existingId));
  });
});

describe('productController: vendorRef passthrough and existing vendor behavior (stubbed, no database)', () => {
  it('createProduct keeps a valid vendorRef and drops an invalid one, the same way it already handles other vendor fields', async () => {
    const original = Product.create;
    let createdPayload = null;
    Product.create = async (payload) => { createdPayload = payload; return { _id: 'p1', ...payload }; };
    try {
      const validId = new mongoose.Types.ObjectId().toString();
      await run(createProduct, { body: { name: 'A', vendors: [{ name: 'V1', purchasePrice: 10, vendorRef: validId }, { name: 'V2', purchasePrice: 5, vendorRef: 'not-an-id' }] } });
      assert.equal(createdPayload.vendors[0].vendorRef, validId);
      assert.equal(createdPayload.vendors[1].vendorRef, undefined);
    } finally { Product.create = original; }
  });

  it('createProduct still strips any client-sent vendor _id, unaffected by the new vendorRef handling', async () => {
    const original = Product.create;
    let createdPayload = null;
    Product.create = async (payload) => { createdPayload = payload; return { _id: 'p1', ...payload }; };
    try {
      await run(createProduct, { body: { name: 'A', vendors: [{ _id: 'client-sent', name: 'V1', purchasePrice: 10 }] } });
      assert.equal(createdPayload.vendors[0]._id, undefined);
    } finally { Product.create = original; }
  });

  it('updateProduct price-history logging is unaffected by vendorRef: a real purchasePrice change still logs exactly as before', async () => {
    const originalFindById = Product.findById;
    const originalUpdate = Product.findByIdAndUpdate;
    const originalInsertMany = VendorPriceHistory.insertMany;
    const existingVendorId = new mongoose.Types.ObjectId();
    let loggedChanges = null;
    Product.findById = async () => ({ vendors: [{ _id: existingVendorId, purchasePrice: 10 }] });
    Product.findByIdAndUpdate = async (id, update) => ({ _id: id, vendors: update.vendors.map((v) => ({ _id: v._id || existingVendorId, name: v.name, purchasePrice: v.purchasePrice })) });
    VendorPriceHistory.insertMany = async (changes) => { loggedChanges = changes; };
    try {
      await run(updateProduct, {
        params: { id: 'p1' },
        user: owner,
        body: { vendors: [{ _id: existingVendorId.toString(), name: 'Rajesh', purchasePrice: 15, vendorRef: new mongoose.Types.ObjectId().toString() }] },
      });
      assert.equal(loggedChanges.length, 1, 'a real purchase-price change must still be logged even when vendorRef is set in the same request');
      assert.equal(loggedChanges[0].previousPrice, 10);
      assert.equal(loggedChanges[0].newPrice, 15);
    } finally {
      Product.findById = originalFindById;
      Product.findByIdAndUpdate = originalUpdate;
      VendorPriceHistory.insertMany = originalInsertMany;
    }
  });
});

describe('existing procurement endpoints remain functional (regression)', () => {
  it('productRoutes.js still wires price-history, purchases, record-purchase and mark-received exactly as before', () => {
    const expectations = [
      { method: 'get', path: '/:productId/vendors/:vendorId/price-history', handler: listPriceHistory },
      { method: 'get', path: '/:productId/vendors/:vendorId/purchases', handler: listPurchases },
      { method: 'post', path: '/:productId/vendors/:vendorId/purchases', handler: createPurchase },
      { method: 'patch', path: '/:productId/vendors/:vendorId/purchases/:purchaseId/receive', handler: receivePurchase },
    ];
    for (const { method, path, handler } of expectations) {
      const layer = productRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
      assert.ok(layer, `${method.toUpperCase()} ${path} must still exist, unchanged`);
      const handlers = layer.route.stack.map((entry) => entry.handle);
      assert.equal(handlers[handlers.length - 1], handler);
    }
  });
});

describe('vendorBackfillLogic: dry-run report (read-only, pure — no model imports, no database)', () => {
  const sampleProducts = [
    { _id: 'prod1', name: 'Potato', vendors: [{ _id: 'v1', name: 'Rajesh Vegetable Supplier', purchasePrice: 20 }] },
    { _id: 'prod2', name: 'Tomato', vendors: [{ _id: 'v2', name: 'rajesh vegetable supplier', purchasePrice: 22 }, { _id: 'v3', name: 'Singh Traders', purchasePrice: 15, vendorRef: 'existingVendor1' }] },
    { _id: 'prod3', name: 'Onion', vendors: [{ _id: 'v4', name: 'Rajesh  Vegetable  Supplier ', purchasePrice: 19 }] },
    { _id: 'prod4', name: 'Garlic', vendors: [{ _id: 'v5', name: 'Singh Trader', purchasePrice: 16 }] },
  ];

  it('groups embedded vendors by case-insensitive, whitespace-normalized name across every product', () => {
    const groups = groupEmbeddedVendorsByName(sampleProducts);
    const rajeshGroup = groups.find((group) => group.normalizedName === 'rajesh vegetable supplier');
    assert.equal(rajeshGroup.occurrences.length, 3);
    assert.deepEqual(new Set(rajeshGroup.occurrences.map((o) => o.productId)), new Set(['prod1', 'prod2', 'prod3']));
  });

  it('never groups across different spellings — "Singh Trader" and "Singh Traders" stay separate', () => {
    const groups = groupEmbeddedVendorsByName(sampleProducts);
    assert.ok(groups.find((g) => g.normalizedName === 'singh traders'));
    assert.ok(groups.find((g) => g.normalizedName === 'singh trader'));
  });

  it('flags a mixed-spelling group for review, and a single-spelling group as only "likely-same", never auto-approved', () => {
    const report = buildDryRunReport(sampleProducts);
    assert.equal(report.totalProducts, 4);
    assert.equal(report.totalEmbeddedVendors, 5);
    const rajeshGroup = report.groups.find((g) => g.normalizedName === 'rajesh vegetable supplier');
    assert.equal(rajeshGroup.productCount, 3);
    assert.equal(rajeshGroup.confidence, 'review-recommended', 'three different raw spellings should be flagged, not auto-approved');
    const singhTradersGroup = report.groups.find((g) => g.normalizedName === 'singh traders');
    assert.equal(singhTradersGroup.confidence, 'likely-same');
    assert.equal(singhTradersGroup.alreadyLinkedCount, 1);
  });

  it('ignores a blank/missing vendor name rather than forming a bogus group', () => {
    const report = buildDryRunReport([{ _id: 'p', name: 'X', vendors: [{ _id: 'v', name: '', purchasePrice: 1 }] }]);
    assert.equal(report.totalGroups, 0);
  });

  it('handles products with no vendors at all, without throwing', () => {
    const report = buildDryRunReport([{ _id: 'p', name: 'X', vendors: [] }, { _id: 'p2', name: 'Y' }]);
    assert.equal(report.totalGroups, 0);
    assert.equal(report.totalProducts, 2);
  });
});

describe('vendorBackfillLogic: applyApprovedMappings (execution requires an explicit approved mapping)', () => {
  it('creates a new Vendor only when mapping.vendor is given, and links every listed embedded vendor by its existing _id', async () => {
    const created = [];
    const updates = [];
    const StubVendor = { create: async (payload) => { const doc = { _id: 'newVendorId', ...payload }; created.push(doc); return doc; } };
    const StubProduct = { updateOne: async (filter, update) => { updates.push({ filter, update }); return { matchedCount: 1 }; } };
    const mappings = [{ vendor: { name: 'Rajesh Vegetable Supplier' }, entries: [{ productId: 'prod1', vendorId: 'v1' }, { productId: 'prod2', vendorId: 'v2' }] }];
    const result = await applyApprovedMappings(mappings, { Vendor: StubVendor, Product: StubProduct });

    assert.equal(result.createdVendors.length, 1);
    assert.equal(result.linked.length, 2);
    assert.equal(result.errors.length, 0);
    assert.equal(updates[0].filter._id, 'prod1');
    assert.equal(updates[0].filter['vendors._id'], 'v1');
    assert.equal(updates[0].update.$set['vendors.$.vendorRef'], 'newVendorId');
  });

  it('reuses an existing Vendor id instead of creating a new one when vendorId is supplied', async () => {
    let createCalled = false;
    const StubVendor = { create: async () => { createCalled = true; } };
    const StubProduct = { updateOne: async () => ({ matchedCount: 1 }) };
    const mappings = [{ vendorId: 'existingVendor1', entries: [{ productId: 'prod2', vendorId: 'v3' }] }];
    const result = await applyApprovedMappings(mappings, { Vendor: StubVendor, Product: StubProduct });
    assert.equal(createCalled, false);
    assert.equal(result.linked[0].vendorId, 'existingVendor1');
  });

  it('only touches entries explicitly listed in a mapping — a name shared by other embedded vendors is never linked automatically', async () => {
    const touched = [];
    const StubVendor = { create: async (payload) => ({ _id: 'v', ...payload }) };
    const StubProduct = { updateOne: async (filter) => { touched.push(filter); return { matchedCount: 1 }; } };
    const mappings = [{ vendor: { name: 'Rajesh Vegetable Supplier' }, entries: [{ productId: 'prod1', vendorId: 'v1' }] }];
    await applyApprovedMappings(mappings, { Vendor: StubVendor, Product: StubProduct });
    assert.equal(touched.length, 1, 'only the one explicitly-listed entry may be touched, regardless of how many other products share that vendor name');
  });

  it('never imports or calls into VendorPurchase/VendorPriceHistory — their records cannot be touched by this function', () => {
    const source = readFileSync(new URL('../scripts/vendorBackfillLogic.js', import.meta.url), 'utf8');
    // Comments are allowed to explain *why* those collections are untouched (and do); what must never
    // appear is an import of either model, or a method call on one.
    assert.ok(!/^import .*VendorPurchase/m.test(source));
    assert.ok(!/^import .*VendorPriceHistory/m.test(source));
    assert.ok(!source.includes('VendorPurchase.'));
    assert.ok(!source.includes('VendorPriceHistory.'));
  });

  it('reports an error and changes nothing for an entry whose embedded vendorId is not actually found on that product', async () => {
    const StubVendor = { create: async (payload) => ({ _id: 'v', ...payload }) };
    const StubProduct = { updateOne: async () => ({ matchedCount: 0 }) };
    const mappings = [{ vendor: { name: 'X' }, entries: [{ productId: 'prod1', vendorId: 'does-not-exist' }] }];
    const result = await applyApprovedMappings(mappings, { Vendor: StubVendor, Product: StubProduct });
    assert.equal(result.linked.length, 0);
    assert.equal(result.errors.length, 1);
  });

  it('rejects a mapping with neither vendorId nor vendor.name, and one with no entries, without throwing', async () => {
    const StubVendor = { create: async () => { throw new Error('must not be called'); } };
    const StubProduct = { updateOne: async () => { throw new Error('must not be called'); } };
    const result = await applyApprovedMappings(
      [{ entries: [{ productId: 'p', vendorId: 'v' }] }, { vendor: { name: 'X' }, entries: [] }],
      { Vendor: StubVendor, Product: StubProduct },
    );
    assert.equal(result.errors.length, 2);
    assert.equal(result.createdVendors.length, 0);
    assert.equal(result.linked.length, 0);
  });

  it('rejects non-array input rather than silently doing nothing', async () => {
    await assert.rejects(() => applyApprovedMappings('not an array', { Vendor: {}, Product: {} }));
  });
});

describe('vendorBackfill.js CLI: dry-run makes no writes (structural)', () => {
  it('the dry-run branch only reads products and never calls applyApprovedMappings, Vendor.create, or Product.updateOne', () => {
    const source = readFileSync(new URL('../scripts/vendorBackfill.js', import.meta.url), 'utf8');
    const dryRunBranch = source.slice(source.indexOf("if (args.mode === 'dry-run')"), source.indexOf('if (!args.mappingsPath)'));
    assert.match(dryRunBranch, /Product\.find\(/);
    assert.ok(!dryRunBranch.includes('applyApprovedMappings'));
    assert.ok(!dryRunBranch.includes('.updateOne('));
    assert.ok(!dryRunBranch.includes('Vendor.create'));
  });

  it('execute mode requires --mappings and only then calls applyApprovedMappings', () => {
    const source = readFileSync(new URL('../scripts/vendorBackfill.js', import.meta.url), 'utf8');
    assert.match(source, /if \(!args\.mappingsPath\) throw new Error/);
    assert.match(source, /applyApprovedMappings\(mappings, \{ Vendor, Product \}\)/);
  });
});
