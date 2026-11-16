// REAL DATABASE integration test — connects to the actual Atlas replica set (same MONGODB_URI as the
// app), not stubbed. Proves the actual MongoDB aggregation pipeline's correctness (strict
// {product, variationId, unit} grouping, unit separation for the same product/variation, deleted-product
// handling via snapshots, pagination) against real seeded StockMovement/Product documents. Run separately
// from the main suite (npm run test:integration:productReports — never part of the default `npm test`),
// using isolated, disposable test data under a fixed fictional date, distinct from Phase 7.1's own
// 2199-03-15 and Phase 7.2's own 2199-04-01 fixtures so the three integration suites can never collide.
import '../../config/dns.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import StockMovement from '../../models/StockMovement.js';
import { getProductWiseSummary } from '../../controllers/stockReportController.js';

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

const TEST_DAY = '2199-06-01';
const TEST_MOMENT = new Date(`${TEST_DAY}T12:00:00.000Z`);

let productA; // legacy (no real variations), kg + a historically-drifted "pieces" movement
let productB; // a real variation
let productC; // deleted after its movement is seeded
let productBVariationId;
const movementIds = [];

before(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set — this integration test needs a real connection.');
  await mongoose.connect(process.env.MONGODB_URI);
  productA = await Product.create({ name: '__phase7_3_test_product_A__', category: 'Test', description: 'Disposable', price: 1, unit: 'kg', stock: 115 });
  productB = await Product.create({
    name: '__phase7_3_test_product_B__', category: 'Test', description: 'Disposable', price: 1, unit: 'pack', stock: 0,
    variations: [{ label: 'Small Pack', unit: 'pack', stock: 16, minStockThreshold: 0, isActive: true }],
  });
  productBVariationId = String(productB.variations[0]._id);
  productC = await Product.create({ name: '__phase7_3_test_product_C__', category: 'Test', description: 'Disposable', price: 1, unit: 'kg', stock: 8 });
});

after(async () => {
  await Product.deleteMany({ _id: { $in: [productA._id, productB._id, productC._id] } });
  await StockMovement.deleteMany({ _id: { $in: movementIds } });
  await mongoose.disconnect().catch(() => {});
});

async function seed(doc) {
  const [record] = await StockMovement.create([{ reason: 'Integration test seed', actor: { id: new mongoose.Types.ObjectId(), name: 'Integration Test' }, createdAt: TEST_MOMENT, ...doc }]);
  movementIds.push(record._id);
  return record;
}

describe('GET /stock/reports/products — real aggregation correctness', () => {
  it('groups strictly by {product, variationId, unit}, keeps a unit drift as separate rows, handles a real variation, shows a deleted product from its own snapshot, and never computes opening/closing', async () => {
    // productA, legacy (variationId: null), kg — two movements.
    await seed({ product: productA._id, productName: productA.name, variationId: null, variationLabel: 'Default', unit: 'kg', type: 'add', previousStock: 100, newStock: 120, difference: 20 });
    await seed({ product: productA._id, productName: productA.name, variationId: null, variationLabel: 'Default', unit: 'kg', type: 'remove', previousStock: 120, newStock: 115, difference: -5 });
    // productA, SAME variationId: null, but a different recorded unit — simulating the verified,
    // ledger-invisible historical unit drift (Product.unit can change without a StockMovement at all).
    await seed({ product: productA._id, productName: productA.name, variationId: null, variationLabel: 'Default', unit: 'pieces', type: 'add', previousStock: 50, newStock: 53, difference: 3 });
    // productB, a real variation.
    await seed({ product: productB._id, productName: productB.name, variationId: productBVariationId, variationLabel: 'Small Pack', unit: 'pack', type: 'add', previousStock: 10, newStock: 16, difference: 6 });
    // productC, then deleted.
    await seed({ product: productC._id, productName: productC.name, variationId: null, variationLabel: 'Default', unit: 'kg', type: 'add', previousStock: 5, newStock: 8, difference: 3 });
    await Product.deleteOne({ _id: productC._id });

    const result = await run(getProductWiseSummary, { query: { from: TEST_DAY, to: TEST_DAY, limit: '50' } });
    assert.equal(result.status, 200);
    const { rows, total } = result.body;
    assert.equal(total, 4, 'four distinct {product, variationId, unit} buckets, never merged');

    const aKg = rows.find((row) => row.productId === String(productA._id) && row.unit === 'kg');
    const aPieces = rows.find((row) => row.productId === String(productA._id) && row.unit === 'pieces');
    assert.ok(aKg && aPieces, 'the same (product, variationId) pair must appear as two separate rows, one per recorded unit');
    assert.equal(aKg.incoming, 20); assert.equal(aKg.outgoing, 5); assert.equal(aKg.net, 15); assert.equal(aKg.movementCount, 2);
    assert.equal(aPieces.incoming, 3); assert.equal(aPieces.outgoing, 0); assert.equal(aPieces.net, 3); assert.equal(aPieces.movementCount, 1);
    assert.equal(aKg.isDeleted, false);

    const bRow = rows.find((row) => row.productId === String(productB._id));
    assert.ok(bRow);
    assert.equal(bRow.variationId, productBVariationId);
    assert.equal(bRow.variationLabel, 'Small Pack');
    assert.equal(bRow.unit, 'pack');
    assert.equal(bRow.incoming, 6); assert.equal(bRow.outgoing, 0); assert.equal(bRow.net, 6);

    const cRow = rows.find((row) => row.productId === String(productC._id));
    assert.ok(cRow, 'a deleted product must still appear, from its own StockMovement snapshot');
    assert.equal(cRow.productName, productC.name);
    assert.equal(cRow.isDeleted, true);

    // Opening/closing must never be computed — always the same hardcoded unavailable shape.
    for (const row of rows) {
      assert.deepEqual(row.opening, { available: false });
      assert.deepEqual(row.closing, { available: false });
    }
  });

  it('applies the product + variationId filter together — only that exact bucket is returned', async () => {
    const result = await run(getProductWiseSummary, { query: { from: TEST_DAY, to: TEST_DAY, product: String(productB._id), variationId: productBVariationId } });
    assert.equal(result.status, 200);
    assert.equal(result.body.rows.length, 1);
    assert.equal(result.body.rows[0].productId, String(productB._id));
    assert.equal(result.body.rows[0].unit, 'pack');
  });

  it('paginates the four buckets correctly — two pages of two, covering all four with no overlap', async () => {
    const page1 = await run(getProductWiseSummary, { query: { from: TEST_DAY, to: TEST_DAY, page: '1', limit: '2' } });
    const page2 = await run(getProductWiseSummary, { query: { from: TEST_DAY, to: TEST_DAY, page: '2', limit: '2' } });
    assert.equal(page1.body.total, 4); assert.equal(page1.body.pages, 2);
    assert.equal(page2.body.total, 4); assert.equal(page2.body.pages, 2);
    assert.equal(page1.body.rows.length, 2);
    assert.equal(page2.body.rows.length, 2);
    const key = (row) => `${row.productId}|${row.variationId}|${row.unit}`;
    const page1Keys = page1.body.rows.map(key);
    const page2Keys = page2.body.rows.map(key);
    assert.equal(new Set([...page1Keys, ...page2Keys]).size, 4, 'no bucket omitted or duplicated across pages');
  });

  it('includes a movement at 23:30 IST on the `to` date — the inclusive India-local end-date boundary', async () => {
    const lateIstMoment = new Date('2026-08-10T23:30:00.000+05:30');
    await seed({ product: productA._id, productName: productA.name, variationId: null, variationLabel: 'Default', unit: 'kg', type: 'add', previousStock: 200, newStock: 205, difference: 5, createdAt: lateIstMoment });
    const result = await run(getProductWiseSummary, { query: { from: '2026-08-10', to: '2026-08-10', product: String(productA._id) } });
    assert.equal(result.status, 200);
    assert.equal(result.body.rows.length, 1, 'a movement at 23:30 IST on the `to` date must be included, not excluded by a UTC-midnight boundary');
  });

  it('rejects invalid dates with a 400, via the real handler', async () => {
    const result = await run(getProductWiseSummary, { query: { from: 'not-a-date', to: TEST_DAY } });
    assert.equal(result.status, 400);
  });

  it('rejects a reversed date range with a 400, via the real handler', async () => {
    const result = await run(getProductWiseSummary, { query: { from: '2199-06-05', to: '2199-06-01' } });
    assert.equal(result.status, 400);
  });
});
