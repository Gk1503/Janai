import mongoose from 'mongoose';
import Product from '../models/Product.js';
import VendorPriceHistory from '../models/VendorPriceHistory.js';
import asyncHandler from '../utils/asyncHandler.js';
import { canViewSupplierCosts, hasPermission } from '../config/permissions.js';
import { bestOfferFor, loadPricingContext, withOffer } from '../utils/promotionPricing.js';
import { MIN_SEASONAL_PRODUCTS } from '../utils/promotionValidation.js';
import { SECTION_LABELS, parsePlacements, promotionsUsing, pullFromAllPromotions, pullFromPromotions } from '../utils/dealPlacements.js';

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
  // `price` stays the stored price; `offer` is null or the discount the pricing engine would apply right now.
  const pricing = await loadPricingContext();

  // Customers see (and pay) the offer price, so price sorting and price filters must use it too. That is only
  // different from the stored price while a live discount exists; otherwise the original database query below
  // runs unchanged.
  const priceSort = sort === 'priceAsc' || sort === 'priceDesc';
  if (pricing.promotions.length > 0 && (priceSort || filter.price)) {
    const { price: range, ...rest } = filter;
    // Only id, price and category are read for the whole matching set (never images or supplier data), then
    // the effective price is worked out by the same engine that prices the cart.
    const rows = await Product.find(rest).select('price category').lean();
    const priced = rows
      .map((row) => ({ id: String(row._id), price: bestOfferFor(row, pricing)?.finalPrice ?? row.price }))
      .filter((row) => (!range || ((range.$gte === undefined || row.price >= range.$gte) && (range.$lte === undefined || row.price <= range.$lte))));
    const total = priced.length;
    let products;
    if (priceSort) {
      const direction = sort === 'priceAsc' ? 1 : -1;
      priced.sort((a, b) => direction * (a.price - b.price) || (a.id < b.id ? -1 : 1));
      const ids = priced.slice((page - 1) * limit, page * limit).map((row) => row.id);
      const found = await withSupplierVisibility(Product.find({ _id: { $in: ids } }), req.user);
      const byId = new Map(found.map((product) => [String(product._id), product]));
      products = ids.map((id) => byId.get(id)).filter(Boolean);
    } else {
      products = await withSupplierVisibility(Product.find({ ...rest, _id: { $in: priced.map((row) => row.id) } }), req.user).sort(sorts[sort] || sorts.featured).skip((page - 1) * limit).limit(limit);
    }
    return res.json({ products: products.map((product) => withOffer(product, pricing)), total, page, pages: Math.ceil(total / limit) });
  }

  const [products, total] = await Promise.all([
    // Supplier names and purchase prices never go to the public, customers or unauthorised staff.
    withSupplierVisibility(Product.find(filter), req.user).sort(sorts[sort] || sorts.featured).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ products: products.map((product) => withOffer(product, pricing)), total, page, pages: Math.ceil(total / limit) });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await withSupplierVisibility(Product.findById(req.params.id), req.user);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ product: withOffer(product, await loadPricingContext()) });
});

// Promotional placement is a Deals Management matter, so only the owner may set it.
function readPlacements(req) {
  if (req.body?.dealPlacements === undefined) return {};
  if (req.user?.role !== 'admin') return { error: 'Only the owner can change promotional placement.', status: 403 };
  const parsed = parsePlacements(req.body.dealPlacements);
  return parsed.error ? { error: parsed.error, status: 400 } : { placements: parsed.value };
}

export const createProduct = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  delete payload.removeFromPromotions;
  const { placements, error, status } = readPlacements(req);
  if (error) return res.status(status).json({ message: error });
  if (placements) payload.dealPlacements = placements;
  else delete payload.dealPlacements;
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
  delete update.dealPlacements;
  delete update.removeFromPromotions;
  const { placements, error, status } = readPlacements(req);
  if (error) return res.status(status).json({ message: error });
  // Only the flags sent are written (dotted paths), so one flag never resets the other.
  for (const [key, flag] of Object.entries(placements || {})) update[`dealPlacements.${key}`] = flag;
  // Unmarking a section while the product still sits in one of its promotions: ask first, never drop silently.
  const unmarked = Object.entries(placements || {}).filter(([, flag]) => flag === false).map(([key]) => key);
  if (unmarked.length) {
    const using = await promotionsUsing(existing._id, unmarked);
    // A Seasonal Deal must keep at least three products, so a placement cannot be removed from underneath one.
    const tooFew = using.filter((promotion) => promotion.section === 'seasonal_deals' && promotion.productCount >= MIN_SEASONAL_PRODUCTS && promotion.productCount - 1 < MIN_SEASONAL_PRODUCTS);
    if (tooFew.length) {
      const names = tooFew.map((promotion) => `"${promotion.title || 'Seasonal Deals'}"`).join(', ');
      return res.status(409).json({ code: 'PLACEMENT_BREAKS_MINIMUM', promotions: tooFew, message: `This product is one of the ${MIN_SEASONAL_PRODUCTS} products ${names} needs. Add another product to that Seasonal Deal first, then remove this placement.` });
    }
    if (using.length && req.body.removeFromPromotions !== true) {
      const names = using.map((promotion) => `"${promotion.title}" (${SECTION_LABELS[promotion.section]})`).join(', ');
      return res.status(409).json({ code: 'PLACEMENT_IN_USE', promotions: using, message: `This product is part of ${names}. Removing the placement will also take it out of ${using.length === 1 ? 'that promotion' : 'those promotions'}.` });
    }
  }
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

  if (unmarked.length) await pullFromPromotions(product._id, unmarked, req.user?._id);
  res.json({ product });
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  // Promotions must not keep pointing at a product that no longer exists. Orders keep their own snapshot.
  await pullFromAllPromotions(product._id);
  res.json({ message: 'Product deleted.' });
});
