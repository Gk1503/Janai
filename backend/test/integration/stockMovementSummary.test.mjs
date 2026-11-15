// REAL DATABASE integration test — connects to the actual Atlas replica set (same MONGODB_URI as the
// app), not stubbed. Proves the actual MongoDB aggregation pipeline's correctness (direction
// classification from `difference`, unit separation, source/type grouping, India-local date boundaries)
// against real seeded StockMovement documents — a mocked unit test cannot prove an aggregation pipeline
// is correct, only that it was called. Run separately from the main suite
// (npm run test:integration:stockReports — never part of the default `npm test`), using disposable test
// products and movement documents created and deleted by this file alone.
import '../../config/dns.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import StockMovement from '../../models/StockMovement.js';
import { getStockMovementSummary } from '../../controllers/stockReportController.js';

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

const actor = { id: new mongoose.Types.ObjectId(), name: 'Integration Test' };
let productA;
let productB;
const movementIds = [];

before(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set — this integration test needs a real connection.');
  await mongoose.connect(process.env.MONGODB_URI);
  productA = await Product.create({ name: '__phase7_1_test_product_A__', category: 'Test', description: 'Disposable', price: 1, unit: 'kg', stock: 100 });
  productB = await Product.create({ name: '__phase7_1_test_product_B__', category: 'Test', description: 'Disposable', price: 1, unit: 'pcs', stock: 50 });
});

after(async () => {
  await Product.deleteMany({ _id: { $in: [productA._id, productB._id] } });
  await StockMovement.deleteMany({ _id: { $in: movementIds } });
  await mongoose.disconnect().catch(() => {});
});

async function seed(doc) {
  const [record] = await StockMovement.create([doc]);
  movementIds.push(record._id);
  return record;
}

// A deliberately fictional, far-future date, fixed on every seeded document here (explicit `createdAt`
// IS honored by Mongoose at create() time, unlike a later updateOne — confirmed empirically; Mongoose's
// timestamps plugin silently keeps the original createdAt on an update). This isolates this test's
// query window from the rest of the real, shared StockMovement collection, which a wide 2000-2099 range
// would otherwise aggregate in its entirety.
const TEST_DAY = '2199-03-15';
const TEST_MOMENT = new Date(`${TEST_DAY}T12:00:00.000Z`);

function base(product, overrides) {
  return {
    product: product._id,
    productName: product.name,
    variationId: null,
    variationLabel: 'Default',
    unit: product.unit,
    reason: 'Integration test seed',
    actor,
    createdAt: TEST_MOMENT,
    ...overrides,
  };
}

describe('GET /stock/reports/summary — real aggregation correctness', () => {
  it('classifies every manual and automatic event correctly, separates units, and computes net without double-counting', async () => {
    // Product A (kg): one of every classification case.
    await seed(base(productA, { type: 'add', previousStock: 100, newStock: 110, difference: 10 })); // manual add
    await seed(base(productA, { type: 'remove', previousStock: 110, newStock: 105, difference: -5 })); // manual remove
    await seed(base(productA, { type: 'set_exact', previousStock: 105, newStock: 120, difference: 15 })); // positive set_exact
    await seed(base(productA, { type: 'set_exact', previousStock: 120, newStock: 100, difference: -20 })); // negative set_exact
    await seed(base(productA, { type: 'set_exact', previousStock: 100, newStock: 100, difference: 0 })); // zero-difference set_exact
    const orderId = new mongoose.Types.ObjectId();
    await seed(base(productA, { type: 'remove', previousStock: 100, newStock: 96, difference: -4, source: { type: 'order', id: orderId, event: 'order_placed', itemKey: '0' } }));
    await seed(base(productA, { type: 'add', previousStock: 96, newStock: 100, difference: 4, source: { type: 'order', id: orderId, event: 'order_cancelled', itemKey: '0' } }));
    await seed(base(productA, { type: 'remove', previousStock: 100, newStock: 97, difference: -3, source: { type: 'order', id: new mongoose.Types.ObjectId(), event: 'preorder_confirmed', itemKey: '0' } }));
    const bulkId = new mongoose.Types.ObjectId();
    await seed(base(productA, { type: 'remove', previousStock: 97, newStock: 90, difference: -7, source: { type: 'bulk_order', id: bulkId, event: 'bulk_approved', itemKey: 'line1' } }));
    await seed(base(productA, { type: 'add', previousStock: 90, newStock: 97, difference: 7, source: { type: 'bulk_order', id: bulkId, event: 'bulk_rejected', itemKey: 'line1' } }));
    await seed(base(productA, { type: 'add', previousStock: 97, newStock: 110, difference: 13, source: { type: 'vendor_purchase', id: new mongoose.Types.ObjectId(), event: 'vendor_received', itemKey: null } }));

    // Product B (pcs): must never be combined with product A's kg totals.
    await seed(base(productB, { type: 'add', previousStock: 50, newStock: 60, difference: 10 }));
    await seed(base(productB, { type: 'remove', previousStock: 60, newStock: 55, difference: -5 }));

    const result = await run(getStockMovementSummary, { query: { from: TEST_DAY, to: TEST_DAY } });
    assert.equal(result.status, 200);
    const { byUnit, bySource, byType } = result.body;

    const kg = byUnit.find((row) => row.unit === 'kg');
    const pcs = byUnit.find((row) => row.unit === 'pcs');
    assert.ok(kg && pcs, 'both units must appear as separate rows');
    // kg: added = 10(manual) + 15(set_exact+) + 4(order_cancelled) + 7(bulk_rejected) + 13(vendor_received) = 49
    // kg: removed = 5(manual) + 20(set_exact-) + 4(order_placed) + 3(preorder_confirmed) + 7(bulk_approved) = 39
    assert.equal(kg.added, 49);
    assert.equal(kg.removed, 39);
    assert.equal(kg.net, 10);
    // 11 kg movements seeded above: manual add/remove, set_exact (+/-/0), order_placed/cancelled,
    // preorder_confirmed, bulk_approved/rejected, vendor_received — the zero-difference set_exact still
    // counts here even though it contributes to neither added nor removed.
    assert.equal(kg.movementCount, 11);
    assert.equal(pcs.added, 10);
    assert.equal(pcs.removed, 5);
    assert.equal(pcs.net, 5);
    assert.equal(pcs.movementCount, 2);

    // "manual" = no `source` at all — that's manual add, manual remove, AND all three set_exact rows
    // (none of them were given a `source` in this test), not just the zero-difference one.
    const manualKg = bySource.find((row) => row.source === 'manual' && row.unit === 'kg');
    assert.equal(manualKg.movementCount, 5);
    assert.equal(manualKg.added, 25); // manual add (10) + positive set_exact (15)
    assert.equal(manualKg.removed, 25); // manual remove (5) + negative set_exact (20)
    for (const event of ['order_placed', 'order_cancelled', 'preorder_confirmed', 'bulk_approved', 'bulk_rejected', 'vendor_received']) {
      const row = bySource.find((entry) => entry.source === event && entry.unit === 'kg');
      assert.ok(row, `${event} must appear as its own specific source category, not a generic "automatic"`);
    }

    const addType = byType.find((row) => row.type === 'add' && row.unit === 'kg');
    const removeType = byType.find((row) => row.type === 'remove' && row.unit === 'kg');
    const setExactType = byType.find((row) => row.type === 'set_exact' && row.unit === 'kg');
    assert.ok(addType && removeType && setExactType);
    assert.equal(setExactType.movementCount, 3); // positive, negative, and zero-difference
  });

  it('applies the product filter — only that product\'s movements are summarized', async () => {
    const result = await run(getStockMovementSummary, { query: { from: TEST_DAY, to: TEST_DAY, product: String(productB._id) } });
    assert.equal(result.status, 200);
    assert.ok(!result.body.byUnit.some((row) => row.unit === 'kg'), 'product A\'s kg movements must be excluded by the product filter');
    assert.ok(result.body.byUnit.some((row) => row.unit === 'pcs'));
  });

  it('includes a movement at 23:30 IST on the `to` date — the inclusive India-local end-date boundary', async () => {
    // Explicit createdAt IS honored at create() time (confirmed empirically — unlike updateOne, which
    // Mongoose's timestamps plugin silently ignores for this field).
    const lateIstMoment = new Date('2026-06-15T23:30:00.000+05:30');
    await seed(base(productA, { type: 'add', previousStock: 200, newStock: 205, difference: 5, createdAt: lateIstMoment }));

    const result = await run(getStockMovementSummary, { query: { from: '2026-06-15', to: '2026-06-15', product: String(productA._id) } });
    assert.equal(result.status, 200);
    const kg = result.body.byUnit.find((row) => row.unit === 'kg');
    assert.ok(kg && kg.movementCount >= 1, 'a movement at 23:30 IST on the `to` date must be included, not excluded by a UTC-midnight boundary');
  });

  it('rejects invalid dates with a 400, via the real handler', async () => {
    const result = await run(getStockMovementSummary, { query: { from: 'not-a-date', to: '2026-11-12' } });
    assert.equal(result.status, 400);
  });

  it('rejects a reversed date range with a 400, via the real handler', async () => {
    const result = await run(getStockMovementSummary, { query: { from: '2026-11-15', to: '2026-11-10' } });
    assert.equal(result.status, 400);
  });

  it('rejects an invalid product id with a 400', async () => {
    const result = await run(getStockMovementSummary, { query: { from: '2000-01-01', to: '2099-12-31', product: 'not-an-id' } });
    assert.equal(result.status, 400);
  });
});
