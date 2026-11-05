import BulkOrder from '../models/BulkOrder.js';
import Product from '../models/Product.js';
import asyncHandler from '../utils/asyncHandler.js';
import { hasPermission } from '../config/permissions.js';
import { maskBulkOrder } from '../utils/privacy.js';
import { buildStatusEntry, statusUpdateWithAudit, withPresentedHistory } from '../utils/statusAudit.js';
import {
  BULK_ORDER_TYPES, BULK_STATUSES, CUSTOMER_CANCELLABLE, QUOTABLE, buildQuotation, canTransition, isValidId,
  normalizeBulkPhone, presentBulkForCustomer, readAdminMessage, validateRequestLines,
} from '../utils/bulkOrderWorkflow.js';

const MAX_REQUIRED_DATE_DAYS = 730;

export const createBulkOrder = asyncHandler(async (req, res) => {
  const { name, phone, email, organization = '', orderType = 'Business', products, requiredDate, deliveryAddress, additionalRequirements = '' } = req.body;
  if (![name, phone, email, deliveryAddress].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Complete your contact and delivery details.' });
  if (name.trim().length > 100 || deliveryAddress.trim().length > 500) return res.status(400).json({ message: 'Name or delivery address is too long.' });
  if (typeof organization !== 'string' || organization.trim().length > 120) return res.status(400).json({ message: 'Organization name can be at most 120 characters.' });
  if (typeof additionalRequirements !== 'string' || additionalRequirements.length > 2000) return res.status(400).json({ message: 'Additional requirements can be at most 2000 characters.' });
  const mobile = normalizeBulkPhone(phone);
  if (!mobile) return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!BULK_ORDER_TYPES.includes(orderType)) return res.status(400).json({ message: 'Choose a valid bulk order type.' });

  // Products picked from the catalogue are resolved here, so their name and unit never come from the client.
  const productIds = Array.isArray(products) ? products.map((item) => item?.productId).filter(Boolean) : [];
  if (productIds.some((id) => !isValidId(id))) return res.status(400).json({ message: 'One of the selected products is no longer available for bulk orders.' });
  const catalogue = new Map();
  if (productIds.length) {
    const found = await Product.find({ _id: { $in: productIds }, bulkAvailable: true }).select('name unit');
    found.forEach((product) => catalogue.set(String(product._id), product));
  }
  const checked = validateRequestLines(products, catalogue);
  if (checked.error) return res.status(400).json({ message: checked.error });

  const date = new Date(requiredDate);
  if (!requiredDate || Number.isNaN(date.getTime()) || date <= new Date()) return res.status(400).json({ message: 'Required delivery date must be in the future.' });
  if (date.getTime() - Date.now() > MAX_REQUIRED_DATE_DAYS * 24 * 60 * 60 * 1000) return res.status(400).json({ message: 'Choose a required date within the next two years.' });

  // The owner is whoever the verified session says it is. A customer id in the body is never read.
  const request = await BulkOrder.create({
    user: req.user?._id,
    name: name.trim(), phone: mobile, email: email.trim(), organization: organization.trim(), orderType,
    products: checked.lines, requiredDate: date, deliveryAddress: deliveryAddress.trim(), additionalRequirements: additionalRequirements.trim(),
  });
  res.status(201).json({ request: presentBulkForCustomer(request), message: 'Bulk order request submitted.' });
});

// ---- Customer-facing handlers: always scoped to the signed-in account, whatever its role, and always
// shaped by presentBulkForCustomer (no audit history, no staff identifiers).
export const listBulkOrders = asyncHandler(async (req, res) => {
  const requests = await BulkOrder.find({ user: req.user.id }).sort({ createdAt: -1 });
  res.json({ requests: requests.map(presentBulkForCustomer) });
});

export const getBulkOrder = asyncHandler(async (req, res) => {
  // A malformed id, a missing request and someone else's request all answer the same way.
  const request = isValidId(req.params.id) ? await BulkOrder.findOne({ _id: req.params.id, user: req.user.id }) : null;
  if (!request) return res.status(404).json({ message: 'Bulk order request not found.' });
  res.json({ request: presentBulkForCustomer(request) });
});

export const cancelBulkOrder = asyncHandler(async (req, res) => {
  const current = isValidId(req.params.id) ? await BulkOrder.findOne({ _id: req.params.id, user: req.user.id }) : null;
  if (!current) return res.status(404).json({ message: 'Bulk order request not found.' });
  if (!CUSTOMER_CANCELLABLE.includes(current.status)) return res.status(409).json({ message: `A request that is ${current.status.toLowerCase()} can no longer be cancelled.` });
  const update = statusUpdateWithAudit('status', 'Cancelled', buildStatusEntry(req.user, 'bulk', current.status, 'Cancelled'));
  // Conditional on the status just validated and on ownership, so a concurrent staff decision cannot be overwritten.
  const request = await BulkOrder.findOneAndUpdate({ _id: current.id, user: req.user.id, status: current.status }, update, { new: true, runValidators: true });
  if (!request) return res.status(409).json({ message: 'This request was just updated. Refresh and try again.' });
  res.json({ request: presentBulkForCustomer(request), message: 'Bulk order request cancelled.' });
});

// ---- Staff-facing handlers.
// Audit history is returned only by the *Admin handlers below, which are mounted on the admin router
// and additionally require bulk:view.
export const listAdminBulkOrders = asyncHandler(async (req, res) => {
  // The router already requires bulk:view; checked again so this handler is safe on its own.
  if (!hasPermission(req.user, 'bulk:view')) return res.status(403).json({ message: 'You do not have permission to view bulk orders.' });
  const requests = await BulkOrder.find({}).sort({ createdAt: -1 }).select('+statusHistory');
  res.json({ requests: requests.map((request) => withPresentedHistory(maskBulkOrder(request, req.user), req.user, true)) });
});

async function changeRequestStatus(req, res, { includeHistory }) {
  const { status: target } = req.body;
  if (!BULK_STATUSES.includes(target)) return res.status(400).json({ message: 'Choose a valid request status.' });
  const message = readAdminMessage(req.body.message);
  if (message.error) return res.status(400).json({ message: message.error });
  const withHistory = includeHistory && hasPermission(req.user, 'bulk:view');
  // A malformed id surfaces as a CastError, which the error handler reports as 400, as before.
  const currentQuery = BulkOrder.findById(req.params.id);
  const current = await (withHistory ? currentQuery.select('+statusHistory') : currentQuery);
  if (!current) return res.status(404).json({ message: 'Bulk order request not found.' });
  const present = (doc) => withPresentedHistory(maskBulkOrder(doc, req.user), req.user, withHistory);
  // Same status: nothing changes and nothing is audited (the request is still acknowledged as before).
  if (current.status === target) return res.json({ request: present(current) });
  if (target === 'Cancelled') return res.status(403).json({ message: 'Only the customer can cancel a request. Reject it instead.' });
  if (!canTransition(current.status, target)) return res.status(409).json({ message: `A request that is ${current.status.toLowerCase()} cannot be changed to ${target.toLowerCase()}.` });
  if (target === 'Rejected' && !message.value) return res.status(400).json({ message: 'Add a reason for the customer when rejecting a request.' });
  if (target === 'Approved' && !current.quotation?.items?.length) return res.status(409).json({ message: 'Send a quotation before approving this request.' });

  // Status, optional customer note and audit entry are one atomic document update, conditional on the status we read.
  const update = statusUpdateWithAudit('status', target, buildStatusEntry(req.user, 'bulk', current.status, target));
  if (message.value) update.$set.adminResponse = { message: message.value, at: new Date() };
  const query = BulkOrder.findOneAndUpdate({ _id: current.id, status: current.status }, update, { new: true, runValidators: true });
  const request = await (withHistory ? query.select('+statusHistory') : query);
  if (!request) return res.status(409).json({ message: 'This request was just updated by someone else. Refresh and try again.' });
  return res.json({ request: present(request) });
}

// Status changes are audited by both handlers; only the admin one echoes the history back.
export const updateBulkOrderStatus = asyncHandler((req, res) => changeRequestStatus(req, res, { includeHistory: false }));
export const updateAdminBulkOrderStatus = asyncHandler((req, res) => changeRequestStatus(req, res, { includeHistory: true }));

// Creates or revises the quotation. Prices come from staff; quantities and totals are derived server-side.
export const setBulkOrderQuotation = asyncHandler(async (req, res) => {
  const current = await BulkOrder.findById(req.params.id);
  if (!current) return res.status(404).json({ message: 'Bulk order request not found.' });
  if (!QUOTABLE.includes(current.status)) return res.status(409).json({ message: `A request that is ${current.status.toLowerCase()} can no longer be quoted.` });
  const built = buildQuotation(current, req.body);
  if (built.error) return res.status(400).json({ message: built.error });
  built.quotation.quotedByName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim();
  const update = statusUpdateWithAudit('status', 'Quoted', buildStatusEntry(req.user, 'bulk', current.status, 'Quoted'));
  update.$set.quotation = built.quotation;
  const request = await BulkOrder.findOneAndUpdate({ _id: current.id, status: current.status }, update, { new: true, runValidators: true }).select('+statusHistory');
  if (!request) return res.status(409).json({ message: 'This request was just updated by someone else. Refresh and try again.' });
  res.json({ request: withPresentedHistory(maskBulkOrder(request, req.user), req.user, true), message: 'Quotation saved.' });
});
