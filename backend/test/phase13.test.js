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
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import Vendor, { normalizeVendorName } from '../models/Vendor.js';
import Product from '../models/Product.js';
import VendorPriceHistory from '../models/VendorPriceHistory.js';
import { createVendor, deactivateVendor, getVendor, listVendors, updateVendor } from '../controllers/adminVendorController.js';
import { createProduct, updateProduct } from '../controllers/productController.js';
import { listPriceHistory, listPurchases, createPurchase, receivePurchase } from '../controllers/vendorController.js';
import vendorRouter from '../routes/vendorRoutes.js';
import productRouter from '../routes/productRoutes.js';
import { requireAnyPermission, requireAuth } from '../middleware/auth.js';
import { applyApprovedMappings, buildDryRunReport, groupEmbeddedVendorsByName } from '../scripts/vendorBackfillLogic.js';

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

const owner = { _id: 'owner1', id: 'owner1', role: 'admin' };

describe('Vendor model validation', () => {
  it('requires a name', () => {
    const doc = new Vendor({});
    const error = doc.validateSync();
    assert.ok(error);
    assert.ok(error.errors.name);
  });

  it('defaults status to Active and every optional field to an empty string', () => {
    const doc = new Vendor({ name: 'Rajesh Vegetable Supplier' });
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.status, 'Active');
    assert.equal(doc.contactPerson, '');
    assert.equal(doc.phone, '');
    assert.equal(doc.email, '');
    assert.equal(doc.address, '');
    assert.equal(doc.notes, '');
  });

  it('rejects an invalid status', () => {
    const doc = new Vendor({ name: 'Test', status: 'Pending' });
    assert.ok(doc.validateSync());
  });

  it('computes a case-insensitive, whitespace-normalized normalizedName before validation — on the async validate() path every real write (Vendor.create/.save()) actually uses', async () => {
    const doc = new Vendor({ name: '  Rajesh   Vegetable   Supplier  ' });
    await doc.validate();
    assert.equal(doc.normalizedName, 'rajesh vegetable supplier');
  });

  it('normalizeVendorName lowercases and collapses whitespace independently of the model', () => {
    assert.equal(normalizeVendorName('  Rajesh   Vegetable Supplier '), 'rajesh vegetable supplier');
    assert.equal(normalizeVendorName('RAJESH VEGETABLE SUPPLIER'), 'rajesh vegetable supplier');
    assert.equal(normalizeVendorName(''), '');
    assert.equal(normalizeVendorName(undefined), '');
  });
});

describe('adminVendorController: CRUD (stubbed model, no database)', () => {
  it('listVendors returns every vendor sorted by name when no filters are given', async () => {
    const originalFind = Vendor.find;
    const originalAggregate = Product.aggregate;
    let capturedFilter = null;
    Vendor.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([{ _id: '1', name: 'A', status: 'Active' }]) }; };
    Product.aggregate = async () => [];
    try {
      const result = await run(listVendors, { query: {} });
      assert.equal(result.status, 200);
      assert.deepEqual(capturedFilter, {});
      assert.equal(result.body.vendors.length, 1);
    } finally { Vendor.find = originalFind; Product.aggregate = originalAggregate; }
  });

  it('listVendors filters by status and rejects an invalid one before ever querying', async () => {
    const original = Vendor.find;
    let called = false;
    Vendor.find = () => { called = true; return { sort: () => Promise.resolve([]) }; };
    try {
      const bad = await run(listVendors, { query: { status: 'Pending' } });
      assert.equal(bad.status, 400);
      assert.equal(called, false);

      const good = await run(listVendors, { query: { status: 'Inactive' } });
      assert.equal(good.status, 200);
      assert.equal(called, true);
    } finally { Vendor.find = original; }
  });

  it('listVendors searches by a case-insensitive, regex-escaped normalized name (name/contact/phone search broadened in Stage 2 — see phase14.test.js)', async () => {
    const original = Vendor.find;
    let capturedFilter = null;
    Vendor.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([]) }; };
    try {
      await run(listVendors, { query: { q: 'Raj.*Supplier (new)' } });
      assert.ok(capturedFilter.$or[0].normalizedName.$regex.includes('\\.'), 'regex special characters must be escaped');
    } finally { Vendor.find = original; }
  });

  it('getVendor returns 404 when the vendor does not exist', async () => {
    const original = Vendor.findById;
    Vendor.findById = async () => null;
    try {
      const result = await run(getVendor, { params: { id: 'x' } });
      assert.equal(result.status, 404);
    } finally { Vendor.findById = original; }
  });

  it('createVendor requires a name and a valid status, and never touches the database for invalid input', async () => {
    const originalCreate = Vendor.create;
    const originalFind = Vendor.find;
    let created = false;
    Vendor.create = async () => { created = true; };
    Vendor.find = () => ({ sort: () => Promise.resolve([]) });
    try {
      const missingName = await run(createVendor, { body: { name: '  ' }, user: owner });
      assert.equal(missingName.status, 400);
      const badStatus = await run(createVendor, { body: { name: 'X', status: 'Pending' }, user: owner });
      assert.equal(badStatus.status, 400);
      assert.equal(created, false);
    } finally { Vendor.create = originalCreate; Vendor.find = originalFind; }
  });

  it('createVendor succeeds and surfaces, but never blocks on, an existing same-normalized-name vendor', async () => {
    const originalCreate = Vendor.create;
    const originalFind = Vendor.find;
    let createdPayload = null;
    Vendor.create = async (payload) => { createdPayload = payload; return { _id: 'new1', ...payload }; };
    Vendor.find = (filter) => ({
      sort: () => Promise.resolve(filter.normalizedName === 'rajesh vegetable supplier' ? [{ _id: 'existing1', name: 'Rajesh Vegetable Supplier', status: 'Active' }] : []),
    });
    try {
      const result = await run(createVendor, { body: { name: 'rajesh vegetable supplier ' }, user: owner });
      assert.equal(result.status, 201);
      assert.equal(createdPayload.createdBy, owner._id);
      assert.equal(result.body.possibleDuplicates.length, 1, 'an existing same-normalized-name vendor must be surfaced');
      assert.equal(result.body.possibleDuplicates[0].name, 'Rajesh Vegetable Supplier');
      assert.ok(result.body.vendor, 'creation must still succeed — duplicate names are detected, never blocked');
    } finally { Vendor.create = originalCreate; Vendor.find = originalFind; }
  });

  it('updateVendor recomputes normalizedName whenever name changes, and leaves it untouched otherwise', async () => {
    const original = Vendor.findByIdAndUpdate;
    let capturedUpdate = null;
    Vendor.findByIdAndUpdate = async (id, update) => { capturedUpdate = update; return { _id: id, name: update.name || 'Existing', status: 'Active' }; };
    try {
      await run(updateVendor, { params: { id: 'v1' }, body: { name: 'New Name' } });
      assert.equal(capturedUpdate.normalizedName, 'new name');

      await run(updateVendor, { params: { id: 'v1' }, body: { phone: '999' } });
      assert.equal(capturedUpdate.name, undefined);
      assert.equal(capturedUpdate.normalizedName, undefined);
    } finally { Vendor.findByIdAndUpdate = original; }
  });

  it('updateVendor returns 404 when the vendor no longer exists', async () => {
    const original = Vendor.findByIdAndUpdate;
    Vendor.findByIdAndUpdate = async () => null;
    try {
      const result = await run(updateVendor, { params: { id: 'gone' }, body: { phone: '1' } });
      assert.equal(result.status, 404);
    } finally { Vendor.findByIdAndUpdate = original; }
  });

  it('deactivateVendor sets status to Inactive without touching any other field', async () => {
    const original = Vendor.findByIdAndUpdate;
    let capturedUpdate = null;
    Vendor.findByIdAndUpdate = async (id, update) => { capturedUpdate = update; return { _id: id, status: 'Inactive' }; };
    try {
      const result = await run(deactivateVendor, { params: { id: 'v1' } });
      assert.equal(result.status, 200);
      assert.deepEqual(capturedUpdate, { status: 'Inactive' });
      assert.equal(result.body.vendor.status, 'Inactive');
    } finally { Vendor.findByIdAndUpdate = original; }
  });

  it('deactivateVendor returns 404 when the vendor no longer exists', async () => {
    const original = Vendor.findByIdAndUpdate;
    Vendor.findByIdAndUpdate = async () => null;
    try {
      const result = await run(deactivateVendor, { params: { id: 'gone' } });
      assert.equal(result.status, 404);
    } finally { Vendor.findByIdAndUpdate = original; }
  });
});

describe('vendorRoutes: permission enforcement', () => {
  it('every vendor route requires auth, then the shared products:manage/inventory:update check, before its handler', () => {
    const expectations = [
      { method: 'get', path: '/', handler: listVendors },
      { method: 'get', path: '/:id', handler: getVendor },
      { method: 'post', path: '/', handler: createVendor },
      { method: 'put', path: '/:id', handler: updateVendor },
      { method: 'patch', path: '/:id/deactivate', handler: deactivateVendor },
    ];
    for (const { method, path, handler } of expectations) {
      const layer = vendorRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
      assert.ok(layer, `${method.toUpperCase()} ${path} must exist`);
      const handlers = layer.route.stack.map((entry) => entry.handle);
      assert.equal(handlers.length, 3, `${method.toUpperCase()} ${path} must be exactly requireAuth -> permission check -> handler`);
      assert.equal(handlers[0], requireAuth);
      assert.equal(handlers[2], handler);
    }
  });

  it('the shared permission check accepts the owner and staff holding products:manage or inventory:update', () => {
    const vendorAccess = requireAnyPermission('products:manage', 'inventory:update');
    const allowed = [
      { role: 'admin' },
      // products:manage requires its products:view prerequisite to actually be held (see REQUIRES in
      // config/permissions.js) — real staff accounts always carry it alongside, same as the
      // inventory_manager role template (['products:view', 'inventory:update']).
      { role: 'staff', permissions: ['products:view', 'products:manage'] },
      { role: 'staff', permissions: ['inventory:update'] },
    ];
    for (const user of allowed) {
      let passed = false;
      vendorAccess({ user }, { status() { return this; }, json() { return this; } }, () => { passed = true; });
      assert.equal(passed, true, JSON.stringify(user));
    }
  });

  it('the shared permission check rejects other staff, delivery-only staff, and customers', () => {
    const vendorAccess = requireAnyPermission('products:manage', 'inventory:update');
    const rejected = [
      { role: 'staff', permissions: ['orders:view'] },
      { role: 'staff', permissions: ['delivery:view', 'delivery:update'] },
      { role: 'customer' },
      undefined,
    ];
    for (const user of rejected) {
      let passed = false;
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
      vendorAccess({ user }, res, () => { passed = true; });
      assert.equal(passed, false, JSON.stringify(user));
      assert.equal(res.statusCode, 403);
    }
  });
});

describe('Product model: vendorRef compatibility (additive, optional)', () => {
  it('an embedded vendor validates fine with no vendorRef at all — identical to before this field existed', () => {
    const doc = new Product({ name: 'Potato', category: 'Vegetables', description: 'x', price: 10, vendors: [{ name: 'Old Vendor', purchasePrice: 5 }] });
    assert.equal(doc.validateSync(), undefined);
    assert.equal(doc.vendors[0].vendorRef, null);
  });

  it('an embedded vendor accepts a valid vendorRef and keeps every other existing field intact', () => {
    const vendorId = new mongoose.Types.ObjectId();
    const doc = new Product({
      name: 'Potato', category: 'Vegetables', description: 'x', price: 10,
      vendors: [{ name: 'Rajesh', purchasePrice: 5, moq: '10kg', leadTime: '1 day', preferred: true, lastPurchasePrice: 4.5, notes: 'reliable', vendorRef: vendorId }],
    });
    assert.equal(doc.validateSync(), undefined);
    const vendor = doc.vendors[0];
    assert.equal(String(vendor.vendorRef), String(vendorId));
    assert.equal(vendor.name, 'Rajesh');
    assert.equal(vendor.purchasePrice, 5);
    assert.equal(vendor.moq, '10kg');
    assert.equal(vendor.leadTime, '1 day');
    assert.equal(vendor.preferred, true);
    assert.equal(vendor.lastPurchasePrice, 4.5);
    assert.equal(vendor.notes, 'reliable');
  });

  it('an existing embedded vendor _id is never regenerated by the new vendorRef field', () => {
    const existingId = new mongoose.Types.ObjectId();
    const doc = new Product({ name: 'Potato', category: 'Vegetables', description: 'x', price: 10, vendors: [{ _id: existingId, name: 'Rajesh', purchasePrice: 5 }] });
    assert.equal(String(doc.vendors[0]._id), String(existingId));
  });
});

describe('productController: vendorRef passthrough and existing vendor behavior (stubbed, no database)', () => {
  it('createProduct keeps a valid vendorRef and drops an invalid one, the same way it already handles other vendor fields', async () => {
    const original = Product.create;
    let createdPayload = null;
    Product.create = async (payload) => { createdPayload = payload; return { _id: 'p1', ...payload }; };
    try {
      const validId = new mongoose.Types.ObjectId().toString();
      await run(createProduct, { body: { name: 'A', vendors: [{ name: 'V1', purchasePrice: 10, vendorRef: validId }, { name: 'V2', purchasePrice: 5, vendorRef: 'not-an-id' }] } });
      assert.equal(createdPayload.vendors[0].vendorRef, validId);
      assert.equal(createdPayload.vendors[1].vendorRef, undefined);
    } finally { Product.create = original; }
  });

  it('createProduct still strips any client-sent vendor _id, unaffected by the new vendorRef handling', async () => {
    const original = Product.create;
    let createdPayload = null;
    Product.create = async (payload) => { createdPayload = payload; return { _id: 'p1', ...payload }; };
    try {
      await run(createProduct, { body: { name: 'A', vendors: [{ _id: 'client-sent', name: 'V1', purchasePrice: 10 }] } });
      assert.equal(createdPayload.vendors[0]._id, undefined);
    } finally { Product.create = original; }
  });

  it('updateProduct price-history logging is unaffected by vendorRef: a real purchasePrice change still logs exactly as before', async () => {
    const originalFindById = Product.findById;
    const originalUpdate = Product.findByIdAndUpdate;
    const originalInsertMany = VendorPriceHistory.insertMany;
    const existingVendorId = new mongoose.Types.ObjectId();
    let loggedChanges = null;
    Product.findById = async () => ({ vendors: [{ _id: existingVendorId, purchasePrice: 10 }] });
    Product.findByIdAndUpdate = async (id, update) => ({ _id: id, vendors: update.vendors.map((v) => ({ _id: v._id || existingVendorId, name: v.name, purchasePrice: v.purchasePrice })) });
    VendorPriceHistory.insertMany = async (changes) => { loggedChanges = changes; };
    try {
      await run(updateProduct, {
        params: { id: 'p1' },
        user: owner,
        body: { vendors: [{ _id: existingVendorId.toString(), name: 'Rajesh', purchasePrice: 15, vendorRef: new mongoose.Types.ObjectId().toString() }] },
      });
      assert.equal(loggedChanges.length, 1, 'a real purchase-price change must still be logged even when vendorRef is set in the same request');
      assert.equal(loggedChanges[0].previousPrice, 10);
      assert.equal(loggedChanges[0].newPrice, 15);
    } finally {
      Product.findById = originalFindById;
      Product.findByIdAndUpdate = originalUpdate;
      VendorPriceHistory.insertMany = originalInsertMany;
    }
  });
});

describe('existing procurement endpoints remain functional (regression)', () => {
  it('productRoutes.js still wires price-history, purchases, record-purchase and mark-received exactly as before', () => {
    const expectations = [
      { method: 'get', path: '/:productId/vendors/:vendorId/price-history', handler: listPriceHistory },
      { method: 'get', path: '/:productId/vendors/:vendorId/purchases', handler: listPurchases },
      { method: 'post', path: '/:productId/vendors/:vendorId/purchases', handler: createPurchase },
      { method: 'patch', path: '/:productId/vendors/:vendorId/purchases/:purchaseId/receive', handler: receivePurchase },
    ];
    for (const { method, path, handler } of expectations) {
      const layer = productRouter.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
      assert.ok(layer, `${method.toUpperCase()} ${path} must still exist, unchanged`);
      const handlers = layer.route.stack.map((entry) => entry.handle);
      assert.equal(handlers[handlers.length - 1], handler);
    }
  });
});

describe('vendorBackfillLogic: dry-run report (read-only, pure — no model imports, no database)', () => {
  const sampleProducts = [
    { _id: 'prod1', name: 'Potato', vendors: [{ _id: 'v1', name: 'Rajesh Vegetable Supplier', purchasePrice: 20 }] },
    { _id: 'prod2', name: 'Tomato', vendors: [{ _id: 'v2', name: 'rajesh vegetable supplier', purchasePrice: 22 }, { _id: 'v3', name: 'Singh Traders', purchasePrice: 15, vendorRef: 'existingVendor1' }] },
    { _id: 'prod3', name: 'Onion', vendors: [{ _id: 'v4', name: 'Rajesh  Vegetable  Supplier ', purchasePrice: 19 }] },
    { _id: 'prod4', name: 'Garlic', vendors: [{ _id: 'v5', name: 'Singh Trader', purchasePrice: 16 }] },
  ];

  it('groups embedded vendors by case-insensitive, whitespace-normalized name across every product', () => {
    const groups = groupEmbeddedVendorsByName(sampleProducts);
    const rajeshGroup = groups.find((group) => group.normalizedName === 'rajesh vegetable supplier');
    assert.equal(rajeshGroup.occurrences.length, 3);
    assert.deepEqual(new Set(rajeshGroup.occurrences.map((o) => o.productId)), new Set(['prod1', 'prod2', 'prod3']));
  });

  it('never groups across different spellings — "Singh Trader" and "Singh Traders" stay separate', () => {
    const groups = groupEmbeddedVendorsByName(sampleProducts);
    assert.ok(groups.find((g) => g.normalizedName === 'singh traders'));
    assert.ok(groups.find((g) => g.normalizedName === 'singh trader'));
  });

  it('flags a mixed-spelling group for review, and a single-spelling group as only "likely-same", never auto-approved', () => {
    const report = buildDryRunReport(sampleProducts);
    assert.equal(report.totalProducts, 4);
    assert.equal(report.totalEmbeddedVendors, 5);
    const rajeshGroup = report.groups.find((g) => g.normalizedName === 'rajesh vegetable supplier');
    assert.equal(rajeshGroup.productCount, 3);
    assert.equal(rajeshGroup.confidence, 'review-recommended', 'three different raw spellings should be flagged, not auto-approved');
    const singhTradersGroup = report.groups.find((g) => g.normalizedName === 'singh traders');
    assert.equal(singhTradersGroup.confidence, 'likely-same');
    assert.equal(singhTradersGroup.alreadyLinkedCount, 1);
  });

  it('ignores a blank/missing vendor name rather than forming a bogus group', () => {
    const report = buildDryRunReport([{ _id: 'p', name: 'X', vendors: [{ _id: 'v', name: '', purchasePrice: 1 }] }]);
    assert.equal(report.totalGroups, 0);
  });

  it('handles products with no vendors at all, without throwing', () => {
    const report = buildDryRunReport([{ _id: 'p', name: 'X', vendors: [] }, { _id: 'p2', name: 'Y' }]);
    assert.equal(report.totalGroups, 0);
    assert.equal(report.totalProducts, 2);
  });
});

describe('vendorBackfillLogic: applyApprovedMappings (execution requires an explicit approved mapping)', () => {
  it('creates a new Vendor only when mapping.vendor is given, and links every listed embedded vendor by its existing _id', async () => {
    const created = [];
    const updates = [];
    const StubVendor = { create: async (payload) => { const doc = { _id: 'newVendorId', ...payload }; created.push(doc); return doc; } };
    const StubProduct = { updateOne: async (filter, update) => { updates.push({ filter, update }); return { matchedCount: 1 }; } };
    const mappings = [{ vendor: { name: 'Rajesh Vegetable Supplier' }, entries: [{ productId: 'prod1', vendorId: 'v1' }, { productId: 'prod2', vendorId: 'v2' }] }];
    const result = await applyApprovedMappings(mappings, { Vendor: StubVendor, Product: StubProduct });

    assert.equal(result.createdVendors.length, 1);
    assert.equal(result.linked.length, 2);
    assert.equal(result.errors.length, 0);
    assert.equal(updates[0].filter._id, 'prod1');
    assert.equal(updates[0].filter['vendors._id'], 'v1');
    assert.equal(updates[0].update.$set['vendors.$.vendorRef'], 'newVendorId');
  });

  it('reuses an existing Vendor id instead of creating a new one when vendorId is supplied', async () => {
    let createCalled = false;
    const StubVendor = { create: async () => { createCalled = true; } };
    const StubProduct = { updateOne: async () => ({ matchedCount: 1 }) };
    const mappings = [{ vendorId: 'existingVendor1', entries: [{ productId: 'prod2', vendorId: 'v3' }] }];
    const result = await applyApprovedMappings(mappings, { Vendor: StubVendor, Product: StubProduct });
    assert.equal(createCalled, false);
    assert.equal(result.linked[0].vendorId, 'existingVendor1');
  });

  it('only touches entries explicitly listed in a mapping — a name shared by other embedded vendors is never linked automatically', async () => {
    const touched = [];
    const StubVendor = { create: async (payload) => ({ _id: 'v', ...payload }) };
    const StubProduct = { updateOne: async (filter) => { touched.push(filter); return { matchedCount: 1 }; } };
    const mappings = [{ vendor: { name: 'Rajesh Vegetable Supplier' }, entries: [{ productId: 'prod1', vendorId: 'v1' }] }];
    await applyApprovedMappings(mappings, { Vendor: StubVendor, Product: StubProduct });
    assert.equal(touched.length, 1, 'only the one explicitly-listed entry may be touched, regardless of how many other products share that vendor name');
  });

  it('never imports or calls into VendorPurchase/VendorPriceHistory — their records cannot be touched by this function', () => {
    const source = readFileSync(new URL('../scripts/vendorBackfillLogic.js', import.meta.url), 'utf8');
    // Comments are allowed to explain *why* those collections are untouched (and do); what must never
    // appear is an import of either model, or a method call on one.
    assert.ok(!/^import .*VendorPurchase/m.test(source));
    assert.ok(!/^import .*VendorPriceHistory/m.test(source));
    assert.ok(!source.includes('VendorPurchase.'));
    assert.ok(!source.includes('VendorPriceHistory.'));
  });

  it('reports an error and changes nothing for an entry whose embedded vendorId is not actually found on that product', async () => {
    const StubVendor = { create: async (payload) => ({ _id: 'v', ...payload }) };
    const StubProduct = { updateOne: async () => ({ matchedCount: 0 }) };
    const mappings = [{ vendor: { name: 'X' }, entries: [{ productId: 'prod1', vendorId: 'does-not-exist' }] }];
    const result = await applyApprovedMappings(mappings, { Vendor: StubVendor, Product: StubProduct });
    assert.equal(result.linked.length, 0);
    assert.equal(result.errors.length, 1);
  });

  it('rejects a mapping with neither vendorId nor vendor.name, and one with no entries, without throwing', async () => {
    const StubVendor = { create: async () => { throw new Error('must not be called'); } };
    const StubProduct = { updateOne: async () => { throw new Error('must not be called'); } };
    const result = await applyApprovedMappings(
      [{ entries: [{ productId: 'p', vendorId: 'v' }] }, { vendor: { name: 'X' }, entries: [] }],
      { Vendor: StubVendor, Product: StubProduct },
    );
    assert.equal(result.errors.length, 2);
    assert.equal(result.createdVendors.length, 0);
    assert.equal(result.linked.length, 0);
  });

  it('rejects non-array input rather than silently doing nothing', async () => {
    await assert.rejects(() => applyApprovedMappings('not an array', { Vendor: {}, Product: {} }));
  });
});

describe('vendorBackfill.js CLI: dry-run makes no writes (structural)', () => {
  it('the dry-run branch only reads products and never calls applyApprovedMappings, Vendor.create, or Product.updateOne', () => {
    const source = readFileSync(new URL('../scripts/vendorBackfill.js', import.meta.url), 'utf8');
    const dryRunBranch = source.slice(source.indexOf("if (args.mode === 'dry-run')"), source.indexOf('if (!args.mappingsPath)'));
    assert.match(dryRunBranch, /Product\.find\(/);
    assert.ok(!dryRunBranch.includes('applyApprovedMappings'));
    assert.ok(!dryRunBranch.includes('.updateOne('));
    assert.ok(!dryRunBranch.includes('Vendor.create'));
  });

  it('execute mode requires --mappings and only then calls applyApprovedMappings', () => {
    const source = readFileSync(new URL('../scripts/vendorBackfill.js', import.meta.url), 'utf8');
    assert.match(source, /if \(!args\.mappingsPath\) throw new Error/);
    assert.match(source, /applyApprovedMappings\(mappings, \{ Vendor, Product \}\)/);
  });
});
