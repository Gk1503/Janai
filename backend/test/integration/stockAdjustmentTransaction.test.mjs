// REAL DATABASE integration test — connects to the actual Atlas replica set (same MONGODB_URI as the
// app), not stubbed. Proves actual transaction rollback, which a mocked unit test cannot prove: if the
// StockMovement insert fails AFTER the stock mutation already ran inside the same transaction, the
// stock mutation must be reverted too. Run separately from the main suite (npm run test:integration:stock
// — never part of the default `npm test`, which stays fully DB-free), and uses a disposable test
// product created and deleted by this file alone; no existing catalog data is ever touched.
import '../../config/dns.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import StockMovement from '../../models/StockMovement.js';
import { addVariationStock } from '../../utils/productVariations.js';
import { transactionHelper } from '../../utils/withTransaction.js';

let testProductId;

before(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set — this integration test needs a real connection.');
  await mongoose.connect(process.env.MONGODB_URI);
  const product = await Product.create({
    name: '__phase3_integration_test_product__', category: 'Test', description: 'Disposable — created and deleted by stockAdjustmentTransaction.test.mjs',
    price: 1, unit: 'kg', stock: 10,
  });
  testProductId = product._id;
});

after(async () => {
  if (testProductId) {
    await Product.deleteOne({ _id: testProductId });
    await StockMovement.deleteMany({ product: testProductId });
  }
  await mongoose.disconnect().catch(() => {});
});

describe('Manual Stock Adjustments: real transaction rollback (live replica set)', () => {
  it('rolls back the stock mutation when the movement insert fails inside the same transaction', async () => {
    const before = await Product.findById(testProductId);
    assert.equal(before.stock, 10);

    await assert.rejects(
      transactionHelper.run(async (session) => {
        const updated = await addVariationStock(Product, { productId: testProductId, variationId: 'legacy', isLegacy: true, quantity: 5, session });
        assert.ok(updated, 'the $inc must actually have applied inside the transaction');
        assert.equal(updated.stock, 15, 'sanity check: the in-transaction read sees the uncommitted write');
        // Force a failure AFTER the stock mutation succeeded, inside the same transaction.
        throw new Error('simulated movement insert failure');
      }),
      /simulated movement insert failure/,
    );

    const after = await Product.findById(testProductId);
    assert.equal(after.stock, 10, 'the stock mutation must be rolled back — it must never persist without its movement record');
    const movements = await StockMovement.find({ product: testProductId });
    assert.equal(movements.length, 0, 'no movement record should exist either, since the transaction never committed');
  });

  it('commits both the stock mutation and the movement record together when nothing fails', async () => {
    const result = await transactionHelper.run(async (session) => {
      const updated = await addVariationStock(Product, { productId: testProductId, variationId: 'legacy', isLegacy: true, quantity: 3, session });
      const [movement] = await StockMovement.create([{
        product: testProductId, productName: '__phase3_integration_test_product__', variationId: null, variationLabel: 'Default',
        unit: 'kg', type: 'add', previousStock: 10, newStock: updated.stock, difference: updated.stock - 10,
        reason: 'Physical count correction', actor: { id: testProductId, name: 'Integration Test' },
      }], { session });
      return movement;
    });
    assert.ok(result._id);

    const after = await Product.findById(testProductId);
    assert.equal(after.stock, 13, 'the committed transaction must persist the stock change');
    const movements = await StockMovement.find({ product: testProductId });
    assert.equal(movements.length, 1, 'and exactly one movement record alongside it');
  });
});
