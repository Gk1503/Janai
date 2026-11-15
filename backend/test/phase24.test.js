// Phase 7.2: Staff Adjustment Reports. Pure-function, route-wiring and source-regex tests only — the
// actual MongoDB aggregation's correctness (manual-only filtering, actor grouping, name-history
// ordering, unit/reason totals) is proven for real against the Atlas replica set in
// test/integration/stockMovementStaffSummary.test.mjs, mirroring the stubbed/integration split already
// established for Phase 7.1 (phase23.test.js + stockMovementSummary.test.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import stockRouter from '../routes/stockRoutes.js';

function handlersFor(router, path, method) {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  return layer ? layer.route.stack.map((entry) => entry.handle) : null;
}

const controllerSource = readFileSync(new URL('../controllers/stockReportController.js', import.meta.url), 'utf8');
// Isolates just the new function's body so these assertions can't accidentally pass by matching
// something in getStockMovementSummary (Phase 7.1) instead.
const staffFnSource = controllerSource.slice(controllerSource.indexOf('export const getStaffAdjustmentSummary'));

describe('getStaffAdjustmentSummary — manual-only source classification', () => {
  it('matches on `source: { $exists: false }` before any grouping stage, excluding every automatic movement', () => {
    const matchIndex = staffFnSource.indexOf("source: { $exists: false }");
    const firstGroupIndex = staffFnSource.indexOf('$group');
    assert.ok(matchIndex > -1, 'manual-only filter must be present');
    assert.ok(matchIndex < firstGroupIndex, 'manual-only filter must be applied before actor grouping');
  });

  it('never reuses listStockMovementActors (which has no manual-only filter and can include customers)', () => {
    assert.ok(!staffFnSource.includes('listStockMovementActors'));
  });
});

describe('getStaffAdjustmentSummary — reason classification', () => {
  it('defines exactly the four stored presets, excluding the literal "Other" validation-only entry', () => {
    assert.match(controllerSource, /KNOWN_REASON_PRESETS = \['Physical count correction', 'Damaged \/ Spoiled', 'Loss \/ Theft', 'Received outside vendor system'\]/);
  });

  it('re-buckets anything not matching a known preset under a synthetic "Other" category', () => {
    assert.match(staffFnSource, /\$cond: \[\{ \$in: \['\$reason', KNOWN_REASON_PRESETS\] \}, '\$reason', 'Other'\]/);
  });

  it('never exposes the underlying free-text explanation — byReason carries only the category and a count', () => {
    assert.ok(!/explanation/i.test(staffFnSource));
    assert.match(staffFnSource, /byReason\.push\(\{ reason: row\.reason, count: row\.count \}\)/);
  });
});

describe('getStaffAdjustmentSummary — staff identity', () => {
  it('groups by actor.id, not by historical name, in every facet', () => {
    const groupIds = [...staffFnSource.matchAll(/_id: ('\$actor\.id'|\{ actorId: '\$actor\.id'[^}]*\})/g)];
    assert.ok(groupIds.length >= 4, 'overall, nameHistory, byUnit and byReason must all key off actor.id');
  });

  it('falls back to "Unknown staff" for a blank name and never queries the User collection', () => {
    assert.match(staffFnSource, /row\.name \|\| 'Unknown staff'/);
    assert.ok(!/from ['"]\.\.\/models\/User\.js['"]/.test(controllerSource));
    assert.ok(!/\.populate\(/.test(staffFnSource));
  });

  it('orders nameHistory by lastSeenAt descending (most recent historical name first)', () => {
    assert.match(staffFnSource, /nameHistory\.sort\(\(a, b\) => new Date\(b\.lastSeenAt\) - new Date\(a\.lastSeenAt\)\)/);
  });
});

describe('getStaffAdjustmentSummary — date range reuse', () => {
  it('calls the existing resolveIstRange rather than defining a second date-range implementation', () => {
    const definitions = controllerSource.match(/function resolveIstRange/g) || [];
    assert.equal(definitions.length, 1, 'resolveIstRange must be defined exactly once');
    assert.match(staffFnSource, /resolveIstRange\(from, to\)/);
  });
});

describe('getStaffAdjustmentSummary — quantity calculation (set_exact counted independent of direction)', () => {
  it('counts a set_exact row into setExactCount regardless of whether it added, removed, or changed nothing', () => {
    assert.match(staffFnSource, /setExactCount: \{ \$sum: \{ \$cond: \[\{ \$eq: \['\$type', 'set_exact'\] \}, 1, 0\] \} \}/);
  });
});

describe('GET /stock/reports/staff — route wiring and permission gate', () => {
  it('is registered under the existing stock router with the same broad view permission as every other stock endpoint', () => {
    const handlers = handlersFor(stockRouter, '/reports/staff', 'get');
    assert.ok(handlers, 'route must exist');
    assert.equal(handlers.length, 3);
  });

  it('shares its permission gate with /reports/summary and /movements (no new permission constant)', () => {
    const source = readFileSync(new URL('../routes/stockRoutes.js', import.meta.url), 'utf8');
    const lineFor = (needle) => source.split('\n').find((line) => line.includes(needle));
    const gate = (line) => line.match(/requireAnyPermission\([^)]*\)/)[0];
    const staffGate = gate(lineFor("'/reports/staff'"));
    assert.equal(staffGate, gate(lineFor("'/movements'")));
    assert.equal(staffGate, gate(lineFor("'/reports/summary'")));
  });
});

describe('getStaffAdjustmentSummary never exposes sensitive fields', () => {
  it('never references cost, price, valuation, phone or email fields', () => {
    const codeOnly = staffFnSource.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.ok(!/\.rate\b|purchasePrice|totalAmount|vendorName|canViewSupplierCosts|valuation|phone|email/i.test(codeOnly));
  });

  it('the response is limited to from/to/staff — never a raw movement document', () => {
    assert.match(controllerSource, /res\.json\(\{ from, to, staff \}\)/);
  });
});
