import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DAYS, normalizeAddress, normalizeBusinessName, normalizeOperatingHours,
  normalizeOptionalEmail, normalizeOptionalLogo, normalizeOptionalPhone,
} from '../utils/settingsValidation.js';
import { getGeneralSettings, updateGeneralSettings } from '../controllers/settingsController.js';
import Settings from '../models/Settings.js';
import settingsRouter from '../routes/settingsRoutes.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';

describe('settings validation', () => {
  it('requires a non-empty business name, trimmed and length-capped', () => {
    assert.equal(normalizeBusinessName('  Janai Foods  ').value, 'Janai Foods');
    for (const bad of ['', '   ', null, undefined, 42, 'x'.repeat(121)]) assert.ok(normalizeBusinessName(bad).error, String(bad));
  });

  it('treats an empty phone/email as not provided, never invents a value, and validates a real one', () => {
    assert.equal(normalizeOptionalPhone('').value, '');
    assert.equal(normalizeOptionalPhone(undefined).value, '');
    assert.equal(normalizeOptionalPhone('+91 98765 43210').value, '9876543210');
    assert.ok(normalizeOptionalPhone('12345').error);
    assert.equal(normalizeOptionalEmail('').value, '');
    assert.equal(normalizeOptionalEmail(' Owner@Janai.IN ').value, 'owner@janai.in');
    assert.ok(normalizeOptionalEmail('nope').error);
  });

  it('normalises an address, rejecting an invalid pincode but allowing one to be omitted', () => {
    const result = normalizeAddress({ line1: ' 12 MG Road ', city: 'Pune', postalCode: '411001', extra: 'ignored' });
    assert.deepEqual(result.value, { line1: '12 MG Road', line2: '', city: 'Pune', state: '', postalCode: '411001' });
    assert.ok(!('extra' in result.value), 'unknown address fields must be dropped, not passed through');
    assert.ok(normalizeAddress({ postalCode: '123' }).error);
    assert.deepEqual(normalizeAddress(undefined).value, { line1: '', line2: '', city: '', state: '', postalCode: '' });
  });

  it('fills in safe defaults for operating hours and validates every day independently', () => {
    const defaults = normalizeOperatingHours(undefined).value;
    assert.equal(Object.keys(defaults).length, 7);
    for (const day of DAYS) assert.deepEqual(defaults[day], { closed: false, open: '09:00', close: '21:00' });

    assert.ok(normalizeOperatingHours({ monday: { open: '25:00', close: '10:00' } }).error, 'invalid time format must be rejected');
    assert.ok(normalizeOperatingHours({ monday: { open: '18:00', close: '09:00' } }).error, 'closing before opening must be rejected');
    const closedMonday = normalizeOperatingHours({ monday: { closed: true, open: 'garbage', close: 'garbage' } });
    assert.equal(closedMonday.error, undefined, 'a closed day skips time validation entirely');
    assert.equal(closedMonday.value.monday.closed, true);
  });

  it('accepts an uploaded-image data URL for the logo, rejects anything else, and enforces a size ceiling', () => {
    assert.equal(normalizeOptionalLogo('').value, '');
    assert.equal(normalizeOptionalLogo(undefined).value, '');
    const smallLogo = `data:image/png;base64,${'A'.repeat(100)}`;
    assert.equal(normalizeOptionalLogo(smallLogo).value, smallLogo);
    assert.ok(normalizeOptionalLogo('not-a-data-url').error);
    assert.ok(normalizeOptionalLogo('<script>alert(1)</script>').error);
    const tooLarge = `data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}`; // ~5.25MB raw
    assert.ok(normalizeOptionalLogo(tooLarge).error);
  });
});

describe('Settings model', () => {
  it('declares safe schema defaults for a never-configured document', () => {
    const doc = new Settings({});
    assert.equal(doc.general.businessName, 'Janai');
    assert.equal(doc.general.logo, '');
    assert.equal(doc.general.operatingHours.monday.open, '09:00');
    assert.equal(doc.general.operatingHours.sunday.close, '21:00');
    assert.equal(doc.validateSync(), undefined);
  });
});

describe('settings routes: who can read vs write', () => {
  it('GET /general is public (no auth middleware in front of it)', () => {
    const layer = settingsRouter.stack.find((entry) => entry.route?.path === '/general' && entry.route.methods.get);
    assert.ok(layer, 'GET /general must exist');
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.deepEqual(handlers, [getGeneralSettings]);
    assert.ok(!handlers.includes(requireAuth) && !handlers.includes(requireOwner));
  });

  it('PATCH /general requires authentication AND ownership, in that order, before the handler', () => {
    const layer = settingsRouter.stack.find((entry) => entry.route?.path === '/general' && entry.route.methods.patch);
    assert.ok(layer, 'PATCH /general must exist');
    const handlers = layer.route.stack.map((entry) => entry.handle);
    assert.deepEqual(handlers, [requireAuth, requireOwner, updateGeneralSettings]);
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
const validBody = (overrides = {}) => ({ businessName: 'Janai Foods', phone: '9876543210', email: 'owner@janai.in', address: { city: 'Pune', postalCode: '411001' }, operatingHours: {}, ...overrides });

describe('getGeneralSettings / updateGeneralSettings (stubbed model)', () => {
  it('a never-configured store reads back safe defaults', async () => {
    const original = Settings.findOneAndUpdate;
    Settings.findOneAndUpdate = async () => ({ general: { businessName: 'Janai', logo: '', phone: '', email: '', address: {}, operatingHours: {} }, updatedAt: new Date() });
    try {
      const result = await run(getGeneralSettings, owner);
      assert.equal(result.status, 200);
      assert.equal(result.body.settings.businessName, 'Janai');
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('the owner can update settings, and the saved values are exactly what comes back (round-trip)', async () => {
    const original = Settings.findOneAndUpdate;
    let writtenFilter = null;
    let writtenUpdate = null;
    Settings.findOneAndUpdate = async (filter, update) => {
      writtenFilter = filter;
      writtenUpdate = update;
      return { general: update.$set.general, updatedAt: new Date() };
    };
    try {
      const result = await run(updateGeneralSettings, owner, validBody());
      assert.equal(result.status, 200);
      assert.deepEqual(writtenFilter, {}, 'must always write the single canonical document, never a caller-supplied id');
      assert.equal(writtenUpdate.$set.updatedBy, owner._id);
      assert.equal(result.body.settings.businessName, 'Janai Foods');
      assert.equal(result.body.settings.phone, '9876543210');
      assert.equal(result.body.settings.address.city, 'Pune');
      assert.equal(result.body.message, 'Settings saved.');
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('rejects invalid input before ever touching the database', async () => {
    const original = Settings.findOneAndUpdate;
    let called = false;
    Settings.findOneAndUpdate = async () => { called = true; };
    try {
      for (const bad of [validBody({ businessName: '' }), validBody({ email: 'not-an-email' }), validBody({ address: { postalCode: '123' } }), validBody({ operatingHours: { monday: { open: '20:00', close: '09:00' } } })]) {
        const result = await run(updateGeneralSettings, owner, bad);
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
      const result = await run(updateGeneralSettings, owner, validBody({ role: 'admin', permissions: ['delivery:view'] }));
      assert.equal(result.status, 400);
      assert.match(result.body.message, /Unsupported field/);
      assert.equal(called, false);
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });

  it('never returns updatedBy or any internal field — only the five General fields plus updatedAt', async () => {
    const original = Settings.findOneAndUpdate;
    Settings.findOneAndUpdate = async () => ({ general: { businessName: 'Janai', logo: '', phone: '', email: '', address: {}, operatingHours: {} }, updatedBy: 'owner1', __v: 0, updatedAt: new Date() });
    try {
      const result = await run(getGeneralSettings, owner);
      assert.deepEqual(Object.keys(result.body.settings).sort(), ['address', 'businessName', 'email', 'logo', 'operatingHours', 'phone', 'updatedAt']);
    } finally {
      Settings.findOneAndUpdate = original;
    }
  });
});
