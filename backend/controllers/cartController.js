import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import asyncHandler from '../utils/asyncHandler.js';
import { effectiveMoq } from '../utils/productVariations.js';
import { validateOrderQuantity } from '../utils/quantity.js';

export const getCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user.id }).populate({ path: 'items.product', select: '-vendors' });
  res.json({ cart: cart || { user: req.user.id, items: [] } });
});

export const addToCart = asyncHandler(async (req, res) => {
  const { value: quantity, error } = validateOrderQuantity(req.body.quantity ?? 1);
  if (!req.body.productId || error) return res.status(400).json({ message: 'Choose a valid product and quantity.' });
  const product = await Product.findById(req.body.productId);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  const cart = await Cart.findOneAndUpdate({ user: req.user.id }, { $setOnInsert: { user: req.user.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const existing = cart.items.find((item) => String(item.product) === String(product.id));
  const nextQuantity = (existing?.quantity || 0) + quantity;
  // Early feedback only — createOrder is the authoritative MOQ check and still re-validates every item
  // regardless of what the cart already holds (never a truthiness check: an explicit 0 means none).
  const moq = effectiveMoq(product, 'normal');
  if (moq != null && nextQuantity < moq) return res.status(400).json({ message: `${product.name} requires a minimum order quantity of ${moq} ${product.unit}.`, product: product.name, requestedQuantity: nextQuantity, requiredMoq: moq, unit: product.unit });
  if (nextQuantity > product.stock) return res.status(409).json({ message: `Only ${product.stock} ${product.unit} are available.` });
  if (existing) existing.quantity = nextQuantity;
  else cart.items.push({ product: product.id, quantity });
  await cart.save();
  await cart.populate({ path: 'items.product', select: '-vendors' });
  res.json({ cart });
});

export const updateCartItem = asyncHandler(async (req, res) => {
  const { value: quantity, error } = validateOrderQuantity(req.body.quantity);
  if (error) return res.status(400).json({ message: 'Quantity must be at least one.' });
  const [cart, product] = await Promise.all([Cart.findOne({ user: req.user.id }), Product.findById(req.params.productId)]);
  if (!cart || !product) return res.status(404).json({ message: 'Cart item not found.' });
  const moq = effectiveMoq(product, 'normal');
  if (moq != null && quantity < moq) return res.status(400).json({ message: `${product.name} requires a minimum order quantity of ${moq} ${product.unit}.`, product: product.name, requestedQuantity: quantity, requiredMoq: moq, unit: product.unit });
  if (quantity > product.stock) return res.status(409).json({ message: `Only ${product.stock} ${product.unit} are available.` });
  const item = cart.items.find((entry) => String(entry.product) === String(product.id));
  if (!item) return res.status(404).json({ message: 'Cart item not found.' });
  item.quantity = quantity;
  await cart.save();
  await cart.populate({ path: 'items.product', select: '-vendors' });
  res.json({ cart });
});

export const removeCartItem = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user.id });
  if (cart) {
    cart.items = cart.items.filter((item) => String(item.product) !== req.params.productId);
    await cart.save();
    await cart.populate({ path: 'items.product', select: '-vendors' });
  }
  res.json({ cart: cart || { user: req.user.id, items: [] } });
});

export const clearCart = asyncHandler(async (req, res) => {
  await Cart.findOneAndUpdate({ user: req.user.id }, { $set: { items: [] } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  res.json({ message: 'Cart cleared.', cart: { user: req.user.id, items: [] } });
});
