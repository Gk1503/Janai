import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import asyncHandler from '../utils/asyncHandler.js';
import { loadPricingContext, priceLines } from '../utils/promotionPricing.js';

// The cart as sent to the browser: each line carries the server-calculated offer and unit price, and the
// cart carries the original subtotal, discount and payable subtotal. The stored cart holds only product ids
// and quantities, so an expired promotion simply stops applying the next time the cart is read.
export async function presentCart(cart) {
  const plain = typeof cart?.toJSON === 'function' ? cart.toJSON() : cart;
  const lines = (plain.items || []).filter((item) => item.product && item.product._id);
  const priced = priceLines(lines.map((item) => ({ product: item.product, quantity: item.quantity })), await loadPricingContext());
  const byProduct = new Map(priced.items.map((line) => [line.productId, line]));
  const items = (plain.items || []).map((item) => {
    const line = item.product && byProduct.get(String(item.product._id));
    return line ? { ...item, offer: line.offer, unitPrice: line.unitPrice, lineTotal: line.lineTotal } : item;
  });
  return { ...plain, items, pricing: { originalSubtotal: priced.originalSubtotal, discountTotal: priced.discountTotal, subtotal: priced.subtotal } };
}

export const getCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user.id }).populate({ path: 'items.product', select: '-vendors' });
  res.json({ cart: await presentCart(cart || { user: req.user.id, items: [] }) });
});

export const addToCart = asyncHandler(async (req, res) => {
  const quantity = Number(req.body.quantity || 1);
  if (!req.body.productId || !Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ message: 'Choose a valid product and quantity.' });
  const product = await Product.findById(req.body.productId);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  const cart = await Cart.findOneAndUpdate({ user: req.user.id }, { $setOnInsert: { user: req.user.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const existing = cart.items.find((item) => String(item.product) === String(product.id));
  const nextQuantity = (existing?.quantity || 0) + quantity;
  if (nextQuantity > product.stock) return res.status(409).json({ message: `Only ${product.stock} ${product.unit} are available.` });
  if (existing) existing.quantity = nextQuantity;
  else cart.items.push({ product: product.id, quantity });
  await cart.save();
  await cart.populate({ path: 'items.product', select: '-vendors' });
  res.json({ cart: await presentCart(cart) });
});

export const updateCartItem = asyncHandler(async (req, res) => {
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) return res.status(400).json({ message: 'Quantity must be at least one.' });
  const [cart, product] = await Promise.all([Cart.findOne({ user: req.user.id }), Product.findById(req.params.productId)]);
  if (!cart || !product) return res.status(404).json({ message: 'Cart item not found.' });
  if (quantity > product.stock) return res.status(409).json({ message: `Only ${product.stock} ${product.unit} are available.` });
  const item = cart.items.find((entry) => String(entry.product) === String(product.id));
  if (!item) return res.status(404).json({ message: 'Cart item not found.' });
  item.quantity = quantity;
  await cart.save();
  await cart.populate({ path: 'items.product', select: '-vendors' });
  res.json({ cart: await presentCart(cart) });
});

export const removeCartItem = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user.id });
  if (cart) {
    cart.items = cart.items.filter((item) => String(item.product) !== req.params.productId);
    await cart.save();
    await cart.populate({ path: 'items.product', select: '-vendors' });
  }
  res.json({ cart: await presentCart(cart || { user: req.user.id, items: [] }) });
});

export const clearCart = asyncHandler(async (req, res) => {
  await Cart.findOneAndUpdate({ user: req.user.id }, { $set: { items: [] } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  res.json({ message: 'Cart cleared.', cart: await presentCart({ user: req.user.id, items: [] }) });
});
