import Category from '../models/Category.js';
import Product from '../models/Product.js';
import asyncHandler from '../utils/asyncHandler.js';

const statuses = ['Active', 'Inactive'];

export const listCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({ displayOrder: 1, name: 1 });
  res.json({ categories });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { name, description = '', image = '', status = 'Active', displayOrder } = req.body;
  if (!String(name || '').trim()) return res.status(400).json({ message: 'Category name is required.' });
  if (!statuses.includes(status)) return res.status(400).json({ message: 'Choose a valid category status.' });
  if (displayOrder !== undefined && (!Number.isFinite(Number(displayOrder)) || Number(displayOrder) < 0)) return res.status(400).json({ message: 'Display order must be a valid number.' });
  const category = await Category.create({
    name: name.trim(),
    description,
    image,
    status,
    displayOrder: displayOrder === undefined ? undefined : Number(displayOrder),
  });
  res.status(201).json({ category });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const { name, description, image, status, displayOrder } = req.body;
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ message: 'Category name is required.' });
  if (status !== undefined && !statuses.includes(status)) return res.status(400).json({ message: 'Choose a valid category status.' });
  if (displayOrder !== undefined && (!Number.isFinite(Number(displayOrder)) || Number(displayOrder) < 0)) return res.status(400).json({ message: 'Display order must be a valid number.' });
  const update = {};
  if (name !== undefined) update.name = name.trim();
  if (description !== undefined) update.description = description;
  if (image !== undefined) update.image = image;
  if (status !== undefined) update.status = status;
  if (displayOrder !== undefined) update.displayOrder = Number(displayOrder);
  const category = await Category.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!category) return res.status(404).json({ message: 'Category not found.' });
  res.json({ category });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) return res.status(404).json({ message: 'Category no longer exists.' });
  const productCount = await Product.countDocuments({ category: category.name });
  if (productCount > 0) {
    return res.status(409).json({
      message: `This category contains ${productCount} ${productCount === 1 ? 'product' : 'products'}. Please move or reassign these products to another category before deleting this category.`,
      productCount,
    });
  }
  await category.deleteOne();
  res.json({ message: 'Category deleted.' });
});
