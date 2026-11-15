// REAL DATABASE integration test — connects to the actual Atlas replica set (same MONGODB_URI as the
// app), not stubbed. Proves the actual MongoDB aggregation pipeline's correctness (manual-only
// filtering, actor-id grouping, historical-name combining/ordering, unit/reason totals, Set Exact
// counted independent of direction) against real seeded StockMovement documents — a mocked unit test
// cannot prove an aggregation pipeline is correct, only that it was called. Run separately from the main
// suite (npm run test:integration:staffReports — never part of the default `npm test`), using isolated,
// disposable test data under a fixed fictional date. This deliberately avoids the earlier Phase 7.1
// mistake of querying a huge date range against the shared historical collection and accidentally
// aggregating unrelated records (see stockMovementSummary.test.mjs's own comment on that bug).
import '../../config/dns.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import StockMovement from '../../models/StockMovement.js';
import { getStaffAdjustmentSummary } from '../../controllers/stockReportController.js';

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

let productA; // kg
let productB; // pcs
const movementIds = [];

const jane = { id: new mongoose.Types.ObjectId() };
const bob = { id: new mongoose.Types.ObjectId() };

before(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set — this integration test needs a real connection.');
  await mongoose.connect(process.env.MONGODB_URI);
  productA = await Product.create({ name: '__phase7_2_test_product_A__', category: 'Test', description: 'Disposable', price: 1, unit: 'kg', stock: 100 });
  productB = await Product.create({ name: '__phase7_2_test_product_B__', category: 'Test', description: 'Disposable', price: 1, unit: 'pcs', stock: 50 });
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

// A deliberately fictional, far-future day, distinct from Phase 7.1's own 2199-03-15 fixture, so the two
// integration suites can never collide even if ever run concurrently against the same database.
const TEST_DAY = '2199-04-01';

function base(product, actor, name, overrides) {
  return {
    product: product._id,
    productName: product.name,
    variationId: null,
    variationLabel: 'Default',
    unit: product.unit,
    reason: 'Integration test seed',
    actor: { id: actor.id, name },
    ...overrides,
  };
}

describe('GET /stock/reports/staff — real aggregation correctness', () => {
  it('groups manual adjustments by actor id, combines historical names, separates units, re-buckets reasons, and excludes every automatic movement', async () => {
    const t1 = new Date(`${TEST_DAY}T08:00:00.000Z`); // Jane Patel, manual add, kg, preset reason
    const t2 = new Date(`${TEST_DAY}T09:00:00.000Z`); // Jane Shah, manual remove, kg, different preset reason
    const t3 = new Date(`${TEST_DAY}T10:00:00.000Z`); // Jane Patel again (non-consecutive), positive set_exact, pcs, custom explanation
    const t4 = new Date(`${TEST_DAY}T11:00:00.000Z`); // Jane Shah, negative set_exact, pcs, a DIFFERENT custom explanation
    const t5 = new Date(`${TEST_DAY}T12:00:00.000Z`); // Jane Shah, zero-difference set_exact, kg, same preset reason as t1

    await seed(base(productA, jane, 'Jane Patel', { type: 'add', previousStock: 100, newStock: 110, difference: 10, reason: 'Physical count correction', createdAt: t1 }));
    await seed(base(productA, jane, 'Jane Shah', { type: 'remove', previousStock: 110, newStock: 100, difference: -10, reason: 'Damaged / Spoiled', createdAt: t2 }));
    await seed(base(productB, jane, 'Jane Patel', { type: 'set_exact', previousStock: 50, newStock: 70, difference: 20, reason: 'Fixed a scale calibration issue', createdAt: t3 }));
    await seed(base(productB, jane, 'Jane Shah', { type: 'set_exact', previousStock: 70, newStock: 55, difference: -15, reason: 'Found broken packaging during audit', createdAt: t4 }));
    await seed(base(productA, jane, 'Jane Shah', { type: 'set_exact', previousStock: 100, newStock: 100, difference: 0, reason: 'Physical count correction', createdAt: t5 }));

    // A second staff account — proves multiple staff accounts each get their own row.
    await seed(base(productA, bob, 'Bob K', { type: 'add', previousStock: 200, newStock: 210, difference: 10, reason: 'Loss / Theft', createdAt: t1 }));

    // Automatic movements snapshotting Jane's own actor id — every one of these must be excluded, even
    // though the actor id matches a real staff member and even across every automatic event type.
    const orderId = new mongoose.Types.ObjectId();
    const bulkId = new mongoose.Types.ObjectId();
    const vendorId = new mongoose.Types.ObjectId();
    await seed(base(productA, jane, 'Jane Shah', { type: 'remove', previousStock: 100, newStock: 90, difference: -10, createdAt: t1, source: { type: 'order', id: orderId, event: 'order_placed', itemKey: '0' } }));
    await seed(base(productA, jane, 'Jane Shah', { type: 'add', previousStock: 90, newStock: 100, difference: 10, createdAt: t1, source: { type: 'order', id: orderId, event: 'order_cancelled', itemKey: '0' } }));
    await seed(base(productA, jane, 'Jane Shah', { type: 'remove', previousStock: 100, newStock: 95, difference: -5, createdAt: t1, source: { type: 'order', id: new mongoose.Types.ObjectId(), event: 'preorder_confirmed', itemKey: '0' } }));
    await seed(base(productA, jane, 'Jane Shah', { type: 'remove', previousStock: 95, newStock: 85, difference: -10, createdAt: t1, source: { type: 'bulk_order', id: bulkId, event: 'bulk_approved', itemKey: 'line1' } }));
    await seed(base(productA, jane, 'Jane Shah', { type: 'add', previousStock: 85, newStock: 95, difference: 10, createdAt: t1, source: { type: 'bulk_order', id: bulkId, event: 'bulk_rejected', itemKey: 'line1' } }));
    await seed(base(productA, jane, 'Jane Shah', { type: 'add', previousStock: 95, newStock: 110, difference: 15, createdAt: t1, source: { type: 'vendor_purchase', id: vendorId, event: 'vendor_received', itemKey: null } }));

    const result = await run(getStaffAdjustmentSummary, { query: { from: TEST_DAY, to: TEST_DAY } });
    assert.equal(result.status, 200);
    const { staff } = result.body;
    assert.equal(staff.length, 2, 'exactly two staff rows — one per actor id, automatics excluded, never one row per historical name');

    const janeRow = staff.find((row) => row.actorId === String(jane.id));
    const bobRow = staff.find((row) => row.actorId === String(bob.id));
    assert.ok(janeRow && bobRow);

    // Manual-only + actor-id grouping: the six automatic movements above must not inflate this at all.
    assert.equal(janeRow.totalAdjustments, 5);
    assert.equal(janeRow.setExactCount, 3); // t3 (positive), t4 (negative), t5 (zero) — independent of direction
    assert.equal(janeRow.lastAdjustmentAt.toString(), new Date(t5).toString());

    // Historical names combined by name (not by raw interval) and ordered most-recent-first.
    assert.equal(janeRow.nameHistory.length, 2);
    assert.equal(janeRow.nameHistory[0].name, 'Jane Shah');
    assert.equal(janeRow.nameHistory[0].adjustmentCount, 3); // t2, t4, t5
    assert.equal(new Date(janeRow.nameHistory[0].lastSeenAt).toISOString(), t5.toISOString());
    assert.equal(janeRow.nameHistory[1].name, 'Jane Patel');
    assert.equal(janeRow.nameHistory[1].adjustmentCount, 2); // t1, t3 — non-consecutive periods combined into one entry
    assert.equal(new Date(janeRow.nameHistory[1].lastSeenAt).toISOString(), t3.toISOString());

    // Units never combined; per-unit counts sum back to totalAdjustments.
    const janeKg = janeRow.byUnit.find((row) => row.unit === 'kg');
    const janePcs = janeRow.byUnit.find((row) => row.unit === 'pcs');
    assert.ok(janeKg && janePcs);
    assert.equal(janeKg.added, 10); assert.equal(janeKg.removed, 10); assert.equal(janeKg.net, 0); assert.equal(janeKg.count, 3);
    assert.equal(janePcs.added, 20); assert.equal(janePcs.removed, 15); assert.equal(janePcs.net, 5); assert.equal(janePcs.count, 2);
    assert.equal(janeKg.count + janePcs.count, janeRow.totalAdjustments);

    // Reasons: known presets stay distinct, two DIFFERENT custom explanations both collapse into one
    // synthetic "Other" row (never the literal free text), and reason counts sum back to totalAdjustments.
    const findReason = (name) => janeRow.byReason.find((row) => row.reason === name);
    assert.equal(findReason('Physical count correction').count, 2); // t1, t5
    assert.equal(findReason('Damaged / Spoiled').count, 1); // t2
    assert.equal(findReason('Other').count, 2); // t3, t4 — distinct free text, same category
    assert.ok(!janeRow.byReason.some((row) => /scale calibration|broken packaging/i.test(row.reason)), 'free-text explanations must never be exposed');
    const reasonTotal = janeRow.byReason.reduce((sum, row) => sum + row.count, 0);
    assert.equal(reasonTotal, janeRow.totalAdjustments);

    // The second staff account.
    assert.equal(bobRow.totalAdjustments, 1);
    assert.equal(bobRow.setExactCount, 0);
    assert.equal(bobRow.nameHistory.length, 1);
    assert.equal(bobRow.nameHistory[0].name, 'Bob K');
    assert.equal(bobRow.byReason.find((row) => row.reason === 'Loss / Theft').count, 1);
  });

  it('filters to a single actor when `actor` is supplied', async () => {
    const result = await run(getStaffAdjustmentSummary, { query: { from: TEST_DAY, to: TEST_DAY, actor: String(bob.id) } });
    assert.equal(result.status, 200);
    assert.equal(result.body.staff.length, 1);
    assert.equal(result.body.staff[0].actorId, String(bob.id));
  });

  it('rejects an invalid actor id with a 400', async () => {
    const result = await run(getStaffAdjustmentSummary, { query: { from: TEST_DAY, to: TEST_DAY, actor: 'not-an-id' } });
    assert.equal(result.status, 400);
  });

  it('includes a manual adjustment at 23:30 IST on the `to` date — the inclusive India-local end-date boundary', async () => {
    const lateIstMoment = new Date('2026-07-20T23:30:00.000+05:30');
    await seed(base(productA, jane, 'Jane Shah', { type: 'add', previousStock: 300, newStock: 305, difference: 5, reason: 'Physical count correction', createdAt: lateIstMoment }));

    const result = await run(getStaffAdjustmentSummary, { query: { from: '2026-07-20', to: '2026-07-20', actor: String(jane.id) } });
    assert.equal(result.status, 200);
    assert.equal(result.body.staff.length, 1, 'a movement at 23:30 IST on the `to` date must be included, not excluded by a UTC-midnight boundary');
    assert.equal(result.body.staff[0].totalAdjustments, 1);
  });

  it('rejects invalid dates with a 400', async () => {
    const result = await run(getStaffAdjustmentSummary, { query: { from: 'not-a-date', to: TEST_DAY } });
    assert.equal(result.status, 400);
  });

  it('rejects a reversed date range with a 400', async () => {
    const result = await run(getStaffAdjustmentSummary, { query: { from: '2199-04-05', to: '2199-04-01' } });
    assert.equal(result.status, 400);
  });
});
