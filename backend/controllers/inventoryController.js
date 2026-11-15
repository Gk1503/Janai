import Product from '../models/Product.js';
import VendorPurchase from '../models/VendorPurchase.js';
import Order from '../models/Order.js';
import BulkOrder from '../models/BulkOrder.js';
import asyncHandler from '../utils/asyncHandler.js';
import { canViewSupplierCosts } from '../config/permissions.js';
import { classifyVariationStock, getEffectiveVariations } from '../utils/productVariations.js';

const RECENT_LIMIT = 10;

function addToUnitMap(map, unit, amount) {
  map.set(unit, (map.get(unit) || 0) + amount);
}
function unitMapToArray(map) {
  return Array.from(map, ([unit, quantity]) => ({ unit, quantity }));
}

// Everything below reads via a small, fixed number of queries (never one per product), reusing the
// existing, already-tested getEffectiveVariations helper for the legacy-fallback rule rather than
// reimplementing it as a Mongo aggregation pipeline — that rule is JS-level (an empty variations array
// means one implicit default), which $unwind cannot express without risking it drifting from the real
// stock-mutation logic in utils/productVariations.js.
export const getInventoryOverview = asyncHandler(async (req, res) => {
  const canViewValues = canViewSupplierCosts(req.user);

  // minStockThreshold included (Stock Management, Phase 3) so a legacy product's newly persisted,
  // admin-set threshold is actually read here — without it in the projection, getEffectiveVariations
  // would silently fall back to its own `?? 0` default even for a product that has a real one saved.
  const products = await Product.find({}, { name: 1, stock: 1, unit: 1, minStockThreshold: 1, variations: 1 });

  let totalActiveVariations = 0;
  let outOfStockCount = 0;
  let lowStockCount = 0;
  let healthyConfiguredCount = 0;
  let unconfiguredThresholdCount = 0;
  const stockByUnit = new Map();
  const outOfStockItems = [];
  const lowStockItems = [];

  for (const product of products) {
    for (const variation of getEffectiveVariations(product)) {
      if (variation.isActive === false) continue;
      totalActiveVariations += 1;
      addToUnitMap(stockByUnit, variation.unit, variation.stock);

      const item = {
        productId: product._id,
        productName: product.name,
        variationId: variation.isLegacy ? null : String(variation._id),
        variationLabel: variation.isLegacy ? '' : variation.label,
        unit: variation.unit,
        stock: variation.stock,
        minStockThreshold: variation.minStockThreshold,
      };

      // Shared with Stock Management (utils/productVariations.js) so the two pages can never disagree
      // on what counts as low/healthy/unconfigured.
      switch (classifyVariationStock(variation)) {
        case 'outOfStock': outOfStockCount += 1; outOfStockItems.push(item); break;
        case 'unconfigured': unconfiguredThresholdCount += 1; break;
        case 'lowStock': lowStockCount += 1; lowStockItems.push(item); break;
        default: healthyConfiguredCount += 1;
      }
    }
  }

  const productNameById = new Map(products.map((product) => [String(product._id), product.name]));

  const incomingPurchases = await VendorPurchase.find({ status: 'Ordered' }, { quantity: 1, unit: 1 });
  const incomingByUnit = new Map();
  for (const purchase of incomingPurchases) addToUnitMap(incomingByUnit, purchase.unit, purchase.quantity);

  const recentReceived = await VendorPurchase.find({ status: 'Received' }, { product: 1, vendorName: 1, quantity: 1, unit: 1, rate: 1, totalAmount: 1, receivedAt: 1 })
    .sort({ receivedAt: -1 })
    .limit(RECENT_LIMIT);
  const receivedPurchases = recentReceived.map((purchase) => {
    // A purchase can outlive the product it was recorded against — deleting a product has never
    // cascaded to its VendorPurchase history (by design: that history is preserved, never deleted
    // alongside it). `.get()` returning undefined here means exactly that, not a mapping bug — surfaced
    // explicitly rather than silently rendered as a blank name.
    const productExists = productNameById.has(String(purchase.product));
    return {
      productId: purchase.product,
      productName: productExists ? productNameById.get(String(purchase.product)) : 'Product unavailable',
      productExists,
      vendorName: purchase.vendorName,
      quantity: purchase.quantity,
      unit: purchase.unit,
      receivedAt: purchase.receivedAt,
      // Never shown to a viewer who only holds inventory:update — mirrors canViewSupplierCosts everywhere
      // else supplier purchase figures appear (productController.js's withSupplierVisibility, Vendor Detail
      // Page, Vendor Analytics).
      ...(canViewValues ? { rate: purchase.rate, totalAmount: purchase.totalAmount } : {}),
    };
  });

  // Order-derived activity, not a stock movement ledger: each row is one order's single
  // stockDeductedAt/stockRestoredAt timestamp (Phase 2), not a per-line change record — labelled as
  // such below rather than presented as a durable audit trail.
  const [recentOrders, recentBulkOrders] = await Promise.all([
    Order.find({ $or: [{ stockDeductedAt: { $ne: null } }, { stockRestoredAt: { $ne: null } }] }, { orderType: 1, stockDeductedAt: 1, stockRestoredAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(RECENT_LIMIT),
    BulkOrder.find({ $or: [{ stockDeductedAt: { $ne: null } }, { stockRestoredAt: { $ne: null } }] }, { stockDeductedAt: 1, stockRestoredAt: 1 })
      .sort({ updatedAt: -1 })
      .limit(RECENT_LIMIT),
  ]);
  const orderEvents = [
    ...recentOrders.map((order) => ({ type: 'order', id: order._id, orderType: order.orderType, event: order.stockRestoredAt ? 'restored' : 'deducted', at: order.stockRestoredAt || order.stockDeductedAt })),
    ...recentBulkOrders.map((request) => ({ type: 'bulk_order', id: request._id, event: request.stockRestoredAt ? 'restored' : 'deducted', at: request.stockRestoredAt || request.stockDeductedAt })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, RECENT_LIMIT);

  res.json({
    summary: {
      totalProducts: products.length,
      totalActiveVariations,
      stockByUnit: unitMapToArray(stockByUnit),
      outOfStockCount,
      lowStockCount,
      healthyConfiguredCount,
      unconfiguredThresholdCount,
      incoming: { count: incomingPurchases.length, quantityByUnit: unitMapToArray(incomingByUnit) },
    },
    attention: { outOfStock: outOfStockItems, lowStock: lowStockItems },
    recentActivity: { receivedPurchases, orderEvents },
    canViewPurchaseValues: canViewValues,
  });
});
