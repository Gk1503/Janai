// REAL DATABASE integration test — connects to the actual Atlas replica set (same MONGODB_URI as the
// app), not stubbed. Proves what a mocked unit test cannot: that each Phase 5 automatic workflow's
// claim + stock mutation(s) + StockMovement insert(s) + status transition genuinely commit or abort
// together, and that the StockMovement.source sparse unique index behaves exactly as designed. Run
// separately from the main suite (npm run test:integration:phase5 — never part of the default `npm
// test`, which stays fully DB-free), and uses disposable test documents created and deleted by this
// file alone; no existing catalog/order data is ever touched.
import '../../config/dns.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import Product from '../../models/Product.js';
import Order from '../../models/Order.js';
import BulkOrder from '../../models/BulkOrder.js';
import VendorPurchase from '../../models/VendorPurchase.js';
import StockMovement from '../../models/StockMovement.js';
import { receivePurchase } from '../../controllers/vendorController.js';
import { updateOrderStatus } from '../../controllers/orderController.js';

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

const admin = { _id: new mongoose.Types.ObjectId(), id: 'owner1', role: 'admin', firstName: 'Integration', lastName: 'Test' };
const disposableIds = { products: [], orders: [], bulkOrders: [], purchases: [] };

before(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set — this integration test needs a real connection.');
  await mongoose.connect(process.env.MONGODB_URI);
  await StockMovement.syncIndexes(); // ensure the new sparse unique source index actually exists
});

after(async () => {
  await Product.deleteMany({ _id: { $in: disposableIds.products } });
  await Order.deleteMany({ _id: { $in: disposableIds.orders } });
  await BulkOrder.deleteMany({ _id: { $in: disposableIds.bulkOrders } });
  await VendorPurchase.deleteMany({ _id: { $in: disposableIds.purchases } });
  await StockMovement.deleteMany({ product: { $in: disposableIds.products } });
  await mongoose.disconnect().catch(() => {});
});

async function makeProduct(overrides = {}) {
  const product = await Product.create({
    name: '__phase5_integration_test_product__', category: 'Test', description: 'Disposable — created and deleted by phase5AutomaticLedger.test.mjs',
    price: 1, unit: 'kg', stock: 10, ...overrides,
  });
  disposableIds.products.push(product._id);
  return product;
}

describe('Phase 5 integration: vendor purchase receiving — real transaction rollback', () => {
  it('rolls back the stock addition and the purchase status flip when the movement insert fails', async () => {
    const product = await makeProduct({ stock: 10 });
    const purchase = await VendorPurchase.create({
      product: product._id, vendor: new mongoose.Types.ObjectId(), vendorName: 'Test Vendor',
      purchaseDate: new Date(), quantity: 5, unit: 'kg', rate: 10, totalAmount: 50, status: 'Ordered',
    });
    disposableIds.purchases.push(purchase._id);

    const originalCreate = StockMovement.create;
    StockMovement.create = async () => { throw new Error('simulated movement insert failure'); };
    try {
      const result = await run(receivePurchase, { user: admin, params: { productId: String(product._id), vendorId: String(purchase.vendor), purchaseId: String(purchase._id) } });
      assert.equal(result.status, 500);
    } finally { StockMovement.create = originalCreate; }

    const productAfter = await Product.findById(product._id);
    assert.equal(productAfter.stock, 10, 'the stock addition must roll back with the failed transaction');
    const purchaseAfter = await VendorPurchase.findById(purchase._id);
    assert.equal(purchaseAfter.status, 'Ordered', 'the status flip must roll back too — never left half-received');
    assert.equal(purchaseAfter.receivedQuantity, 0);
    const movements = await StockMovement.find({ product: product._id });
    assert.equal(movements.length, 0, 'no movement record for a transaction that never committed');
  });

  it('commits the stock addition, the status flip, and exactly one movement together when nothing fails', async () => {
    const product = await makeProduct({ stock: 10 });
    const purchase = await VendorPurchase.create({
      product: product._id, vendor: new mongoose.Types.ObjectId(), vendorName: 'Test Vendor',
      purchaseDate: new Date(), quantity: 5, unit: 'kg', rate: 10, totalAmount: 50, status: 'Ordered',
    });
    disposableIds.purchases.push(purchase._id);

    const result = await run(receivePurchase, { user: admin, params: { productId: String(product._id), vendorId: String(purchase.vendor), purchaseId: String(purchase._id) } });
    assert.equal(result.status, 200);

    const productAfter = await Product.findById(product._id);
    assert.equal(productAfter.stock, 15);
    const purchaseAfter = await VendorPurchase.findById(purchase._id);
    assert.equal(purchaseAfter.status, 'Received');
    assert.equal(purchaseAfter.receivedQuantity, 5);
    const movements = await StockMovement.find({ product: product._id });
    assert.equal(movements.length, 1);
    assert.equal(movements[0].source.event, 'vendor_received');
    assert.equal(movements[0].source.itemKey, null);
  });
});

describe('Phase 5 integration: pre-order confirmation — real transaction closes the stuck-claim gap', () => {
  async function makePreOrder(product, quantity) {
    const order = await Order.create({
      user: admin._id,
      items: [{ product: product._id, name: product.name, image: '', price: 1, unit: product.unit, quantity, variationId: null, variationLabel: '' }],
      totalAmount: quantity,
      orderType: 'preorder',
      deliveryAddress: { recipient: 'Test', phone: '9876543210', street: 'MG Road', postalCode: '411001' },
      deliveryDate: new Date(Date.now() + 86400000),
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      orderStatus: 'placed',
      stockDeductedAt: null,
    });
    disposableIds.orders.push(order._id);
    return order;
  }

  it('rolls back the claim, the deduction, AND the status transition together when the movement insert fails', async () => {
    const product = await makeProduct({ stock: 10 });
    const order = await makePreOrder(product, 4);

    const originalCreate = StockMovement.create;
    StockMovement.create = async () => { throw new Error('simulated movement insert failure'); };
    try {
      const result = await run(updateOrderStatus, { user: admin, params: { id: String(order._id) }, body: { orderStatus: 'confirmed' } });
      assert.equal(result.status, 500);
    } finally { StockMovement.create = originalCreate; }

    const orderAfter = await Order.findById(order._id);
    assert.equal(orderAfter.orderStatus, 'placed', 'must never confirm when the transaction aborted');
    assert.equal(orderAfter.stockDeductedAt, null, 'the claim itself must roll back — this is the stuck-claim gap Phase 5 closes');
    const productAfter = await Product.findById(product._id);
    assert.equal(productAfter.stock, 10, 'the deduction must roll back with everything else');
    const movements = await StockMovement.find({ product: product._id });
    assert.equal(movements.length, 0);
  });

  it('commits the claim, the deduction, the status transition, and exactly one movement together', async () => {
    const product = await makeProduct({ stock: 10 });
    const order = await makePreOrder(product, 4);

    const result = await run(updateOrderStatus, { user: admin, params: { id: String(order._id) }, body: { orderStatus: 'confirmed' } });
    assert.equal(result.status, 200);

    const orderAfter = await Order.findById(order._id);
    assert.equal(orderAfter.orderStatus, 'confirmed');
    assert.notEqual(orderAfter.stockDeductedAt, null);
    const productAfter = await Product.findById(product._id);
    assert.equal(productAfter.stock, 6);
    const movements = await StockMovement.find({ product: product._id });
    assert.equal(movements.length, 1);
    assert.equal(movements[0].source.event, 'preorder_confirmed');
  });
});

describe('Phase 5 integration: restoration is genuinely all-or-nothing across multiple items', () => {
  it('rolls back an ALREADY-SUCCEEDED first item\'s restoration when a later item fails, in the same transaction', async () => {
    const productA = await makeProduct({ name: '__phase5_integration_test_product_A__', stock: 10 });
    const productB = await makeProduct({ name: '__phase5_integration_test_product_B__', stock: 10 });
    const order = await Order.create({
      user: admin._id,
      items: [
        { product: productA._id, name: productA.name, image: '', price: 1, unit: 'kg', quantity: 3, variationId: null, variationLabel: '' },
        { product: productB._id, name: productB.name, image: '', price: 1, unit: 'kg', quantity: 2, variationId: null, variationLabel: '' },
      ],
      totalAmount: 5,
      orderType: 'normal',
      deliveryAddress: { recipient: 'Test', phone: '9876543210', street: 'MG Road', postalCode: '411001' },
      deliveryDate: new Date(Date.now() + 86400000),
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      orderStatus: 'confirmed',
      stockDeductedAt: new Date(),
      stockRestoredAt: null,
    });
    disposableIds.orders.push(order._id);

    // Let product A's restoration go through for real; force product B's to fail — proving that even
    // though A's $inc already applied earlier in the SAME transaction, MongoDB rolls it back too once
    // the transaction as a whole aborts.
    const originalFOU = Product.findOneAndUpdate.bind(Product);
    Product.findOneAndUpdate = function patchedFindOneAndUpdate(filter, ...rest) {
      if (filter && String(filter._id) === String(productB._id)) return Promise.resolve(null);
      return originalFOU(filter, ...rest);
    };
    try {
      const result = await run(updateOrderStatus, { user: admin, params: { id: String(order._id) }, body: { orderStatus: 'cancelled' } });
      assert.equal(result.status, 500);
      assert.equal(result.body.code, 'STOCK_RESTORE_FAILED');
      assert.equal(result.body.order.orderStatus, 'cancelled', 'the cancellation write itself (a separate, already-committed transaction) must stand');
    } finally { Product.findOneAndUpdate = originalFOU; }

    const orderAfter = await Order.findById(order._id);
    assert.equal(orderAfter.orderStatus, 'cancelled');
    assert.equal(orderAfter.stockRestoredAt, null, 'the restoration claim must roll back — retryable in principle');
    const productAAfter = await Product.findById(productA._id);
    assert.equal(productAAfter.stock, 10, 'product A\'s restoration must roll back too, even though it ran first and "succeeded" inside the aborted transaction');
    const productBAfter = await Product.findById(productB._id);
    assert.equal(productBAfter.stock, 10);
    const movements = await StockMovement.find({ product: { $in: [productA._id, productB._id] } });
    assert.equal(movements.length, 0, 'neither item may leave a movement from a restoration that never committed');
  });

  it('commits every item\'s restoration and movement together when nothing fails', async () => {
    const productA = await makeProduct({ name: '__phase5_integration_test_product_A__', stock: 5 });
    const productB = await makeProduct({ name: '__phase5_integration_test_product_B__', stock: 5 });
    const order = await Order.create({
      user: admin._id,
      items: [
        { product: productA._id, name: productA.name, image: '', price: 1, unit: 'kg', quantity: 3, variationId: null, variationLabel: '' },
        { product: productB._id, name: productB.name, image: '', price: 1, unit: 'kg', quantity: 2, variationId: null, variationLabel: '' },
      ],
      totalAmount: 5,
      orderType: 'normal',
      deliveryAddress: { recipient: 'Test', phone: '9876543210', street: 'MG Road', postalCode: '411001' },
      deliveryDate: new Date(Date.now() + 86400000),
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      orderStatus: 'confirmed',
      stockDeductedAt: new Date(),
      stockRestoredAt: null,
    });
    disposableIds.orders.push(order._id);

    const result = await run(updateOrderStatus, { user: admin, params: { id: String(order._id) }, body: { orderStatus: 'cancelled' } });
    assert.equal(result.status, 200);

    const productAAfter = await Product.findById(productA._id);
    assert.equal(productAAfter.stock, 8); // 5 + 3
    const productBAfter = await Product.findById(productB._id);
    assert.equal(productBAfter.stock, 7); // 5 + 2
    const movements = await StockMovement.find({ product: { $in: [productA._id, productB._id] } }).sort({ 'source.itemKey': 1 });
    assert.equal(movements.length, 2);
    assert.deepEqual(movements.map((movement) => movement.source.event), ['order_cancelled', 'order_cancelled']);
  });
});

describe('Phase 5 integration: StockMovement.source schema and sparse unique index (real MongoDB)', () => {
  it('multiple manual movements without `source` save cleanly, with no `source` key on the raw document', async () => {
    const product = await makeProduct({ stock: 100 });
    const docs = await StockMovement.create([
      { product: product._id, productName: product.name, variationId: null, variationLabel: 'Default', unit: 'kg', type: 'add', previousStock: 100, newStock: 110, difference: 10, reason: 'Physical count correction', actor: { id: admin._id, name: 'Integration Test' } },
      { product: product._id, productName: product.name, variationId: null, variationLabel: 'Default', unit: 'kg', type: 'add', previousStock: 110, newStock: 120, difference: 10, reason: 'Physical count correction', actor: { id: admin._id, name: 'Integration Test' } },
    ]);
    assert.equal(docs.length, 2, 'both manual movements saved without colliding on the sparse index');
    const raw = await StockMovement.collection.findOne({ _id: docs[0]._id });
    assert.equal(Object.prototype.hasOwnProperty.call(raw, 'source'), false, 'the raw document must have no `source` key at all');
  });

  it('two different vendor_purchase movements with itemKey: null coexist', async () => {
    const product = await makeProduct({ stock: 50 });
    const purchaseIdA = new mongoose.Types.ObjectId();
    const purchaseIdB = new mongoose.Types.ObjectId();
    const [a, b] = await StockMovement.create([
      { product: product._id, productName: product.name, variationId: null, variationLabel: 'Default', unit: 'kg', type: 'add', previousStock: 50, newStock: 60, difference: 10, reason: 'Vendor purchase received', actor: { id: admin._id, name: 'Integration Test' }, source: { type: 'vendor_purchase', id: purchaseIdA, event: 'vendor_received', itemKey: null } },
      { product: product._id, productName: product.name, variationId: null, variationLabel: 'Default', unit: 'kg', type: 'add', previousStock: 60, newStock: 70, difference: 10, reason: 'Vendor purchase received', actor: { id: admin._id, name: 'Integration Test' }, source: { type: 'vendor_purchase', id: purchaseIdB, event: 'vendor_received', itemKey: null } },
    ]);
    assert.ok(a._id);
    assert.ok(b._id);
  });

  it('a duplicate automatic source tuple (same type/id/event/itemKey) is rejected with E11000', async () => {
    const product = await makeProduct({ stock: 50 });
    const purchaseId = new mongoose.Types.ObjectId();
    const movementShape = (previousStock, newStock) => ({
      product: product._id, productName: product.name, variationId: null, variationLabel: 'Default', unit: 'kg', type: 'add',
      previousStock, newStock, difference: newStock - previousStock, reason: 'Vendor purchase received', actor: { id: admin._id, name: 'Integration Test' },
      source: { type: 'vendor_purchase', id: purchaseId, event: 'vendor_received', itemKey: null },
    });
    await StockMovement.create([movementShape(50, 60)]);
    await assert.rejects(StockMovement.create([movementShape(60, 70)]), /E11000/);
  });

  it('the same source and item with different events coexist, but a duplicate same-event tuple is rejected', async () => {
    const product = await makeProduct({ stock: 50 });
    const orderId = new mongoose.Types.ObjectId();
    const movementShape = (event, previousStock, newStock) => ({
      product: product._id, productName: product.name, variationId: null, variationLabel: 'Default', unit: 'kg', type: event === 'order_placed' ? 'remove' : 'add',
      previousStock, newStock, difference: newStock - previousStock, reason: event, actor: { id: admin._id, name: 'Integration Test' },
      source: { type: 'order', id: orderId, event, itemKey: '0' },
    });
    await StockMovement.create([movementShape('order_placed', 50, 46)]);
    const [cancelled] = await StockMovement.create([movementShape('order_cancelled', 46, 50)]);
    assert.ok(cancelled._id, 'a different event for the same order+itemKey must coexist');

    await assert.rejects(StockMovement.create([movementShape('order_placed', 50, 46)]), /E11000/, 'a duplicate of the same event for the same order+itemKey must be rejected');
  });
});
