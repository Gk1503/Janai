import ExcelJS from 'exceljs';
import Product from '../models/Product.js';
import Vendor from '../models/Vendor.js';
import VendorPurchase from '../models/VendorPurchase.js';
import asyncHandler from '../utils/asyncHandler.js';

const STATUSES = ['Ordered', 'Received'];

// Resolves every embedded Product.vendors row that carries a vendorRef, across the WHOLE catalog —
// the one and only link this report is allowed to use (never a name match, and a legacy/unlinked row
// with no vendorRef can never appear here at all, by construction). A single query regardless of
// catalog size, so building this index never becomes N+1.
async function buildEmbeddedVendorIndex() {
  const products = await Product.find({ 'vendors.vendorRef': { $ne: null } }, { name: 1, category: 1, unit: 1, vendors: 1 });
  const embeddedToProduct = new Map();
  const embeddedToCentralVendorId = new Map();
  for (const product of products) {
    for (const embedded of product.vendors) {
      if (!embedded.vendorRef) continue;
      const embeddedId = String(embedded._id);
      embeddedToProduct.set(embeddedId, { productId: String(product._id), productName: product.name, category: product.category, unit: product.unit });
      embeddedToCentralVendorId.set(embeddedId, String(embedded.vendorRef));
    }
  }
  return { embeddedToProduct, embeddedToCentralVendorId };
}

// Applies the shared filter set (vendor, product, status, date range) and returns the matching
// VendorPurchase rows plus everything needed to resolve each one back to its central vendor and
// product. Exactly 3 queries total (products, the purchases themselves, and the central vendors
// actually referenced) no matter how large the purchase history grows — never one query per vendor or
// per product.
async function resolveFilteredPurchases(query) {
  const { embeddedToProduct, embeddedToCentralVendorId } = await buildEmbeddedVendorIndex();
  let embeddedVendorIds = Array.from(embeddedToCentralVendorId.keys());

  const { vendorId, productId, status, from, to } = query || {};
  if (vendorId) embeddedVendorIds = embeddedVendorIds.filter((id) => embeddedToCentralVendorId.get(id) === String(vendorId));

  if (!embeddedVendorIds.length) return { purchases: [], embeddedToProduct, embeddedToCentralVendorId, vendorsById: new Map() };

  const filter = { vendor: { $in: embeddedVendorIds } };
  if (productId) filter.product = productId;
  if (status && STATUSES.includes(status)) filter.status = status;
  if (from || to) {
    filter.purchaseDate = {};
    if (from) filter.purchaseDate.$gte = new Date(from);
    if (to) filter.purchaseDate.$lte = new Date(to);
  }

  const purchases = await VendorPurchase.find(filter).sort({ purchaseDate: -1, createdAt: -1 });

  const centralVendorIds = Array.from(new Set(purchases.map((purchase) => embeddedToCentralVendorId.get(String(purchase.vendor))).filter(Boolean)));
  const vendors = centralVendorIds.length ? await Vendor.find({ _id: { $in: centralVendorIds } }, { name: 1, status: 1 }) : [];
  const vendorsById = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));

  return { purchases, embeddedToProduct, embeddedToCentralVendorId, vendorsById };
}

// One purchase, resolved back to its product/central-vendor metadata. `vendorId` is null for a
// purchase whose embedded row (unusually) has no vendorRef — resolveFilteredPurchases already only
// includes embedded ids that DO have one, so this is a defensive fallback, not an expected case.
function enrichPurchase(purchase, embeddedToProduct, embeddedToCentralVendorId, vendorsById) {
  const productMeta = embeddedToProduct.get(String(purchase.vendor)) || {};
  const vendorId = embeddedToCentralVendorId.get(String(purchase.vendor)) || null;
  const vendor = vendorId ? vendorsById.get(vendorId) : null;
  return {
    purchase,
    productId: productMeta.productId || null,
    productName: productMeta.productName || '',
    category: productMeta.category || '',
    vendorId,
    vendorName: vendor?.name || '',
    vendorStatus: vendor?.status || null,
  };
}

function validDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

// Vendor Analytics & Reports (Stage 8). Every figure here is computed from the SAME filtered,
// enriched purchase set in memory — no second round of queries per table, so nothing here becomes
// N+1 regardless of how many vendors/products/months appear in the result. Ordered and Received are
// always kept in separate figures (never blended into one, and never labelled as a payment — Janai
// has no payment-tracking system); quantity totals are always grouped by unit (kg and L, say, are
// never summed); a Received row with a falsy receivedQuantity is excluded from amount/quantity
// aggregation entirely, the same defensive guard already used in adminVendorController.js and
// vendorController.js. Legacy embedded rows with no vendorRef can never reach this report at all,
// since buildEmbeddedVendorIndex only ever indexes rows that already have one.
export const getVendorAnalytics = asyncHandler(async (req, res) => {
  const { purchases, embeddedToProduct, embeddedToCentralVendorId, vendorsById } = await resolveFilteredPurchases(req.query);
  const enriched = purchases.map((purchase) => enrichPurchase(purchase, embeddedToProduct, embeddedToCentralVendorId, vendorsById));

  const activeVendorIds = new Set();
  const linkedProductIds = new Set();
  const summaryByUnit = { ordered: new Map(), received: new Map() };
  const summary = { ordered: { amount: 0 }, received: { amount: 0 } };
  const vendorStats = new Map();
  const productStats = new Map();
  const byProductVendorRows = new Map();
  const monthlyMap = new Map();

  for (const row of enriched) {
    if (row.vendorId && row.vendorStatus === 'Active') activeVendorIds.add(row.vendorId);
    if (row.productId) linkedProductIds.add(row.productId);

    const isReceived = row.purchase.status === 'Received';
    // Same defensive guard as getVendorPurchases/listPurchases: a Received row with no actual
    // receivedQuantity contributes to no amount/quantity total anywhere in this report.
    const countsForAmount = !(isReceived && !row.purchase.receivedQuantity);

    if (countsForAmount) {
      if (isReceived) {
        summary.received.amount += row.purchase.receivedQuantity * row.purchase.rate;
        summaryByUnit.received.set(row.purchase.unit, (summaryByUnit.received.get(row.purchase.unit) || 0) + row.purchase.receivedQuantity);
      } else {
        summary.ordered.amount += row.purchase.totalAmount;
        summaryByUnit.ordered.set(row.purchase.unit, (summaryByUnit.ordered.get(row.purchase.unit) || 0) + row.purchase.quantity);
      }
    }

    if (row.vendorId) {
      const bucket = vendorStats.get(row.vendorId) || { vendorId: row.vendorId, vendorName: row.vendorName, purchaseCount: 0, orderedAmount: 0, receivedAmount: 0, lastPurchaseDate: null };
      bucket.purchaseCount += 1;
      if (countsForAmount) {
        if (isReceived) bucket.receivedAmount += row.purchase.receivedQuantity * row.purchase.rate;
        else bucket.orderedAmount += row.purchase.totalAmount;
      }
      if (validDate(row.purchase.purchaseDate) && (!bucket.lastPurchaseDate || row.purchase.purchaseDate > bucket.lastPurchaseDate)) bucket.lastPurchaseDate = row.purchase.purchaseDate;
      vendorStats.set(row.vendorId, bucket);
    }

    if (row.productId) {
      const key = `${row.productId}:${row.vendorId || 'unlinked'}`;
      const bucket = productStats.get(key) || {
        productId: row.productId, productName: row.productName, vendorId: row.vendorId, vendorName: row.vendorName,
        purchaseCount: 0, totalAmount: 0, orderedQuantityByUnit: new Map(), receivedQuantityByUnit: new Map(),
      };
      bucket.purchaseCount += 1;
      if (countsForAmount) {
        if (isReceived) {
          bucket.totalAmount += row.purchase.receivedQuantity * row.purchase.rate;
          bucket.receivedQuantityByUnit.set(row.purchase.unit, (bucket.receivedQuantityByUnit.get(row.purchase.unit) || 0) + row.purchase.receivedQuantity);
        } else {
          bucket.totalAmount += row.purchase.totalAmount;
          bucket.orderedQuantityByUnit.set(row.purchase.unit, (bucket.orderedQuantityByUnit.get(row.purchase.unit) || 0) + row.purchase.quantity);
        }
      }
      productStats.set(key, bucket);
    }

    if (row.productId && row.vendorId) {
      const key = `${row.productId}:${row.vendorId}`;
      if (!byProductVendorRows.has(key)) byProductVendorRows.set(key, []);
      byProductVendorRows.get(key).push(row);
    }

    if (validDate(row.purchase.purchaseDate)) {
      const month = `${row.purchase.purchaseDate.getUTCFullYear()}-${String(row.purchase.purchaseDate.getUTCMonth() + 1).padStart(2, '0')}`;
      const bucket = monthlyMap.get(month) || { month, purchaseCount: 0, orderedAmount: 0, receivedAmount: 0 };
      bucket.purchaseCount += 1;
      if (countsForAmount) {
        if (isReceived) bucket.receivedAmount += row.purchase.receivedQuantity * row.purchase.rate;
        else bucket.orderedAmount += row.purchase.totalAmount;
      }
      monthlyMap.set(month, bucket);
    }
  }

  const byVendor = Array.from(vendorStats.values());
  const byProduct = Array.from(productStats.values())
    .map((bucket) => ({
      ...bucket,
      orderedQuantityByUnit: Array.from(bucket.orderedQuantityByUnit, ([unit, quantity]) => ({ unit, quantity })),
      receivedQuantityByUnit: Array.from(bucket.receivedQuantityByUnit, ([unit, quantity]) => ({ unit, quantity })),
    }))
    .sort((a, b) => b.purchaseCount - a.purchaseCount);
  const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // Price comparison: for each (product, vendor) pair, that vendor's own latest rate and — only when
  // an earlier purchase from the SAME vendor shares the exact same unit — that vendor's own previous
  // rate. Never compares one vendor's rate to a different vendor's rate, and never compares across
  // incompatible units. Only products with more than one distinct supplying central vendor are kept.
  const priceRowsByProduct = new Map();
  for (const rows of byProductVendorRows.values()) {
    const sorted = [...rows].sort((a, b) => (validDate(b.purchase.purchaseDate) ? b.purchase.purchaseDate : 0) - (validDate(a.purchase.purchaseDate) ? a.purchase.purchaseDate : 0));
    const latestRow = sorted[0];
    const previousRow = sorted.find((candidate, index) => index > 0 && candidate.purchase.unit === latestRow.purchase.unit);
    const entry = {
      productId: latestRow.productId,
      productName: latestRow.productName,
      vendorId: latestRow.vendorId,
      vendorName: latestRow.vendorName,
      latestRate: latestRow.purchase.rate,
      unit: latestRow.purchase.unit,
      previousRate: previousRow ? previousRow.purchase.rate : null,
      difference: previousRow ? Math.round((latestRow.purchase.rate - previousRow.purchase.rate) * 100) / 100 : null,
    };
    if (!priceRowsByProduct.has(entry.productId)) priceRowsByProduct.set(entry.productId, []);
    priceRowsByProduct.get(entry.productId).push(entry);
  }
  const priceComparison = [];
  for (const rows of priceRowsByProduct.values()) {
    if (new Set(rows.map((row) => row.vendorId)).size > 1) priceComparison.push(...rows);
  }

  res.json({
    summary: {
      activeVendorCount: activeVendorIds.size,
      linkedProductCount: linkedProductIds.size,
      ordered: { amount: summary.ordered.amount, quantityByUnit: Array.from(summaryByUnit.ordered, ([unit, quantity]) => ({ unit, quantity })) },
      received: { amount: summary.received.amount, quantityByUnit: Array.from(summaryByUnit.received, ([unit, quantity]) => ({ unit, quantity })) },
    },
    byVendor,
    byProduct,
    priceComparison,
    monthly,
  });
});

// Flat, per-purchase export of the exact same filtered set the analytics endpoint uses — same
// permission gate, same filters, same resolution logic (via resolveFilteredPurchases), so it can
// never disagree with what the owner is already looking at. Nothing here is a second purchase API:
// it reads the existing VendorPurchase records only, never writes anything.
export const exportVendorPurchases = asyncHandler(async (req, res) => {
  const { purchases, embeddedToProduct, embeddedToCentralVendorId, vendorsById } = await resolveFilteredPurchases(req.query);
  const enriched = purchases.map((purchase) => enrichPurchase(purchase, embeddedToProduct, embeddedToCentralVendorId, vendorsById));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Vendor Purchases');
  sheet.columns = [
    { header: 'Vendor', key: 'vendorName', width: 24 },
    { header: 'Product', key: 'productName', width: 24 },
    { header: 'Purchase Date', key: 'purchaseDate', width: 16 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Rate', key: 'rate', width: 12 },
    { header: 'Total Amount', key: 'totalAmount', width: 14 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Received Quantity', key: 'receivedQuantity', width: 18 },
    { header: 'Received Date', key: 'receivedDate', width: 16 },
    { header: 'Invoice Number', key: 'invoiceNumber', width: 18 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of enriched) {
    sheet.addRow({
      vendorName: row.vendorName,
      productName: row.productName,
      purchaseDate: validDate(row.purchase.purchaseDate) ? row.purchase.purchaseDate.toISOString().slice(0, 10) : '',
      quantity: row.purchase.quantity,
      unit: row.purchase.unit,
      rate: row.purchase.rate,
      totalAmount: row.purchase.totalAmount,
      status: row.purchase.status,
      receivedQuantity: row.purchase.receivedQuantity || 0,
      receivedDate: validDate(row.purchase.receivedAt) ? row.purchase.receivedAt.toISOString().slice(0, 10) : '',
      invoiceNumber: row.purchase.invoiceNumber || '',
      notes: row.purchase.notes || '',
    });
  }

  const filename = `vendor-purchases-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});
