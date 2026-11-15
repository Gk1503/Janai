import mongoose from 'mongoose';
import Product from '../models/Product.js';
import VendorPriceHistory from '../models/VendorPriceHistory.js';
import asyncHandler from '../utils/asyncHandler.js';
import { canViewSupplierCosts, hasPermission } from '../config/permissions.js';
import { validateOrderQuantity } from '../utils/quantity.js';

// Whitelists and casts incoming vendor rows. A client-sent `_id` is kept only when it's
// a real ObjectId (i.e. an already-persisted vendor) so Mongoose preserves that vendor's
// identity across the save; anything else is treated as a brand-new vendor subdocument.
function sanitizeVendors(vendors) {
  if (!Array.isArray(vendors)) return [];
  return vendors.map((vendor) => {
    const clean = {
      name: String(vendor?.name || '').trim(),
      purchasePrice: Number(vendor?.purchasePrice) || 0,
      moq: String(vendor?.moq || '').trim(),
      leadTime: String(vendor?.leadTime || '').trim(),
      preferred: Boolean(vendor?.preferred),
      lastPurchasePrice: vendor?.lastPurchasePrice === '' || vendor?.lastPurchasePrice == null ? null : Number(vendor.lastPurchasePrice),
      lastPurchaseDate: vendor?.lastPurchaseDate ? new Date(vendor.lastPurchaseDate) : null,
      notes: String(vendor?.notes || '').trim(),
    };
    if (vendor?._id && mongoose.isValidObjectId(vendor._id)) clean._id = vendor._id;
    // Optional and additive (Stage 1 of Vendor Management): only set when a genuine Vendor id is sent.
    // Nothing in this stage sends it yet (ProductFormModal is untouched here), so existing create/edit
    // behavior is unchanged — this only makes the field reachable through the existing save path for
    // whenever a later stage starts sending it.
    if (vendor?.vendorRef && mongoose.isValidObjectId(vendor.vendorRef)) clean.vendorRef = vendor.vendorRef;
    return clean;
  });
}

const withSupplierVisibility = (query, user) => (canViewSupplierCosts(user) ? query : query.select('-vendors'));

// Customer-facing MOQ fields (Phase 6) are optional and nullable: an empty string from the form means
// "unset", never 0 — mirrors the existing lastPurchasePrice normalization already used for vendor rows.
// Mutates only fields present in `payload`, so a caller that never mentions them (e.g. any other
// partial-update path) leaves them untouched. Returns an error message, or null if everything is valid.
const MOQ_FIELDS = ['normalMoq', 'bulkMoq', 'preOrderMoq'];
const MOQ_FIELD_LABELS = { normalMoq: 'Normal Order MOQ', bulkMoq: 'Bulk Order MOQ', preOrderMoq: 'Pre-order MOQ' };
function normalizeMoqFields(payload) {
  for (const field of MOQ_FIELDS) {
    if (!(field in payload)) continue;
    const raw = payload[field];
    if (raw === '' || raw === null || raw === undefined) { payload[field] = null; continue; }
    const { value, error } = validateOrderQuantity(raw, { min: 0 });
    if (error) return `${MOQ_FIELD_LABELS[field]}: ${error}`;
    payload[field] = value;
  }
  return null;
}

export const listProducts = asyncHandler(async (req, res) => {
  const { category, q, sort = 'featured', preOrder, bulk, minPrice, maxPrice, rating } = req.query;
  const filter = {};
  if (category && category !== 'All') filter.category = category;
  if (q) filter.$text = { $search: String(q).trim() };
  if (preOrder === 'true') filter.preOrderAvailable = true;
  if (bulk === 'true') filter.bulkAvailable = true;
  if (rating && Number.isFinite(Number(rating))) filter.rating = { $gte: Number(rating) };
  if (minPrice || maxPrice) filter.price = { ...(minPrice ? { $gte: Number(minPrice) } : {}), ...(maxPrice ? { $lte: Number(maxPrice) } : {}) };
  const sorts = { featured: { featured: -1, createdAt: -1 }, popular: { rating: -1, reviews: -1 }, priceAsc: { price: 1 }, priceDesc: { price: -1 }, newest: { createdAt: -1 } };
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
  const page = Math.max(1, Number(req.query.page) || 1);
  const [products, total] = await Promise.all([
    // Supplier names and purchase prices never go to the public, customers or unauthorised staff.
    withSupplierVisibility(Product.find(filter), req.user).sort(sorts[sort] || sorts.featured).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ products, total, page, pages: Math.ceil(total / limit) });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await withSupplierVisibility(Product.findById(req.params.id), req.user);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ product });
});

export const createProduct = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  const moqError = normalizeMoqFields(payload);
  if (moqError) return res.status(400).json({ message: moqError });
  // A brand-new product has no price history to compare against, so vendors are
  // saved as-is (stripped of any client-sent `_id`, which can't be real yet).
  if (payload.vendors !== undefined) payload.vendors = sanitizeVendors(payload.vendors).map(({ _id, ...rest }) => rest);
  const product = await Product.create(payload);
  res.status(201).json({ product });
});

export const updateProduct = asyncHandler(async (req, res) => {
  // Manual Stock Adjustments (Phase 3): stock is no longer editable through this endpoint for anyone —
  // it must go through the ledgered adjustment API (stockController.js::adjustStock) so every change is
  // reasoned, attributed, and permanently recorded. inventory:update alone had no other field it was
  // ever allowed to touch here, so there is nothing left for it to do on this endpoint.
  if (!hasPermission(req.user, 'products:manage')) {
    return res.status(403).json({ message: 'Use Stock Management to adjust stock.' });
  }
  const existing = await Product.findById(req.params.id);
  if (!existing) return res.status(404).json({ message: 'Product not found.' });

  const update = { ...req.body };
  // Stripped unconditionally, even for products:manage: ProductFormModal's own Stock field still sends
  // a value as part of a full product edit, but it must never silently change stock outside the ledger.
  delete update.stock;
  const moqError = normalizeMoqFields(update);
  if (moqError) return res.status(400).json({ message: moqError });
  const loggingVendors = update.vendors !== undefined;
  if (loggingVendors) update.vendors = sanitizeVendors(update.vendors);
  const previousPriceByVendorId = new Map(existing.vendors.map((vendor) => [String(vendor._id), Number(vendor.purchasePrice)]));

  const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ message: 'Product not found.' });

  // Only an actual purchase-price change on a vendor that already existed counts as a
  // price change — unrelated edits (name, notes, a brand-new vendor) never log an entry.
  if (loggingVendors) {
    const changes = [];
    for (const vendor of product.vendors) {
      const key = String(vendor._id);
      if (!previousPriceByVendorId.has(key)) continue;
      const previousPrice = previousPriceByVendorId.get(key);
      const newPrice = Number(vendor.purchasePrice);
      if (previousPrice !== newPrice) changes.push({ product: product._id, vendor: vendor._id, vendorName: vendor.name, previousPrice, newPrice, changedBy: req.user?._id });
    }
    if (changes.length) await VendorPriceHistory.insertMany(changes);
  }

  res.json({ product });
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ message: 'Product deleted.' });
});
