import mongoose from 'mongoose';
import Product from '../models/Product.js';
import VendorPriceHistory from '../models/VendorPriceHistory.js';
import asyncHandler from '../utils/asyncHandler.js';
import { canViewSupplierCosts, hasPermission } from '../config/permissions.js';

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
    return clean;
  });
}

const withSupplierVisibility = (query, user) => (canViewSupplierCosts(user) ? query : query.select('-vendors'));

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
  // A brand-new product has no price history to compare against, so vendors are
  // saved as-is (stripped of any client-sent `_id`, which can't be real yet).
  if (payload.vendors !== undefined) payload.vendors = sanitizeVendors(payload.vendors).map(({ _id, ...rest }) => rest);
  const product = await Product.create(payload);
  res.status(201).json({ product });
});

export const updateProduct = asyncHandler(async (req, res) => {
  // Staff holding only inventory:update may change stock and nothing else.
  if (!hasPermission(req.user, 'products:manage')) {
    const fields = Object.keys(req.body || {});
    if (fields.length !== 1 || fields[0] !== 'stock') return res.status(403).json({ message: 'You may only update the stock quantity.' });
    if (typeof req.body.stock !== 'number' || !Number.isFinite(req.body.stock) || req.body.stock < 0) return res.status(400).json({ message: 'Enter a valid stock quantity.' });
  }
  const existing = await Product.findById(req.params.id);
  if (!existing) return res.status(404).json({ message: 'Product not found.' });

  const update = { ...req.body };
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
