import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import asyncHandler from '../utils/asyncHandler.js';
import { DELIVERY_TRANSITIONS, ORDER_TYPE_PERMISSIONS, hasPermission, orderTypeCondition, viewableOrderTypes } from '../config/permissions.js';
import { dispatchOrderNotification, dispatchStatusNotification } from '../utils/orderNotifications.js';
import { deliveryFeeFor, loadOrderPricingRules } from '../utils/orderPricing.js';
import { bestOfferFor, loadPricingContext, round2 } from '../utils/promotionPricing.js';
import { maskOrder } from '../utils/privacy.js';
import { addVariationStock, deductVariationStock, effectiveMoq, isLegacyTarget, resolveVariation } from '../utils/productVariations.js';
import { validateOrderQuantity } from '../utils/quantity.js';
import { buildStatusEntry, statusUpdateWithAudit, withPresentedHistory, withoutStatusHistory } from '../utils/statusAudit.js';
import { actorName, readStock } from './stockController.js';
import { transactionHelper } from '../utils/withTransaction.js';

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

    // Both normal orders and pre-orders are delivered through the same mechanism (deliveryAddress,
    // assignedDeliveryStaff, etc.), so turning delivery off blocks both — bulk orders are a separate,
    // quote-only workflow (BulkOrder model) with no delivery/total of their own and are unaffected.
    const rules = await loadOrderPricingRules();
    if (!rules.deliveryEnabled) return res.status(409).json({ message: 'Delivery is currently unavailable. Please check back later.' });

    const cart = await Cart.findOne({ user: req.user.id });
    const sourceItems = Array.isArray(req.body.items) && req.body.items.length ? req.body.items : cart?.items || [];
    if (!sourceItems.length) return res.status(400).json({ message: 'Your cart is empty.' });
    // variationId is optional per item: omitted (or a product with no real variations) resolves to that
    // product's implicit default variation — see utils/productVariations.js. Never guessed otherwise.
    // Decimal quantities (Phase 6) are accepted above the existing minimum of 1, capped at 3 decimal
    // places — see utils/quantity.js. This is purely a format check; it never consults a product, so
    // it stays a simple aggregate rejection exactly as before, just swapping the predicate.
    const items = sourceItems.map((item) => ({
      productId: item.productId || item.product?._id || item.product,
      quantity: Number(item.quantity),
      variationId: item.variationId || null,
    }));
    if (items.some((item) => !item.productId || !validateOrderQuantity(item.quantity).value)) return res.status(400).json({ message: 'One or more product quantities are invalid.' });
    const products = await Product.find({ _id: { $in: items.map((item) => item.productId) } });
    const byId = new Map(products.map((product) => [String(product.id), product]));
    if (byId.size !== new Set(items.map((item) => String(item.productId))).size) return res.status(400).json({ message: 'One or more products are no longer available.' });
    const orderItems = [];
    let subtotal = 0;
    // Live promotions are read once, from the database, at the moment the order is placed.
    const promotions = await loadPricingContext();
    for (const item of items) {
      const product = byId.get(String(item.productId));
      if (orderType === 'preorder' && !product.preOrderAvailable) return res.status(400).json({ message: `${product.name} is not available for pre-order.` });
      if (orderType === 'normal' && item.quantity > product.stock) return res.status(409).json({ message: `Only ${product.stock} ${product.unit} of ${product.name} are available.` });
      // `price` on the stored line is the final unit price actually charged; the rest of the pricing is kept
      // as an immutable snapshot, so later edits to the product or promotion never change this order.
      const offer = bestOfferFor(product, promotions);
      const unitPrice = offer ? offer.finalPrice : product.price;
      const discountPerUnit = offer ? offer.discountPerUnit : 0;
      subtotal += unitPrice * item.quantity;
      orderItems.push({
        product: product.id, name: product.name, image: product.images[0] || '', price: unitPrice, unit: product.unit, quantity: item.quantity,
        originalPrice: product.price, discountPerUnit, discountTotal: round2(discountPerUnit * item.quantity), lineTotal: round2(unitPrice * item.quantity),
        ...(offer ? { promotion: { id: offer.promotionId, title: offer.title, section: offer.section } } : {}),
      });
    }
    subtotal = round2(subtotal);
    // The browser may say what total it showed, only so a changed price (for example an expired promotion)
    // is reported instead of silently charged. It is never used as a price.
    if (req.body.expectedSubtotal !== undefined && Math.abs(Number(req.body.expectedSubtotal) - subtotal) > 0.009) {
      return res.status(409).json({ code: 'PRICE_CHANGED', message: 'Some prices changed since you last viewed your cart. Please review the updated prices and place your order again.', pricing: { subtotal } });
      const variation = resolveVariation(product, item.variationId);
      if (!variation) return res.status(400).json({ message: `The selected option for ${product.name} is no longer available.` });
      // Phase 6: MOQ is checked here — after the real product/variation is resolved, before any stock
      // mutation (which only happens later, inside the Phase 5 transaction). `effectiveMoq` never uses a
      // truthiness check, so an explicitly configured 0 correctly means "no minimum", same as absent.
      const moq = effectiveMoq(product, orderType);
      if (moq != null && item.quantity < moq) {
        return res.status(400).json({
          message: `${product.name} requires a minimum order quantity of ${moq} ${variation.unit}.`,
          product: product.name, requestedQuantity: item.quantity, requiredMoq: moq, unit: variation.unit, orderType,
        });
      }
      if (orderType === 'normal' && item.quantity > variation.stock) return res.status(409).json({ message: `Only ${variation.stock} ${variation.unit} of ${product.name} are available.` });
      subtotal += product.price * item.quantity;
      orderItems.push({
        product: product.id, name: product.name, image: product.images[0] || '', price: product.price,
        unit: variation.unit, quantity: item.quantity,
        variationId: variation.isLegacy ? null : String(variation._id), variationLabel: variation.isLegacy ? '' : variation.label,
      });
    }
    if (subtotal < rules.minimumOrderValue) return res.status(400).json({ message: `Minimum order value is ₹${rules.minimumOrderValue}. Add more items to continue.` });
    // The server computes this from the current settings and the looked-up product prices alone —
    // nothing from the request body ever contributes to totalAmount, so a client-supplied total is
    // never trusted either before or after this change.
    const totalAmount = subtotal + deliveryFeeFor(subtotal, rules);

    const orderFields = {
      user: req.user.id, items: orderItems, totalAmount, orderType, deliveryAddress, deliveryDate: date,
      preferredTimeSlot, deliveryInstructions: deliveryInstructions.trim(), paymentMethod, paymentStatus: 'pending',
    };

    let order;
    if (orderType === 'normal') {
      // Phase 5: every item's deduction, its StockMovement, the order document itself, and the cart
      // cleanup all commit or abort together inside one transaction. A failure partway through (e.g. the
      // third of four items has run out of stock) leaves nothing behind at all — no partial deduction,
      // no order, no misleading ledger row — replacing the old manual per-item compensation entirely.
      order = await transactionHelper.run(async (session) => {
        // Normal orders deduct synchronously, exactly once (this create() call never repeats for the
        // same order) — pre-orders deduct later, at confirmation (see updateOrderStatus below).
        const [newOrder] = await Order.create([{ ...orderFields, stockDeductedAt: new Date() }], { session });
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const product = byId.get(String(item.productId));
          const isLegacy = isLegacyTarget(product, item.variationId);
          const variation = resolveVariation(product, item.variationId);
          const updatedProduct = await deductVariationStock(Product, { productId: item.productId, variationId: item.variationId, isLegacy, quantity: item.quantity, session });
          if (!updatedProduct) throw Object.assign(new Error('Stock changed while placing your order. Please review your cart.'), { statusCode: 409 });
          const newStockValue = readStock(updatedProduct, item.variationId, isLegacy);
          const previousStock = newStockValue + item.quantity;
          await StockMovement.create([{
            product: product._id,
            productName: product.name,
            variationId: isLegacy ? null : String(item.variationId),
            variationLabel: isLegacy ? 'Default' : variation.label,
            unit: variation.unit,
            type: 'remove',
            previousStock,
            newStock: newStockValue,
            difference: newStockValue - previousStock,
            reason: 'Order placed',
            actor: { id: req.user._id, name: actorName(req.user) },
            source: { type: 'order', id: newOrder._id, event: 'order_placed', itemKey: String(index) },
          }], { session });
        }
        if (cart) {
          cart.items = cart.items.filter((entry) => !items.some((cartItem) => String(cartItem.productId) === String(entry.product)));
          await cart.save({ session });
        }
        return newOrder;
      });
    } else {
      // Pre-orders never deduct at placement — confirmation does (updateOrderStatus below). No stock
      // mutation happens here, so no transaction is needed; unchanged from before Phase 5.
      order = await Order.create({ ...orderFields, stockDeductedAt: null });
      if (cart) {
        cart.items = cart.items.filter((entry) => !items.some((item) => String(item.productId) === String(entry.product)));
        await cart.save();
      }
    }

    // Only once the order exists and the cart has been updated — never for failed validation, a lost
    // stock race or any path that doesn't reach here. Fire-and-forget: it cannot delay or fail this
    // response, and Order.create happens exactly once, so one order means one notification. Dispatched
    // only after the transaction (if any) has committed — never from inside the callback above, which
    // the MongoDB driver can transparently re-run on a transient conflict.
    dispatchOrderNotification(order, 'orderPlaced');
    return res.status(201).json({ order, message: orderType === 'preorder' ? 'Pre-order scheduled.' : 'Order placed successfully.' });
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
  const orders = await Order.find(filter).select('+statusHistory').populate('user', 'firstName lastName email phone').populate('assignedDeliveryStaff', 'firstName lastName adminId').sort({ createdAt: -1 });
  res.json({ orders: orders.map((order) => withPresentedHistory(maskOrder(order, req.user), req.user, true)) });
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email phone');
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (req.user.role !== 'admin' && String(order.user.id) !== String(req.user.id)) return res.status(403).json({ message: 'You cannot view this order.' });
  res.json({ order });
});

// Customer-initiated cancellation — only reachable while still 'placed' (checked below), i.e. before
// the admin has confirmed it. Pre-orders only ever deduct stock at confirmation (see
// confirmPreOrderTransactionally below), so a still-'placed' order never had stock deducted and there is
// nothing to restore here — this handler never creates a StockMovement. Cancelling an already-confirmed
// pre-order is an admin action through updateOrderStatus, which does restore stock.
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
  // Past the conditional update, so exactly one concurrent request reaches here — a competing request
  // gets the 409 above and sends nothing.
  dispatchOrderNotification(cancelled, 'orderCancelled');
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

// Pre-order confirmation deducts stock for the first time (placement never did). Phase 5: the claim,
// every item's deduction, its StockMovement, and the status transition itself are ONE transaction — so
// there is no longer a window between "claim committed" and "status transition committed" in which a
// crash could leave an order permanently stuck "placed" with its stock already gone (the gap identified
// during Phase 5 design review). A duplicate/concurrent confirm request's claim attempt matches nothing
// and the transaction commits as a no-op, falling through to the ordinary conflict response below. Any
// item that can't be fulfilled aborts the whole transaction — nothing already written in this attempt
// (claim, earlier deductions, earlier movements) survives, and the claim is free for a clean retry.
async function confirmPreOrderTransactionally(current, actor) {
  const entry = buildStatusEntry(actor, current.orderType, 'placed', 'confirmed');
  const claimed = await transactionHelper.run(async (session) => {
    const claim = await Order.findOneAndUpdate(
      { _id: current.id, orderStatus: 'placed', stockDeductedAt: null },
      { $set: { stockDeductedAt: new Date() } },
      { new: true, session },
    );
    if (!claim) return null;
    for (let index = 0; index < claim.items.length; index += 1) {
      const item = claim.items[index];
      if (!item.product) continue; // deleted product: nothing to deduct, nothing to block confirmation on
      // Validation/snapshot read only — never session-scoped, matching stockController.js::adjustStock's
      // own established convention. The actual mutation below is what must be session-scoped for
      // atomicity, and deductVariationStock's own guard re-validates the real, current stock regardless.
      const product = await Product.findById(item.product);
      if (!product) continue;
      const variation = resolveVariation(product, item.variationId);
      if (!variation) throw Object.assign(new Error(`The selected option for ${item.name} is no longer available. Cannot confirm this order.`), { statusCode: 409 });
      const isLegacy = isLegacyTarget(product, item.variationId);
      const updatedProduct = await deductVariationStock(Product, { productId: item.product, variationId: item.variationId, isLegacy, quantity: item.quantity, session });
      if (!updatedProduct) throw Object.assign(new Error(`Only limited stock of ${item.name} is available. Cannot confirm this order.`), { statusCode: 409 });
      const newStockValue = readStock(updatedProduct, item.variationId, isLegacy);
      const previousStock = newStockValue + item.quantity;
      await StockMovement.create([{
        product: item.product,
        productName: item.name,
        variationId: isLegacy ? null : String(item.variationId),
        variationLabel: isLegacy ? 'Default' : variation.label,
        unit: variation.unit,
        type: 'remove',
        previousStock,
        newStock: newStockValue,
        difference: newStockValue - previousStock,
        reason: 'Pre-order confirmed',
        actor: { id: actor._id, name: actorName(actor) },
        source: { type: 'order', id: claim._id, event: 'preorder_confirmed', itemKey: String(index) },
      }], { session });
    }
    return Order.findOneAndUpdate(
      { _id: claim.id, orderStatus: 'placed' },
      statusUpdateWithAudit('orderStatus', 'confirmed', entry),
      { new: true, session, runValidators: true },
    ).select('+statusHistory');
  });
  return claimed; // null means the claim was already taken (conflict); never thrown for that case
}

// Phase 5B: all-or-nothing stock restoration, in its OWN transaction, deliberately separate from the
// cancellation/rejection status write that triggers it (which is already durable by the time this
// runs). Either every eligible line is restored and logged, or none is — a partial-restoration problem
// must never un-cancel/un-reject an already-recorded decision, so the status write is never touched
// here. The claim below is the exactly-once guard: a duplicate cancellation request's claim attempt
// matches nothing and this commits as a no-op, restoring nothing and logging nothing.
async function restoreOrderStockTransactionally(order, actor, { reasonText, event }) {
  let anyRestorationAttempted = false;
  try {
    await transactionHelper.run(async (session) => {
      const claim = await Order.findOneAndUpdate(
        { _id: order.id, stockDeductedAt: { $ne: null }, stockRestoredAt: null },
        { $set: { stockRestoredAt: new Date() } },
        { session },
      );
      if (!claim) return; // never deducted, or already restored — not a failure, nothing to do
      anyRestorationAttempted = true;
      for (let index = 0; index < order.items.length; index += 1) {
        const item = order.items[index];
        if (!item.product) continue; // deleted product: nothing to restore
        const isLegacy = !item.variationId;
        const updatedProduct = await addVariationStock(Product, { productId: item.product, variationId: item.variationId, isLegacy, quantity: item.quantity, session });
        if (!updatedProduct) throw new Error(`Could not restore stock for ${item.name}.`);
        const newStockValue = readStock(updatedProduct, item.variationId, isLegacy);
        const previousStock = newStockValue - item.quantity;
        await StockMovement.create([{
          product: item.product,
          productName: item.name,
          variationId: isLegacy ? null : String(item.variationId),
          variationLabel: item.variationLabel || 'Default',
          unit: item.unit,
          type: 'add',
          previousStock,
          newStock: newStockValue,
          difference: newStockValue - previousStock,
          reason: reasonText,
          actor: { id: actor._id, name: actorName(actor) },
          source: { type: 'order', id: order._id, event, itemKey: String(index) },
        }], { session });
      }
    });
    return { failed: false };
  } catch (error) {
    console.error(`Stock restoration transaction aborted for order ${order.id}: ${error.message}`);
    return { failed: anyRestorationAttempted };
  }
}

export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { orderStatus } = req.body;
  if (!statuses.includes(orderStatus)) return res.status(400).json({ message: 'Choose a valid order status.' });
  const current = await Order.findById(req.params.id);
  if (!current) return res.status(404).json({ message: 'Order not found.' });
  // Each order type is governed by its own permissions; cancelling a normal order needs orders:cancel.
  // A delivery:update holder may additionally apply the two delivery-stage steps on their own
  // (preparing -> out_for_delivery -> delivered) without the order type's broader update permission.
  const access = ORDER_TYPE_PERMISSIONS[current.orderType || 'normal'];
  const isDeliveryStep = DELIVERY_TRANSITIONS[current.orderStatus] === orderStatus && hasPermission(req.user, 'delivery:update');
  if (!access || !(hasPermission(req.user, access.update) || isDeliveryStep) || (orderStatus === 'cancelled' && !hasPermission(req.user, access.cancel))) return res.status(403).json({ message: 'You do not have permission to change this order.' });
  if (!nextStatuses[current.orderStatus].includes(orderStatus)) return res.status(409).json({ message: `An order that is ${current.orderStatus.replaceAll('_', ' ')} cannot be changed to ${orderStatus.replaceAll('_', ' ')}.` });

  const isPreorderConfirmation = current.orderType === 'preorder' && current.orderStatus === 'placed' && orderStatus === 'confirmed';

  let order;
  if (isPreorderConfirmation) {
    // Matches stockController.js::adjustStock's own convention: a deliberately-tagged failure inside the
    // transaction is caught and mapped here explicitly, rather than left to the generic error handler.
    try {
      order = await confirmPreOrderTransactionally(current, req.user);
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
      throw error;
    }
    if (!order) return res.status(409).json({ message: 'This order was just updated by someone else. Refresh and try again.' });
  } else {
    // Conditional on the status we validated against, so two admins can't both apply a transition.
    // The status change and its audit entry are one atomic document update.
    const entry = buildStatusEntry(req.user, current.orderType || 'normal', current.orderStatus, orderStatus);
    order = await Order.findOneAndUpdate({ _id: current.id, orderStatus: current.orderStatus }, statusUpdateWithAudit('orderStatus', orderStatus, entry), { new: true, runValidators: true }).select('+statusHistory');
    if (!order) return res.status(409).json({ message: 'This order was just updated by someone else. Refresh and try again.' });
  }
  // Past the conditional update/transaction, so this transition genuinely happened and exactly one
  // request won it. `order` is the raw document, not the masked `presented` copy below, so the
  // recipient's real number is resolved server-side without changing what any viewer is allowed to see.
  dispatchStatusNotification(order);
  const presented = withPresentedHistory(maskOrder(order, req.user), req.user, true);
  // Restoration applies to ANY order type, but only ever actually does something if stock was genuinely
  // deducted for this order (stockDeductedAt set — normal orders at placement, pre-orders at the
  // confirmation above) and hasn't already been restored.
  if (orderStatus === 'cancelled') {
    const { failed } = await restoreOrderStockTransactionally(order, req.user, { reasonText: 'Order cancelled', event: 'order_cancelled' });
    if (failed) {
      // The cancellation itself is persisted and audited, so say exactly that instead of reporting plain
      // success. The restoration transaction aborted entirely — either all of it or none of it applied —
      // so inventory needs a manual check, but no item is left half-restored and no movement row exists
      // for this failed attempt.
      return res.status(500).json({
        code: 'STOCK_RESTORE_FAILED',
        message: 'The order was cancelled and recorded, but stock could not be restored. Adjust inventory manually; do not cancel again.',
        order: presented,
      });
    }
  }
  res.json({ order: presented });
});
