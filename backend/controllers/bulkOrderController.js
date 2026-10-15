import BulkOrder from '../models/BulkOrder.js';
import asyncHandler from '../utils/asyncHandler.js';
import { hasPermission } from '../config/permissions.js';
import { maskBulkOrder } from '../utils/privacy.js';
import { buildStatusEntry, statusUpdateWithAudit, withPresentedHistory } from '../utils/statusAudit.js';

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

// Audit history is returned only by the *Admin handlers below, which are mounted on the admin router
// and additionally require bulk:view. The customer-facing handlers never select or return it.
async function listRequests(req, res, { includeHistory }) {
  // Owner and staff with bulk:view see every request; everyone else only their own.
  const canViewAll = hasPermission(req.user, 'bulk:view');
  const withHistory = includeHistory && canViewAll;
  const query = BulkOrder.find(canViewAll ? {} : { user: req.user.id }).sort({ createdAt: -1 });
  const requests = await (withHistory ? query.select('+statusHistory') : query);
  res.json({ requests: requests.map((request) => withPresentedHistory(maskBulkOrder(request, req.user), req.user, withHistory)) });
}

export const listBulkOrders = asyncHandler((req, res) => listRequests(req, res, { includeHistory: false }));
export const listAdminBulkOrders = asyncHandler((req, res) => listRequests(req, res, { includeHistory: true }));

export const getBulkOrder = asyncHandler(async (req, res) => {
  const request = await BulkOrder.findById(req.params.id);
  if (!request) return res.status(404).json({ message: 'Bulk order request not found.' });
  if (!hasPermission(req.user, 'bulk:view') && String(request.user) !== String(req.user.id)) return res.status(403).json({ message: 'You cannot view this request.' });
  res.json({ request: maskBulkOrder(request, req.user) });
});

async function changeRequestStatus(req, res, { includeHistory }) {
  if (!statuses.includes(req.body.status)) return res.status(400).json({ message: 'Choose a valid request status.' });
  const withHistory = includeHistory && hasPermission(req.user, 'bulk:view');
  const currentQuery = BulkOrder.findById(req.params.id);
  const current = await (withHistory ? currentQuery.select('+statusHistory') : currentQuery);
  if (!current) return res.status(404).json({ message: 'Bulk order request not found.' });
  const present = (doc) => withPresentedHistory(maskBulkOrder(doc, req.user), req.user, withHistory);
  // Same status: nothing changes and nothing is audited (the request is still acknowledged as before).
  if (current.status === req.body.status) return res.json({ request: present(current) });
  // Status and audit entry are one atomic document update, conditional on the status we read.
  const update = statusUpdateWithAudit('status', req.body.status, buildStatusEntry(req.user, 'bulk', current.status, req.body.status));
  const query = BulkOrder.findOneAndUpdate({ _id: current.id, status: current.status }, update, { new: true, runValidators: true });
  const request = await (withHistory ? query.select('+statusHistory') : query);
  if (!request) return res.status(409).json({ message: 'This request was just updated by someone else. Refresh and try again.' });
  return res.json({ request: present(request) });
}

// Status changes are audited by both handlers; only the admin one echoes the history back.
export const updateBulkOrderStatus = asyncHandler((req, res) => changeRequestStatus(req, res, { includeHistory: false }));
export const updateAdminBulkOrderStatus = asyncHandler((req, res) => changeRequestStatus(req, res, { includeHistory: true }));
