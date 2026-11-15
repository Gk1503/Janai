// Phase 7.3: Product-wise Historical Inventory Report. Pure-function, route-wiring, early-validation
// and source-regex tests only — the actual MongoDB grouping/aggregation correctness (unit separation,
// incoming/outgoing/net, deleted-product handling, pagination) is proven for real against the Atlas
// replica set in test/integration/stockMovementProductSummary.test.mjs, mirroring the stubbed/integration
// split already established for Phase 7.1/7.2 (phase23/24.test.js + their own integration suites).
//
// A few validations below run the real exported handler directly (no DB stub needed): every one of
// them returns before the function ever touches StockMovement.aggregate or Product.find.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getProductWiseSummary } from '../controllers/stockReportController.js';
import stockRouter from '../routes/stockRoutes.js';

function handlersFor(router, path, method) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  return layer ? layer.route.stack.map((entry) => entry.handle) : null;
}

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

const controllerSource = readFileSync(new URL('../controllers/stockReportController.js', import.meta.url), 'utf8');
const fnSource = controllerSource.slice(controllerSource.indexOf('export const getProductWiseSummary'));

describe('getProductWiseSummary — early validation (no DB required)', () => {
  it('rejects a variationId filter without a product filter, with a 400, before touching the database', async () => {
    const result = await run(getProductWiseSummary, { query: { from: '2026-11-01', to: '2026-11-02', variationId: 'abc' } });
    assert.equal(result.status, 400);
    assert.match(result.body.message, /variation filter requires a product filter/i);
  });

  it('rejects an invalid date range with a 400', async () => {
    const result = await run(getProductWiseSummary, { query: { from: 'not-a-date', to: '2026-11-02' } });
    assert.equal(result.status, 400);
  });

  it('rejects an invalid product id with a 400', async () => {
    const result = await run(getProductWiseSummary, { query: { from: '2026-11-01', to: '2026-11-02', product: 'not-an-id' } });
    assert.equal(result.status, 400);
  });
});

describe('getProductWiseSummary — grouping and unit safety (source-level)', () => {
  it('groups strictly by {product, variationId, unit}, never product/variation alone', () => {
    assert.match(fnSource, /_id: \{ product: '\$product', variationId: '\$variationId', unit: '\$unit' \}/);
  });

  it('never defines a second resolveIstRange — reuses the existing one unchanged', () => {
    const definitions = controllerSource.match(/function resolveIstRange/g) || [];
    assert.equal(definitions.length, 1);
    assert.match(fnSource, /resolveIstRange\(from, to\)/);
  });

  it('computes incoming/outgoing/net from `difference`, never from `type` alone', () => {
    assert.match(fnSource, /incoming: \{ \$sum: \{ \$cond: \[\{ \$gt: \['\$difference', 0\] \}, '\$difference', 0\] \} \}/);
    assert.match(fnSource, /outgoing: \{ \$sum: \{ \$cond: \[\{ \$lt: \['\$difference', 0\] \}, \{ \$abs: '\$difference' \}, 0\] \} \}/);
    assert.match(fnSource, /net: \{ \$subtract: \['\$incoming', '\$outgoing'\] \}/);
  });
});

describe('getProductWiseSummary — opening/closing are always unavailable', () => {
  it('hardcodes opening/closing as unavailable, never computed from a boundary movement or a unit-uniformity heuristic', () => {
    assert.match(fnSource, /opening: \{ available: false \}/);
    assert.match(fnSource, /closing: \{ available: false \}/);
    assert.ok(!/addToSet/i.test(fnSource), 'must never attempt a recorded-unit-uniformity check');
    assert.ok(!/continuity/i.test(fnSource) || /not trustworthy|no heuristic here is trustworthy/i.test(fnSource), 'no continuity claim may be implemented');
  });
});

describe('getProductWiseSummary — deleted products use existence check only', () => {
  it('checks Product existence by _id only, never fetching name/price/vendor fields for this purpose', () => {
    assert.match(fnSource, /Product\.find\(\{ _id: \{ \$in: productIds \} \}, \{ _id: 1 \}\)/);
  });
});

describe('getProductWiseSummary never exposes sensitive fields', () => {
  it('never references cost, price, valuation, phone or email fields', () => {
    const codeOnly = fnSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.ok(!/\.rate\b|purchasePrice|totalAmount|vendorName|canViewSupplierCosts|valuation|phone|email/i.test(codeOnly));
  });

  it('the response is limited to from/to/page/limit/total/pages/rows — never a raw movement document', () => {
    assert.match(controllerSource, /res\.json\(\{ from, to, page: pageNum, limit: limitNum, total, pages, rows \}\)/);
  });
});

describe('GET /stock/reports/products — route wiring and permission gate', () => {
  it('is registered under the existing stock router with the same broad view permission as every other stock endpoint', () => {
    const handlers = handlersFor(stockRouter, '/reports/products', 'get');
    assert.ok(handlers, 'route must exist');
    assert.equal(handlers.length, 3);
  });

  it('shares its permission gate with /reports/summary, /reports/staff and /movements (no new permission constant)', () => {
    const source = readFileSync(new URL('../routes/stockRoutes.js', import.meta.url), 'utf8');
    const lineFor = (needle) => source.split('\n').find((line) => line.includes(needle));
    const gate = (line) => line.match(/requireAnyPermission\([^)]*\)/)[0];
    const productsGate = gate(lineFor("'/reports/products'"));
    assert.equal(productsGate, gate(lineFor("'/movements'")));
    assert.equal(productsGate, gate(lineFor("'/reports/summary'")));
    assert.equal(productsGate, gate(lineFor("'/reports/staff'")));
  });
});
