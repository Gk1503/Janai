import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ORDER_TYPE_PERMISSIONS, hasPermission, orderTypeCondition, viewableOrderTypes } from '../config/permissions.js';
import { maskOrder } from '../utils/privacy.js';
import { buildStatusEntry, statusUpdateWithAudit, withPresentedHistory, withoutStatusHistory } from '../utils/statusAudit.js';

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

// Admin-panel listing. Customer-facing /orders and /preorders keep using listOrders above, where
// anyone other than the owner only ever receives their own orders.
export const listAdminOrders = asyncHandler(async (req, res) => {
  const requested = req.query.type ? String(req.query.type) : null;
  if (requested && !ORDER_TYPE_PERMISSIONS[requested]) return res.status(400).json({ message: 'Choose a valid order type.' });
  const allowed = viewableOrderTypes(req.user);
  if (requested ? !allowed.includes(requested) : !allowed.length) return res.status(403).json({ message: 'You do not have permission to view these orders.' });
  const filter = {};
  if (requested || req.user.role !== 'admin') filter.orderType = orderTypeCondition(requested ? [requested] : allowed);
  // History is requested explicitly; order types the viewer cannot see were already excluded by the filter.
  const orders = await Order.find(filter).select('+statusHistory').populate('user', 'firstName lastName email phone').sort({ createdAt: -1 });
  res.json({ orders: orders.map((order) => withPresentedHistory(maskOrder(order, req.user), req.user, true)) });
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
  // Conditional on the state we just validated, and written together with its audit entry.
  const cancelled = await Order.findOneAndUpdate(
    { _id: order.id, user: req.user.id, orderType: 'preorder', orderStatus: 'placed' },
    statusUpdateWithAudit('orderStatus', 'cancelled', buildStatusEntry(req.user, 'preorder', 'placed', 'cancelled')),
    { new: true, runValidators: true },
  );
  if (!cancelled) return res.status(409).json({ message: 'This pre-order can no longer be cancelled.' });
  res.json({ order: withoutStatusHistory(cancelled), message: 'Pre-order cancelled.' });
});

// Normal flow: placed -> confirmed -> preparing -> out_for_delivery -> delivered. Active orders can be cancelled; delivered and cancelled are final.
const nextStatuses = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { orderStatus } = req.body;
  if (!statuses.includes(orderStatus)) return res.status(400).json({ message: 'Choose a valid order status.' });
  const current = await Order.findById(req.params.id);
  if (!current) return res.status(404).json({ message: 'Order not found.' });
  // Each order type is governed by its own permissions; cancelling a normal order needs orders:cancel.
  const access = ORDER_TYPE_PERMISSIONS[current.orderType || 'normal'];
  if (!access || !hasPermission(req.user, access.update) || (orderStatus === 'cancelled' && !hasPermission(req.user, access.cancel))) return res.status(403).json({ message: 'You do not have permission to change this order.' });
  if (!nextStatuses[current.orderStatus].includes(orderStatus)) return res.status(409).json({ message: `An order that is ${current.orderStatus.replaceAll('_', ' ')} cannot be changed to ${orderStatus.replaceAll('_', ' ')}.` });
  // Conditional on the status we validated against, so two admins can't both apply a transition.
  // The status change and its audit entry are one atomic document update.
  const entry = buildStatusEntry(req.user, current.orderType || 'normal', current.orderStatus, orderStatus);
  const order = await Order.findOneAndUpdate({ _id: current.id, orderStatus: current.orderStatus }, statusUpdateWithAudit('orderStatus', orderStatus, entry), { new: true, runValidators: true }).select('+statusHistory');
  if (!order) return res.status(409).json({ message: 'This order was just updated by someone else. Refresh and try again.' });
  const presented = withPresentedHistory(maskOrder(order, req.user), req.user, true);
  // Normal orders reserve stock at checkout; pre-orders do not. The conditional update above lets exactly
  // one request win a cancellation, so each reservation is returned at most once.
  if (orderStatus === 'cancelled' && order.orderType === 'normal') {
    const lines = order.items.filter((item) => item.product);
    const results = await Promise.allSettled(lines.map((item) => Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } })));
    // A product that no longer exists matches nothing, which also means its stock was not restored.
    const failed = lines.filter((item, index) => results[index].status === 'rejected' || results[index].value?.matchedCount === 0);
    if (failed.length) {
      console.error(`Stock restoration incomplete for cancelled order ${order.id}: ${failed.length} of ${lines.length} item(s).`);
      // The cancellation itself is persisted and audited, so say exactly that instead of reporting plain success.
      return res.status(500).json({
        code: 'STOCK_RESTORE_FAILED',
        message: `The order was cancelled and recorded, but stock could not be restored for: ${failed.map((item) => item.name).join(', ')}. Adjust inventory manually; do not cancel again.`,
        order: presented,
      });
    }
  }
  res.json({ order: presented });
});
