// Phase 7.1: Reports page foundation + Inventory Movement Summary. Pure-function, route-wiring and
// source-regex tests only — the actual MongoDB aggregation pipeline's correctness (grouping, direction
// classification, unit separation) is proven for real against the Atlas replica set in
// test/integration/stockMovementSummary.test.mjs, exactly mirroring the stubbed/integration split
// already established for Phase 5 (phase21.test.js + phase5AutomaticLedger.test.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolveIstRange } from '../controllers/stockReportController.js';
import stockRouter from '../routes/stockRoutes.js';

function handlersFor(router, path, method) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  return layer ? layer.route.stack.map((entry) => entry.handle) : null;
}

describe('resolveIstRange (pure) — Asia/Kolkata date boundaries', () => {
  it('resolves a single day (e.g. "Today") to exact IST midnight-to-midnight UTC instants', () => {
    const { start, endExclusive, error } = resolveIstRange('2026-11-12', '2026-11-12');
    assert.equal(error, undefined);
    assert.equal(start.toISOString(), '2026-11-11T18:30:00.000Z'); // IST midnight on the 12th
    assert.equal(endExclusive.toISOString(), '2026-11-12T18:30:00.000Z'); // IST midnight on the 13th — exclusive
  });

  it('includes the entire local `to` day — the exclusive next-day boundary covers every movement from that day', () => {
    const { endExclusive } = resolveIstRange('2026-11-01', '2026-11-12');
    // 23:59:59.999 IST on the 12th must fall strictly before endExclusive.
    const lastMomentOfTo = new Date('2026-11-12T23:59:59.999+05:30');
    assert.ok(lastMomentOfTo.getTime() < endExclusive.getTime());
  });

  it('rejects invalid date strings', () => {
    for (const bad of [['2026-13-01', '2026-11-12'], ['not-a-date', '2026-11-12'], ['', '2026-11-12'], ['2026-11-12', '']]) {
      const { error } = resolveIstRange(bad[0], bad[1]);
      assert.ok(error, JSON.stringify(bad));
    }
  });

  it('rejects a reversed date range (from after to)', () => {
    const { error } = resolveIstRange('2026-11-15', '2026-11-10');
    assert.ok(error);
  });

  it('accepts a same-day range (from === to)', () => {
    const { error } = resolveIstRange('2026-11-12', '2026-11-12');
    assert.equal(error, undefined);
  });
});

describe('GET /stock/reports/summary — route wiring and permission gate', () => {
  it('is registered under the existing stock router with the same broad view permission as every other stock endpoint', () => {
    const handlers = handlersFor(stockRouter, '/reports/summary', 'get');
    assert.ok(handlers, 'route must exist');
    // requireAuth, then the permission middleware, then the controller — same shape as /movements.
    assert.equal(handlers.length, 3);
  });

  it('shares its permission check with the existing movement-history endpoint (same gate, not a new one)', async () => {
    const source = readFileSync(new URL('../routes/stockRoutes.js', import.meta.url), 'utf8');
    const summaryLine = source.split('\n').find((line) => line.includes('/reports/summary'));
    const movementsLine = source.split('\n').find((line) => line.includes("'/movements'"));
    const gate = (line) => line.match(/requireAnyPermission\([^)]*\)/)[0];
    assert.equal(gate(summaryLine), gate(movementsLine));
  });
});

describe('stockReportController.js never exposes supplier/vendor financial data', () => {
  it('the controller source never references a cost, rate, price or valuation field in actual code (comments aside)', async () => {
    const source = readFileSync(new URL('../controllers/stockReportController.js', import.meta.url), 'utf8');
    const codeOnly = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.ok(!/\.rate\b|purchasePrice|totalAmount|vendorName|canViewSupplierCosts|valuation/i.test(codeOnly));
  });

  it('the aggregation response is limited to unit/source/type breakdowns — never a raw movement document', async () => {
    const source = readFileSync(new URL('../controllers/stockReportController.js', import.meta.url), 'utf8');
    assert.match(source, /res\.json\(\{ from, to, product: product \|\| null, byUnit: result\.byUnit, bySource: result\.bySource, byType: result\.byType \}\)/);
  });
});
