import mongoose from 'mongoose';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  addVariationStock, classifyVariationStock, deductVariationStock, getEffectiveVariations,
  isLegacyTarget, LEGACY_VARIATION_ID, resolveVariation, setVariationStock,
} from '../utils/productVariations.js';
import { transactionHelper } from '../utils/withTransaction.js';

const STATUS_FILTERS = ['outOfStock', 'lowStock', 'unconfigured', 'healthy'];
const ADJUSTMENT_TYPES = ['add', 'remove', 'set_exact'];
export const REASON_PRESETS = ['Physical count correction', 'Damaged / Spoiled', 'Loss / Theft', 'Received outside vendor system', 'Other'];

// Thrown only inside adjustStock's transaction to carry a specific HTTP status/message out of the
// withTransaction callback without it being swallowed or relabelled as a generic 500.
class AdjustmentError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// One row per effective variation (not per product) — a product with 3 real variations produces 3
// rows; a legacy product (the only kind that exists in this database today) produces exactly 1, via the
// same getEffectiveVariations helper every stock mutation already goes through. Search/category filter
// server-side on Product; status filter is applied after expansion, since status is a per-variation
// property a product-level query can't express. At today's catalog size this is a single lightweight
// query plus an in-memory reduce — the same shape already proven for the Inventory Dashboard.
export const listStockRows = asyncHandler(async (req, res) => {
  const { search, category, status, page = '1', limit = '20' } = req.query;
  if (status && !STATUS_FILTERS.includes(status)) return res.status(400).json({ message: 'Choose a valid stock status filter.' });

  const filter = {};
  if (category && category !== 'All') filter.category = category;
  if (search && search.trim()) filter.$or = [{ name: { $regex: search.trim(), $options: 'i' } }, { category: { $regex: search.trim(), $options: 'i' } }];

  const products = await Product.find(filter, { name: 1, category: 1, images: 1, stock: 1, unit: 1, minStockThreshold: 1, variations: 1 }).sort({ name: 1 });

  const rows = [];
  for (const product of products) {
    for (const variation of getEffectiveVariations(product)) {
      if (variation.isActive === false) continue;
      const variationStatus = classifyVariationStock(variation);
      if (status && status !== variationStatus) continue;
      rows.push({
        productId: product._id,
        productName: product.name,
        productImage: product.images?.[0] || '',
        category: product.category,
        variationId: variation.isLegacy ? LEGACY_VARIATION_ID : String(variation._id),
        variationLabel: variation.isLegacy ? 'Default' : variation.label,
        isLegacy: Boolean(variation.isLegacy),
        stock: variation.stock,
        unit: variation.unit,
        minStockThreshold: variation.minStockThreshold,
        status: variationStatus,
      });
    }
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / limitNum));
  const paged = rows.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  res.json({ rows: paged, total, page: pageNum, pages });
});

// products:manage only (enforced again here, not just by the route middleware, since this is a more
// sensitive write than the view-only listing above shares a route prefix with). inventory:update alone
// — which already exists to let staff change a product's raw stock quantity — deliberately does NOT
// extend to thresholds; a threshold is a planning/configuration decision, not a stock count.
export const updateStockThreshold = asyncHandler(async (req, res) => {
  const { productId, variationId } = req.params;
  const value = Number(req.body.minStockThreshold);
  if (!Number.isFinite(value) || value < 0) return res.status(400).json({ message: 'Enter a minimum stock threshold of 0 or more.' });

  const product = await Product.findById(productId);
  if (!product) return res.status(404).json({ message: 'Product not found.' });

  if (isLegacyTarget(product, variationId)) {
    product.minStockThreshold = value;
  } else {
    if (!mongoose.isValidObjectId(variationId)) return res.status(400).json({ message: 'Invalid variation.' });
    const variation = product.variations.find((entry) => String(entry._id) === String(variationId));
    if (!variation) return res.status(404).json({ message: 'Variation not found on this product.' });
    variation.minStockThreshold = value;
  }
  await product.save();
  res.json({ minStockThreshold: value });
});

// Exported for reuse by the automatic-movement workflows (Phase 5: orderController.js,
// bulkOrderController.js, vendorController.js) — same read-the-true-post-write-value rule applies there
// as it does to manual adjustments below: never compute a movement's stock values from a stale read.
export function readStock(product, variationId, isLegacy) {
  if (isLegacy) return product.stock;
  const variation = product.variations.find((entry) => String(entry._id) === String(variationId));
  return variation ? variation.stock : null;
}

export function actorName(user) {
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  return name || user.adminId || 'Unknown';
}

// Manual Stock Adjustments (Phase 3). Add/Remove/Set Exact, each creating exactly one permanent
// StockMovement record in the SAME transaction as the stock write — either both happen or neither does.
// Every value stored on the movement (previousStock/newStock/difference) is read back from the atomic
// write's own result, never trusted from the request body, even for the relative operations.
export const adjustStock = asyncHandler(async (req, res) => {
  const { productId, variationId } = req.params;
  const { type, quantity, newStock, expectedPreviousStock, reason, explanation } = req.body;

  if (!ADJUSTMENT_TYPES.includes(type)) return res.status(400).json({ message: 'Choose a valid adjustment type.' });
  if (!REASON_PRESETS.includes(reason)) return res.status(400).json({ message: 'Choose a valid reason.' });
  const finalReason = reason === 'Other' ? String(explanation || '').trim() : reason;
  if (reason === 'Other' && !finalReason) return res.status(400).json({ message: 'Enter an explanation for Other.' });
  if (!finalReason) return res.status(400).json({ message: 'Reason is required.' });

  let qty = null;
  let exactValue = null;
  let expectedPrev = null;
  if (type === 'add' || type === 'remove') {
    qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: 'Enter a quantity greater than 0.' });
  } else {
    exactValue = Number(newStock);
    if (!Number.isFinite(exactValue) || exactValue < 0) return res.status(400).json({ message: 'Enter a stock quantity of 0 or more.' });
    expectedPrev = Number(expectedPreviousStock);
    if (!Number.isFinite(expectedPrev) || expectedPrev < 0) return res.status(400).json({ message: 'Missing the expected current stock — refresh and try again.' });
  }

  // Resolved once, outside the transaction, purely to validate the target exists and is active and to
  // snapshot productName/variationLabel/unit for the movement record — never to decide previousStock,
  // which is always re-derived from the atomic write's own result below.
  const productBefore = await Product.findById(productId);
  if (!productBefore) return res.status(404).json({ message: 'Product not found.' });
  const variation = resolveVariation(productBefore, variationId);
  if (!variation) return res.status(404).json({ message: 'Variation not found or inactive.' });
  const isLegacy = isLegacyTarget(productBefore, variationId);

  try {
    const movement = await transactionHelper.run(async (session) => {
      let updated;
      let previousStock;
      let newStockValue;

      if (type === 'add') {
        updated = await addVariationStock(Product, { productId, variationId, isLegacy, quantity: qty, session });
        if (!updated) throw new AdjustmentError(404, 'Product or variation not found.');
        newStockValue = readStock(updated, variationId, isLegacy);
        previousStock = newStockValue - qty;
      } else if (type === 'remove') {
        updated = await deductVariationStock(Product, { productId, variationId, isLegacy, quantity: qty, session });
        if (!updated) throw new AdjustmentError(409, 'Insufficient stock, or it changed since you loaded this page. Refresh and try again.');
        newStockValue = readStock(updated, variationId, isLegacy);
        previousStock = newStockValue + qty;
      } else {
        updated = await setVariationStock(Product, { productId, variationId, isLegacy, newStock: exactValue, expectedPreviousStock: expectedPrev, session });
        if (!updated) throw new AdjustmentError(409, 'Stock changed since you loaded this page. Refresh and try again.');
        previousStock = expectedPrev;
        newStockValue = exactValue;
      }

      const [record] = await StockMovement.create([{
        product: productId,
        productName: productBefore.name,
        variationId: isLegacy ? null : String(variationId),
        variationLabel: isLegacy ? 'Default' : variation.label,
        unit: variation.unit,
        type,
        previousStock,
        newStock: newStockValue,
        difference: newStockValue - previousStock,
        reason: finalReason,
        actor: { id: req.user._id, name: actorName(req.user) },
      }], { session });
      return record;
    });
    res.status(201).json({ movement });
  } catch (error) {
    if (error instanceof AdjustmentError) return res.status(error.statusCode).json({ message: error.message });
    throw error;
  }
});

// Read-only movement history. Same view permission as the stock listing above — this ledger carries no
// supplier/purchase-price data of any kind, so there is nothing here that needs the stricter
// canViewSupplierCosts gate the Inventory Dashboard applies to vendor purchase figures.
export const listStockMovements = asyncHandler(async (req, res) => {
  const { product, productName, variationId, type, actor, from, to, page = '1', limit = '20' } = req.query;
  if (type && !ADJUSTMENT_TYPES.includes(type)) return res.status(400).json({ message: 'Choose a valid adjustment type.' });

  const filter = {};
  if (product) {
    if (!mongoose.isValidObjectId(product)) return res.status(400).json({ message: 'Invalid product filter.' });
    filter.product = product;
  }
  // Snapshot-based name search (Phase 4) — matches the productName stored on the movement itself, never
  // a live Product. This is the only way to find history for a since-deleted product at all, and it
  // coexists with the exact `product` id filter above rather than replacing it: both can be sent
  // together (callers that already know the id keep using it; this is for everyone else).
  if (productName && productName.trim()) filter.productName = { $regex: productName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (variationId) filter.variationId = variationId === LEGACY_VARIATION_ID ? null : variationId;
  if (type) filter.type = type;
  if (actor) {
    if (!mongoose.isValidObjectId(actor)) return res.status(400).json({ message: 'Invalid actor filter.' });
    filter['actor.id'] = actor;
  }
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
  const [movements, total] = await Promise.all([
    StockMovement.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum),
    StockMovement.countDocuments(filter),
  ]);

  res.json({ movements, total, page: pageNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
});

// Distinct staff members who actually appear in the ledger, from the ledger's own saved actor.name
// snapshots — never a live User lookup. Bounded to the (indexed) actor.id grouping already present on
// this collection; at any realistic history size this is a single, cheap aggregation, not a join.
export const listStockMovementActors = asyncHandler(async (req, res) => {
  const actors = await StockMovement.aggregate([
    { $group: { _id: '$actor.id', name: { $first: '$actor.name' } } },
    { $project: { _id: 0, id: '$_id', name: 1 } },
    { $sort: { name: 1 } },
  ]);
  res.json({ actors });
});
