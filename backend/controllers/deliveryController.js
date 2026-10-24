import mongoose from 'mongoose';
import Order from '../models/Order.js';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import { DELIVERY_ELIGIBLE_STATUSES, DELIVERY_TRANSITIONS, hasPermission, orderTypeCondition } from '../config/permissions.js';
import { dispatchStatusNotification } from '../utils/orderNotifications.js';
import { maskOrder, maskOrderForAssignedRider } from '../utils/privacy.js';
import { buildStatusEntry, statusUpdateWithAudit, withPresentedHistory } from '../utils/statusAudit.js';

// Orders eligible for delivery handling: normal and pre-orders that have reached (or finished) the
// delivery stage of the existing workflow. Bulk orders use their own separate status workflow and are
// never part of this list.
export const listDeliveryOrders = asyncHandler(async (req, res) => {
  const filter = { orderType: orderTypeCondition(['normal', 'preorder']), orderStatus: { $in: DELIVERY_ELIGIBLE_STATUSES } };
  const orders = await Order.find(filter)
    .select('+statusHistory')
    .populate('user', 'firstName lastName email phone')
    .populate('assignedDeliveryStaff', 'firstName lastName adminId')
    .sort({ deliveryDate: 1, createdAt: -1 });
  res.json({ orders: orders.map((order) => withPresentedHistory(maskOrder(order, req.user), req.user, true)) });
});

// Active staff who actually hold delivery:update — the only accounts an order can be assigned to, since
// they are the ones able to advance it through the delivery-stage transitions afterwards.
export const listEligibleDeliveryStaff = asyncHandler(async (req, res) => {
  const staff = await User.find({ role: 'staff', isActive: true, permissions: 'delivery:update' }).sort({ firstName: 1, lastName: 1 });
  res.json({ staff: staff.map((user) => ({ _id: String(user._id), fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim(), loginId: user.adminId })) });
});

export const assignDeliveryOrder = asyncHandler(async (req, res) => {
  const unsupported = Object.keys(req.body || {}).filter((key) => key !== 'staffId');
  if (unsupported.length) return res.status(400).json({ message: `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.` });
  const { staffId } = req.body;
  let assignee = null;
  if (staffId) {
    if (!mongoose.isValidObjectId(staffId)) return res.status(400).json({ message: 'Choose a valid delivery staff member.' });
    assignee = await User.findOne({ _id: staffId, role: 'staff' });
    if (!assignee) return res.status(404).json({ message: 'That staff account no longer exists.' });
    if (assignee.isActive === false) return res.status(409).json({ message: 'That staff account is deactivated and cannot be assigned.' });
    if (!hasPermission(assignee, 'delivery:update')) return res.status(409).json({ message: 'That staff member does not currently hold delivery permissions.' });
  }

  // Assignable only while an order is still on its way to being delivered — not before it's ready
  // (placed/confirmed) and not once it's delivered/cancelled, a historical record by then.
  const ASSIGNABLE_STATUSES = ['preparing', 'out_for_delivery'];
  // The eligibility condition is part of the write itself, so an order that became delivered/cancelled
  // between the page loading and this request can no longer be (re)assigned.
  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, orderType: orderTypeCondition(['normal', 'preorder']), orderStatus: { $in: ASSIGNABLE_STATUSES } },
    { $set: { assignedDeliveryStaff: assignee ? assignee._id : null, assignedAt: assignee ? new Date() : null } },
    { new: true, runValidators: true },
  ).select('+statusHistory').populate('user', 'firstName lastName email phone').populate('assignedDeliveryStaff', 'firstName lastName adminId');
  if (!order) return res.status(409).json({ message: 'This order can no longer be assigned (it may already be delivered or cancelled).' });

  res.json({ order: withPresentedHistory(maskOrder(order, req.user), req.user, true), message: assignee ? `Assigned to ${assignee.firstName} ${assignee.lastName}`.trim() + '.' : 'Delivery assignment cleared.' });
});

/* ------------------------------------------------------------------ */
/* Rider-facing: a delivery staff member's own dashboard.               */
/* Deliberately separate from the admin-panel handlers above (which    */
/* show/advance every eligible order to any delivery:view/update       */
/* holder) — these two always filter and write by req.user._id, never  */
/* by anything the caller sends, so a rider can never read or move     */
/* someone else's delivery no matter what query params or body it      */
/* sends.                                                               */
/* ------------------------------------------------------------------ */

export const listMyDeliveryOrders = asyncHandler(async (req, res) => {
  const filter = {
    orderType: orderTypeCondition(['normal', 'preorder']),
    orderStatus: { $in: DELIVERY_ELIGIBLE_STATUSES },
    assignedDeliveryStaff: req.user._id,
  };
  const orders = await Order.find(filter)
    .select('+statusHistory')
    .populate('user', 'firstName lastName email phone')
    .populate('assignedDeliveryStaff', 'firstName lastName adminId')
    .sort({ deliveryDate: 1, createdAt: -1 });
  // maskOrderForAssignedRider, not maskOrder: every order here is already scoped to this rider's own
  // assignment (the query filter above), so the real customer phone is safe to reveal here specifically.
  res.json({ orders: orders.map((order) => withPresentedHistory(maskOrderForAssignedRider(order, req.user), req.user, true)) });
});

export const updateMyDeliveryOrderStatus = asyncHandler(async (req, res) => {
  const { orderStatus } = req.body;
  if (!Object.values(DELIVERY_TRANSITIONS).includes(orderStatus)) return res.status(400).json({ message: 'Choose a valid delivery status.' });
  // Scoped to this rider's own assignment and to delivery-eligible order types (never bulk) at the read
  // step, so an order assigned to someone else, not assigned at all, or of the wrong type reports the
  // same 404 as one that doesn't exist — nothing is revealed about why.
  const current = await Order.findOne({
    _id: req.params.id,
    orderType: orderTypeCondition(['normal', 'preorder']),
    assignedDeliveryStaff: req.user._id,
  });
  if (!current) return res.status(404).json({ message: 'Order not found or not assigned to you.' });
  if (DELIVERY_TRANSITIONS[current.orderStatus] !== orderStatus) return res.status(409).json({ message: `An order that is ${current.orderStatus.replaceAll('_', ' ')} cannot be changed to ${orderStatus.replaceAll('_', ' ')}.` });
  const entry = buildStatusEntry(req.user, current.orderType || 'normal', current.orderStatus, orderStatus);
  // Conditional on both the status just validated against and this rider's own assignment, so neither a
  // concurrent update nor a reassignment that happened in between can be raced past.
  const order = await Order.findOneAndUpdate(
    { _id: current.id, orderStatus: current.orderStatus, assignedDeliveryStaff: req.user._id },
    statusUpdateWithAudit('orderStatus', orderStatus, entry),
    { new: true, runValidators: true },
  ).select('+statusHistory').populate('user', 'firstName lastName email phone').populate('assignedDeliveryStaff', 'firstName lastName adminId');
  if (!order) return res.status(409).json({ message: 'This order was just updated by someone else. Refresh and try again.' });
  // Past the assigned-rider check and the conditional update, so the transition genuinely happened and
  // only the winning request notifies. Fire-and-forget: an SMS failure can never undo this transition.
  dispatchStatusNotification(order);
  res.json({ order: withPresentedHistory(maskOrderForAssignedRider(order, req.user), req.user, true) });
});
