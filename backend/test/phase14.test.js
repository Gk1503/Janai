import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import Cart from '../models/Cart.js';
import Category from '../models/Category.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Promotion from '../models/Promotion.js';
import Settings from '../models/Settings.js';
import User from '../models/User.js';
import adminRouter from '../routes/adminRoutes.js';
import cartRouter from '../routes/cartRoutes.js';
import orderRouter from '../routes/orderRoutes.js';
import productRouter from '../routes/productRoutes.js';
import preOrderRouter from '../routes/preOrderRoutes.js';
import promotionRouter from '../routes/promotionRoutes.js';
import { PERMISSION_LIST } from '../config/permissions.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { bestOfferFor, computeDiscount, priceLines, promotionStatus } from '../utils/promotionPricing.js';

process.env.JWT_SECRET = 'phase14-test-secret';

const hex = (n) => String(n).padStart(24, '0');
const HOUR = 3600 * 1000;
const iso = (offsetHours) => new Date(Date.now() + offsetHours * HOUR).toISOString();
const owner = { _id: hex(1), id: hex(1), role: 'admin', isActive: true, firstName: 'Owner', lastName: 'One' };
const staff = { _id: hex(2), id: hex(2), role: 'staff', isActive: true, firstName: 'Sam', lastName: 'Staff', permissions: PERMISSION_LIST };
const customer = { _id: hex(3), id: hex(3), role: 'customer', isActive: true, firstName: 'Cu', lastName: 'Stomer' };
const people = { [owner.id]: owner, [staff.id]: staff, [customer.id]: customer };
const tokenFor = (user) => jwt.sign({ sub: user.id }, process.env.JWT_SECRET);

const MANGO = hex(200);
const TOMATO = hex(201);
const RICE = hex(202);
const baseProducts = () => [
  { _id: MANGO, id: MANGO, name: 'Mango', category: 'Fruits', price: 100, unit: 'kg', images: [], stock: 50, vendors: [{ name: 'Secret Supplier', purchasePrice: 12 }], dealPlacements: { bestDeals: true, seasonalDeals: true } },
  { _id: TOMATO, id: TOMATO, name: 'Tomato', category: 'Vegetables', price: 40, unit: 'kg', images: [], stock: 50, vendors: [], dealPlacements: { bestDeals: true, seasonalDeals: true } },
  { _id: RICE, id: RICE, name: 'Rice', category: 'Groceries', price: 99.99, unit: 'kg', images: [], stock: 5, vendors: [], dealPlacements: { bestDeals: true, seasonalDeals: true } },
];

// ---------------------------------------------------------------- in-memory fakes (no database)
let promos;
let products;
let orders;
let settingsDoc;
let stockLog;
let promoSeq;
const originals = {};

const compare = (value, op, expected, condition) => {
  if (op === '$in') return expected.map(String).includes(String(value));
  if (op === '$nin') return !expected.map(String).includes(String(value));
  if (op === '$regex') return new RegExp(expected, condition.$options).test(String(value));
  if (op === '$options') return true;
  if (op === '$lte') return value <= expected;
  if (op === '$gte') return value >= expected;
  if (op === '$gt') return value > expected;
  throw new Error(`fake does not support ${op}`);
};
function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    const value = key.split('.').reduce((node, part) => node?.[part], doc);
    if (condition && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition)) return Object.entries(condition).every(([op, expected]) => compare(value, op, expected, condition));
    if (Array.isArray(value)) return value.map(String).includes(String(condition));
    return String(value) === String(condition);
  });
}
function chain(compute) {
  const state = { sort: null, limit: null, strip: [] };
  const q = {
    select(spec) { if (typeof spec === 'string') spec.split(' ').filter((part) => part.startsWith('-')).forEach((part) => state.strip.push(part.slice(1))); return q; },
    sort(spec) { state.sort = spec; return q; }, limit(n) { state.limit = n; return q; }, skip() { return q; }, collation() { return q; }, lean() { return q; },
    then: (a, b) => {
      let result = compute();
      if (Array.isArray(result)) {
        if (state.sort) result = [...result].sort((x, y) => { for (const [key, dir] of Object.entries(state.sort)) { if (x[key] < y[key]) return -dir; if (x[key] > y[key]) return dir; } return 0; });
        if (state.limit) result = result.slice(0, state.limit);
      }
      const strip = (doc) => (doc && state.strip.length ? Object.fromEntries(Object.entries(doc).filter(([k]) => !state.strip.includes(k))) : doc);
      return Promise.resolve(Array.isArray(result) ? result.map(strip) : strip(result)).then(a, b);
    },
  };
  return q;
}

beforeEach(() => {
  promos = []; products = baseProducts(); orders = []; stockLog = []; promoSeq = 0;
  settingsDoc = { deals: { bestDealsEnabled: true, seasonalDealsEnabled: true } };
  for (const [key, model, name] of [['pf', Promotion, 'find'], ['pfo', Promotion, 'findOne'], ['pbi', Promotion, 'findById'], ['pc', Promotion, 'create'], ['pu', Promotion, 'findByIdAndUpdate'], ['pd', Promotion, 'findByIdAndDelete'], ['pbw', Promotion, 'bulkWrite'], ['pum', Promotion, 'updateMany'], ['prfu2', Product, 'findByIdAndUpdate'], ['prfd', Product, 'findByIdAndDelete'],
    ['prf', Product, 'find'], ['prbi', Product, 'findById'], ['prfu', Product, 'findOneAndUpdate'], ['prcd', Product, 'countDocuments'], ['prup', Product, 'updateOne'],
    ['cf', Category, 'find'], ['sfo', Settings, 'findOne'], ['sfu', Settings, 'findOneAndUpdate'], ['cart', Cart, 'findOne'], ['ocr', Order, 'create'], ['ofb', Order, 'findById'], ['ufb', User, 'findById']]) originals[key] = model[name];

  Promotion.find = (filter) => chain(() => promos.filter((p) => matches(p, filter)));
  Promotion.findOne = (filter) => chain(() => promos.find((p) => matches(p, filter)) || null);
  Promotion.findById = (id) => chain(() => promos.find((p) => p._id === String(id)) || null);
  Promotion.create = async (fields) => { promoSeq += 1; const doc = { ...fields, _id: hex(500 + promoSeq), products: fields.products || [], createdAt: new Date(Date.now() + promoSeq), updatedAt: new Date() }; promos.push(doc); return { ...doc, toObject: () => ({ ...doc }) }; };
  Promotion.findByIdAndUpdate = (id, update) => chain(() => { const doc = promos.find((p) => p._id === String(id)); if (!doc) return null; Object.assign(doc, update.$set); return doc; });
  Promotion.findByIdAndDelete = async (id) => { const index = promos.findIndex((p) => p._id === String(id)); return index < 0 ? null : promos.splice(index, 1)[0]; };
  Promotion.bulkWrite = async (ops) => { for (const { updateOne } of ops) { const doc = promos.find((p) => matches(p, updateOne.filter)); if (doc) Object.assign(doc, updateOne.update.$set); } };
  // products arrays are matched by membership, like MongoDB does for an array field.
  Promotion.updateMany = async (filter, update) => {
    let modified = 0;
    for (const doc of promos) {
      const inSection = !filter.section || (filter.section.$in ? filter.section.$in.includes(doc.section) : filter.section === doc.section);
      if (!inSection || !(doc.products || []).map(String).includes(String(filter.products))) continue;
      doc.products = doc.products.filter((id) => String(id) !== String(update.$pull.products)); modified += 1;
    }
    return { modifiedCount: modified };
  };
  Product.findByIdAndUpdate = (id, update) => chain(() => {
    const doc = products.find((p) => p._id === String(id)); if (!doc) return null;
    for (const [path, value] of Object.entries(update)) { const [group, key] = path.split('.'); if (key) doc[group] = { ...(doc[group] || {}), [key]: value }; else doc[path] = value; }
    return doc;
  });
  Product.findByIdAndDelete = async (id) => { const index = products.findIndex((p) => p._id === String(id)); return index < 0 ? null : products.splice(index, 1)[0]; };
  Product.find = (filter) => chain(() => products.filter((p) => matches(p, filter)));
  Product.findById = (id) => chain(() => products.find((p) => p._id === String(id)) || null);
  Product.countDocuments = async () => products.length;
  Product.findOneAndUpdate = async (filter, update) => { const doc = products.find((p) => matches(p, { _id: filter._id })); if (!doc || doc.stock < filter.stock.$gte) return null; doc.stock += update.$inc.stock; stockLog.push([doc._id, update.$inc.stock]); return doc; };
  Product.updateOne = async () => ({ matchedCount: 1 });
  Category.find = () => chain(() => [{ name: 'Fruits' }, { name: 'Vegetables' }, { name: 'Groceries' }]);
  Settings.findOne = () => chain(() => settingsDoc);
  Settings.findOneAndUpdate = async (filter, update) => { for (const [path, value] of Object.entries(update.$set)) { const [group, key] = path.split('.'); if (key) { settingsDoc[group] = { ...(settingsDoc[group] || {}), [key]: value }; } else settingsDoc[group] = value; } return settingsDoc; };
  Cart.findOne = () => chain(() => null);
  Order.create = async (fields) => { const doc = { ...fields, _id: hex(900 + orders.length), createdAt: new Date(), toObject() { return { ...this }; } }; orders.push(doc); return doc; };
  User.findById = async (id) => people[String(id)] || null;
});
afterEach(() => {
  Promotion.find = originals.pf; Promotion.findOne = originals.pfo; Promotion.findById = originals.pbi; Promotion.create = originals.pc; Promotion.findByIdAndUpdate = originals.pu; Promotion.findByIdAndDelete = originals.pd; Promotion.bulkWrite = originals.pbw; Promotion.updateMany = originals.pum; Product.findByIdAndUpdate = originals.prfu2; Product.findByIdAndDelete = originals.prfd;
  Product.find = originals.prf; Product.findById = originals.prbi; Product.findOneAndUpdate = originals.prfu; Product.countDocuments = originals.prcd; Product.updateOne = originals.prup;
  Category.find = originals.cf; Settings.findOne = originals.sfo; Settings.findOneAndUpdate = originals.sfu; Cart.findOne = originals.cart; Order.create = originals.ocr; Order.findById = originals.ofb; User.findById = originals.ufb;
});

let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use('/api/promotions', promotionRouter);
  app.use('/api/products', productRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', orderRouter);
  app.use('/api/preorders', preOrderRouter);
  app.use(errorHandler);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const call = (method, path, user, body) => fetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}) },
  body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
});
const json = async (response) => ({ status: response.status, body: await response.json() });

// A stored promotion, live by default.
function seedPromo(fields = {}) {
  promoSeq += 1;
  const doc = {
    _id: hex(700 + promoSeq), title: `Deal ${promoSeq}`, description: 'desc', section: 'best_deals', promotionType: 'actual_discount', bannerImage: '', products: [MANGO], categories: [],
    discountType: 'percentage', discountValue: 20, startAt: new Date(Date.now() - HOUR), endAt: new Date(Date.now() + HOUR), isActive: true, displayOrder: promoSeq, badgeText: '', createdBy: owner._id, updatedBy: owner._id, createdAt: new Date(Date.now() - 1000 * (100 - promoSeq)), ...fields,
  };
  promos.push(doc);
  return doc;
}
const newDeal = (extra = {}) => ({ title: 'Mango Season', description: 'Sweet', section: 'seasonal_deals', promotionType: 'actual_discount', products: [MANGO, TOMATO, RICE], discountType: 'percentage', discountValue: 20, startAt: iso(-1), endAt: iso(24), ...extra });
const address = { recipient: 'Asha', phone: '9876543210', street: '12 MG Road', postalCode: '411001' };
const orderBody = (extra = {}) => ({ items: [{ productId: MANGO, quantity: 2 }], deliveryAddress: address, deliveryDate: iso(48).slice(0, 10), paymentMethod: 'cod', ...extra });
const deals = async (section) => json(await call('GET', `/promotions/${section}`));

// ---------------------------------------------------------------- pricing rules (pure)
describe('discount calculation', () => {
  it('applies percentage and fixed discounts to the stored price', () => {
    assert.deepEqual(computeDiscount(100, 'percentage', 20), { discountPerUnit: 20, finalPrice: 80, discountPercent: 20 });
    assert.deepEqual(computeDiscount(100, 'fixed', 15), { discountPerUnit: 15, finalPrice: 85, discountPercent: 15 });
    assert.deepEqual(computeDiscount(99.99, 'percentage', 33.33), { discountPerUnit: 33.33, finalPrice: 66.66, discountPercent: 33.3 });
  });

  it('never produces a negative price or applies an invalid discount', () => {
    assert.equal(computeDiscount(100, 'fixed', 101), null, 'larger than the price is ignored');
    assert.equal(computeDiscount(100, 'percentage', 101), null);
    assert.equal(computeDiscount(100, 'percentage', 0), null);
    assert.equal(computeDiscount(100, 'fixed', -5), null);
    assert.equal(computeDiscount(100, 'fixed', 'abc'), null);
    assert.equal(computeDiscount(0, 'percentage', 10), null);
    assert.equal(computeDiscount(100, 'bogus', 10), null);
    assert.equal(computeDiscount(100, 'percentage', 100).finalPrice, 0);
  });

  it('classifies a promotion by its status', () => {
    const now = new Date();
    const at = (a, b, isActive = true) => promotionStatus({ isActive, startAt: new Date(now.getTime() + a * HOUR), endAt: new Date(now.getTime() + b * HOUR) }, now);
    assert.deepEqual([at(-1, 1), at(1, 2), at(-2, -1), at(-1, 1, false)], ['live', 'scheduled', 'expired', 'inactive']);
  });

  it('picks exactly one offer per product, never stacking, with a deterministic tie-break', () => {
    const product = { _id: MANGO, category: 'Fruits', price: 100 };
    const mk = (id, extra) => ({ _id: id, title: id, section: 'best_deals', discountType: 'percentage', discountValue: 10, products: [MANGO], categories: [], displayOrder: 0, createdAt: new Date(2026, 0, 1), ...extra });
    const context = { promotions: [mk('a', { discountValue: 10 }), mk('b', { discountValue: 25 }), mk('c', { discountType: 'fixed', discountValue: 20 })] };
    const best = bestOfferFor(product, context);
    assert.equal(best.promotionId, 'b');
    assert.equal(best.finalPrice, 75, 'only the single best discount, not 10% + 25% + 20');
    const tied = { promotions: [mk('z', { discountValue: 20, displayOrder: 2 }), mk('y', { discountValue: 20, displayOrder: 1 }), mk('x', { discountValue: 20, displayOrder: 1, createdAt: new Date(2026, 5, 1) })] };
    assert.equal(bestOfferFor(product, tied).promotionId, 'y', 'tie: lower display order, then older');
    assert.equal(bestOfferFor(product, { promotions: [...tied.promotions].reverse() }).promotionId, 'y', 'independent of input order');
  });

  it('matches by product id or by category, case-insensitively', () => {
    const promotion = { _id: 'p', title: 't', section: 'best_deals', discountType: 'percentage', discountValue: 10, products: [], categories: ['fruits'], displayOrder: 0 };
    assert.ok(bestOfferFor({ _id: MANGO, category: 'Fruits', price: 100 }, { promotions: [promotion] }));
    assert.equal(bestOfferFor({ _id: MANGO, category: 'Vegetables', price: 100 }, { promotions: [promotion] }), null);
  });

  it('prices cart lines with original subtotal, discount and payable subtotal', () => {
    const context = { promotions: [{ _id: 'p', title: 't', section: 'best_deals', discountType: 'percentage', discountValue: 20, products: [MANGO], categories: [], displayOrder: 0 }] };
    const result = priceLines([{ product: { _id: MANGO, category: 'Fruits', price: 100 }, quantity: 3 }, { product: { _id: TOMATO, category: 'Vegetables', price: 40 }, quantity: 1 }], context);
    assert.deepEqual([result.originalSubtotal, result.discountTotal, result.subtotal], [340, 60, 280]);
    assert.equal(result.items[0].unitPrice, 80);
    assert.equal(result.items[1].offer, null);
  });
});

// ---------------------------------------------------------------- admin
describe('admin: creating, editing and deleting promotions', () => {
  it('creates display-only, percentage and fixed promotions with server-side defaults', async () => {
    const display = await json(await call('POST', '/admin/deals', owner, newDeal({ promotionType: 'display_only', discountType: undefined, discountValue: undefined, title: 'Mango Showcase' })));
    assert.equal(display.status, 201);
    assert.equal(display.body.promotion.discountLabel, 'Display Only');
    assert.equal(promos[0].discountValue, null);
    const percent = await json(await call('POST', '/admin/deals', owner, newDeal({ title: 'Twenty off' })));
    assert.equal(percent.status, 201);
    assert.equal(percent.body.promotion.discountLabel, '20% off');
    const fixed = await json(await call('POST', '/admin/deals', owner, newDeal({ title: 'Fifteen off', discountType: 'fixed', discountValue: 15, section: 'best_deals' })));
    assert.equal(fixed.status, 201);
    assert.equal(fixed.body.promotion.discountLabel, '₹15 off');
    assert.deepEqual(promos.map((p) => p.displayOrder), [0, 1, 0], 'display order continues within each section');
    assert.equal(promos[0].createdBy, owner._id, 'the author comes from the session');
  });

  it('refuses unknown or forged fields (no mass assignment)', async () => {
    for (const extra of [{ createdBy: customer._id }, { _id: hex(1) }, { price: 1 }, { finalPrice: 1 }]) {
      const result = await json(await call('POST', '/admin/deals', owner, newDeal(extra)));
      assert.equal(result.status, 400, JSON.stringify(extra));
    }
    assert.equal(promos.length, 0);
  });

  it('edits only what is sent, keeps the rest and validates the merged result', async () => {
    const promo = seedPromo({ section: 'seasonal_deals', products: [MANGO, TOMATO, RICE] });
    const saved = await json(await call('PUT', `/admin/deals/${promo._id}`, owner, { title: 'Renamed', discountValue: 30 }));
    assert.equal(saved.status, 200);
    assert.equal(promos[0].title, 'Renamed');
    assert.equal(promos[0].discountValue, 30);
    assert.deepEqual(promos[0].products, [MANGO, TOMATO, RICE]);
    assert.equal(promos[0].updatedBy, owner._id);
    assert.equal((await json(await call('PUT', `/admin/deals/${promo._id}`, owner, { discountValue: 500 }))).status, 400, 'merged percentage over 100');
    assert.equal((await json(await call('PUT', `/admin/deals/${promo._id}`, owner, { section: 'best_deals' }))).status, 400, 'cannot change section');
    assert.equal((await json(await call('PUT', `/admin/deals/${hex(9999)}`, owner, { title: 'x' }))).status, 404);
  });

  it('toggles an individual promotion without touching its configuration', async () => {
    const promo = seedPromo();
    const off = await json(await call('PATCH', `/admin/deals/${promo._id}/active`, owner, { isActive: false }));
    assert.equal(off.status, 200);
    assert.equal(off.body.promotion.status, 'inactive');
    assert.equal(promos[0].discountValue, 20);
    assert.equal((await json(await call('PATCH', `/admin/deals/${promo._id}/active`, owner, { isActive: 'yes' }))).status, 400);
    await call('PATCH', `/admin/deals/${promo._id}/active`, owner, { isActive: true });
    assert.equal(promos[0].isActive, true);
  });

  it('deletes a promotion, and answers 404 for bad or missing ids', async () => {
    const promo = seedPromo();
    assert.equal((await call('DELETE', `/admin/deals/${promo._id}`, owner)).status, 200);
    assert.equal(promos.length, 0);
    assert.equal((await call('DELETE', `/admin/deals/${promo._id}`, owner)).status, 404);
    assert.equal((await call('DELETE', '/admin/deals/not-an-id', owner)).status, 404);
  });

  it('reorders within a section only', async () => {
    const a = seedPromo({ displayOrder: 0 });
    const b = seedPromo({ displayOrder: 1 });
    const other = seedPromo({ section: 'seasonal_deals', displayOrder: 7 });
    assert.equal((await call('PUT', '/admin/deals/reorder', owner, { section: 'best_deals', ids: [b._id, a._id, other._id] })).status, 200);
    assert.deepEqual([a.displayOrder, b.displayOrder, other.displayOrder], [1, 0, 7], 'the other section is never reordered');
    assert.equal((await call('PUT', '/admin/deals/reorder', owner, { section: 'best_deals', ids: [a._id, a._id] })).status, 400);
    assert.equal((await call('PUT', '/admin/deals/reorder', owner, { section: 'nope', ids: [a._id] })).status, 400);
  });

  it('lists promotions with per-section counts and without banner payloads', async () => {
    seedPromo({ bannerImage: 'data:image/png;base64,AAAA' });
    seedPromo({ startAt: new Date(Date.now() + HOUR), endAt: new Date(Date.now() + 2 * HOUR) });
    seedPromo({ startAt: new Date(Date.now() - 3 * HOUR), endAt: new Date(Date.now() - 2 * HOUR) });
    seedPromo({ isActive: false });
    seedPromo({ section: 'seasonal_deals' });
    const { body } = await json(await call('GET', '/admin/deals?section=best_deals', owner));
    assert.deepEqual(body.stats.best_deals, { total: 4, active: 1, scheduled: 1, expired: 1, inactive: 1 });
    assert.equal(body.promotions.length, 4);
    assert.ok(body.promotions.every((p) => !('bannerImage' in p)));
    assert.equal((await call('GET', '/admin/deals?section=bogus', owner)).status, 400);
  });
});

describe('admin: validation', () => {
  const rejects = async (extra, label) => assert.equal((await json(await call('POST', '/admin/deals', owner, newDeal(extra)))).status, 400, label);

  it('rejects invalid discounts', async () => {
    await rejects({ discountValue: 0 }, 'percentage 0');
    await rejects({ discountValue: 100.5 }, 'percentage over 100');
    await rejects({ discountValue: -5 }, 'negative');
    await rejects({ discountType: 'fixed', discountValue: 0 }, 'fixed 0');
    await rejects({ discountType: 'fixed', discountValue: 150 }, 'fixed above the product price');
    await rejects({ discountType: 'half' }, 'unknown discount type');
    await rejects({ discountValue: 'abc' }, 'not a number');
    await rejects({ discountType: undefined }, 'actual discount without a type');
    await rejects({ products: [], categories: [] }, 'discount with nothing to apply to');
    await rejects({ promotionType: 'display_only' }, 'display only must not carry a discount');
    assert.equal(promos.length, 0);
  });

  it('rejects invalid dates', async () => {
    await rejects({ startAt: iso(5), endAt: iso(2) }, 'end before start');
    const same = iso(5); // one timestamp: two separate Date.now() calls could differ by a millisecond
    await rejects({ startAt: same, endAt: same }, 'end equals start');
    await rejects({ startAt: iso(-10), endAt: iso(-5) }, 'already ended');
    await rejects({ startAt: 'tomorrow' }, 'unparseable');
    await rejects({ endAt: undefined }, 'missing');
  });

  it('rejects bad references and malformed fields', async () => {
    await rejects({ products: ['not-an-id'] }, 'bad ObjectId');
    await rejects({ products: [hex(8888)] }, 'unknown product');
    await rejects({ categories: ['Imaginary'] }, 'unknown category');
    await rejects({ title: 'x'.repeat(81) }, 'long title');
    await rejects({ badgeText: 'x'.repeat(31) }, 'long badge');
    await rejects({ section: 'daily' }, 'unknown section');
    await rejects({ promotionType: 'free' }, 'unknown type');
    await rejects({ bannerImage: 'javascript:alert(1)' }, 'unsafe banner');
    await rejects({ bannerImage: 'data:text/html;base64,AAAA' }, 'non-image data URL');
    await rejects({ displayOrder: -1 }, 'negative order');
  });

  it('stores categories under their database spelling and accepts a valid banner', async () => {
    const created = await json(await call('POST', '/admin/deals', owner, newDeal({ section: 'best_deals', products: [], categories: ['fruits'], bannerImage: 'data:image/png;base64,iVBORw0KGgo=' })));
    assert.equal(created.status, 201);
    assert.deepEqual(promos[0].categories, ['Fruits']);
  });
});

describe('admin: access control', () => {
  it('rejects anonymous users, customers and every staff account, even with all permissions', async () => {
    const promo = seedPromo();
    const routes = [['GET', '/admin/deals'], ['POST', '/admin/deals'], ['GET', `/admin/deals/${promo._id}`], ['PUT', `/admin/deals/${promo._id}`], ['DELETE', `/admin/deals/${promo._id}`], ['PATCH', `/admin/deals/${promo._id}/active`], ['PUT', '/admin/deals/reorder'], ['GET', `/admin/deals/${promo._id}/preview`], ['GET', '/admin/deals/settings'], ['PATCH', '/admin/deals/settings']];
    for (const [method, path] of routes) {
      assert.equal((await call(method, path, null, {})).status, 401, `anonymous ${method} ${path}`);
      assert.equal((await call(method, path, customer, {})).status, 403, `customer ${method} ${path}`);
      assert.equal((await call(method, path, staff, {})).status, 403, `staff ${method} ${path}`);
    }
    assert.equal(promos.length, 1, 'nothing was changed by rejected callers');
    assert.equal(settingsDoc.deals.bestDealsEnabled, true);
  });
});

describe('section switches', () => {
  it('saves each switch independently to the settings document', async () => {
    settingsDoc = {};
    const first = await json(await call('PATCH', '/admin/deals/settings', owner, { bestDealsEnabled: true }));
    assert.deepEqual(first.body.settings, { bestDealsEnabled: true, seasonalDealsEnabled: false });
    const second = await json(await call('PATCH', '/admin/deals/settings', owner, { seasonalDealsEnabled: true }));
    assert.deepEqual(second.body.settings, { bestDealsEnabled: true, seasonalDealsEnabled: true });
    const third = await json(await call('PATCH', '/admin/deals/settings', owner, { bestDealsEnabled: false }));
    assert.deepEqual(third.body.settings, { bestDealsEnabled: false, seasonalDealsEnabled: true });
    assert.deepEqual((await json(await call('GET', '/admin/deals/settings', owner))).body.settings, { bestDealsEnabled: false, seasonalDealsEnabled: true });
    for (const body of [{}, { bestDealsEnabled: 'yes' }, { other: true }]) assert.equal((await call('PATCH', '/admin/deals/settings', owner, body)).status, 400, JSON.stringify(body));
  });

  it('defaults to off when settings were never saved or cannot be read', async () => {
    settingsDoc = {};
    assert.deepEqual((await json(await call('GET', '/admin/deals/settings', owner))).body.settings, { bestDealsEnabled: false, seasonalDealsEnabled: false });
    Settings.findOne = () => { throw new Error('database down'); };
    assert.equal((await deals('best-deals')).body.enabled, false);
  });

  it('turning a section off keeps every promotion and turning it on brings them back', async () => {
    seedPromo();
    seedPromo({ title: 'Second' });
    assert.equal((await deals('best-deals')).body.promotions.length, 2);
    await call('PATCH', '/admin/deals/settings', owner, { bestDealsEnabled: false });
    assert.deepEqual((await deals('best-deals')).body, { enabled: false, promotions: [] });
    assert.equal(promos.length, 2, 'nothing deleted');
    assert.ok(promos.every((p) => p.discountValue === 20 && p.isActive));
    await call('PATCH', '/admin/deals/settings', owner, { bestDealsEnabled: true });
    assert.equal((await deals('best-deals')).body.promotions.length, 2);
  });
});

// ---------------------------------------------------------------- public API
describe('customer visibility', () => {
  it('shows live promotions of an enabled section, ordered by display order', async () => {
    seedPromo({ title: 'Second', displayOrder: 5 });
    seedPromo({ title: 'First', displayOrder: 1 });
    const { body } = await deals('best-deals');
    assert.equal(body.enabled, true);
    assert.deepEqual(body.promotions.map((p) => p.title), ['First', 'Second']);
  });

  it('hides Best Deals when it is switched off, without affecting Seasonal Deals', async () => {
    seedPromo();
    seedPromo({ section: 'seasonal_deals', title: 'Summer' });
    settingsDoc.deals.bestDealsEnabled = false;
    assert.deepEqual((await deals('best-deals')).body, { enabled: false, promotions: [] });
    assert.deepEqual((await deals('seasonal-deals')).body.promotions.map((p) => p.title), ['Summer']);
  });

  it('hides Seasonal Deals when it is switched off, without affecting Best Deals', async () => {
    seedPromo();
    seedPromo({ section: 'seasonal_deals', title: 'Summer' });
    settingsDoc.deals.seasonalDealsEnabled = false;
    assert.deepEqual((await deals('seasonal-deals')).body, { enabled: false, promotions: [] });
    assert.equal((await deals('best-deals')).body.promotions.length, 1);
  });

  it('serves each section only its own promotions', async () => {
    seedPromo({ title: 'Best one' });
    seedPromo({ section: 'seasonal_deals', title: 'Seasonal one' });
    assert.deepEqual((await deals('best-deals')).body.promotions.map((p) => p.title), ['Best one']);
    assert.deepEqual((await deals('seasonal-deals')).body.promotions.map((p) => p.title), ['Seasonal one']);
  });

  it('hides inactive, future and expired promotions', async () => {
    seedPromo({ title: 'Inactive', isActive: false });
    seedPromo({ title: 'Future', startAt: new Date(Date.now() + HOUR), endAt: new Date(Date.now() + 2 * HOUR) });
    seedPromo({ title: 'Expired', startAt: new Date(Date.now() - 3 * HOUR), endAt: new Date(Date.now() - HOUR) });
    seedPromo({ title: 'Live' });
    assert.deepEqual((await deals('best-deals')).body.promotions.map((p) => p.title), ['Live']);
  });

  it('exposes nothing admin-only and no supplier data', async () => {
    seedPromo({ bannerImage: 'data:image/png;base64,iVBORw0KGgo=' });
    const { body } = await deals('best-deals');
    const text = JSON.stringify(body);
    for (const forbidden of ['createdBy', 'updatedBy', 'isActive', 'startAt', 'displayOrder', 'vendors', 'Secret Supplier', 'purchasePrice']) assert.ok(!text.includes(forbidden), forbidden);
    assert.equal(body.promotions[0].bannerImage, 'data:image/png;base64,iVBORw0KGgo=');
  });

  it('skips a promotion whose products were all deleted and survives a missing one', async () => {
    seedPromo({ title: 'Orphan', products: [hex(4444)] });
    seedPromo({ title: 'Mixed', products: [hex(4444), MANGO] });
    const { body } = await deals('best-deals');
    assert.deepEqual(body.promotions.map((p) => p.title), ['Mixed']);
    assert.deepEqual(body.promotions[0].products.map((p) => p._id), [MANGO]);
  });

  it('fills a category promotion from that category, and shows a banner-only display promotion', async () => {
    seedPromo({ title: 'Veg week', products: [], categories: ['Vegetables'] });
    seedPromo({ title: 'Banner only', promotionType: 'display_only', discountType: null, discountValue: null, products: [], categories: [] });
    const { body } = await deals('best-deals');
    assert.deepEqual(body.promotions.map((p) => [p.title, p.products.length]), [['Veg week', 1], ['Banner only', 0]]);
    assert.equal(body.promotions[0].products[0].name, 'Tomato');
  });

  it('shows the discount on actual-discount cards and no false prices on display-only cards', async () => {
    seedPromo({ title: 'Real', discountType: 'percentage', discountValue: 20 });
    seedPromo({ title: 'Showcase', promotionType: 'display_only', discountType: null, discountValue: null, products: [TOMATO] });
    const { body } = await deals('best-deals');
    const real = body.promotions.find((p) => p.title === 'Real');
    const showcase = body.promotions.find((p) => p.title === 'Showcase');
    assert.deepEqual(real.discount, { type: 'percentage', value: 20 });
    assert.equal(real.products[0].price, 100);
    assert.equal(real.products[0].offer.finalPrice, 80);
    assert.equal(showcase.discount, null);
    assert.equal(showcase.products[0].offer, null);
    assert.equal(showcase.products[0].price, 40);
  });
});

// ---------------------------------------------------------------- preview
describe('admin preview', () => {
  it('shows original, discount and final price whatever the status, and whether customers can see it', async () => {
    const promo = seedPromo({ isActive: false, discountType: 'fixed', discountValue: 15 });
    const { body } = await json(await call('GET', `/admin/deals/${promo._id}/preview`, owner));
    assert.deepEqual(body.pricing[0], { productId: MANGO, name: 'Mango', originalPrice: 100, discountPerUnit: 15, finalPrice: 85, discountPercent: 15, applied: true });
    assert.equal(body.status, 'inactive');
    assert.equal(body.visibleToCustomers, false);
    assert.equal((await json(await call('GET', `/admin/deals/${seedPromo()._id}/preview`, owner))).body.visibleToCustomers, true);
    settingsDoc.deals.bestDealsEnabled = false;
    assert.equal((await json(await call('GET', `/admin/deals/${promos.at(-1)._id}/preview`, owner))).body.visibleToCustomers, false);
  });

  it('reports that a fixed discount larger than a product price is not applied to it', async () => {
    const promo = seedPromo({ discountType: 'fixed', discountValue: 60, products: [MANGO, TOMATO] });
    const { body } = await json(await call('GET', `/admin/deals/${promo._id}/preview`, owner));
    assert.deepEqual(body.pricing.map((line) => [line.name, line.applied, line.finalPrice]), [['Mango', true, 40], ['Tomato', false, 40]]);
  });
});

// ---------------------------------------------------------------- product listings, cart and checkout
describe('promotional prices in listings and the cart', () => {
  it('leaves stored prices untouched and adds the offer', async () => {
    seedPromo();
    const list = await json(await call('GET', '/products'));
    const mango = list.body.products.find((p) => p._id === MANGO);
    assert.equal(mango.price, 100);
    assert.equal(mango.offer.finalPrice, 80);
    assert.equal(list.body.products.find((p) => p._id === TOMATO).offer, null);
    assert.equal((await json(await call('GET', `/products/${MANGO}`))).body.product.offer.finalPrice, 80);
    assert.equal(products[0].price, 100, 'the database price was never modified');
  });

  it('does not expose supplier data to customers', async () => {
    seedPromo();
    const text = JSON.stringify((await json(await call('GET', '/products'))).body);
    assert.ok(!text.includes('Secret Supplier'));
  });

  it('display-only promotions never change a product price', async () => {
    seedPromo({ promotionType: 'display_only', discountType: null, discountValue: null });
    const mango = (await json(await call('GET', '/products'))).body.products.find((p) => p._id === MANGO);
    assert.equal(mango.offer, null);
    assert.equal(mango.price, 100);
  });

  it('applies no discount from a disabled section, an inactive, future or expired promotion', async () => {
    const offerNow = async () => (await json(await call('GET', `/products/${MANGO}`))).body.product.offer;
    const live = seedPromo();
    assert.ok(await offerNow());
    settingsDoc.deals.bestDealsEnabled = false;
    assert.equal(await offerNow(), null, 'section off');
    settingsDoc.deals.bestDealsEnabled = true;
    live.isActive = false;
    assert.equal(await offerNow(), null, 'inactive');
    live.isActive = true; live.startAt = new Date(Date.now() + HOUR); live.endAt = new Date(Date.now() + 2 * HOUR);
    assert.equal(await offerNow(), null, 'future');
    live.startAt = new Date(Date.now() - 3 * HOUR); live.endAt = new Date(Date.now() - HOUR);
    assert.equal(await offerNow(), null, 'expired');
  });

  it('does not stack discounts across sections', async () => {
    seedPromo({ discountValue: 10 });
    seedPromo({ section: 'seasonal_deals', discountValue: 30 });
    const offer = (await json(await call('GET', `/products/${MANGO}`))).body.product.offer;
    assert.equal(offer.finalPrice, 70);
    assert.equal(offer.discountPercent, 30);
  });

  it('prices the cart on the server and recalculates when a promotion has expired', async () => {
    const promo = seedPromo();
    const populated = () => ({ items: [{ product: { ...products[0], vendors: undefined }, quantity: 3 }], toJSON() { return { items: this.items }; } });
    Cart.findOne = () => ({ populate: async () => populated() });
    const first = (await json(await call('GET', '/cart', customer))).body.cart;
    assert.deepEqual(first.pricing, { originalSubtotal: 300, discountTotal: 60, subtotal: 240 });
    assert.equal(first.items[0].unitPrice, 80);
    assert.equal(first.items[0].lineTotal, 240);
    promo.endAt = new Date(Date.now() - 1000);
    const later = (await json(await call('GET', '/cart', customer))).body.cart;
    assert.deepEqual(later.pricing, { originalSubtotal: 300, discountTotal: 0, subtotal: 300 }, 'an old open cart gets the current price');
    assert.equal(later.items[0].offer, null);
  });
});

describe('checkout and order snapshots', () => {
  it('charges backend-calculated prices and ignores any price the browser sends', async () => {
    seedPromo();
    const { status, body } = await json(await call('POST', '/orders', customer, orderBody({
      items: [{ productId: MANGO, quantity: 2, price: 1, unitPrice: 1, finalPrice: 1, discount: 99 }], totalAmount: 1, subtotal: 1, discountTotal: 999, price: 1,
    })));
    assert.equal(status, 201);
    const [item] = body.order.items;
    assert.equal(item.price, 80, 'final unit price is calculated from the database');
    assert.equal(body.order.totalAmount, 185, '2 x 80 = 160, plus the existing 25 delivery fee below 500');
  });

  it('stores an immutable pricing snapshot for every line', async () => {
    seedPromo({ title: 'Mango Season', section: 'seasonal_deals' });
    const { body } = await json(await call('POST', '/orders', customer, orderBody({ items: [{ productId: MANGO, quantity: 3 }, { productId: TOMATO, quantity: 1 }] })));
    const [mango, tomato] = body.order.items;
    assert.deepEqual({ price: mango.price, originalPrice: mango.originalPrice, discountPerUnit: mango.discountPerUnit, discountTotal: mango.discountTotal, lineTotal: mango.lineTotal, quantity: mango.quantity, name: mango.name }, { price: 80, originalPrice: 100, discountPerUnit: 20, discountTotal: 60, lineTotal: 240, quantity: 3, name: 'Mango' });
    assert.equal(mango.promotion.title, 'Mango Season');
    assert.equal(mango.promotion.section, 'seasonal_deals');
    assert.ok(mango.promotion.id);
    assert.deepEqual({ price: tomato.price, originalPrice: tomato.originalPrice, discountPerUnit: tomato.discountPerUnit, discountTotal: tomato.discountTotal, lineTotal: tomato.lineTotal }, { price: 40, originalPrice: 40, discountPerUnit: 0, discountTotal: 0, lineTotal: 40 });
    assert.equal(tomato.promotion, undefined);
    assert.equal(body.order.totalAmount, 240 + 40 + 25);
  });

  it('keeps an order unchanged when the promotion is edited or deleted afterwards', async () => {
    const promo = seedPromo({ title: 'Original title' });
    const { body } = await json(await call('POST', '/orders', customer, orderBody()));
    const stored = JSON.parse(JSON.stringify(orders[0].items));
    await call('PUT', `/admin/deals/${promo._id}`, owner, { title: 'Renamed', discountValue: 50 });
    await call('DELETE', `/admin/deals/${promo._id}`, owner);
    products[0].price = 500;
    assert.deepEqual(JSON.parse(JSON.stringify(orders[0].items)), stored, 'the saved order is not a view over live data');
    assert.equal(orders[0].items[0].promotion.title, 'Original title');
    assert.equal(orders[0].items[0].price, 80);
    assert.equal(body.order.totalAmount, orders[0].totalAmount);
  });

  it('does not reduce stock differently because of a promotion', async () => {
    seedPromo({ discountValue: 90 });
    await call('POST', '/orders', customer, orderBody({ items: [{ productId: MANGO, quantity: 4 }] }));
    assert.deepEqual(stockLog, [[MANGO, -4]]);
    assert.equal((await json(await call('POST', '/orders', customer, orderBody({ items: [{ productId: RICE, quantity: 6 }] })))).status, 409, 'stock is still checked at the full quantity');
  });

  it('applies delivery fee and minimum rules to the discounted payable subtotal', async () => {
    seedPromo({ discountValue: 20 });
    const free = await json(await call('POST', '/orders', customer, orderBody({ items: [{ productId: MANGO, quantity: 7 }] })));
    assert.equal(free.body.order.totalAmount, 560, '7 x 80 = 560 is above the 500 free-delivery level: no fee');
    const fee = await json(await call('POST', '/orders', customer, orderBody({ items: [{ productId: MANGO, quantity: 6 }] })));
    assert.equal(fee.body.order.totalAmount, 480 + 25, '6 x 100 = 600 before the discount, but 480 after it, so the fee applies');
  });

  it('does not discount when the section is off or the promotion expired, even with an old cart', async () => {
    const promo = seedPromo();
    settingsDoc.deals.bestDealsEnabled = false;
    const off = await json(await call('POST', '/orders', customer, orderBody()));
    assert.equal(off.body.order.items[0].price, 100);
    assert.equal(off.body.order.items[0].promotion, undefined);
    settingsDoc.deals.bestDealsEnabled = true;
    promo.endAt = new Date(Date.now() - 1000);
    assert.equal((await json(await call('POST', '/orders', customer, orderBody()))).body.order.items[0].price, 100);
  });

  it('refuses to charge a different price than the one the customer last saw', async () => {
    const promo = seedPromo();
    promo.endAt = new Date(Date.now() - 1000);
    const stale = await json(await call('POST', '/orders', customer, orderBody({ expectedSubtotal: 160 })));
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'PRICE_CHANGED');
    assert.equal(stale.body.pricing.subtotal, 200);
    assert.equal(orders.length, 0, 'no order was created');
    assert.deepEqual(stockLog, [], 'no stock was reserved');
    const fresh = await json(await call('POST', '/orders', customer, orderBody({ expectedSubtotal: 200 })));
    assert.equal(fresh.status, 201);
  });

  it('applies the same pricing to pre-orders', async () => {
    seedPromo();
    products[0].preOrderAvailable = true;
    const { status, body } = await json(await call('POST', '/preorders', customer, orderBody()));
    assert.equal(status, 201);
    assert.equal(body.order.orderType, 'preorder');
    assert.equal(body.order.items[0].price, 80);
    assert.equal(body.order.items[0].originalPrice, 100);
    assert.deepEqual(stockLog, [], 'pre-orders still reserve no stock');
  });

  it('still works for orders placed before promotions existed', async () => {
    const legacy = { _id: hex(77), user: { id: customer.id, _id: customer.id }, orderType: 'normal', orderStatus: 'delivered', totalAmount: 125, items: [{ product: MANGO, name: 'Mango', price: 50, unit: 'kg', quantity: 2 }] };
    Order.findById = () => ({ populate: async () => legacy });
    const { status, body } = await json(await call('GET', `/orders/${hex(77)}`, customer));
    assert.equal(status, 200);
    assert.deepEqual(body.order.items[0], legacy.items[0]);
    assert.equal(body.order.items[0].originalPrice, undefined, 'no snapshot fields are invented for old orders');
  });
});

// ---------------------------------------------------------------- code-review follow-ups
const names = (response) => response.body.products.map((product) => product.name);
const shownPrice = (product) => (product.offer ? product.offer.finalPrice : product.price);

describe('price sorting and price filters use the displayed (offer) price', () => {
  beforeEach(() => { seedPromo({ discountValue: 20 }); }); // Mango 100 -> 80

  it('sorts low to high and high to low by the effective price', async () => {
    const asc = await json(await call('GET', '/products?sort=priceAsc'));
    assert.deepEqual(names(asc), ['Tomato', 'Mango', 'Rice'], 'Mango (80 after the offer) sorts before Rice (99.99), although its stored price is higher');
    const desc = await json(await call('GET', '/products?sort=priceDesc'));
    assert.deepEqual(names(desc), ['Rice', 'Mango', 'Tomato']);
    assert.deepEqual(asc.body.products.map(shownPrice), [40, 80, 99.99]);
  });

  it('keeps the original stored-price order when no live discount exists', async () => {
    promos.length = 0;
    assert.deepEqual(names(await json(await call('GET', '/products?sort=priceAsc'))), ['Tomato', 'Rice', 'Mango']);
    settingsDoc.deals.bestDealsEnabled = false;
    seedPromo({ discountValue: 20 });
    assert.deepEqual(names(await json(await call('GET', '/products?sort=priceAsc'))), ['Tomato', 'Rice', 'Mango'], 'a disabled section does not reorder prices');
  });

  it('filters by the effective price, for min and max', async () => {
    const underNinety = await json(await call('GET', '/products?maxPrice=90'));
    assert.deepEqual(names(underNinety).sort(), ['Mango', 'Tomato'], 'Mango is 80 to the customer, so it is under 90');
    const band = await json(await call('GET', '/products?minPrice=85&maxPrice=100'));
    assert.deepEqual(names(band), ['Rice'], 'Mango is no longer in an 85-100 band: it costs 80');
    for (const response of [underNinety, band]) assert.ok(response.body.products.every((product) => shownPrice(product) <= 100));
    assert.equal(underNinety.body.total, 2);
  });

  it('keeps the same filter behaviour without a discount', async () => {
    promos.length = 0;
    assert.deepEqual(names(await json(await call('GET', '/products?maxPrice=90'))), ['Tomato']);
    assert.deepEqual(names(await json(await call('GET', '/products?minPrice=85&maxPrice=100'))).sort(), ['Mango', 'Rice']);
  });

  it('paginates the sorted results and reports the right total', async () => {
    const first = await json(await call('GET', '/products?sort=priceAsc&limit=2&page=1'));
    const second = await json(await call('GET', '/products?sort=priceAsc&limit=2&page=2'));
    assert.deepEqual(names(first), ['Tomato', 'Mango']);
    assert.deepEqual(names(second), ['Rice']);
    assert.equal(first.body.total, 3);
    assert.equal(first.body.pages, 2);
  });

  it('applies a price filter together with another sort order and still strips supplier data', async () => {
    const response = await json(await call('GET', '/products?maxPrice=90&sort=featured'));
    assert.deepEqual(names(response).sort(), ['Mango', 'Tomato']);
    assert.ok(!JSON.stringify(response.body).includes('Secret Supplier'));
  });
});

describe('fixed discounts on a category are calculated per product', () => {
  const addFruit = (id, name, price) => products.push({ _id: hex(id), id: hex(id), name, category: 'Fruits', price, unit: 'kg', images: [], stock: 10, vendors: [] });

  it('subtracts the same amount from each price and skips products it would push below zero', async () => {
    addFruit(210, 'Apple', 30);
    addFruit(211, 'Kiwi', 55);
    seedPromo({ products: [], categories: ['Fruits'], discountType: 'fixed', discountValue: 50 });
    const list = (await json(await call('GET', '/products'))).body.products;
    const by = (name) => list.find((product) => product.name === name);
    assert.equal(by('Mango').offer.finalPrice, 50);
    assert.equal(by('Kiwi').offer.finalPrice, 5);
    assert.equal(by('Apple').offer, null, 'a 50 rupee discount cannot apply to a 30 rupee product');
    assert.equal(by('Apple').price, 30);
    assert.equal(by('Tomato').offer, null, 'other categories are untouched');
  });

  it('charges the per-product result at checkout', async () => {
    addFruit(210, 'Apple', 30);
    seedPromo({ products: [], categories: ['Fruits'], discountType: 'fixed', discountValue: 20 });
    const { body } = await json(await call('POST', '/orders', customer, orderBody({ items: [{ productId: MANGO, quantity: 1 }, { productId: hex(210), quantity: 2 }] })));
    const [mango, apple] = body.order.items;
    assert.deepEqual([mango.price, mango.discountPerUnit, mango.lineTotal], [80, 20, 80]);
    assert.deepEqual([apple.price, apple.discountPerUnit, apple.lineTotal], [10, 20, 20]);
    assert.equal(body.order.totalAmount, 100 + 25);
  });

  it('a larger fixed discount than every product price applies to none and breaks nothing', async () => {
    seedPromo({ products: [], categories: ['Groceries'], discountType: 'fixed', discountValue: 500 });
    const rice = (await json(await call('GET', `/products/${RICE}`))).body.product;
    assert.equal(rice.offer, null);
    assert.equal((await json(await call('POST', '/orders', customer, orderBody({ items: [{ productId: RICE, quantity: 1 }] })))).body.order.items[0].price, 99.99);
  });
});

describe('display-only promotions never touch the cart or checkout', () => {
  beforeEach(() => { seedPromo({ promotionType: 'display_only', discountType: null, discountValue: null, products: [MANGO], categories: ['Fruits'] }); });

  it('leaves cart totals at the stored prices', async () => {
    Cart.findOne = () => ({ populate: async () => ({ items: [{ product: { ...products[0], vendors: undefined }, quantity: 3 }], toJSON() { return { items: this.items }; } }) });
    const cart = (await json(await call('GET', '/cart', customer))).body.cart;
    assert.deepEqual(cart.pricing, { originalSubtotal: 300, discountTotal: 0, subtotal: 300 });
    assert.equal(cart.items[0].offer, null);
    assert.equal(cart.items[0].unitPrice, 100);
  });

  it('orders and pre-orders are charged the stored price with no promotion recorded', async () => {
    products[0].preOrderAvailable = true;
    for (const path of ['/orders', '/preorders']) {
      const item = (await json(await call('POST', path, customer, orderBody()))).body.order.items[0];
      assert.deepEqual([item.price, item.originalPrice, item.discountPerUnit, item.discountTotal], [100, 100, 0, 0], path);
      assert.equal(item.promotion, undefined, path);
    }
  });
});

describe('a disabled section stops discounts in pre-orders as well', () => {
  it('prices a pre-order at the stored price when its section is off, and with the offer when it is on', async () => {
    seedPromo();
    products[0].preOrderAvailable = true;
    settingsDoc.deals.bestDealsEnabled = false;
    const off = (await json(await call('POST', '/preorders', customer, orderBody()))).body.order.items[0];
    assert.deepEqual([off.price, off.promotion], [100, undefined]);
    settingsDoc.deals.bestDealsEnabled = true;
    assert.equal((await json(await call('POST', '/preorders', customer, orderBody()))).body.order.items[0].price, 80);
  });

  it('only switches off the discounts of its own section', async () => {
    seedPromo({ section: 'best_deals', products: [MANGO] });
    seedPromo({ section: 'seasonal_deals', products: [TOMATO], discountValue: 50 });
    settingsDoc.deals.bestDealsEnabled = false;
    const list = (await json(await call('GET', '/products'))).body.products;
    assert.equal(list.find((p) => p.name === 'Mango').offer, null);
    assert.equal(list.find((p) => p.name === 'Tomato').offer.finalPrice, 20);
  });
});

describe('out-of-stock products', () => {
  it('are still listed, with their stock, and an offer does not make them orderable', async () => {
    products[0].stock = 0;
    seedPromo();
    const listed = (await json(await call('GET', `/products/${MANGO}`))).body.product;
    assert.equal(listed.stock, 0);
    assert.equal(listed.offer.finalPrice, 80, 'the price is still shown consistently');
    const refused = await json(await call('POST', '/orders', customer, orderBody({ items: [{ productId: MANGO, quantity: 1 }] })));
    assert.equal(refused.status, 409);
    assert.equal(orders.length, 0);
    assert.deepEqual(stockLog, []);
  });

  it('block the whole order when one line is out of stock, reserving nothing', async () => {
    products[1].stock = 0;
    seedPromo({ products: [MANGO, TOMATO] });
    const refused = await json(await call('POST', '/orders', customer, orderBody({ items: [{ productId: MANGO, quantity: 1 }, { productId: TOMATO, quantity: 1 }] })));
    assert.equal(refused.status, 409);
    assert.equal(orders.length, 0);
    assert.deepEqual(stockLog, []);
  });

  it('are shown in a deal card exactly as in the shop (same fields)', async () => {
    products[0].stock = 0;
    seedPromo();
    const card = (await deals('best-deals')).body.promotions[0].products[0];
    const shop = (await json(await call('GET', `/products/${MANGO}`))).body.product;
    assert.equal(card.stock, 0);
    assert.deepEqual([card.stock, card.price, card.offer], [shop.stock, shop.price, shop.offer]);
  });
});

describe('public endpoints are read-only and limited to the two sections', () => {
  it('refuses writes and unknown sections', async () => {
    seedPromo();
    for (const [method, path] of [['POST', '/promotions/best-deals'], ['PUT', '/promotions/best-deals'], ['DELETE', '/promotions/best-deals'], ['GET', '/promotions/everything'], ['GET', '/promotions']]) {
      assert.equal((await call(method, path, owner, {})).status, 404, `${method} ${path}`);
    }
    assert.equal(promos.length, 1);
  });

  it('does not treat a promotion that ends exactly now as live', async () => {
    seedPromo({ startAt: new Date(Date.now() - HOUR), endAt: new Date(Date.now() - 1) });
    assert.deepEqual((await deals('best-deals')).body.promotions, []);
    assert.equal((await json(await call('GET', `/products/${MANGO}`))).body.product.offer, null);
  });
});

describe('section switches are written to MongoDB in a safe shape', () => {
  // Runs the real Mongoose update casting (no database): the collection call is intercepted, so this shows the
  // exact document that would be sent to MongoDB.
  async function sentUpdate(body) {
    Settings.findOneAndUpdate = originals.sfu;
    const sent = [];
    const saved = {};
    for (const name of ['findOneAndUpdate', 'updateOne']) {
      saved[name] = Settings.collection[name];
      Settings.collection[name] = (...args) => { sent.push(JSON.parse(JSON.stringify(args[1]))); return Promise.resolve({ value: {}, ok: 1, lastErrorObject: {} }); };
    }
    try { await call('PATCH', '/admin/deals/settings', owner, body); } finally { Object.assign(Settings.collection, saved); }
    return sent[0];
  }

  it('sets only the switch that was sent, on the single settings document', async () => {
    const update = await sentUpdate({ seasonalDealsEnabled: false });
    assert.equal(update.$set['deals.seasonalDealsEnabled'], false);
    assert.equal(update.$set.updatedBy, owner._id);
    assert.ok(!('deals.bestDealsEnabled' in update.$set), 'the other switch is not touched');
    assert.deepEqual(Object.keys(update.$set).filter((key) => key.startsWith('deals')), ['deals.seasonalDealsEnabled']);
  });

  it('does not collide with the insert-time defaults when the document is created', async () => {
    const update = await sentUpdate({ bestDealsEnabled: true });
    const onInsert = Object.keys(update.$setOnInsert || {});
    assert.ok(onInsert.length > 0, 'defaults are applied for a brand-new document');
    assert.ok(onInsert.every((key) => key !== 'deals' && !key.startsWith('deals.')), 'no $set / $setOnInsert path conflict on "deals"');
  });
});

describe('there is only one promotions implementation on the backend', () => {
  const backendDir = fileURLToPath(new URL('../', import.meta.url));
  const skip = new Set(['node_modules', 'test', 'scripts']);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (skip.has(entry.name) ? [] : entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]));
  const sources = walk(backendDir).filter((file) => file.endsWith('.js')).map((file) => ({ file: file.slice(backendDir.length), text: readFileSync(file, 'utf8') }));
  const filesWith = (pattern) => sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file).sort();

  it('only the promotions engine, validation, placements and controller touch the Promotion model', () => {
    assert.deepEqual(filesWith(/from '[^']*models\/Promotion\.js'/), ['controllers/dealsController.js', 'utils/dealPlacements.js', 'utils/promotionPricing.js', 'utils/promotionValidation.js']);
  });

  it('there is one public mount and one admin mount for deals, and no other deal-like model', () => {
    assert.deepEqual(filesWith(/['"]\/api\/promotions['"]/), ['server.js']);
    assert.deepEqual(filesWith(/['"]\/deals['"]/), ['routes/adminRoutes.js']);
    assert.deepEqual(filesWith(/mongoose\.model\(['"][A-Za-z]*(Deal|Offer|Promo|Campaign|Season)/i), ['models/Promotion.js']);
  });

  it('section visibility has a single source of truth in Settings.deals', () => {
    assert.deepEqual(filesWith(/bestDealsEnabled/), ['controllers/dealsController.js', 'models/Settings.js', 'utils/promotionPricing.js']);
  });

  it('price calculation for promotions lives only in the pricing engine', () => {
    assert.deepEqual(filesWith(/function computeDiscount/), ['utils/promotionPricing.js']);
    for (const { file, text } of sources) {
      if (file === 'utils/promotionPricing.js') continue;
      assert.ok(!/discountValue\s*\/\s*100|price\s*\*\s*\(1\s*-/.test(text), `${file} must not compute promotional prices itself`);
    }
  });
});


// ---------------------------------------------------------------- promotional placement (Product Edit <-> Deals Management)
describe('promotional placement and product selection', () => {
  const window = () => ({ startAt: iso(-1), endAt: iso(48) });
  const make = async (section, extra = {}) => {
    const created = await json(await call('POST', '/admin/deals', owner, { title: `${section} promo`, section, promotionType: 'display_only', ...window(), ...(section === 'seasonal_deals' ? { products: [MANGO, TOMATO, RICE] } : {}), ...extra }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body.promotion._id;
  };
  const pickerIds = async (query, user = owner) => (await json(await call('GET', `/admin/deals/products?${query}`, user))).body.products.map((product) => product._id);
  const unmark = () => { for (const product of products) product.dealPlacements = { bestDeals: false, seasonalDeals: false }; };

  it('saves a placement from Product Edit and writes only the flag that was sent', async () => {
    unmark();
    const first = await json(await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: { bestDeals: true } }));
    assert.equal(first.status, 200);
    assert.deepEqual(products[0].dealPlacements, { bestDeals: true, seasonalDeals: false });
    await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: { seasonalDeals: true } });
    assert.deepEqual(products[0].dealPlacements, { bestDeals: true, seasonalDeals: true }, 'a product can belong to both sections');
    assert.equal(products[0].price, 100, 'unrelated fields are untouched');
  });

  it('does not create a promotion, discount or switch change when a placement is saved', async () => {
    unmark();
    settingsDoc = { deals: { bestDealsEnabled: false, seasonalDealsEnabled: false } };
    await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: { bestDeals: true, seasonalDeals: true } });
    assert.equal(promos.length, 0);
    assert.deepEqual(settingsDoc.deals, { bestDealsEnabled: false, seasonalDealsEnabled: false });
    const listed = await json(await call('GET', `/products/${MANGO}`, null));
    assert.equal(listed.body.product.offer, null);
    assert.equal(listed.body.product.price, 100);
  });

  it('rejects malformed placements and non-owners', async () => {
    assert.equal((await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: { bestDeals: 'yes' } })).status, 400);
    assert.equal((await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: { homepage: true } })).status, 400);
    assert.equal((await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: {} })).status, 400);
    assert.equal((await call('PUT', `/products/${MANGO}`, staff, { dealPlacements: { bestDeals: true } })).status, 403);
  });

  it('a new product can be created with a placement, and an unmarked create stores none', async () => {
    const original = Product.create;
    const seen = [];
    Product.create = async (payload) => { seen.push(payload); return { ...payload, _id: hex(300) }; };
    try {
      assert.equal((await call('POST', '/products', owner, { name: 'Pear', category: 'Fruits', description: 'd', price: 10, unit: 'kg', dealPlacements: { seasonalDeals: true } })).status, 201);
      assert.equal((await call('POST', '/products', owner, { name: 'Plum', category: 'Fruits', description: 'd', price: 10, unit: 'kg' })).status, 201);
    } finally { Product.create = original; }
    assert.deepEqual(seen[0].dealPlacements, { seasonalDeals: true });
    assert.equal('dealPlacements' in seen[1], false);
  });

  it('the Add Products picker lists only products marked for that section, with the details needed', async () => {
    unmark();
    products[0].dealPlacements = { bestDeals: true, seasonalDeals: false };
    products[1].dealPlacements = { bestDeals: false, seasonalDeals: true };
    assert.deepEqual(await pickerIds('section=best_deals'), [MANGO]);
    assert.deepEqual(await pickerIds('section=seasonal_deals'), [TOMATO]);
    const all = await json(await call('GET', '/admin/deals/products?section=best_deals&scope=all', owner));
    assert.equal(all.body.products.length, 3);
    const row = all.body.products.find((product) => product._id === MANGO);
    assert.deepEqual(Object.keys(row).sort(), ['_id', 'category', 'image', 'included', 'marked', 'markedBestDeals', 'markedSeasonalDeals', 'name', 'price', 'stock', 'unit']);
    assert.equal(JSON.stringify(all.body).includes('Secret Supplier'), false, 'supplier data never leaves');
  });

  it('the picker searches by name, filters by category and flags products already in the promotion', async () => {
    const id = await make('best_deals', { products: [MANGO] });
    assert.deepEqual(await pickerIds('section=best_deals&q=tom'), [TOMATO]);
    assert.deepEqual(await pickerIds('section=best_deals&category=Groceries'), [RICE]);
    assert.deepEqual(await pickerIds('section=best_deals&q=.*'), [], 'search text is not treated as a pattern');
    const rows = (await json(await call('GET', `/admin/deals/products?section=best_deals&promotionId=${id}`, owner))).body.products;
    assert.deepEqual(rows.filter((row) => row.included).map((row) => row._id), [MANGO]);
    assert.deepEqual(await pickerIds(`section=best_deals&promotionId=${id}&scope=included`), [MANGO]);
  });

  it('the picker is owner-only and validates its inputs', async () => {
    assert.equal((await call('GET', '/admin/deals/products?section=best_deals', staff)).status, 403);
    assert.equal((await call('GET', '/admin/deals/products?section=best_deals', null)).status, 401);
    assert.equal((await call('GET', '/admin/deals/products?section=nope', owner)).status, 400);
    assert.equal((await call('GET', '/admin/deals/products?section=best_deals&scope=weird', owner)).status, 400);
    assert.equal((await call('GET', '/admin/deals/products?section=best_deals&promotionId=zzz', owner)).status, 404);
    const seasonal = await make('seasonal_deals');
    assert.equal((await call('GET', `/admin/deals/products?section=best_deals&promotionId=${seasonal}`, owner)).status, 404, 'a promotion of the other section');
  });

  it('adds several products at once, without duplicates, and only changes the product list', async () => {
    const id = await make('best_deals', { title: 'Keep me', badgeText: 'Hot', products: [MANGO] });
    const result = await json(await call('POST', `/admin/deals/${id}/products`, owner, { add: [MANGO, TOMATO, RICE, TOMATO] }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body.promotion.products, [MANGO, TOMATO, RICE]);
    assert.equal(result.body.added, 2);
    const stored = promos.find((promo) => promo._id === id);
    assert.equal(stored.title, 'Keep me');
    assert.equal(stored.badgeText, 'Hot');
    assert.equal(stored.promotionType, 'display_only');
    assert.equal(products.length, 3, 'no Product document is created');
  });

  it('refuses products that are not marked for the section, or do not exist', async () => {
    const id = await make('seasonal_deals');
    products.push({ _id: hex(203), id: hex(203), name: 'Plum', category: 'Fruits', price: 30, unit: 'kg', images: [], stock: 5, vendors: [], dealPlacements: { bestDeals: true, seasonalDeals: false } });
    const unmarked = await json(await call('POST', `/admin/deals/${id}/products`, owner, { add: [hex(203)] }));
    assert.equal(unmarked.status, 400);
    assert.match(unmarked.body.message, /not marked for Seasonal Deals/);
    assert.equal((await call('POST', `/admin/deals/${id}/products`, owner, { add: [hex(999)] })).status, 400);
    assert.equal((await call('POST', `/admin/deals/${id}/products`, owner, { add: ['nope'] })).status, 400);
    assert.equal((await call('POST', `/admin/deals/${id}/products`, owner, {})).status, 400);
    assert.equal((await call('POST', `/admin/deals/${id}/products`, owner, { add: [MANGO], price: 1 })).status, 400);
    assert.equal((await call('POST', `/admin/deals/${id}/products`, staff, { add: [MANGO] })).status, 403);
    assert.deepEqual(promos[0].products, [MANGO, TOMATO, RICE]);
  });

  it('creating or editing a promotion through the form enforces the same eligibility', async () => {
    products[1].dealPlacements = { bestDeals: true, seasonalDeals: false };
    const refused = await json(await call('POST', '/admin/deals', owner, { title: 'S', section: 'seasonal_deals', promotionType: 'display_only', ...window(), products: [TOMATO] }));
    assert.equal(refused.status, 400);
    const id = await make('best_deals', { products: [TOMATO] });
    products[1].dealPlacements = { bestDeals: false, seasonalDeals: false };
    const resaved = await json(await call('PUT', `/admin/deals/${id}`, owner, { title: 'Renamed' }));
    assert.equal(resaved.status, 200, 'a product already in the promotion (added before placements, or unmarked since) never blocks saving it');
  });

  it('removes products from a promotion without touching the Product or other promotions', async () => {
    const best = await make('best_deals', { products: [MANGO, TOMATO] });
    const seasonal = await make('seasonal_deals');
    const removed = await json(await call('POST', `/admin/deals/${best}/products`, owner, { remove: [MANGO] }));
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.promotion.products, [TOMATO]);
    assert.deepEqual(promos.find((promo) => promo._id === seasonal).products, [MANGO, TOMATO, RICE]);
    assert.ok(products.find((product) => product._id === MANGO));
  });

  it('an Actual Discount cannot be left with no products, and a fixed discount larger than a price is refused', async () => {
    const id = await make('best_deals', { promotionType: 'actual_discount', discountType: 'percentage', discountValue: 10, products: [MANGO] });
    const last = await json(await call('POST', `/admin/deals/${id}/products`, owner, { remove: [MANGO] }));
    assert.equal(last.status, 400);
    assert.deepEqual(promos[0].products, [MANGO]);
    const fixed = await make('best_deals', { promotionType: 'actual_discount', discountType: 'fixed', discountValue: 50, products: [MANGO] });
    const tooCheap = await json(await call('POST', `/admin/deals/${fixed}/products`, owner, { add: [TOMATO] }));
    assert.equal(tooCheap.status, 400);
    assert.match(tooCheap.body.message, /more than the price of Tomato/);
  });

  it('unmarking a product that is in a promotion asks first and changes nothing until confirmed', async () => {
    const best = await make('best_deals', { products: [MANGO] });
    const seasonal = await make('seasonal_deals');
    const asked = await json(await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: { bestDeals: false } }));
    assert.equal(asked.status, 409);
    assert.equal(asked.body.code, 'PLACEMENT_IN_USE');
    assert.deepEqual(asked.body.promotions.map((promo) => promo._id), [best]);
    assert.match(asked.body.message, /best_deals promo|Best Deals/);
    assert.equal(products[0].dealPlacements.bestDeals, true, 'nothing was saved');
    assert.deepEqual(promos.find((promo) => promo._id === best).products, [MANGO]);

    const done = await json(await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: { bestDeals: false }, removeFromPromotions: true }));
    assert.equal(done.status, 200);
    assert.equal(products[0].dealPlacements.bestDeals, false);
    assert.equal(products[0].dealPlacements.seasonalDeals, true, 'the other section is untouched');
    assert.deepEqual(promos.find((promo) => promo._id === best).products, []);
    assert.deepEqual(promos.find((promo) => promo._id === seasonal).products, [MANGO, TOMATO, RICE], 'an unrelated Seasonal Deals promotion is not touched');
    assert.ok(products.find((product) => product._id === MANGO), 'the Product document stays');
  });

  it('unmarking a product that is in no promotion needs no confirmation', async () => {
    await make('best_deals', { products: [TOMATO] });
    const done = await json(await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: { bestDeals: false } }));
    assert.equal(done.status, 200);
  });

  it('deleting a promotion keeps its products and the placement flags', async () => {
    const id = await make('best_deals', { products: [MANGO, TOMATO] });
    assert.equal((await call('DELETE', `/admin/deals/${id}`, owner)).status, 200);
    assert.equal(promos.length, 0);
    assert.equal(products.length, 3);
    assert.equal(products[0].dealPlacements.bestDeals, true);
  });

  it('deleting a product takes it out of every promotion so they stay editable', async () => {
    const best = await make('best_deals', { products: [MANGO, TOMATO] });
    assert.equal((await call('DELETE', `/products/${TOMATO}`, owner)).status, 200);
    assert.deepEqual(promos.find((promo) => promo._id === best).products, [MANGO]);
    assert.equal((await call('PUT', `/admin/deals/${best}`, owner, { title: 'Still saves' })).status, 200);
  });

  it('end to end: Product Edit -> Add Products -> customer homepage API, per section and switch', async () => {
    unmark();
    await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: { bestDeals: true, seasonalDeals: true } });
    await call('PUT', `/products/${TOMATO}`, owner, { dealPlacements: { seasonalDeals: true } });
    await call('PUT', `/products/${RICE}`, owner, { dealPlacements: { seasonalDeals: true } });
    const best = await make('best_deals', { title: 'Best one' });
    const seasonal = await make('seasonal_deals', { title: 'Season one' });
    assert.equal((await call('POST', `/admin/deals/${best}/products`, owner, { add: [MANGO] })).status, 200);
    assert.equal((await call('POST', `/admin/deals/${best}/products`, owner, { add: [TOMATO] })).status, 400, 'Tomato is not marked for Best Deals');

    const bestPublic = await json(await call('GET', '/promotions/best-deals', null));
    assert.deepEqual(bestPublic.body.promotions[0].products.map((product) => product._id), [MANGO]);
    const seasonalPublic = await json(await call('GET', '/promotions/seasonal-deals', null));
    assert.deepEqual(seasonalPublic.body.promotions[0].products.map((product) => product._id), [MANGO, TOMATO, RICE]);
    assert.equal(bestPublic.body.promotions[0].products[0].price, 100, 'Display Only leaves the price alone');
    assert.equal(bestPublic.body.promotions[0].products[0].offer, null);
    assert.equal(JSON.stringify(seasonalPublic.body).includes('Secret Supplier'), false);

    settingsDoc.deals.bestDealsEnabled = false;
    assert.deepEqual((await json(await call('GET', '/promotions/best-deals', null))).body, { enabled: false, promotions: [] });
    assert.equal((await json(await call('GET', '/promotions/seasonal-deals', null))).body.promotions.length, 1, 'the other section is independent');
  });

  it('a placement never discounts: Actual Discount still goes through the one pricing engine', async () => {
    const id = await make('best_deals', { promotionType: 'actual_discount', discountType: 'percentage', discountValue: 20 , products: [MANGO] });
    assert.ok(id);
    const product = (await json(await call('GET', `/products/${MANGO}`, null))).body.product;
    assert.equal(product.offer.finalPrice, 80);
    const untouched = (await json(await call('GET', `/products/${TOMATO}`, null))).body.product;
    assert.equal(untouched.offer, null, 'a marked product with no discount promotion keeps its price');
  });
});

describe('optional promotion title and the full listing for the dedicated pages', () => {
  const when = () => ({ startAt: iso(-1), endAt: iso(48) });
  it('saves a promotion with no title, an empty title or a blank one', async () => {
    for (const title of [undefined, '', '   ', null]) {
      const created = await json(await call('POST', '/admin/deals', owner, { section: 'best_deals', promotionType: 'display_only', products: [MANGO], ...when(), ...(title === undefined ? {} : { title }) }));
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.promotion.title, '');
    }
    assert.equal(promos.length, 4);
  });

  it('still limits a title to 80 characters, and keeps existing titles when other fields are edited', async () => {
    assert.equal((await call('POST', '/admin/deals', owner, { section: 'best_deals', promotionType: 'display_only', title: 'x'.repeat(81), ...when() })).status, 400);
    const promo = seedPromo({ title: 'Diwali Specials' });
    await call('PUT', `/admin/deals/${promo._id}`, owner, { description: 'Lights' });
    assert.equal(promos[0].title, 'Diwali Specials');
    await call('PUT', `/admin/deals/${promo._id}`, owner, { title: '' });
    assert.equal(promos[0].title, '', 'the admin can clear a title');
  });

  it('the public API sends an empty string, never undefined or null, for an untitled promotion', async () => {
    seedPromo({ title: undefined });
    seedPromo({ title: null, section: 'seasonal_deals' });
    for (const section of ['best-deals', 'seasonal-deals']) {
      const { body } = await deals(section);
      assert.equal(body.promotions[0].title, '');
      assert.ok(!/undefined|null/.test(JSON.stringify(body.promotions[0].title)) || body.promotions[0].title === '');
    }
  });

  it('an untitled promotion still prices and snapshots orders', async () => {
    seedPromo({ title: '' });
    const { status, body } = await json(await call('POST', '/orders', customer, orderBody()));
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.order.items[0].price, 80);
  });

  it('?full=1 returns every product a promotion holds, while the homepage default stays capped', async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ _id: hex(3000 + index), id: hex(3000 + index), name: `P${index}`, category: 'Fruits', price: 10, unit: 'kg', images: [], stock: 5, vendors: [] }));
    products.push(...many);
    seedPromo({ products: many.map((product) => product._id), promotionType: 'display_only', discountType: null, discountValue: null });
    assert.equal((await deals('best-deals')).body.promotions[0].products.length, 12);
    const full = await json(await call('GET', '/promotions/best-deals?full=1'));
    assert.equal(full.body.promotions[0].products.length, 30);
    settingsDoc.deals.bestDealsEnabled = false;
    assert.deepEqual((await json(await call('GET', '/promotions/best-deals?full=1'))).body, { enabled: false, promotions: [] });
  });
});

describe('seasonal campaign cards', () => {
  const when = () => ({ startAt: iso(-1), endAt: iso(48) });
  const PNG = 'data:image/png;base64,AAAA';
  const seasonalBody = (extra = {}) => ({ section: 'seasonal_deals', promotionType: 'display_only', title: 'Diwali Specials', bannerImage: PNG, products: [MANGO, TOMATO, RICE], ...when(), ...extra });
  const create = async (extra) => json(await call('POST', '/admin/deals', owner, seasonalBody(extra)));

  it('saves up to six cards in order, each with its own image, and keeps the background image separate', async () => {
    const cards = [
      { title: 'Lights', image: PNG, product: MANGO },
      { title: 'Sweets', image: PNG, category: 'fruits' },
      { title: 'Gifting' },
      { title: 'Kitchen', image: PNG },
      { title: 'Decor', image: PNG },
      { title: 'More', image: PNG },
    ];
    const { status, body } = await create({ cards });
    assert.equal(status, 201, JSON.stringify(body));
    assert.deepEqual(body.promotion.cards.map((card) => card.title), ['Lights', 'Sweets', 'Gifting', 'Kitchen', 'Decor', 'More']);
    assert.equal(body.promotion.cards[1].category, 'Fruits', 'categories are stored under their database spelling');
    assert.equal(body.promotion.cards[0].product, MANGO);
    assert.equal(body.promotion.cards[2].image, '');
    assert.equal(promos[0].bannerImage, PNG);
  });

  it('rejects a seventh card, a card with no title, both links at once, bad links and bad images', async () => {
    const seven = Array.from({ length: 7 }, (_, index) => ({ title: `C${index}` }));
    for (const cards of [seven, [{ title: '' }], [{ title: 'x'.repeat(41) }], [{ title: 'A', product: MANGO, category: 'Fruits' }], [{ title: 'A', product: 'nope' }], [{ title: 'A', product: hex(7777) }], [{ title: 'A', category: 'Imaginary' }], [{ title: 'A', image: 'javascript:alert(1)' }], ['text']]) {
      assert.equal((await create({ cards })).status, 400, JSON.stringify(cards).slice(0, 60));
    }
    assert.equal(promos.length, 0);
  });

  it('cards belong to Seasonal Deals only', async () => {
    const { status } = await json(await call('POST', '/admin/deals', owner, { ...seasonalBody({ cards: [{ title: 'A' }] }), section: 'best_deals' }));
    assert.equal(status, 400);
  });

  it('the public API sends only the configured cards, never filler, and drops links to deleted products', async () => {
    await create({ cards: [{ title: 'Lights', product: MANGO }, { title: 'Fruit', category: 'Fruits' }, { title: 'Plain' }] });
    let card = (await deals('seasonal-deals')).body.promotions[0].cards;
    assert.equal(card.length, 3);
    assert.deepEqual(card.map((entry) => [entry.title, entry.product, entry.category]), [['Lights', MANGO, null], ['Fruit', null, 'Fruits'], ['Plain', null, null]]);
    products.splice(0, 1);
    card = (await deals('seasonal-deals')).body.promotions[0].cards;
    assert.equal(card[0].product, null, 'a deleted product leaves the card non-clickable');
    assert.equal(card[0].title, 'Lights');
  });

  it('a campaign with no cards returns an empty list', async () => {
    await create({});
    assert.deepEqual((await deals('seasonal-deals')).body.promotions[0].cards, []);
  });

  it('editing adds, reorders, edits and removes cards; other fields stay', async () => {
    const id = (await create({ cards: [{ title: 'A' }, { title: 'B' }] })).body.promotion._id;
    const put = async (cards) => json(await call('PUT', `/admin/deals/${id}`, owner, { cards }));
    assert.equal((await put([{ title: 'B' }, { title: 'A2', category: 'Vegetables' }, { title: 'C' }])).status, 200);
    assert.deepEqual(promos[0].cards.map((card) => card.title), ['B', 'A2', 'C']);
    assert.equal(promos[0].title, 'Diwali Specials');
    assert.equal(promos[0].bannerImage, PNG);
    assert.equal((await put([])).status, 200);
    assert.deepEqual(promos[0].cards, []);
  });

  it('editing other fields keeps existing cards (and product ids stored as ObjectIds still validate)', async () => {
    const id = (await create({ cards: [{ title: 'A', product: MANGO }] })).body.promotion._id;
    promos[0].cards = [{ title: 'A', image: '', product: { toString: () => MANGO, _id: MANGO }, category: null }];
    assert.equal((await call('PUT', `/admin/deals/${id}`, owner, { description: 'Lights' })).status, 200);
    assert.equal(promos[0].cards.length, 1);
    assert.equal((await call('POST', `/admin/deals/${id}/products`, owner, { add: [MANGO] })).status, 200);
  });

  it('an older campaign that only has the old banner image still works with no cards at all', async () => {
    seedPromo({ section: 'seasonal_deals', bannerImage: PNG, title: 'Old' });
    const [promotion] = (await deals('seasonal-deals')).body.promotions;
    assert.equal(promotion.bannerImage, PNG);
    assert.deepEqual(promotion.cards, []);
  });

  it('the admin form can load a card\'s product name, and the list leaves images out', async () => {
    const id = (await create({ cards: [{ title: 'Lights', product: MANGO }] })).body.promotion._id;
    const one = await json(await call('GET', `/admin/deals/${id}`, owner));
    assert.equal(one.body.promotion.cards[0].productName, 'Mango');
    assert.equal((await call('POST', '/admin/deals', staff, seasonalBody())).status, 403, 'owner only');
  });
});

describe('seasonal deals: at least three products, and homepage visibility per product', () => {
  const when = () => ({ startAt: iso(-1), endAt: iso(48) });
  const MORE = [hex(204), hex(205)];
  const add = (...ids) => { for (const id of ids) products.push({ _id: id, id, name: `Extra ${id.slice(-3)}`, category: 'Fruits', price: 50, unit: 'kg', images: [], stock: 9, vendors: [], dealPlacements: { bestDeals: true, seasonalDeals: true } }); };
  const body = (extra = {}) => ({ section: 'seasonal_deals', promotionType: 'display_only', title: 'Diwali Specials', ...when(), ...extra });
  const create = async (extra) => json(await call('POST', '/admin/deals', owner, body(extra)));
  const bannerIds = async () => (await deals('seasonal-deals')).body.promotions[0].bannerProducts.map((product) => product._id);
  beforeEach(() => add(...MORE));

  it('rejects a Seasonal Deal with 0, 1 or 2 products, with the clear message, and accepts exactly 3', async () => {
    for (const list of [undefined, [], [MANGO], [MANGO, TOMATO], [MANGO, MANGO, MANGO], [MANGO, MANGO, TOMATO]]) {
      const { status, body: result } = await create(list === undefined ? {} : { products: list });
      assert.equal(status, 400, JSON.stringify(list));
      assert.equal(result.message, 'Please select at least 3 products for a Seasonal Deal.');
    }
    assert.equal(promos.length, 0);
    assert.equal((await create({ products: [MANGO, TOMATO, RICE] })).status, 201);
  });

  it('categories do not count toward the three products', async () => {
    assert.equal((await create({ products: [MANGO, TOMATO], categories: ['Fruits'] })).status, 400);
  });

  it('accepts more than three, dedupes, rejects invalid and unknown ids', async () => {
    const ok = await create({ products: [MANGO, TOMATO, RICE, MORE[0], MORE[1], MANGO] });
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.body.promotion.products, [MANGO, TOMATO, RICE, MORE[0], MORE[1]], 'order is kept and the duplicate dropped');
    assert.equal((await create({ products: [MANGO, TOMATO, 'bad'] })).status, 400);
    assert.equal((await create({ products: [MANGO, TOMATO, hex(9990)] })).status, 400);
  });

  it('Best Deals is unaffected: it still needs no minimum', async () => {
    const one = await json(await call('POST', '/admin/deals', owner, { section: 'best_deals', promotionType: 'display_only', ...when(), products: [MANGO] }));
    assert.equal(one.status, 201);
  });

  it('an update cannot leave fewer than three products', async () => {
    const id = (await create({ products: [MANGO, TOMATO, RICE, MORE[0]] })).body.promotion._id;
    assert.equal((await call('PUT', `/admin/deals/${id}`, owner, { products: [MANGO, TOMATO] })).status, 400);
    assert.equal((await call('PUT', `/admin/deals/${id}`, owner, { products: [MANGO, TOMATO, RICE] })).status, 200);
    assert.equal((await call('POST', `/admin/deals/${id}/products`, owner, { remove: [MANGO] })).status, 400, 'Add Products cannot drop it below three either');
    assert.deepEqual(promos[0].products, [MANGO, TOMATO, RICE]);
  });

  it('an older campaign with fewer than three products stays editable and can grow, but is never silently changed', async () => {
    const legacy = seedPromo({ section: 'seasonal_deals', products: [MANGO], title: 'Old campaign', promotionType: 'display_only', discountType: null, discountValue: null });
    const before = JSON.stringify(legacy);
    assert.equal((await deals('seasonal-deals')).body.promotions.length, 1, 'it still shows to customers');
    assert.equal(JSON.stringify(promos[0]), before);
    assert.equal((await call('PATCH', `/admin/deals/${legacy._id}/active`, owner, { isActive: false })).status, 200, 'it can be deactivated');
    assert.equal((await call('PUT', `/admin/deals/${legacy._id}`, owner, { title: 'Renamed' })).status, 400, 'a save through the form needs three');
    assert.equal((await call('POST', `/admin/deals/${legacy._id}/products`, owner, { add: [TOMATO] })).status, 200, 'but products can be added one at a time');
    assert.equal((await call('PUT', `/admin/deals/${legacy._id}`, owner, { products: [MANGO, TOMATO, RICE], title: 'Renamed' })).status, 200);
    assert.equal((await call('DELETE', `/admin/deals/${legacy._id}`, owner)).status, 200);
  });

  it('stores the homepage checkbox per product, only for products of the campaign', async () => {
    const created = await create({ products: [MANGO, TOMATO, RICE], homepageHidden: [TOMATO, MORE[0], TOMATO] });
    assert.deepEqual(created.body.promotion.homepageHidden, [TOMATO], 'a product outside the campaign cannot be hidden; duplicates collapse');
    assert.equal((await create({ products: [MANGO, TOMATO, RICE], homepageHidden: ['nope'] })).status, 400);
    assert.equal((await create({ products: [MANGO, TOMATO, RICE], homepageHidden: 'x' })).status, 400);
  });

  it('every product starts visible; the homepage shows the first three in the configured order', async () => {
    await create({ products: [RICE, MORE[0], MANGO, TOMATO, MORE[1]] });
    assert.deepEqual(await bannerIds(), [RICE, MORE[0], MANGO]);
  });

  it('only checked products appear, at most three, with no filler', async () => {
    const id = (await create({ products: [MANGO, TOMATO, RICE, MORE[0], MORE[1]] })).body.promotion._id;
    const hide = async (ids) => { assert.equal((await call('PUT', `/admin/deals/${id}`, owner, { homepageHidden: ids })).status, 200); };
    await hide([MANGO]);
    assert.deepEqual(await bannerIds(), [TOMATO, RICE, MORE[0]], 'hiding one brings the next visible product in');
    await hide([MANGO, TOMATO, RICE, MORE[0]]);
    assert.deepEqual(await bannerIds(), [MORE[1]], 'fewer than three visible shows only those');
    await hide([MANGO, TOMATO, RICE, MORE[0], MORE[1]]);
    assert.deepEqual(await bannerIds(), [], 'none visible means no banner cards');
    await hide([]);
    assert.deepEqual(await bannerIds(), [MANGO, TOMATO, RICE], 'unchecking and re-checking works');
  });

  it('hidden products stay in the campaign and on the full Seasonal Deals page', async () => {
    await create({ products: [MANGO, TOMATO, RICE, MORE[0]], homepageHidden: [MANGO, TOMATO, RICE, MORE[0]] });
    const full = (await json(await call('GET', '/promotions/seasonal-deals?full=1'))).body.promotions[0];
    assert.deepEqual(full.products.map((product) => product._id), [MANGO, TOMATO, RICE, MORE[0]]);
    assert.deepEqual(full.bannerProducts, []);
    assert.equal(promos[0].products.length, 4);
  });

  it('banner cards carry the same promotional price as the shop and never change the stored price', async () => {
    await create({ products: [MANGO, TOMATO, RICE], promotionType: 'actual_discount', discountType: 'percentage', discountValue: 20 });
    const [mango] = (await deals('seasonal-deals')).body.promotions[0].bannerProducts;
    assert.equal(mango.price, 100);
    assert.equal(mango.offer.finalPrice, 80);
    assert.equal(mango.vendors, undefined, 'supplier data never leaves');
    const shop = (await json(await call('GET', `/products/${MANGO}`, null))).body.product;
    assert.equal(shop.offer.finalPrice, mango.offer.finalPrice);
  });

  it('a placement change cannot drop a Seasonal Deal below three, and a deleted product leaves the banner', async () => {
    const id = (await create({ products: [MANGO, TOMATO, RICE] })).body.promotion._id;
    const blocked = await json(await call('PUT', `/products/${MANGO}`, owner, { dealPlacements: { seasonalDeals: false }, removeFromPromotions: true }));
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'PLACEMENT_BREAKS_MINIMUM');
    assert.deepEqual(promos.find((promo) => promo._id === id).products, [MANGO, TOMATO, RICE]);
    await call('DELETE', `/products/${MANGO}`, owner);
    assert.deepEqual(await bannerIds(), [TOMATO, RICE]);
  });

  it('turning Seasonal Deals off hides it, and the preview shows exactly the homepage cards', async () => {
    const id = (await create({ products: [MANGO, TOMATO, RICE, MORE[0]], homepageHidden: [MANGO] })).body.promotion._id;
    const preview = (await json(await call('GET', `/admin/deals/${id}/preview`, owner))).body.preview;
    assert.deepEqual(preview.bannerProducts.map((product) => product._id), [TOMATO, RICE, MORE[0]]);
    settingsDoc.deals.seasonalDealsEnabled = false;
    assert.deepEqual((await deals('seasonal-deals')).body, { enabled: false, promotions: [] });
  });
});
