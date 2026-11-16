import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { adjustStock, listStockMovementActors, listStockMovements, updateStockThreshold } from '../controllers/stockController.js';
import stockRouter from '../routes/stockRoutes.js';
import { transactionHelper } from '../utils/withTransaction.js';
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

const manager = { _id: 'u1', role: 'staff', isActive: true, permissions: ['products:manage', 'products:view'], firstName: 'Priya', lastName: 'Patel' };
const inventoryOnly = { _id: 'u2', role: 'staff', isActive: true, permissions: ['inventory:update'], firstName: 'Ravi', lastName: 'Rao' };
const viewer = { _id: 'u3', role: 'staff', isActive: true, permissions: ['products:view'] };

// Bypasses the real withTransaction.run entirely (unit level — no real session needed to verify this
// controller's own logic). A truthy fake session stand-in is passed through — distinct from `undefined`
// — specifically so tests can prove it IS threaded to every write call site: the helpers treat a falsy
// session as "no session" by design (for backward compatibility with every pre-Phase-3 caller), so a
// real test of "is the session actually passed" needs a truthy value, not undefined.
const FAKE_SESSION = { id: 'fake-session' };
function stubTransaction() {
  const original = transactionHelper.run;
  transactionHelper.run = async (work) => work(FAKE_SESSION);
  return () => { transactionHelper.run = original; };
}

// A realistic in-memory stand-in for Product.findOneAndUpdate that actually understands the guarded
// filter shapes addVariationStock/deductVariationStock/setVariationStock build, so these tests exercise
// real race/guard behaviour rather than a hand-fed success value — mirrors the equivalent stub already
// used for Phase 2's own tests.
function stubProductStock(product) {
  const originalFindById = Product.findById;
  const originalFOU = Product.findOneAndUpdate;
  const calls = [];
  Product.findById = async () => product;
  Product.findOneAndUpdate = async (filter, update, options) => {
    calls.push({ filter, update, options });
    if (filter.stock !== undefined) {
      // legacy target
      if (typeof filter.stock === 'object') { if (product.stock < filter.stock.$gte) return null; } // guarded decrement
      else if (product.stock !== filter.stock) return null; // set_exact exact-match guard
      if (update.$inc) product.stock += update.$inc.stock;
      if (update.$set) product.stock = update.$set.stock;
      return product;
    }
    if (filter.variations?.$elemMatch) {
      const cond = filter.variations.$elemMatch;
      const variation = product.variations.find((entry) => entry._id === cond._id);
      if (!variation) return null;
      if (cond.stock !== undefined) {
        if (typeof cond.stock === 'object') { if (variation.stock < cond.stock.$gte) return null; }
        else if (variation.stock !== cond.stock) return null;
      }
      if (update.$inc) variation.stock += update.$inc['variations.$[elem].stock'];
      if (update.$set) variation.stock = update.$set['variations.$.stock'];
      return product;
    }
    if (filter['variations._id'] !== undefined) {
      // addVariationStock's real-variation branch (plain _id match, unconditional)
      const variation = product.variations.find((entry) => entry._id === filter['variations._id']);
      if (!variation) return null;
      variation.stock += update.$inc['variations.$.stock'];
      return product;
    }
    // addVariationStock's legacy branch (no filter conditions beyond _id)
    if (update.$inc?.stock !== undefined) { product.stock += update.$inc.stock; return product; }
    return null;
  };
  return { calls, restore: () => { Product.findById = originalFindById; Product.findOneAndUpdate = originalFOU; } };
}

function stubMovementCreate() {
  const original = StockMovement.create;
  const created = [];
  StockMovement.create = async (docs, options) => { created.push({ doc: docs[0], options }); return [{ ...docs[0], _id: 'm1' }]; };
  return { created, restore: () => { StockMovement.create = original; } };
}

const legacyProduct = () => ({ _id: 'p1', name: 'Tomato', stock: 10, unit: 'kg', variations: [] });
const variedProduct = () => ({ _id: 'p1', name: 'Rice', variations: [{ _id: '507f1f77bcf86cd799439011', label: '500 g', unit: 'pack', stock: 5, isActive: true }] });
const baseBody = { reason: 'Physical count correction' };

describe('stockRoutes: Phase 3 wiring, permissions, and append-only guarantee', () => {
  it('POST .../adjust requires auth then products:manage OR inventory:update (not products:view alone)', () => {
    const layer = stockRouter.stack.find((entry) => entry.route?.path === '/:productId/variations/:variationId/adjust' && entry.route.methods.post);
    assert.ok(layer);
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.equal(handlers[0], requireAuth);
    assert.equal(handlers[2], adjustStock);
  });

  it('inventory:update alone IS permitted to adjust stock (unlike threshold editing)', async () => {
    const layer = stockRouter.stack.find((entry) => entry.route?.path === '/:productId/variations/:variationId/adjust' && entry.route.methods.post);
    const permissionMiddleware = layer.route.stack[1].handle;
    const allowed = await new Promise((resolve) => permissionMiddleware({ user: inventoryOnly }, {}, () => resolve('next-called')));
    assert.equal(allowed, 'next-called');
  });

  it('products:view alone is rejected for adjustments', async () => {
    const layer = stockRouter.stack.find((entry) => entry.route?.path === '/:productId/variations/:variationId/adjust' && entry.route.methods.post);
    const permissionMiddleware = layer.route.stack[1].handle;
    const rejected = await run((req, res, next) => permissionMiddleware(req, res, next), { user: viewer });
    assert.equal(rejected.status, 403);
  });

  it('threshold editing permissions are unchanged by Phase 3 — still products:manage only', async () => {
    const layer = stockRouter.stack.find((entry) => entry.route?.path === '/:productId/variations/:variationId/threshold' && entry.route.methods.patch);
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.equal(handlers[2], updateStockThreshold);
    const permissionMiddleware = layer.route.stack[1].handle;
    const rejected = await run((req, res, next) => permissionMiddleware(req, res, next), { user: inventoryOnly });
    assert.equal(rejected.status, 403, 'inventory:update must still be rejected for threshold edits');
  });

  it('no update or delete route exists for movement history — the ledger is append-only by construction', () => {
    const movementRoutes = stockRouter.stack.filter((entry) => entry.route?.path?.includes('movement') || entry.route?.path === '/movements');
    for (const entry of movementRoutes) {
      assert.ok(!entry.route.methods.put, 'no PUT on any movements route');
      assert.ok(!entry.route.methods.patch, 'no PATCH on any movements route');
      assert.ok(!entry.route.methods.delete, 'no DELETE on any movements route');
    }
    assert.ok(movementRoutes.some((entry) => entry.route.methods.get), 'a read route must exist');
  });
});

describe('adjustStock: Add / Remove / Set Exact', () => {
  it('Add Stock increases a legacy product\'s stock correctly and derives previousStock/newStock from the real atomic result', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'add', quantity: 4 } });
      assert.equal(result.status, 201);
      assert.equal(product.stock, 14);
      assert.equal(movement.created[0].doc.previousStock, 10);
      assert.equal(movement.created[0].doc.newStock, 14);
      assert.equal(movement.created[0].doc.difference, 4);
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('Remove Stock decreases stock correctly', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'remove', quantity: 3 } });
      assert.equal(result.status, 201);
      assert.equal(product.stock, 7);
      assert.equal(movement.created[0].doc.difference, -3);
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('Set Exact sets the requested value, including zero', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'set_exact', newStock: 0, expectedPreviousStock: 10 } });
      assert.equal(result.status, 201);
      assert.equal(product.stock, 0);
      assert.equal(movement.created[0].doc.newStock, 0);
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('real-variation adjustment works and leaves sibling variations untouched', async () => {
    const product = { _id: 'p1', name: 'Rice', variations: [
      { _id: '507f1f77bcf86cd799439011', label: '500 g', unit: 'pack', stock: 5, isActive: true },
      { _id: '507f1f77bcf86cd799439012', label: '1 kg', unit: 'pack', stock: 9, isActive: true },
    ] };
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: '507f1f77bcf86cd799439011' }, body: { ...baseBody, type: 'add', quantity: 2 } });
      assert.equal(result.status, 201);
      assert.equal(product.variations[0].stock, 7);
      assert.equal(product.variations[1].stock, 9);
      assert.equal(movement.created[0].doc.variationLabel, '500 g');
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });
});

describe('adjustStock: validation', () => {
  it('rejects a Remove that would result in negative stock, with 409, and writes no movement', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'remove', quantity: 99 } });
      assert.equal(result.status, 409);
      assert.equal(product.stock, 10, 'stock must be unchanged');
      assert.equal(movement.created.length, 0);
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('rejects zero or negative Add/Remove quantities', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const zero = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'add', quantity: 0 } });
      assert.equal(zero.status, 400);
      const negative = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'remove', quantity: -1 } });
      assert.equal(negative.status, 400);
      assert.equal(movement.created.length, 0);
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('rejects a negative Set Exact value but accepts zero', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'set_exact', newStock: -1, expectedPreviousStock: 10 } });
      assert.equal(result.status, 400);
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('rejects a missing or blank reason', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const missing = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { type: 'add', quantity: 1 } });
      assert.equal(missing.status, 400);
      const blank = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { type: 'add', quantity: 1, reason: '' } });
      assert.equal(blank.status, 400);
      assert.equal(movement.created.length, 0);
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('rejects "Other" without an explanation', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { type: 'add', quantity: 1, reason: 'Other' } });
      assert.equal(result.status, 400);
      const blankExplanation = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { type: 'add', quantity: 1, reason: 'Other', explanation: '   ' } });
      assert.equal(blankExplanation.status, 400);
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('persists the free-text explanation as the final reason when Other is chosen', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { type: 'add', quantity: 1, reason: 'Other', explanation: 'Donated to a local shelter' } });
      assert.equal(result.status, 201);
      assert.equal(movement.created[0].doc.reason, 'Donated to a local shelter');
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('rejects an invalid product or variation target with 404, writing no movement', async () => {
    const originalFindById = Product.findById;
    Product.findById = async () => null;
    const movement = stubMovementCreate();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'does-not-exist', variationId: 'legacy' }, body: { ...baseBody, type: 'add', quantity: 1 } });
      assert.equal(result.status, 404);
      assert.equal(movement.created.length, 0);
    } finally { Product.findById = originalFindById; movement.restore(); }

    const product = variedProduct();
    Product.findById = async () => product;
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: '507f1f77bcf86cd799439099' }, body: { ...baseBody, type: 'add', quantity: 1 } });
      assert.equal(result.status, 404);
    } finally { Product.findById = originalFindById; }
  });
});

describe('adjustStock: Set Exact concurrency (stale request)', () => {
  it('returns 409 and never overwrites a newer stock value when expectedPreviousStock is stale', async () => {
    const product = legacyProduct();
    product.stock = 20; // someone else already changed it since the client loaded the page
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'set_exact', newStock: 0, expectedPreviousStock: 10 } });
      assert.equal(result.status, 409);
      assert.equal(product.stock, 20, 'the newer value must be left untouched, not silently overwritten');
      assert.equal(movement.created.length, 0);
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('uses $elemMatch on the same array element for a real variation, never a bare positional filter', async () => {
    const product = variedProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: '507f1f77bcf86cd799439011' }, body: { ...baseBody, type: 'set_exact', newStock: 8, expectedPreviousStock: 5 } });
      const setCall = stock.calls.find((call) => call.update.$set);
      assert.ok(setCall.filter.variations.$elemMatch, 'filter must use $elemMatch, not a bare positional field');
      assert.equal(setCall.filter.variations.$elemMatch._id, '507f1f77bcf86cd799439011');
      assert.equal(setCall.filter.variations.$elemMatch.stock, 5);
      assert.equal(setCall.update.$set['variations.$.stock'], 8);
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });
});

describe('adjustStock: concurrent Remove cannot drive stock negative', () => {
  it('two near-simultaneous removes exceeding combined stock: exactly one succeeds, the other is rejected, stock never goes negative', async () => {
    const product = legacyProduct(); // stock: 10
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      const [first, second] = await Promise.all([
        run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'remove', quantity: 7 } }),
        run(adjustStock, { user: inventoryOnly, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'remove', quantity: 7 } }),
      ]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [201, 409]);
      assert.equal(product.stock, 3, 'stock must never go negative, regardless of ordering');
      assert.equal(movement.created.length, 1, 'exactly one movement record for the one that actually succeeded');
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });
});

describe('adjustStock: actor identity and transaction usage', () => {
  it('actor identity always comes from the authenticated user, never from the request body', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      await run(adjustStock, {
        user: manager,
        params: { productId: 'p1', variationId: 'legacy' },
        body: { ...baseBody, type: 'add', quantity: 1, actorId: 'someone-else', actorName: 'Spoofed Name', createdAt: '2000-01-01' },
      });
      assert.equal(movement.created[0].doc.actor.id, manager._id);
      assert.equal(movement.created[0].doc.actor.name, 'Priya Patel');
      assert.ok(!('createdAt' in movement.created[0].doc), 'no client-supplied timestamp field is ever read into the document');
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('every write in the adjustment is passed the transaction session', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const movement = stubMovementCreate();
    const restoreTx = stubTransaction();
    try {
      await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'add', quantity: 1 } });
      assert.equal(stock.calls[0].options.session, FAKE_SESSION, 'the product write must receive the exact transaction session');
      assert.equal(movement.created[0].options.session, FAKE_SESSION, 'the movement insert must receive the exact transaction session');
    } finally { stock.restore(); movement.restore(); restoreTx(); }
  });

  it('a failure inserting the movement record propagates as an error rather than silently succeeding (control-flow only — real rollback is proven by the separate DB integration test)', async () => {
    const product = legacyProduct();
    const stock = stubProductStock(product);
    const originalCreate = StockMovement.create;
    StockMovement.create = async () => { throw new Error('simulated movement insert failure'); };
    const restoreTx = stubTransaction();
    try {
      const result = await run(adjustStock, { user: manager, params: { productId: 'p1', variationId: 'legacy' }, body: { ...baseBody, type: 'add', quantity: 1 } });
      assert.equal(result.status, 500);
    } finally { stock.restore(); StockMovement.create = originalCreate; restoreTx(); }
  });
});

describe('listStockMovements: snapshots survive product/variation deletion', () => {
  it('returns stored snapshot fields without any live Product lookup', async () => {
    const originalFind = StockMovement.find;
    const originalCount = StockMovement.countDocuments;
    const originalProductFindById = Product.findById;
    let productWasQueried = false;
    Product.findById = async () => { productWasQueried = true; return null; };
    const record = {
      _id: 'm1', productName: 'Discontinued Spice Mix', variationId: null, variationLabel: 'Default', unit: 'kg',
      type: 'add', previousStock: 0, newStock: 5, difference: 5, reason: 'Physical count correction',
      actor: { id: 'u1', name: 'Priya Patel' }, createdAt: new Date(),
    };
    StockMovement.find = () => ({ sort: () => ({ skip: () => ({ limit: () => Promise.resolve([record]) }) }) });
    StockMovement.countDocuments = async () => 1;
    try {
      const result = await run(listStockMovements, { user: viewer, query: {} });
      assert.equal(result.status, 200);
      assert.equal(result.body.movements[0].productName, 'Discontinued Spice Mix');
      assert.equal(productWasQueried, false, 'display must never depend on a live Product lookup');
    } finally { StockMovement.find = originalFind; StockMovement.countDocuments = originalCount; Product.findById = originalProductFindById; }
  });

  it('rejects an invalid adjustment-type filter', async () => {
    const result = await run(listStockMovements, { user: viewer, query: { type: 'not-a-real-type' } });
    assert.equal(result.status, 400);
  });
});

describe('listStockMovements: snapshot-based productName search (Phase 4)', () => {
  it('filters by the stored productName snapshot, case-insensitively, without requiring the exact product id', async () => {
    const originalFind = StockMovement.find;
    const originalCount = StockMovement.countDocuments;
    let capturedFilter = null;
    StockMovement.find = (filter) => { capturedFilter = filter; return { sort: () => ({ skip: () => ({ limit: () => Promise.resolve([]) }) }) }; };
    StockMovement.countDocuments = async () => 0;
    try {
      await run(listStockMovements, { user: viewer, query: { productName: 'tomato' } });
      assert.ok(capturedFilter.productName);
      assert.equal(capturedFilter.productName.$options, 'i');
      assert.ok(!('product' in capturedFilter), 'productName must not require the exact product id filter to also be set');
    } finally { StockMovement.find = originalFind; StockMovement.countDocuments = originalCount; }
  });

  it('escapes regex special characters in the search term rather than treating them as a pattern', async () => {
    const originalFind = StockMovement.find;
    const originalCount = StockMovement.countDocuments;
    let capturedFilter = null;
    StockMovement.find = (filter) => { capturedFilter = filter; return { sort: () => ({ skip: () => ({ limit: () => Promise.resolve([]) }) }) }; };
    StockMovement.countDocuments = async () => 0;
    try {
      await run(listStockMovements, { user: viewer, query: { productName: 'a.b*c' } });
      assert.equal(capturedFilter.productName.$regex, 'a\\.b\\*c');
    } finally { StockMovement.find = originalFind; StockMovement.countDocuments = originalCount; }
  });

  it('the exact product id filter still works unchanged when productName is not given', async () => {
    const originalFind = StockMovement.find;
    const originalCount = StockMovement.countDocuments;
    let capturedFilter = null;
    StockMovement.find = (filter) => { capturedFilter = filter; return { sort: () => ({ skip: () => ({ limit: () => Promise.resolve([]) }) }) }; };
    StockMovement.countDocuments = async () => 0;
    try {
      await run(listStockMovements, { user: viewer, query: { product: '507f1f77bcf86cd799439011' } });
      assert.equal(capturedFilter.product, '507f1f77bcf86cd799439011');
      assert.ok(!('productName' in capturedFilter));
    } finally { StockMovement.find = originalFind; StockMovement.countDocuments = originalCount; }
  });
});

describe('listStockMovementActors: distinct staff from saved snapshots (Phase 4)', () => {
  it('returns distinct actors using the ledger\'s own saved name snapshots, never a live User lookup', async () => {
    const originalAggregate = StockMovement.aggregate;
    let pipeline = null;
    StockMovement.aggregate = async (stages) => { pipeline = stages; return [{ id: 'u1', name: 'Priya Patel' }, { id: 'u2', name: 'Ravi Rao' }]; };
    try {
      const result = await run(listStockMovementActors, { user: viewer, query: {} });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.actors, [{ id: 'u1', name: 'Priya Patel' }, { id: 'u2', name: 'Ravi Rao' }]);
      assert.ok(pipeline.some((stage) => stage.$group), 'must aggregate/group rather than fetch every raw movement document');
    } finally { StockMovement.aggregate = originalAggregate; }
  });

  it('is reachable by the same broad view permission as the rest of stock history', () => {
    const layer = stockRouter.stack.find((entry) => entry.route?.path === '/movements/actors' && entry.route.methods.get);
    assert.ok(layer, 'GET /movements/actors must exist');
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.equal(handlers[0], requireAuth);
    assert.equal(handlers[2], listStockMovementActors);
  });
});
