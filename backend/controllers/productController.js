import Product from '../models/Product.js';
import asyncHandler from '../utils/asyncHandler.js';

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
    Product.find(filter).sort(sorts[sort] || sorts.featured).skip((page - 1) * limit).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ products, total, page, pages: Math.ceil(total / limit) });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ product });
});

export const createProduct = asyncHandler(async (req, res) => {
  const product = await Product.create(req.body);
  res.status(201).json({ product });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ product });
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  res.json({ message: 'Product deleted.' });
});
