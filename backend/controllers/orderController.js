import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import asyncHandler from '../utils/asyncHandler.js';

const statuses = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
const timeSlots = ['8:00 AM - 10:00 AM', '10:00 AM - 12:00 PM', '12:00 PM - 2:00 PM', '2:00 PM - 4:00 PM', '4:00 PM - 6:00 PM', '6:00 PM - 8:00 PM'];

export function createOrder(orderType = 'normal') {
  return asyncHandler(async (req, res) => {
    const { deliveryAddress, deliveryDate, paymentMethod = 'cod', preferredTimeSlot = '', deliveryInstructions = '' } = req.body;
    const addressFields = ['recipient', 'phone', 'street', 'postalCode'];
    if (!deliveryAddress || !addressFields.every((field) => String(deliveryAddress[field] || '').trim())) return res.status(400).json({ message: 'Complete every delivery address field.' });
    if (preferredTimeSlot && !timeSlots.includes(preferredTimeSlot)) return res.status(400).json({ message: 'Choose a valid delivery time slot.' });
    if (typeof deliveryInstructions !== 'string' || deliveryInstructions.length > 300) return res.status(400).json({ message: 'Keep delivery instructions under 300 characters.' });
    if (paymentMethod !== 'cod') return res.status(501).json({ message: 'Online payments are not available yet. Choose Cash on Delivery.' });
    const date = new Date(deliveryDate);
    if (!deliveryDate || Number.isNaN(date.getTime())) return res.status(400).json({ message: 'Choose a valid delivery date.' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDay = new Date(date);
    selectedDay.setHours(0, 0, 0, 0);
    if (selectedDay < today || (orderType === 'preorder' && selectedDay <= today)) return res.status(400).json({ message: 'Choose a valid future delivery date.' });

    const cart = await Cart.findOne({ user: req.user.id });
    const sourceItems = Array.isArray(req.body.items) && req.body.items.length ? req.body.items : cart?.items || [];
    if (!sourceItems.length) return res.status(400).json({ message: 'Your cart is empty.' });
    const items = sourceItems.map((item) => ({ productId: item.productId || item.product?._id || item.product, quantity: Number(item.quantity) }));
    if (items.some((item) => !item.productId || !Number.isInteger(item.quantity) || item.quantity < 1)) return res.status(400).json({ message: 'One or more product quantities are invalid.' });
    const products = await Product.find({ _id: { $in: items.map((item) => item.productId) } });
    const byId = new Map(products.map((product) => [String(product.id), product]));
    if (byId.size !== new Set(items.map((item) => String(item.productId))).size) return res.status(400).json({ message: 'One or more products are no longer available.' });
    const orderItems = [];
    let subtotal = 0;
    for (const item of items) {
      const product = byId.get(String(item.productId));
      if (orderType === 'preorder' && !product.preOrderAvailable) return res.status(400).json({ message: `${product.name} is not available for pre-order.` });
      if (orderType === 'normal' && item.quantity > product.stock) return res.status(409).json({ message: `Only ${product.stock} ${product.unit} of ${product.name} are available.` });
      subtotal += product.price * item.quantity;
      orderItems.push({ product: product.id, name: product.name, image: product.images[0] || '', price: product.price, unit: product.unit, quantity: item.quantity });
    }
    const totalAmount = subtotal + (subtotal >= 500 ? 0 : 25);
    const reserved = [];
    try {
      if (orderType === 'normal') {
        for (const item of items) {
          const product = await Product.findOneAndUpdate({ _id: item.productId, stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } }, { new: true });
          if (!product) throw Object.assign(new Error('Stock changed while placing your order. Please review your cart.'), { statusCode: 409 });
          reserved.push(item);
        }
      }
      const order = await Order.create({ user: req.user.id, items: orderItems, totalAmount, orderType, deliveryAddress, deliveryDate: date, preferredTimeSlot, deliveryInstructions: deliveryInstructions.trim(), paymentMethod, paymentStatus: 'pending' });
      if (cart) {
        cart.items = cart.items.filter((entry) => !items.some((item) => String(item.productId) === String(entry.product)));
        await cart.save();
      }
      return res.status(201).json({ order, message: orderType === 'preorder' ? 'Pre-order scheduled.' : 'Order placed successfully.' });
    } catch (error) {
      await Promise.all(reserved.map((item) => Product.updateOne({ _id: item.productId }, { $inc: { stock: item.quantity } })));
      throw error;
    }
  });
}

export const listOrders = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { user: req.user.id };
  if (req.query.type) filter.orderType = req.query.type;
  const orders = await Order.find(filter).populate('user', 'firstName lastName email phone').sort({ createdAt: -1 });
  res.json({ orders });
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email phone');
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (req.user.role !== 'admin' && String(order.user.id) !== String(req.user.id)) return res.status(403).json({ message: 'You cannot view this order.' });
  res.json({ order });
});

export const cancelPreOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user.id, orderType: 'preorder' });
  if (!order) return res.status(404).json({ message: 'Pre-order not found.' });
  if (order.orderStatus !== 'placed' || order.deliveryDate <= new Date()) return res.status(409).json({ message: 'This pre-order can no longer be cancelled.' });
  order.orderStatus = 'cancelled';
  await order.save();
  res.json({ order, message: 'Pre-order cancelled.' });
});

export const updateOrderStatus = asyncHandler(async (req, res) => {
  if (!statuses.includes(req.body.orderStatus)) return res.status(400).json({ message: 'Choose a valid order status.' });
  const order = await Order.findByIdAndUpdate(req.params.id, { orderStatus: req.body.orderStatus }, { new: true, runValidators: true });
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  res.json({ order });
});
