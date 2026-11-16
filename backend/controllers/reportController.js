import BulkOrder from '../models/BulkOrder.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import VendorPurchase from '../models/VendorPurchase.js';
import asyncHandler from '../utils/asyncHandler.js';
import { orderTypeCondition } from '../config/permissions.js';
import { buildExport } from '../utils/reportExport.js';
import {
  REPORT_TIMEZONE, dateFormatFor, describeRange, fillSeries, istDateString, istStartOfDay, percentChange, resolveRange, round2,
} from '../utils/reportRanges.js';

// Owner-only reports. Nothing here selects supplier costs, contact details or images, and every list is
// capped, so a report never loads a collection into memory.
//
// Revenue rules (what the database actually records):
//  - Order value      = totalAmount of orders placed in the period that are not cancelled.
//  - Delivered value  = totalAmount of delivered orders. This is the report's "revenue".
//  - Collected value  = totalAmount of orders whose paymentStatus is 'paid'. Cash on delivery is never
//                       marked paid by any code path, so this is expected to be zero and is shown as
//                       "not tracked" rather than guessed.
//  - Bulk-order quotations are pipeline figures only and are never added to revenue.

export const LOW_STOCK_DEFAULT = 10;
const MAX_TIME_MS = 20000;
const TOP_LIMIT = 10;
const LIST_LIMIT = 50;
const STATUS_ORDER = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
const ACTIVE_ORDER_STATUSES = ['placed', 'confirmed', 'preparing', 'out_for_delivery'];
const BULK_STATUS_ORDER = ['Pending', 'Reviewing', 'Quoted', 'Approved', 'Processing', 'Completed', 'Rejected', 'Cancelled'];
const APPROVED_BULK = ['Approved', 'Processing', 'Completed'];

// Normal orders and pre-orders live in the Order collection; bulk requests have their own model.
const SALES_TYPES = orderTypeCondition(['normal', 'preorder']);
const notCancelled = { $ne: ['$orderStatus', 'cancelled'] };
const isDelivered = { $eq: ['$orderStatus', 'delivered'] };
const sumIf = (condition, value) => ({ $sum: { $cond: [condition, value, 0] } });
const typeOf = { $ifNull: ['$orderType', 'normal'] };

function aggregate(Model, pipeline) {
  const query = Model.aggregate(pipeline);
  return typeof query.option === 'function' ? query.option({ maxTimeMS: MAX_TIME_MS }) : query;
}

const orderMatch = (range, extra = {}) => ({ createdAt: { $gte: range.from, $lt: range.to }, orderType: SALES_TYPES, ...extra });
const dayKey = (field, format) => ({ $dateToString: { format, date: field, timezone: REPORT_TIMEZONE } });

// ---------------------------------------------------------------- sales
export function salesSummaryPipeline(range) {
  return [
    { $match: orderMatch(range) },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        activeOrders: sumIf(notCancelled, 1),
        orderValue: sumIf(notCancelled, '$totalAmount'),
        deliveredOrders: sumIf(isDelivered, 1),
        deliveredValue: sumIf(isDelivered, '$totalAmount'),
        cancelledOrders: sumIf({ $eq: ['$orderStatus', 'cancelled'] }, 1),
        cancelledValue: sumIf({ $eq: ['$orderStatus', 'cancelled'] }, '$totalAmount'),
        collectedOrders: sumIf({ $and: [notCancelled, { $eq: ['$paymentStatus', 'paid'] }] }, 1),
        collectedValue: sumIf({ $and: [notCancelled, { $eq: ['$paymentStatus', 'paid'] }] }, '$totalAmount'),
      },
    },
  ];
}

export function shapeSalesSummary(row) {
  const r = row || {};
  const activeOrders = r.activeOrders || 0;
  return {
    totalOrders: r.totalOrders || 0,
    activeOrders,
    orderValue: round2(r.orderValue),
    averageOrderValue: activeOrders ? round2((r.orderValue || 0) / activeOrders) : 0,
    deliveredOrders: r.deliveredOrders || 0,
    deliveredValue: round2(r.deliveredValue),
    cancelledOrders: r.cancelledOrders || 0,
    cancelledValue: round2(r.cancelledValue),
    collectedOrders: r.collectedOrders || 0,
    collectedValue: round2(r.collectedValue),
  };
}

const salesChanges = (current, previous) => ({
  orderValue: percentChange(current.orderValue, previous.orderValue),
  deliveredValue: percentChange(current.deliveredValue, previous.deliveredValue),
  activeOrders: percentChange(current.activeOrders, previous.activeOrders),
  deliveredOrders: percentChange(current.deliveredOrders, previous.deliveredOrders),
  averageOrderValue: percentChange(current.averageOrderValue, previous.averageOrderValue),
});

async function salesSummaries(range) {
  const previous = { from: range.previous.from, to: range.previous.to };
  const [current, before] = await Promise.all([
    aggregate(Order, salesSummaryPipeline(range)),
    aggregate(Order, salesSummaryPipeline(previous)),
  ]);
  return { summary: shapeSalesSummary(current[0]), previous: shapeSalesSummary(before[0]) };
}

async function salesReport(range) {
  const [{ summary, previous }, seriesRows, typeRows] = await Promise.all([
    salesSummaries(range),
    aggregate(Order, [
      { $match: orderMatch(range) },
      { $group: { _id: dayKey('$createdAt', dateFormatFor(range)), orders: sumIf(notCancelled, 1), orderValue: sumIf(notCancelled, '$totalAmount'), deliveredValue: sumIf(isDelivered, '$totalAmount') } },
      { $sort: { _id: 1 } },
    ]),
    aggregate(Order, [
      { $match: orderMatch(range) },
      { $group: { _id: typeOf, orders: sumIf(notCancelled, 1), orderValue: sumIf(notCancelled, '$totalAmount'), deliveredValue: sumIf(isDelivered, '$totalAmount') } },
    ]),
  ]);
  const byType = ['normal', 'preorder'].map((type) => {
    const row = typeRows.find((entry) => entry._id === type) || {};
    return { type, orders: row.orders || 0, orderValue: round2(row.orderValue), deliveredValue: round2(row.deliveredValue) };
  });
  return {
    summary,
    previous,
    changes: salesChanges(summary, previous),
    series: fillSeries(range, seriesRows, { orders: 0, orderValue: 0, deliveredValue: 0 }).map((row) => ({ ...row, orderValue: round2(row.orderValue), deliveredValue: round2(row.deliveredValue) })),
    byType,
    collection: {
      tracked: summary.collectedOrders > 0,
      note: 'Cash on delivery is not recorded as collected anywhere in Janai, so actual collected revenue cannot be reported. "Revenue" here is the value of delivered orders.',
    },
  };
}

// ---------------------------------------------------------------- overview
async function overviewReport(range) {
  const [{ summary, previous }, totalCustomers, newCustomers] = await Promise.all([
    salesSummaries(range),
    User.countDocuments({ role: 'customer' }),
    User.countDocuments({ role: 'customer', createdAt: { $gte: range.from, $lt: range.to } }),
  ]);
  return {
    cards: {
      revenue: { value: summary.deliveredValue, previous: previous.deliveredValue, change: percentChange(summary.deliveredValue, previous.deliveredValue) },
      totalOrders: { value: summary.totalOrders, previous: previous.totalOrders, change: percentChange(summary.totalOrders, previous.totalOrders) },
      deliveredOrders: { value: summary.deliveredOrders, previous: previous.deliveredOrders, change: percentChange(summary.deliveredOrders, previous.deliveredOrders) },
      averageOrderValue: { value: summary.averageOrderValue, previous: previous.averageOrderValue, change: percentChange(summary.averageOrderValue, previous.averageOrderValue) },
      totalCustomers: { value: totalCustomers, newInPeriod: newCustomers },
    },
    summary,
    collection: { tracked: summary.collectedOrders > 0 },
  };
}

// ---------------------------------------------------------------- orders
export function shapeOrderStatuses(rows) {
  const empty = () => Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  const byType = { normal: empty(), preorder: empty() };
  for (const row of rows || []) {
    const type = row._id?.type;
    const status = row._id?.status;
    if (byType[type] && status in byType[type]) byType[type][status] += row.count || 0;
  }
  const totals = empty();
  for (const type of Object.keys(byType)) for (const status of STATUS_ORDER) totals[status] += byType[type][status];
  const total = STATUS_ORDER.reduce((sum, status) => sum + totals[status], 0);
  const group = (counts) => ({
    total: STATUS_ORDER.reduce((sum, status) => sum + counts[status], 0),
    pending: counts.placed,
    processing: counts.confirmed + counts.preparing,
    outForDelivery: counts.out_for_delivery,
    delivered: counts.delivered,
    cancelled: counts.cancelled,
  });
  return {
    totals: group(totals),
    byType: { normal: group(byType.normal), preorder: group(byType.preorder) },
    distribution: STATUS_ORDER.map((status) => ({ status, count: totals[status], percent: total ? Math.round((totals[status] / total) * 1000) / 10 : 0 })),
  };
}

async function ordersReport(range) {
  const [statusRows, seriesRows, bulkRequests] = await Promise.all([
    aggregate(Order, [{ $match: orderMatch(range) }, { $group: { _id: { type: typeOf, status: '$orderStatus' }, count: { $sum: 1 } } }]),
    aggregate(Order, [
      { $match: orderMatch(range) },
      { $group: { _id: dayKey('$createdAt', dateFormatFor(range)), placed: { $sum: 1 }, delivered: sumIf(isDelivered, 1), cancelled: sumIf({ $eq: ['$orderStatus', 'cancelled'] }, 1) } },
      { $sort: { _id: 1 } },
    ]),
    BulkOrder.countDocuments({ createdAt: { $gte: range.from, $lt: range.to } }),
  ]);
  return {
    ...shapeOrderStatuses(statusRows),
    series: fillSeries(range, seriesRows, { placed: 0, delivered: 0, cancelled: 0 }),
    // Bulk requests are a separate quotation workflow, so they are counted here but never mixed into the order totals.
    bulkRequests,
  };
}

// ---------------------------------------------------------------- inventory / stock
const inventoryName = { name: 1, category: 1, unit: 1, stock: 1 };

async function stockLists(threshold) {
  const [lowRows, outRows] = await Promise.all([
    Product.find({ stock: { $gt: 0, $lte: threshold } }).select(inventoryName).sort({ stock: 1, name: 1 }).limit(LIST_LIMIT + 1).lean(),
    Product.find({ stock: { $lte: 0 } }).select(inventoryName).sort({ name: 1 }).limit(LIST_LIMIT + 1).lean(),
  ]);
  const shape = (rows) => ({ truncated: rows.length > LIST_LIMIT, products: rows.slice(0, LIST_LIMIT).map((p) => ({ id: String(p._id), name: p.name, category: p.category, unit: p.unit, stock: p.stock })) });
  return { low: shape(lowRows), out: shape(outRows) };
}

async function inventoryReport(range, { lowStock }) {
  const [totalsRows, lists, receivedRows] = await Promise.all([
    aggregate(Product, [{
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        totalStock: { $sum: '$stock' },
        outOfStock: sumIf({ $lte: ['$stock', 0] }, 1),
        lowStock: sumIf({ $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', lowStock] }] }, 1),
      },
    }]),
    stockLists(lowStock),
    aggregate(VendorPurchase, [
      { $match: { status: 'Received', receivedAt: { $gte: range.from, $lt: range.to } } },
      { $group: { _id: '$unit', purchases: { $sum: 1 }, quantity: { $sum: '$receivedQuantity' } } },
      { $sort: { _id: 1 } },
      { $limit: 50 },
    ]),
  ]);
  const totals = totalsRows[0] || {};
  return {
    threshold: lowStock,
    totals: { totalProducts: totals.totalProducts || 0, totalStock: round2(totals.totalStock), outOfStock: totals.outOfStock || 0, lowStock: totals.lowStock || 0 },
    lowStock: lists.low,
    outOfStock: lists.out,
    movement: {
      // Only supplier receipts carry a date. Sales reservations, cancellations and manual stock edits do not
      // write a history record, so a full stock-movement ledger cannot be built from this database.
      tracked: false,
      note: 'Janai does not record a stock movement history. Only goods received from suppliers are dated, shown below by unit.',
      receivedFromSuppliers: receivedRows.map((row) => ({ unit: row._id, purchases: row.purchases, quantity: round2(row.quantity) })),
    },
  };
}

// ---------------------------------------------------------------- products & categories
// Sales come from the item snapshots stored on each order (price and quantity at the time of the sale),
// never from current product prices. Cancelled orders are excluded.
function productLines(range) {
  return [
    { $match: orderMatch(range, { orderStatus: { $ne: 'cancelled' } }) },
    { $unwind: '$items' },
    {
      $group: {
        _id: { $ifNull: ['$items.product', '$items.name'] },
        productId: { $first: '$items.product' },
        name: { $first: '$items.name' },
        unit: { $first: '$items.unit' },
        quantity: { $sum: '$items.quantity' },
        sales: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
        orders: { $sum: 1 },
      },
    },
  ];
}

export function categoryPipeline(range) {
  return [
    ...productLines(range),
    // Only the category is pulled from the product, never its images or supplier data.
    { $lookup: { from: Product.collection.collectionName, let: { pid: '$productId' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$pid'] } } }, { $project: { category: 1 } }], as: 'product' } },
    { $project: { quantity: 1, sales: 1, category: { $ifNull: [{ $arrayElemAt: ['$product.category', 0] }, 'Unknown (product removed)'] } } },
    { $group: { _id: '$category', quantity: { $sum: '$quantity' }, sales: { $sum: '$sales' }, products: { $sum: 1 } } },
    { $sort: { sales: -1, _id: 1 } },
    { $limit: 20 },
  ];
}

async function productsReport(range, { by, lowStock }) {
  const [topRows, categoryRows, lists] = await Promise.all([
    aggregate(Order, [...productLines(range), { $sort: { [by]: -1, _id: 1 } }, { $limit: TOP_LIMIT }]),
    aggregate(Order, categoryPipeline(range)),
    stockLists(lowStock),
  ]);
  return {
    sortedBy: by,
    topProducts: topRows.map((row) => ({ id: row.productId ? String(row.productId) : null, name: row.name, unit: row.unit, quantity: round2(row.quantity), sales: round2(row.sales), orders: row.orders })),
    categories: categoryRows.map((row) => ({ category: row._id, quantity: round2(row.quantity), sales: round2(row.sales), products: row.products })),
    categoryNote: 'Categories are taken from each product as it is today; items whose product was deleted are grouped as unknown.',
    threshold: lowStock,
    lowStock: lists.low,
    outOfStock: lists.out,
  };
}

// ---------------------------------------------------------------- customers
const bucketLabels = { 1: '1 order', 2: '2 orders', 3: '3-4 orders', many: '5 or more orders' };

export function shapeCustomerFacet(facet) {
  const summary = facet?.summary?.[0] || {};
  const buckets = ['1', '2', '3', 'many'].map((key) => {
    const row = (facet?.buckets || []).find((entry) => String(entry._id) === key);
    return { label: bucketLabels[key], customers: row?.customers || 0 };
  });
  return {
    activeCustomers: summary.activeCustomers || 0,
    repeatCustomers: summary.repeatCustomers || 0,
    ordersPlaced: summary.orders || 0,
    orderValue: round2(summary.value),
    buckets,
    // Names only. Email and phone are never selected, so there is nothing to mask or leak.
    topCustomers: (facet?.top || []).map((row) => ({ id: String(row._id), name: row.name || 'Customer', orders: row.orders, value: round2(row.value) })),
  };
}

async function customersReport(range) {
  const [totalCustomers, newCustomers, previousNew, facetRows, registrations] = await Promise.all([
    User.countDocuments({ role: 'customer' }),
    User.countDocuments({ role: 'customer', createdAt: { $gte: range.from, $lt: range.to } }),
    User.countDocuments({ role: 'customer', createdAt: { $gte: range.previous.from, $lt: range.previous.to } }),
    aggregate(Order, [
      { $match: orderMatch(range, { orderStatus: { $ne: 'cancelled' } }) },
      { $group: { _id: '$user', orders: { $sum: 1 }, value: { $sum: '$totalAmount' } } },
      {
        $facet: {
          summary: [{ $group: { _id: null, activeCustomers: { $sum: 1 }, repeatCustomers: sumIf({ $gte: ['$orders', 2] }, 1), orders: { $sum: '$orders' }, value: { $sum: '$value' } } }],
          buckets: [{ $bucket: { groupBy: '$orders', boundaries: [1, 2, 3, 5], default: 'many', output: { customers: { $sum: 1 } } } }],
          top: [
            { $sort: { value: -1, _id: 1 } },
            { $limit: TOP_LIMIT },
            { $lookup: { from: User.collection.collectionName, let: { id: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$id'] } } }, { $project: { firstName: 1, lastName: 1 } }], as: 'user' } },
            { $project: { orders: 1, value: 1, name: { $trim: { input: { $concat: [{ $ifNull: [{ $arrayElemAt: ['$user.firstName', 0] }, ''] }, ' ', { $ifNull: [{ $arrayElemAt: ['$user.lastName', 0] }, ''] }] } } } } },
          ],
        },
      },
    ]),
    aggregate(User, [
      { $match: { role: 'customer', createdAt: { $gte: range.from, $lt: range.to } } },
      { $group: { _id: dayKey('$createdAt', dateFormatFor(range)), registrations: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  return {
    totalCustomers,
    newCustomers,
    newCustomersChange: percentChange(newCustomers, previousNew),
    ...shapeCustomerFacet(facetRows[0]),
    registrations: fillSeries(range, registrations, { registrations: 0 }),
  };
}

// ---------------------------------------------------------------- pre-orders
export function shapePreorders(facet, today) {
  const summary = facet?.summary?.[0] || {};
  const statuses = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  for (const row of facet?.byStatus || []) if (row._id in statuses) statuses[row._id] = row.count;
  return {
    asOf: istDateString(today),
    total: summary.total || 0,
    value: round2(summary.value),
    upcoming: summary.upcoming || 0,
    overdue: summary.overdue || 0,
    completed: statuses.delivered,
    cancelled: statuses.cancelled,
    statuses: STATUS_ORDER.map((status) => ({ status, count: statuses[status] })),
    deliveryDates: (facet?.distribution || []).map((row) => ({ date: row._id, orders: row.orders, value: round2(row.value) })),
  };
}

async function preordersReport(range, _opts, now) {
  const today = istStartOfDay(now);
  const active = { $in: ['$orderStatus', ACTIVE_ORDER_STATUSES] };
  const match = { createdAt: { $gte: range.from, $lt: range.to }, orderType: 'preorder' };
  const rows = await aggregate(Order, [
    { $match: match },
    {
      $facet: {
        summary: [{
          $group: {
            _id: null,
            total: { $sum: 1 },
            value: sumIf(notCancelled, '$totalAmount'),
            upcoming: sumIf({ $and: [active, { $gte: ['$deliveryDate', today] }] }, 1),
            overdue: sumIf({ $and: [active, { $lt: ['$deliveryDate', today] }] }, 1),
          },
        }],
        byStatus: [{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }],
        distribution: [
          { $match: { orderStatus: { $ne: 'cancelled' } } },
          { $group: { _id: dayKey('$deliveryDate', '%Y-%m-%d'), orders: { $sum: 1 }, value: { $sum: '$totalAmount' } } },
          { $sort: { _id: 1 } },
          { $limit: 100 },
        ],
        series: [{ $group: { _id: dayKey('$createdAt', dateFormatFor(range)), placed: { $sum: 1 } } }, { $sort: { _id: 1 } }],
      },
    },
  ]);
  return { ...shapePreorders(rows[0], today), series: fillSeries(range, rows[0]?.series, { placed: 0 }) };
}

// ---------------------------------------------------------------- bulk orders
export function shapeBulk(facet) {
  const counts = Object.fromEntries(BULK_STATUS_ORDER.map((status) => [status, { count: 0, quotedRequests: 0, quotationValue: 0 }]));
  for (const row of facet?.byStatus || []) {
    if (counts[row._id]) counts[row._id] = { count: row.count || 0, quotedRequests: row.quotedRequests || 0, quotationValue: round2(row.quotationValue) };
  }
  const sum = (statuses, field) => round2(statuses.reduce((total, status) => total + counts[status][field], 0));
  const total = BULK_STATUS_ORDER.reduce((acc, status) => acc + counts[status].count, 0);
  return {
    total,
    statuses: BULK_STATUS_ORDER.map((status) => ({ status, count: counts[status].count, quotationValue: counts[status].quotationValue })),
    quotedRequests: BULK_STATUS_ORDER.reduce((acc, status) => acc + counts[status].quotedRequests, 0),
    // Pipeline figures taken from stored quotations. They are not revenue: bulk requests are not orders and
    // payment for them is not recorded.
    openQuotationValue: sum(['Quoted'], 'quotationValue'),
    approvedQuotationValue: sum(APPROVED_BULK, 'quotationValue'),
    note: 'Quotation values are not revenue. They are estimates sent to customers; bulk requests are not linked to orders or payments.',
  };
}

async function bulkReport(range) {
  const hasQuote = { $ne: [{ $type: '$quotation.totalAmount' }, 'missing'] };
  const quoteValue = { $ifNull: ['$quotation.totalAmount', 0] };
  const rows = await aggregate(BulkOrder, [
    { $match: { createdAt: { $gte: range.from, $lt: range.to } } },
    {
      $facet: {
        byStatus: [{ $group: { _id: '$status', count: { $sum: 1 }, quotedRequests: sumIf(hasQuote, 1), quotationValue: { $sum: quoteValue } } }],
        series: [{ $group: { _id: dayKey('$createdAt', dateFormatFor(range)), requests: { $sum: 1 }, quotationValue: { $sum: quoteValue } } }, { $sort: { _id: 1 } }],
      },
    },
  ]);
  const series = fillSeries(range, rows[0]?.series, { requests: 0, quotationValue: 0 }).map((row) => ({ ...row, quotationValue: round2(row.quotationValue) }));
  return { ...shapeBulk(rows[0]), series };
}

export const sections = {
  overview: overviewReport,
  sales: salesReport,
  orders: ordersReport,
  products: productsReport,
  customers: customersReport,
  preorders: preordersReport,
  bulk: bulkReport,
  inventory: inventoryReport,
};

export function readOptions(query = {}) {
  let by = 'sales';
  if (query.by !== undefined && query.by !== '') {
    if (!['sales', 'quantity'].includes(query.by)) return { error: 'Sort products by sales or quantity.' };
    by = query.by;
  }
  let lowStock = LOW_STOCK_DEFAULT;
  if (query.lowStock !== undefined && query.lowStock !== '') {
    lowStock = Number(query.lowStock);
    if (!Number.isInteger(lowStock) || lowStock < 1 || lowStock > 1000) return { error: 'The low-stock level must be a whole number from 1 to 1000.' };
  }
  return { by, lowStock };
}

export async function buildReport(section, query, now = new Date()) {
  const range = resolveRange(query, now);
  if (range.error) return { error: range.error };
  const options = readOptions(query);
  if (options.error) return { error: options.error };
  const data = await sections[section](range, options, now);
  return { range, report: { section, range: describeRange(range), generatedAt: now.toISOString(), ...data } };
}

export const reportHandler = (section) => asyncHandler(async (req, res) => {
  const result = await buildReport(section, req.query);
  if (result.error) return res.status(400).json({ message: result.error });
  res.set('Cache-Control', 'no-store');
  return res.json(result.report);
});

export const exportReport = asyncHandler(async (req, res) => {
  const section = String(req.query.section || '');
  const format = String(req.query.format || '');
  if (!sections[section]) return res.status(400).json({ message: 'Choose a valid report to export.' });
  if (!['csv', 'pdf'].includes(format)) return res.status(400).json({ message: 'Choose csv or pdf.' });
  const result = await buildReport(section, req.query);
  if (result.error) return res.status(400).json({ message: result.error });
  const file = buildExport(result.report, format);
  res.set({ 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' });
  return res.send(file.body);
});
