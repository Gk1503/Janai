import Order from '../models/Order.js';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import { orderTypeCondition, viewableOrderTypes } from '../config/permissions.js';
import { maskOrder, maskUser, shouldMaskContact } from '../utils/privacy.js';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Qualifying order = not cancelled, and either Cash on Delivery (payment is collected on
// delivery, so "pending" is the normal state and should still count) or an online payment
// that has actually been received. Shared by the Customers list and the Customer Details
// page so the two can never drift apart.
async function orderTotalsByUser(userIds) {
  const totals = await Order.aggregate([
    { $match: { user: { $in: userIds } } },
    { $group: { _id: '$user', totalOrders: { $sum: 1 }, totalSpent: { $sum: { $cond: [{ $and: [{ $ne: ['$orderStatus', 'cancelled'] }, { $or: [{ $eq: ['$paymentMethod', 'cod'] }, { $eq: ['$paymentStatus', 'paid'] }] }] }, '$totalAmount', 0] } } } },
  ]);
  return new Map(totals.map((entry) => [String(entry._id), entry]));
}

export const listUsers = asyncHandler(async (req, res) => {
  const { q, role } = req.query;
  const filter = {};
  // Only the owner can list owner/staff accounts; staff with customers:view see customers only.
  if (req.user.role !== 'admin') filter.role = 'customer';
  else if (role) filter.role = role;
  if (q && String(q).trim()) {
    const regex = new RegExp(escapeRegex(String(q).trim()), 'i');
    // Searching masked fields would let staff confirm hidden values, so name-only for them.
    filter.$or = shouldMaskContact(req.user) ? [{ firstName: regex }, { lastName: regex }] : [{ firstName: regex }, { lastName: regex }, { email: regex }, { phone: regex }];
  }
  // Default limit (500) and no role filter match the endpoint's original, unparameterized behaviour
  // so existing callers (the Dashboard's Customers tab) keep working exactly as before.
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 500));
  const page = Math.max(1, Number(req.query.page) || 1);
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);

  const totalsById = await orderTotalsByUser(users.map((user) => user._id));

  res.json({
    users: users.map((user) => maskUser({
      ...user.toSafeJSON(),
      totalOrders: totalsById.get(String(user._id))?.totalOrders || 0,
      totalSpent: totalsById.get(String(user._id))?.totalSpent || 0,
    }, req.user)),
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
  });
});

export const updateUserRole = asyncHandler(async (req, res) => {
  // Owner and staff accounts are never created or changed here; staff are managed in Staff & Access.
  if (req.body.role !== 'customer') return res.status(400).json({ message: 'Owner and staff roles cannot be assigned here.' });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  if (user.role !== 'customer') return res.status(403).json({ message: 'This account\'s role cannot be changed here.' });
  res.json({ user: user.toSafeJSON() });
});

// "Active" has no stored status on User today, so it is defined here from real
// order activity (placed an order in the last 30 days) rather than a new field.
export const getCustomerStats = asyncHandler(async (req, res) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalCustomers, newCustomers, customersWithOrders, activeCustomerIds] = await Promise.all([
    User.countDocuments({ role: 'customer' }),
    User.countDocuments({ role: 'customer', createdAt: { $gte: startOfMonth } }),
    Order.distinct('user'),
    Order.distinct('user', { createdAt: { $gte: thirtyDaysAgo } }),
  ]);

  res.json({
    totalCustomers,
    newCustomers,
    customersWithOrders: customersWithOrders.length,
    activeCustomers: activeCustomerIds.length,
  });
});

export const getCustomerDetail = asyncHandler(async (req, res) => {
  const customer = await User.findById(req.params.id);
  if (!customer || (req.user.role !== 'admin' && customer.role !== 'customer')) return res.status(404).json({ message: 'Customer not found.' });
  // Order history is limited to the order types this user may view.
  const orderFilter = { user: customer._id };
  if (req.user.role !== 'admin') orderFilter.orderType = orderTypeCondition(viewableOrderTypes(req.user));
  const [orders, totalsById] = await Promise.all([
    Order.find(orderFilter).populate('user', 'firstName lastName email phone').sort({ createdAt: -1 }),
    orderTotalsByUser([customer._id]),
  ]);
  const totals = totalsById.get(String(customer._id)) || { totalOrders: 0, totalSpent: 0 };
  res.json({
    customer: maskUser({ ...customer.toSafeJSON(), totalOrders: totals.totalOrders, totalSpent: totals.totalSpent }, req.user),
    orders: orders.map((order) => maskOrder(order, req.user)),
  });
});
