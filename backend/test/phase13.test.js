import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import BulkOrder from '../models/BulkOrder.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import VendorPurchase from '../models/VendorPurchase.js';
import adminRouter from '../routes/adminRoutes.js';
import { PERMISSION_LIST } from '../config/permissions.js';
import { categoryPipeline, readOptions, salesSummaryPipeline, shapeBulk, shapeCustomerFacet, shapeOrderStatuses, shapePreorders, shapeSalesSummary } from '../controllers/reportController.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { toCsv, toPdf } from '../utils/reportExport.js';
import { bucketKeys, describeRange, fillSeries, parseReportDay, percentChange, resolveRange } from '../utils/reportRanges.js';

process.env.JWT_SECRET = 'phase13-test-secret';

// 2026-10-31 01:30 in India, which is still 30 October in UTC: the case where a UTC-based "today" would be wrong.
const NOW = new Date('2026-10-30T20:00:00Z');
const hex = (n) => String(n).padStart(24, '0');
const owner = { _id: hex(1), id: hex(1), role: 'admin', isActive: true, firstName: 'Owner', lastName: 'One' };
const fullStaff = { _id: hex(2), id: hex(2), role: 'staff', isActive: true, firstName: 'Sam', lastName: 'Staff', permissions: PERMISSION_LIST };
const customer = { _id: hex(3), id: hex(3), role: 'customer', isActive: true, firstName: 'Cu', lastName: 'Stomer' };
const people = { [owner.id]: owner, [fullStaff.id]: fullStaff, [customer.id]: customer };
const tokenFor = (user) => jwt.sign({ sub: user.id }, process.env.JWT_SECRET);

const SECTIONS = ['overview', 'sales', 'orders', 'products', 'customers', 'preorders', 'bulk', 'inventory'];

// ---------------------------------------------------------------- stubbed models (no database)
const originals = {};
let calls;
let responders;

function thenable(result) {
  const query = { option: () => query, then: (a, b) => Promise.resolve(result).then(a, b) };
  return query;
}
function stubAggregate(Model, name) {
  originals[`${name}.aggregate`] = Model.aggregate;
  Model.aggregate = (pipeline) => { calls.push({ model: name, pipeline }); return thenable((responders[name] || (() => []))(pipeline)); };
}

beforeEach(() => {
  calls = [];
  responders = {};
  stubAggregate(Order, 'Order');
  stubAggregate(BulkOrder, 'BulkOrder');
  stubAggregate(Product, 'Product');
  stubAggregate(User, 'User');
  stubAggregate(VendorPurchase, 'VendorPurchase');
  originals.userFindById = User.findById;
  originals.userCount = User.countDocuments;
  originals.bulkCount = BulkOrder.countDocuments;
  originals.productFind = Product.find;
  User.findById = async (id) => people[String(id)] || null;
  User.countDocuments = async (filter) => { calls.push({ model: 'User.count', filter }); return responders.userCount ? responders.userCount(filter) : 0; };
  BulkOrder.countDocuments = async () => 0;
  Product.find = (filter) => {
    const chain = { filter, selected: null, select(spec) { this.selected = spec; calls.push({ model: 'Product.find', filter, select: spec }); return this; }, sort() { return this; }, limit() { return this; }, lean: () => Promise.resolve(responders.productFind ? responders.productFind(filter) : []) };
    return chain;
  };
});
afterEach(() => {
  Order.aggregate = originals['Order.aggregate'];
  BulkOrder.aggregate = originals['BulkOrder.aggregate'];
  Product.aggregate = originals['Product.aggregate'];
  User.aggregate = originals['User.aggregate'];
  VendorPurchase.aggregate = originals['VendorPurchase.aggregate'];
  User.findById = originals.userFindById;
  User.countDocuments = originals.userCount;
  BulkOrder.countDocuments = originals.bulkCount;
  Product.find = originals.productFind;
});

// ---------------------------------------------------------------- a real Express app around the admin router
let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  app.use(errorHandler);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/admin/reports`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const get = (path, user) => fetch(`${base}${path}`, { headers: user ? { Authorization: `Bearer ${tokenFor(user)}` } : {} });

// ---------------------------------------------------------------- date filtering
describe('report date ranges', () => {
  const described = (key, extra = {}) => describeRange(resolveRange({ range: key, ...extra }, NOW));

  it('uses India calendar days, not UTC days', () => {
    const today = resolveRange({ range: 'today' }, NOW);
    assert.equal(today.from.toISOString(), '2026-10-30T18:30:00.000Z');
    assert.equal(today.to.toISOString(), '2026-10-31T18:30:00.000Z');
    assert.equal(described('today').from, '2026-10-31');
  });

  it('resolves every preset to the expected inclusive dates', () => {
    const expected = {
      today: ['2026-10-31', '2026-10-31'], yesterday: ['2026-10-30', '2026-10-30'], last7: ['2026-10-25', '2026-10-31'],
      last30: ['2026-10-02', '2026-10-31'], thisMonth: ['2026-10-01', '2026-10-31'], lastMonth: ['2026-09-01', '2026-09-30'],
    };
    for (const [key, [from, to]] of Object.entries(expected)) assert.deepEqual([described(key).from, described(key).to], [from, to], key);
  });

  it('defaults to the last 30 days', () => assert.equal(resolveRange({}, NOW).key, 'last30'));

  it('is half-open: an order a millisecond before midnight IST belongs to the earlier day', () => {
    const yesterday = resolveRange({ range: 'yesterday' }, NOW);
    const justBefore = new Date('2026-10-30T18:29:59.999Z');
    const midnight = new Date('2026-10-30T18:30:00.000Z');
    assert.ok(justBefore >= yesterday.from && justBefore < yesterday.to);
    assert.ok(!(midnight >= yesterday.from && midnight < yesterday.to));
  });

  it('picks the previous equivalent period', () => {
    assert.deepEqual([described('last7').previous.from, described('last7').previous.to], ['2026-10-18', '2026-10-24']);
    assert.deepEqual([described('yesterday').previous.from, described('yesterday').previous.to], ['2026-10-29', '2026-10-29']);
    assert.deepEqual([described('thisMonth').previous.from, described('thisMonth').previous.to], ['2026-09-01', '2026-09-30'], 'month to date vs the previous month, capped at its end');
    assert.deepEqual([described('lastMonth').previous.from, described('lastMonth').previous.to], ['2026-08-01', '2026-08-31']);
  });

  it('handles the January to December year rollover', () => {
    const january = new Date('2027-01-15T06:00:00Z');
    const last = describeRange(resolveRange({ range: 'lastMonth' }, january));
    assert.deepEqual([last.from, last.to], ['2026-12-01', '2026-12-31']);
  });

  it('accepts a valid custom range and rejects bad ones', () => {
    const ok = resolveRange({ range: 'custom', from: '2026-10-01', to: '2026-10-15' }, NOW);
    assert.equal(ok.days, 15);
    for (const bad of [
      { from: '2026-10-15', to: '2026-10-01' }, { from: 'garbage', to: '2026-10-01' }, { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-10-01', to: '2026-11-01' }, { from: '2025-01-01', to: '2026-10-31' }, { from: '2026-10-01' }, {},
    ]) assert.ok(resolveRange({ range: 'custom', ...bad }, NOW).error, JSON.stringify(bad));
    assert.ok(resolveRange({ range: 'forever' }, NOW).error);
    assert.ok(resolveRange({ range: ['today'] }, NOW).error);
  });

  it('groups long ranges by month and fills empty buckets with zeros', () => {
    const long = resolveRange({ range: 'custom', from: '2026-08-01', to: '2026-10-31' }, NOW);
    assert.equal(long.granularity, 'month');
    assert.deepEqual(bucketKeys(long), ['2026-08', '2026-09', '2026-10']);
    const week = resolveRange({ range: 'last7' }, NOW);
    assert.equal(week.granularity, 'day');
    const series = fillSeries(week, [{ _id: '2026-10-27', orders: 3 }], { orders: 0 });
    assert.equal(series.length, 7);
    assert.deepEqual(series.map((row) => row.orders), [0, 0, 3, 0, 0, 0, 0]);
  });

  it('parses days strictly and computes percentage changes safely', () => {
    assert.equal(parseReportDay('2026-02-29'), null);
    assert.ok(parseReportDay('2028-02-29'));
    assert.equal(percentChange(150, 100), 50);
    assert.equal(percentChange(50, 100), -50);
    assert.equal(percentChange(0, 0), 0);
    assert.equal(percentChange(10, 0), null, 'no previous data is "not comparable", not infinity');
  });
});

// ---------------------------------------------------------------- calculations
describe('sales calculations', () => {
  it('shapes revenue, order value and average order value from aggregation rows', () => {
    const s = shapeSalesSummary({ totalOrders: 5, activeOrders: 4, orderValue: 1000.456, deliveredOrders: 2, deliveredValue: 640.5, cancelledOrders: 1, cancelledValue: 99, collectedOrders: 0, collectedValue: 0 });
    assert.equal(s.orderValue, 1000.46);
    assert.equal(s.averageOrderValue, 250.11);
    assert.equal(s.deliveredValue, 640.5);
    assert.equal(s.cancelledOrders, 1);
    assert.equal(s.collectedValue, 0);
  });

  it('is all zeros, never NaN, for an empty period', () => {
    const s = shapeSalesSummary(undefined);
    assert.deepEqual(Object.values(s).filter((v) => v !== 0), []);
  });

  it('only counts normal and pre-orders created in the period, and separates cancelled, delivered and paid', () => {
    const range = resolveRange({ range: 'last7' }, NOW);
    const [match, group] = salesSummaryPipeline(range);
    assert.deepEqual(match.$match.createdAt, { $gte: range.from, $lt: range.to });
    assert.deepEqual(match.$match.orderType.$in.sort(), [null, 'normal', 'preorder'].sort());
    const text = JSON.stringify(group);
    assert.ok(text.includes('"cancelled"'));
    assert.ok(text.includes('"delivered"'));
    assert.ok(text.includes('"paid"'), 'collected revenue relies only on paymentStatus');
    assert.ok(!text.includes('totalSpent'));
  });

  it('serves a sales report with comparison, zero-filled trend and an honest collection note', async () => {
    responders.Order = (pipeline) => {
      const group = pipeline[1].$group;
      if (group._id === null) {
        const isCurrent = pipeline[0].$match.createdAt.$gte.getTime() === resolveRange({ range: 'last7' }, new Date()).from.getTime();
        return isCurrent
          ? [{ totalOrders: 6, activeOrders: 5, orderValue: 1500, deliveredOrders: 3, deliveredValue: 900, cancelledOrders: 1, cancelledValue: 100, collectedOrders: 0, collectedValue: 0 }]
          : [{ totalOrders: 4, activeOrders: 4, orderValue: 1000, deliveredOrders: 2, deliveredValue: 600, cancelledOrders: 0, cancelledValue: 0, collectedOrders: 0, collectedValue: 0 }];
      }
      if (group._id?.$dateToString) return [{ _id: bucketKeys(resolveRange({ range: 'last7' }, new Date()))[2], orders: 2, orderValue: 700.5, deliveredValue: 300 }];
      return [{ _id: 'normal', orders: 4, orderValue: 1100, deliveredValue: 700 }, { _id: 'preorder', orders: 1, orderValue: 400, deliveredValue: 200 }];
    };
    const body = await (await get('/sales?range=last7', owner)).json();
    assert.equal(body.summary.orderValue, 1500);
    assert.equal(body.summary.deliveredValue, 900);
    assert.equal(body.summary.averageOrderValue, 300);
    assert.equal(body.changes.orderValue, 50);
    assert.equal(body.changes.deliveredValue, 50);
    assert.equal(body.series.length, 7);
    assert.equal(body.series[2].orderValue, 700.5);
    assert.equal(body.series[0].orderValue, 0);
    assert.deepEqual(body.byType.map((t) => t.type), ['normal', 'preorder']);
    assert.equal(body.collection.tracked, false);
    assert.match(body.collection.note, /cash on delivery/i);
  });
});

describe('order status counts', () => {
  const rows = [
    { _id: { type: 'normal', status: 'placed' }, count: 3 }, { _id: { type: 'normal', status: 'confirmed' }, count: 2 }, { _id: { type: 'normal', status: 'preparing' }, count: 1 },
    { _id: { type: 'normal', status: 'out_for_delivery' }, count: 4 }, { _id: { type: 'normal', status: 'delivered' }, count: 10 }, { _id: { type: 'normal', status: 'cancelled' }, count: 2 },
    { _id: { type: 'preorder', status: 'placed' }, count: 5 }, { _id: { type: 'preorder', status: 'delivered' }, count: 1 },
  ];

  it('groups statuses the way the admin tabs do and keeps order types apart', () => {
    const r = shapeOrderStatuses(rows);
    assert.deepEqual(r.byType.normal, { total: 22, pending: 3, processing: 3, outForDelivery: 4, delivered: 10, cancelled: 2 });
    assert.deepEqual(r.byType.preorder, { total: 6, pending: 5, processing: 0, outForDelivery: 0, delivered: 1, cancelled: 0 });
    assert.equal(r.totals.total, 28);
    assert.equal(r.totals.pending, 8);
    assert.equal(r.distribution.find((d) => d.status === 'delivered').count, 11);
    assert.equal(Math.round(r.distribution.reduce((sum, d) => sum + d.percent, 0)), 100);
  });

  it('is zero for no data and ignores unknown types or statuses', () => {
    assert.equal(shapeOrderStatuses([]).totals.total, 0);
    assert.equal(shapeOrderStatuses([{ _id: { type: 'bulk', status: 'placed' }, count: 9 }, { _id: { type: 'normal', status: 'weird' }, count: 9 }]).totals.total, 0);
  });

  it('reports bulk requests separately from order totals', async () => {
    BulkOrder.countDocuments = async () => 7;
    responders.Order = (pipeline) => (pipeline[1].$group._id?.type ? rows : []);
    const body = await (await get('/orders?range=last30', owner)).json();
    assert.equal(body.totals.total, 28);
    assert.equal(body.bulkRequests, 7);
    assert.equal(body.series.length, 30);
  });
});

describe('product and category performance', () => {
  it('computes sales from the price snapshot on each order line, excluding cancelled orders', async () => {
    responders.Order = (pipeline) => {
      if (pipeline.some((stage) => stage.$lookup)) return [{ _id: 'Fruits', quantity: 30, sales: 1200, products: 2 }, { _id: 'Unknown (product removed)', quantity: 2, sales: 40, products: 1 }];
      return [{ _id: hex(50), productId: hex(50), name: 'Mango', unit: 'kg', quantity: 20, sales: 900.126, orders: 7 }];
    };
    const body = await (await get('/products?range=last30&by=quantity', owner)).json();
    assert.equal(body.sortedBy, 'quantity');
    assert.deepEqual(body.topProducts[0], { id: hex(50), name: 'Mango', unit: 'kg', quantity: 20, sales: 900.13, orders: 7 });
    assert.equal(body.categories[0].category, 'Fruits');
    assert.equal(body.categories[1].category, 'Unknown (product removed)');
    const top = calls.find((c) => c.model === 'Order' && !c.pipeline.some((s) => s.$lookup)).pipeline;
    const text = JSON.stringify(top);
    assert.ok(text.includes('$items.price') && text.includes('$items.quantity'), 'uses the stored snapshot');
    assert.ok(!text.includes('products'), 'never joins current product prices');
    assert.deepEqual(top[0].$match.orderStatus, { $ne: 'cancelled' });
    assert.deepEqual(top.at(-2).$sort, { quantity: -1, _id: 1 });
    assert.equal(top.at(-1).$limit, 10);
  });

  it('takes only the category from the product for category performance', () => {
    const pipeline = categoryPipeline(resolveRange({ range: 'last30' }, NOW));
    const lookup = pipeline.find((stage) => stage.$lookup).$lookup;
    assert.deepEqual(lookup.pipeline.at(-1), { $project: { category: 1 } });
    assert.ok(!JSON.stringify(pipeline).includes('vendors'));
    assert.ok(!JSON.stringify(pipeline).includes('images'));
    assert.equal(pipeline.at(-1).$limit, 20);
  });
});

describe('customer statistics', () => {
  const facet = {
    summary: [{ activeCustomers: 6, repeatCustomers: 2, orders: 11, value: 3000.5 }],
    buckets: [{ _id: 1, customers: 4 }, { _id: 2, customers: 1 }, { _id: 'many', customers: 1 }],
    top: [{ _id: hex(7), orders: 4, value: 1500, name: 'Asha Rao' }, { _id: hex(8), orders: 1, value: 80.25, name: '' }],
  };

  it('counts active and repeat customers and buckets orders per customer', () => {
    const r = shapeCustomerFacet(facet);
    assert.equal(r.activeCustomers, 6);
    assert.equal(r.repeatCustomers, 2);
    assert.equal(r.orderValue, 3000.5);
    assert.deepEqual(r.buckets.map((b) => b.customers), [4, 1, 0, 1]);
    assert.deepEqual(r.topCustomers[0], { id: hex(7), name: 'Asha Rao', orders: 4, value: 1500 });
    assert.equal(r.topCustomers[1].name, 'Customer');
  });

  it('serves totals, new customers and comparison, without contact details or supplier data', async () => {
    responders.userCount = (filter) => (filter.createdAt ? (filter.createdAt.$gte.getTime() === resolveRange({ range: 'last30' }, new Date()).from.getTime() ? 6 : 3) : 120);
    responders.Order = () => [facet];
    responders.User = () => [{ _id: '2026-10-20', registrations: 2 }];
    const response = await get('/customers?range=last30', owner);
    const body = await response.json();
    assert.equal(body.totalCustomers, 120);
    assert.equal(body.newCustomers, 6);
    assert.equal(body.newCustomersChange, 100);
    assert.equal(body.registrations.length, 30);
    const text = JSON.stringify(body).toLowerCase();
    for (const forbidden of ['email', 'phone', 'mobile', 'vendor', 'purchaseprice', 'password']) assert.ok(!text.includes(forbidden), forbidden);
    const lookup = calls.find((c) => c.model === 'Order').pipeline.at(-1).$facet.top.find((stage) => stage.$lookup).$lookup;
    assert.deepEqual(lookup.pipeline.at(-1), { $project: { firstName: 1, lastName: 1 } }, 'only names are ever read from the user collection');
  });
});

describe('pre-order statistics', () => {
  it('derives upcoming, overdue, completed and cancelled and lists the delivery date distribution', () => {
    const r = shapePreorders({
      summary: [{ total: 9, value: 4000.4, upcoming: 4, overdue: 1 }],
      byStatus: [{ _id: 'delivered', count: 3 }, { _id: 'cancelled', count: 1 }, { _id: 'placed', count: 5 }],
      distribution: [{ _id: '2026-11-02', orders: 2, value: 500 }, { _id: '2026-11-05', orders: 3, value: 900.555 }],
    }, new Date('2026-10-30T18:30:00Z'));
    assert.equal(r.asOf, '2026-10-31');
    assert.deepEqual([r.total, r.upcoming, r.overdue, r.completed, r.cancelled], [9, 4, 1, 3, 1]);
    assert.deepEqual(r.deliveryDates, [{ date: '2026-11-02', orders: 2, value: 500 }, { date: '2026-11-05', orders: 3, value: 900.56 }]);
  });

  it('only looks at pre-orders and measures "upcoming" from the start of today in India', async () => {
    await get('/preorders?range=last30', owner);
    const pipeline = calls.find((c) => c.model === 'Order').pipeline;
    assert.equal(pipeline[0].$match.orderType, 'preorder');
    const facetText = JSON.stringify(pipeline[1].$facet.summary);
    assert.ok(facetText.includes('2026-') || facetText.includes('$deliveryDate'));
    assert.ok(facetText.includes('placed') && facetText.includes('out_for_delivery'), 'only active statuses count as upcoming');
  });
});

describe('bulk-order statistics', () => {
  it('counts each status and keeps quotation values out of revenue', () => {
    const r = shapeBulk({
      byStatus: [
        { _id: 'Pending', count: 3, quotedRequests: 0, quotationValue: 0 }, { _id: 'Quoted', count: 2, quotedRequests: 2, quotationValue: 5000 },
        { _id: 'Approved', count: 1, quotedRequests: 1, quotationValue: 2500.5 }, { _id: 'Completed', count: 1, quotedRequests: 1, quotationValue: 1000 },
        { _id: 'Rejected', count: 1, quotedRequests: 1, quotationValue: 700 },
      ],
    });
    assert.equal(r.total, 8);
    assert.equal(r.statuses.find((s) => s.status === 'Pending').count, 3);
    assert.equal(r.statuses.find((s) => s.status === 'Reviewing').count, 0);
    assert.equal(r.quotedRequests, 5);
    assert.equal(r.openQuotationValue, 5000);
    assert.equal(r.approvedQuotationValue, 3500.5);
    assert.match(r.note, /not revenue/i);
  });

  it('is served from the BulkOrder collection only, with a zero-filled trend', async () => {
    responders.BulkOrder = () => [{ byStatus: [{ _id: 'Pending', count: 2, quotedRequests: 0, quotationValue: 0 }], series: [{ _id: bucketKeys(resolveRange({ range: 'last7' }, new Date()))[5], requests: 2, quotationValue: 0 }] }];
    const body = await (await get('/bulk?range=last7', owner)).json();
    assert.equal(body.total, 2);
    assert.equal(body.series.length, 7);
    assert.ok(calls.every((c) => c.model !== 'Order'), 'bulk requests are not mixed with orders');
  });
});

describe('inventory calculations', () => {
  it('reports totals and low/out-of-stock lists with the requested threshold, selecting no supplier data', async () => {
    responders.Product = () => [{ totalProducts: 12, totalStock: 340.5, outOfStock: 2, lowStock: 3 }];
    responders.productFind = (filter) => (filter.stock.$gt === 0 ? [{ _id: hex(5), name: 'Okra', category: 'Vegetables', unit: 'kg', stock: 4 }] : [{ _id: hex(6), name: 'Kiwi', category: 'Fruits', unit: 'kg', stock: 0 }]);
    responders.VendorPurchase = () => [{ _id: 'kg', purchases: 3, quantity: 120 }];
    const body = await (await get('/inventory?range=last30&lowStock=5', owner)).json();
    assert.deepEqual(body.totals, { totalProducts: 12, totalStock: 340.5, outOfStock: 2, lowStock: 3 });
    assert.equal(body.threshold, 5);
    assert.equal(body.lowStock.products[0].name, 'Okra');
    assert.equal(body.outOfStock.products[0].name, 'Kiwi');
    assert.deepEqual(body.movement.receivedFromSuppliers, [{ unit: 'kg', purchases: 3, quantity: 120 }]);
    assert.equal(body.movement.tracked, false, 'no stock ledger exists, so none is invented');
    assert.ok(JSON.stringify(calls.find((c) => c.model === 'Product').pipeline).includes('5'));
    const selects = calls.filter((c) => c.model === 'Product.find').map((c) => c.select);
    assert.ok(selects.length === 2 && selects.every((s) => !('vendors' in s) && !('images' in s)));
    const received = calls.find((c) => c.model === 'VendorPurchase').pipeline;
    assert.equal(received[0].$match.status, 'Received');
    assert.ok(!JSON.stringify(received).includes('rate') && !JSON.stringify(received).includes('totalAmount'), 'purchase costs are never read');
  });

  it('validates the low-stock level', () => {
    assert.equal(readOptions({}).lowStock, 10);
    for (const bad of ['0', '-1', '1.5', 'abc', '1001']) assert.ok(readOptions({ lowStock: bad }).error, bad);
    assert.ok(readOptions({ by: 'profit' }).error);
    assert.equal(readOptions({ by: 'quantity' }).by, 'quantity');
  });
});

// ---------------------------------------------------------------- exports
describe('CSV and PDF export', () => {
  const salesPayload = {
    section: 'sales', generatedAt: '2026-10-31T01:30:00.000Z',
    range: describeRange(resolveRange({ range: 'custom', from: '2026-10-01', to: '2026-10-03' }, NOW)),
    summary: shapeSalesSummary({ activeOrders: 2, orderValue: 500, deliveredOrders: 1, deliveredValue: 250 }), previous: shapeSalesSummary(undefined),
    changes: { orderValue: null, deliveredValue: null, averageOrderValue: null },
    byType: [{ type: 'normal', orders: 2, orderValue: 500, deliveredValue: 250 }],
    series: [{ period: '2026-10-01', orders: 1, orderValue: 200, deliveredValue: 0 }, { period: '=cmd|calc', orders: 1, orderValue: 300, deliveredValue: 250 }],
    collection: { note: 'Cash on delivery is not tracked, "quoted" note, with comma.' },
  };

  it('writes a CSV with the selected period, quoted cells, a BOM and no formula injection', () => {
    const csv = toCsv(salesPayload);
    assert.ok(csv.startsWith('﻿'));
    assert.match(csv, /Period: 2026-10-01 to 2026-10-03/);
    assert.match(csv, /Order value \(not cancelled\),500\.00,0\.00,/);
    assert.match(csv, /"Cash on delivery is not tracked, ""quoted"" note, with comma\."/);
    assert.match(csv, /\r\n'=cmd\|calc,/, 'a cell starting with = is neutralised');
    assert.ok(!/\r\n=cmd/.test(csv));
  });

  it('writes a structurally valid PDF whose cross-reference table points at real objects', () => {
    const pdf = toPdf(salesPayload).toString('latin1');
    assert.ok(pdf.startsWith('%PDF-1.4'));
    assert.ok(pdf.trimEnd().endsWith('%%EOF'));
    const start = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)[1]);
    assert.ok(pdf.slice(start).startsWith('xref'));
    const entries = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    assert.ok(entries.length >= 6);
    entries.forEach((offset, index) => assert.ok(pdf.slice(offset).startsWith(`${index + 1} 0 obj`), `object ${index + 1}`));
    assert.match(pdf, /Janai - Sales report/);
    assert.match(pdf, /Page 1 of 1/);
  });

  it('paginates long reports and escapes characters that PDF strings cannot hold', () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({ period: `row (${index}) \\ ₹`, orders: index, orderValue: index, deliveredValue: 0 }));
    const pdf = toPdf({ ...salesPayload, series: rows }).toString('latin1');
    assert.ok(/Page 1 of [2-9]/.test(pdf));
    assert.match(pdf, /row \\\(0\\\) \\\\ \?/);
    assert.match(pdf, /\/Count (\d+)/);
  });

  it('is served by the API for the selected report and filters, owner only', async () => {
    const csv = await get('/export?section=sales&format=csv&range=custom&from=2026-10-01&to=2026-10-03', owner);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="janai-sales-2026-10-01_to_2026-10-03.csv"');
    assert.match(await csv.text(), /Period: 2026-10-01 to 2026-10-03/);
    const matchStage = calls.find((c) => c.model === 'Order').pipeline[0].$match;
    assert.equal(matchStage.createdAt.$gte.toISOString(), '2026-09-30T18:30:00.000Z', 'the filter reaches the query');

    const pdf = await get('/export?section=orders&format=pdf&range=last7', owner);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

    for (const path of ['/export?section=secrets&format=csv', '/export?section=sales&format=xlsx', '/export?section=sales&format=csv&range=custom&from=bad&to=bad']) {
      assert.equal((await get(path, owner)).status, 400, path);
    }
    for (const user of [fullStaff, customer, null]) assert.ok([401, 403].includes((await get('/export?section=sales&format=csv', user)).status));
  });
});

// ---------------------------------------------------------------- permissions & empty database
describe('permission restrictions', () => {
  it('rejects unauthenticated requests, customers and every staff account, even with all permissions', async () => {
    for (const section of SECTIONS) {
      assert.equal((await get(`/${section}`, null)).status, 401, `${section} anonymous`);
      assert.equal((await get(`/${section}`, customer)).status, 403, `${section} customer`);
      assert.equal((await get(`/${section}`, fullStaff)).status, 403, `${section} staff with every permission`);
    }
    assert.equal(calls.filter((c) => c.model !== 'User.count').length, 0, 'no data was queried for rejected callers');
  });

  it('allows the owner', async () => {
    for (const section of SECTIONS) assert.equal((await get(`/${section}`, owner)).status, 200, section);
  });

  it('refuses a deactivated owner session', async () => {
    people[owner.id] = { ...owner, isActive: false };
    try { assert.equal((await get('/sales', owner)).status, 401); } finally { people[owner.id] = owner; }
  });
});

describe('invalid filters', () => {
  it('returns 400 with a message instead of querying', async () => {
    for (const query of ['range=decade', 'range=custom&from=2026-10-10&to=2026-10-01', 'range=custom&from=2026-10-01&to=2099-01-01', 'range=today&by=profit', 'range=today&lowStock=0']) {
      const response = await get(`/sales?${query}`, owner);
      assert.equal(response.status, 400, query);
      assert.ok((await response.json()).message);
    }
    assert.equal(calls.length, 0);
  });
});

describe('empty database', () => {
  it('returns zeros and empty lists for every report, never errors or NaN', async () => {
    for (const section of SECTIONS) {
      const response = await get(`/${section}?range=last7`, owner);
      assert.equal(response.status, 200, section);
      const text = await response.text();
      assert.ok(!/NaN|null,"?Infinity|Infinity/.test(text), section);
    }
    const overview = await (await get('/overview?range=today', owner)).json();
    assert.equal(overview.cards.revenue.value, 0);
    assert.equal(overview.cards.averageOrderValue.value, 0);
    assert.equal(overview.cards.totalCustomers.value, 0);
    assert.equal(overview.cards.revenue.change, 0);
    const products = await (await get('/products', owner)).json();
    assert.deepEqual([products.topProducts, products.categories, products.lowStock.products], [[], [], []]);
    const customers = await (await get('/customers', owner)).json();
    assert.deepEqual(customers.topCustomers, []);
    assert.equal(customers.repeatCustomers, 0);
    const pre = await (await get('/preorders', owner)).json();
    assert.equal(pre.total, 0);
    assert.deepEqual(pre.deliveryDates, []);
    const inventory = await (await get('/inventory', owner)).json();
    assert.equal(inventory.totals.totalProducts, 0);
    assert.deepEqual(inventory.movement.receivedFromSuppliers, []);
  });

  it('keeps the overview cards tied to real queries rather than constants', async () => {
    responders.userCount = (filter) => (filter.createdAt ? 2 : 41);
    responders.Order = (pipeline) => (pipeline[0].$match.createdAt.$gte.getTime() === resolveRange({ range: 'today' }, new Date()).from.getTime()
      ? [{ totalOrders: 8, activeOrders: 7, orderValue: 2100, deliveredOrders: 5, deliveredValue: 1400, cancelledOrders: 1, cancelledValue: 50 }] : []);
    const { cards } = await (await get('/overview?range=today', owner)).json();
    assert.equal(cards.revenue.value, 1400);
    assert.equal(cards.totalOrders.value, 8);
    assert.equal(cards.deliveredOrders.value, 5);
    assert.equal(cards.averageOrderValue.value, 300);
    assert.equal(cards.totalCustomers.value, 41);
    assert.equal(cards.totalCustomers.newInPeriod, 2);
  });
});
