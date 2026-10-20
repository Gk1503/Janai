import mongoose from 'mongoose';
import Order from '../models/Order.js';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import { DELIVERY_ELIGIBLE_STATUSES, hasPermission, orderTypeCondition } from '../config/permissions.js';
import { maskOrder } from '../utils/privacy.js';
import { withPresentedHistory } from '../utils/statusAudit.js';

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
