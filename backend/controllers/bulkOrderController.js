import BulkOrder from '../models/BulkOrder.js';
import asyncHandler from '../utils/asyncHandler.js';

const orderTypes = ['Business', 'Office', 'Event', 'Party', 'Large Family', 'Other'];
const statuses = ['Pending', 'Reviewing', 'Approved', 'Rejected', 'Completed'];

export const createBulkOrder = asyncHandler(async (req, res) => {
  const { name, phone, email, organization = '', orderType = 'Business', products, requiredDate, deliveryAddress, additionalRequirements = '' } = req.body;
  if (![name, phone, email, deliveryAddress].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Complete your contact and delivery details.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!orderTypes.includes(orderType)) return res.status(400).json({ message: 'Choose a valid bulk order type.' });
  if (!Array.isArray(products) || !products.length || products.some((item) => !String(item.name || '').trim() || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)) return res.status(400).json({ message: 'Add products with valid quantities.' });
  const date = new Date(requiredDate);
  if (!requiredDate || Number.isNaN(date.getTime()) || date <= new Date()) return res.status(400).json({ message: 'Required delivery date must be in the future.' });
  const request = await BulkOrder.create({ user: req.user?.id, name, phone, email, organization, orderType, products, requiredDate: date, deliveryAddress, additionalRequirements });
  res.status(201).json({ request, message: 'Bulk order request submitted.' });
});

export const listBulkOrders = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'admin' ? {} : { user: req.user.id };
  const requests = await BulkOrder.find(filter).sort({ createdAt: -1 });
  res.json({ requests });
});

export const getBulkOrder = asyncHandler(async (req, res) => {
  const request = await BulkOrder.findById(req.params.id);
  if (!request) return res.status(404).json({ message: 'Bulk order request not found.' });
  if (req.user.role !== 'admin' && String(request.user) !== String(req.user.id)) return res.status(403).json({ message: 'You cannot view this request.' });
  res.json({ request });
});

export const updateBulkOrderStatus = asyncHandler(async (req, res) => {
  if (!statuses.includes(req.body.status)) return res.status(400).json({ message: 'Choose a valid request status.' });
  const request = await BulkOrder.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true, runValidators: true });
  if (!request) return res.status(404).json({ message: 'Bulk order request not found.' });
  res.json({ request });
});
