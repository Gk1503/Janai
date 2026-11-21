import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizePricingRules } from '../utils/settingsValidation.js';
import { getPricingSettings, updatePricingSettings } from '../controllers/settingsController.js';
import Settings from '../models/Settings.js';
import settingsRouter from '../routes/settingsRoutes.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';

describe('normalizePricingRules (pure validation)', () => {
  it('a never-configured store (missing/undefined input) normalises to an empty rule list', () => {
    assert.deepEqual(normalizePricingRules(undefined).value, []);
    assert.deepEqual(normalizePricingRules(null).value, []);
  });

  it('accepts a valid bounded range', () => {
    const result = normalizePricingRules([{ minPurchasePrice: 0, maxPurchasePrice: 100, profitPercent: 20 }]);
    assert.deepEqual(result.value, [{ minPurchasePrice: 0, maxPurchasePrice: 100, fixedProfit: 0, profitPercent: 20 }]);
  });

  it('accepts a valid open-ended final range (no maxPurchasePrice)', () => {
    const result = normalizePricingRules([{ minPurchasePrice: 500, fixedProfit: 10 }]);
    assert.deepEqual(result.value, [{ minPurchasePrice: 500, maxPurchasePrice: null, fixedProfit: 10, profitPercent: 0 }]);
    // Explicit null/empty string must behave the same as omitting the field entirely.
    assert.equal(normalizePricingRules([{ minPurchasePrice: 500, maxPurchasePrice: null, fixedProfit: 10 }]).value[0].maxPurchasePrice, null);
    assert.equal(normalizePricingRules([{ minPurchasePrice: 500, maxPurchasePrice: '', fixedProfit: 10 }]).value[0].maxPurchasePrice, null);
  });

  it('accepts percentage-only profit', () => {
    const result = normalizePricingRules([{ minPurchasePrice: 0, maxPurchasePrice: 100, profitPercent: 15 }]);
    assert.equal(result.value[0].profitPercent, 15);
    assert.equal(result.value[0].fixedProfit, 0);
  });

  it('accepts fixed-only profit', () => {
    const result = normalizePricingRules([{ minPurchasePrice: 0, maxPurchasePrice: 100, fixedProfit: 25 }]);
    assert.equal(result.value[0].fixedProfit, 25);
    assert.equal(result.value[0].profitPercent, 0);
  });

  it('accepts combined fixed + percentage profit', () => {
    const result = normalizePricingRules([{ minPurchasePrice: 0, maxPurchasePrice: 100, fixedProfit: 10, profitPercent: 5 }]);
    assert.deepEqual(result.value[0], { minPurchasePrice: 0, maxPurchasePrice: 100, fixedProfit: 10, profitPercent: 5 });
  });

  it('rejects a rule where both profit values are zero (or both omitted)', () => {
    assert.ok(normalizePricingRules([{ minPurchasePrice: 0, maxPurchasePrice: 100, fixedProfit: 0, profitPercent: 0 }]).error);
    assert.ok(normalizePricingRules([{ minPurchasePrice: 0, maxPurchasePrice: 100 }]).error);
  });

  it('rejects a missing minimum purchase price', () => {
    assert.ok(normalizePricingRules([{ maxPurchasePrice: 100, profitPercent: 10 }]).error);
  });

  it('rejects negative purchase prices', () => {
    assert.ok(normalizePricingRules([{ minPurchasePrice: -5, maxPurchasePrice: 100, profitPercent: 10 }]).error);
    assert.ok(normalizePricingRules([{ minPurchasePrice: 0, maxPurchasePrice: -1, profitPercent: 10 }]).error);
  });

  it('rejects negative fixed profit', () => {
    assert.ok(normalizePricingRules([{ minPurchasePrice: 0, maxPurchasePrice: 100, fixedProfit: -1 }]).error);
  });

  it('rejects negative percentage profit', () => {
    assert.ok(normalizePricingRules([{ minPurchasePrice: 0, maxPurchasePrice: 100, profitPercent: -1 }]).error);
  });

  it('rejects minimum greater than or equal to maximum for a bounded range', () => {
    assert.ok(normalizePricingRules([{ minPurchasePrice: 100, maxPurchasePrice: 100, profitPercent: 10 }]).error, 'equal');
    assert.ok(normalizePricingRules([{ minPurchasePrice: 200, maxPurchasePrice: 100, profitPercent: 10 }]).error, 'min > max');
  });

  it('rejects invalid data types and malformed input', () => {
    assert.ok(normalizePricingRules('not an array').error);
    assert.ok(normalizePricingRules({ minPurchasePrice: 0 }).error, 'a bare object instead of a list');
    assert.ok(normalizePricingRules([null]).error);
    assert.ok(normalizePricingRules(['nope']).error);
    assert.ok(normalizePricingRules([{ minPurchasePrice: 'abc', maxPurchasePrice: 100, profitPercent: 10 }]).error);
    assert.ok(normalizePricingRules([{ minPurchasePrice: 0, maxPurchasePrice: 100, profitPercent: 'lots' }]).error);
    assert.ok(normalizePricingRules([{ minPurchasePrice: true, maxPurchasePrice: 100, profitPercent: 10 }]).error);
  });

  it('accepts adjacent ranges and does not reject shared boundaries as overlapping', () => {
    const result = normalizePricingRules([
      { minPurchasePrice: 0, maxPurchasePrice: 100, profitPercent: 20 },
      { minPurchasePrice: 100, maxPurchasePrice: 500, profitPercent: 15 },
      { minPurchasePrice: 500, fixedProfit: 50 },
    ]);
    assert.equal(result.error, undefined);
    assert.equal(result.value.length, 3);
    assert.equal(result.value[2].maxPurchasePrice, null);
  });

  it('rejects genuinely overlapping ranges', () => {
    const result = normalizePricingRules([
      { minPurchasePrice: 0, maxPurchasePrice: 150, profitPercent: 20 },
      { minPurchasePrice: 100, maxPurchasePrice: 500, profitPercent: 15 },
    ]);
    assert.ok(result.error);
    assert.match(result.error, /overlap/i);
  });

  it('rejects two ranges that share the same starting point', () => {
    const result = normalizePricingRules([
      { minPurchasePrice: 100, maxPurchasePrice: 200, profitPercent: 10 },
      { minPurchasePrice: 100, maxPurchasePrice: 300, profitPercent: 20 },
    ]);
    assert.ok(result.error);
  });

  it('rejects more than one open-ended range', () => {
    const result = normalizePricingRules([
      { minPurchasePrice: 0, fixedProfit: 10 },
      { minPurchasePrice: 500, fixedProfit: 20 },
    ]);
    assert.ok(result.error);
    assert.match(result.error, /one pricing rule may be open-ended/i);
  });

  it('rejects an open-ended range that is not the final range', () => {
    const result = normalizePricingRules([
      { minPurchasePrice: 0, maxPurchasePrice: 100, profitPercent: 10 },
      { minPurchasePrice: 50, fixedProfit: 20 }, // open-ended but starts inside/before the bounded range
    ]);
    assert.ok(result.error);
  });

  it('is immune to input ordering — submitting ranges out of order still validates correctly', () => {
    // The open-ended rule is listed FIRST here, but it genuinely has the highest minimum, so this must
    // still be accepted (and stored sorted, not in submission order).
    const accepted = normalizePricingRules([
      { minPurchasePrice: 500, fixedProfit: 50 },
      { minPurchasePrice: 0, maxPurchasePrice: 100, profitPercent: 20 },
      { minPurchasePrice: 100, maxPurchasePrice: 500, profitPercent: 15 },
    ]);
    assert.equal(accepted.error, undefined);
    assert.deepEqual(accepted.value.map((rule) => rule.minPurchasePrice), [0, 100, 500]);

    // Here the "open-ended" rule is listed last, but another rule actually starts above it — still
    // invalid regardless of submission order, because validation sorts by value, not input position.
    const rejected = normalizePricingRules([
      { minPurchasePrice: 0, fixedProfit: 10 },
      { minPurchasePrice: 500, maxPurchasePrice: 1000, profitPercent: 10 },
    ]);
    assert.ok(rejected.error);
  });
});

describe('Settings model: pricingRules', () => {
  it('declares a safe empty default for a never-configured document', () => {
    const doc = new Settings({});
    assert.deepEqual(doc.pricingRules, []);
    assert.equal(doc.validateSync(), undefined);
  });

  it('accepts a valid rule and leaves every other existing Settings field at its own default', () => {
    const doc = new Settings({ pricingRules: [{ minPurchasePrice: 0, maxPurchasePrice: 100, profitPercent: 20 }] });
    assert.equal(doc.pricingRules.length, 1);
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.general.businessName, 'Janai');
    assert.equal(doc.orderSettings.deliveryFee, 25);
    assert.equal(doc.notifications.enabled, false);
  });
});

describe('settings routes: who can read vs write /pricing-rules', () => {
  it('GET /pricing-rules is owner-only — never public (unlike /general and /orders-delivery)', () => {
    const layer = settingsRouter.stack.find((entry) => entry.route?.path === '/pricing-rules' && entry.route.methods.get);
    assert.ok(layer, 'GET /pricing-rules must exist');
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.deepEqual(handlers, [requireAuth, requireOwner, getPricingSettings]);
  });

  it('PATCH /pricing-rules requires authentication AND ownership, in that order, before the handler', () => {
    const layer = settingsRouter.stack.find((entry) => entry.route?.path === '/pricing-rules' && entry.route.methods.patch);
    assert.ok(layer, 'PATCH /pricing-rules must exist');
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.deepEqual(handlers, [requireAuth, requireOwner, updatePricingSettings]);
  });

  it('requireOwner rejects regular staff, delivery-only staff and customers (staff/customer cannot read or write)', () => {
    const rejected = [];
    const res = { status(code) { this.code = code; return this; }, json(payload) { rejected.push({ code: this.code, payload }); return this; } };
    for (const user of [
      { role: 'staff', permissions: ['products:view', 'products:manage'] },
      { role: 'staff', permissions: ['delivery:view', 'delivery:update'] },
      { role: 'customer' },
      undefined,
    ]) {
      let passed = false;
      requireOwner({ user }, res, () => { passed = true; });
      assert.equal(passed, false, `${JSON.stringify(user)} must not reach the handler`);
    }
    assert.equal(rejected.length, 4);
    for (const entry of rejected) assert.equal(entry.code, 403);
  });

  it('requireAuth rejects an unauthenticated request outright', async () => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    await requireAuth({ headers: {} }, res, () => { throw new Error('must never call next() with no token'); });
    assert.equal(res.statusCode, 401);
  });
});

// ---- handler-level regressions with stubbed model methods (no database) ----
function run(handler, user, body = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler({ user, body }, res, (error) => resolve({ status: 500, error }));
  });
}

const owner = { _id: 'owner1', id: 'owner1', role: 'admin' };

describe('getPricingSettings / updatePricingSettings (stubbed model)', () => {
  it('a never-configured store reads back an empty rule list', async () => {
    const original = Settings.findOneAndUpdate;
    Settings.findOneAndUpdate = async () => ({ pricingRules: [], updatedAt: new Date() });
    try {
      const result = await run(getPricingSettings, owner);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.settings.pricingRules, []);
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('the owner can save rules, and the saved values round-trip exactly, writing the single canonical document', async () => {
    const original = Settings.findOneAndUpdate;
    let writtenFilter = null;
    let writtenUpdate = null;
    Settings.findOneAndUpdate = async (filter, update) => {
      writtenFilter = filter;
      writtenUpdate = update;
      return { pricingRules: update.$set.pricingRules, updatedAt: new Date() };
    };
    try {
      const result = await run(updatePricingSettings, owner, {
        pricingRules: [
          { minPurchasePrice: 0, maxPurchasePrice: 100, profitPercent: 20 },
          { minPurchasePrice: 100, fixedProfit: 30 },
        ],
      });
      assert.equal(result.status, 200);
      assert.deepEqual(writtenFilter, {}, 'must always write the single canonical document, never a caller-supplied id');
      assert.equal(writtenUpdate.$set.updatedBy, owner._id);
      assert.equal(result.body.settings.pricingRules.length, 2);
      assert.equal(result.body.settings.pricingRules[1].maxPurchasePrice, null);
      assert.equal(result.body.message, 'Settings saved.');
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('rejects invalid rules before ever touching the database', async () => {
    const original = Settings.findOneAndUpdate;
    let called = false;
    Settings.findOneAndUpdate = async () => { called = true; };
    try {
      for (const bad of [
        [{ minPurchasePrice: -1, maxPurchasePrice: 100, profitPercent: 10 }],
        [{ minPurchasePrice: 0, maxPurchasePrice: 100, fixedProfit: 0, profitPercent: 0 }],
        [{ minPurchasePrice: 100, maxPurchasePrice: 50, profitPercent: 10 }],
        [{ minPurchasePrice: 0, maxPurchasePrice: 150, profitPercent: 10 }, { minPurchasePrice: 100, maxPurchasePrice: 500, profitPercent: 10 }],
      ]) {
        const result = await run(updatePricingSettings, owner, { pricingRules: bad });
        assert.equal(result.status, 400, JSON.stringify(bad));
      }
      assert.equal(called, false, 'invalid input must never reach the database');
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('rejects an unsupported/unknown field outright (no mass assignment)', async () => {
    const original = Settings.findOneAndUpdate;
    let called = false;
    Settings.findOneAndUpdate = async () => { called = true; };
    try {
      const result = await run(updatePricingSettings, owner, { pricingRules: [], deliveryFee: 10 });
      assert.equal(result.status, 400);
      assert.match(result.body.message, /Unsupported field/);
      assert.equal(called, false);
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('never returns updatedBy, __v, or per-rule internal fields (_id/timestamps)', async () => {
    const original = Settings.findOneAndUpdate;
    Settings.findOneAndUpdate = async () => ({
      pricingRules: [{ _id: 'abc123', minPurchasePrice: 0, maxPurchasePrice: 100, fixedProfit: 0, profitPercent: 20, createdAt: new Date(), updatedAt: new Date() }],
      updatedBy: 'owner1',
      __v: 0,
      updatedAt: new Date(),
    });
    try {
      const result = await run(getPricingSettings, owner);
      assert.deepEqual(Object.keys(result.body.settings).sort(), ['pricingRules', 'updatedAt']);
      assert.deepEqual(Object.keys(result.body.settings.pricingRules[0]).sort(), ['fixedProfit', 'maxPurchasePrice', 'minPurchasePrice', 'profitPercent']);
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('updating pricing rules does not disturb the other existing Settings fields on the written document', async () => {
    const original = Settings.findOneAndUpdate;
    let writtenUpdate = null;
    Settings.findOneAndUpdate = async (filter, update) => {
      writtenUpdate = update;
      return { pricingRules: update.$set.pricingRules, updatedAt: new Date() };
    };
    try {
      await run(updatePricingSettings, owner, { pricingRules: [{ minPurchasePrice: 0, fixedProfit: 10 }] });
      // Only `pricingRules` (and the shared `updatedBy`) are touched — general/orderSettings/notifications
      // are never part of this $set, so a real findOneAndUpdate could never clobber them.
      assert.deepEqual(Object.keys(writtenUpdate.$set).sort(), ['pricingRules', 'updatedBy']);
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });
});
