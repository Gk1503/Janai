import mongoose from 'mongoose';
import BulkOrder from '../models/BulkOrder.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import asyncHandler from '../utils/asyncHandler.js';
import { hasPermission } from '../config/permissions.js';
import { maskBulkOrder } from '../utils/privacy.js';
import { addVariationStock, deductVariationStock, effectiveMoq, isLegacyTarget, resolveVariation } from '../utils/productVariations.js';
import { buildStatusEntry, statusUpdateWithAudit, withPresentedHistory } from '../utils/statusAudit.js';
import {
  BULK_ORDER_TYPES, BULK_STATUSES, CUSTOMER_CANCELLABLE, QUOTABLE, buildQuotation, canTransition, isValidId,
  normalizeBulkPhone, presentBulkForCustomer, readAdminMessage, validateRequestLines,
} from '../utils/bulkOrderWorkflow.js';
import { actorName, readStock } from './stockController.js';
import { transactionHelper } from '../utils/withTransaction.js';

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

// Approving a bulk request deducts stock for every linked line, exactly once. Phase 5: the claim, every
// line's deduction, its StockMovement, and the Approved status transition itself are all ONE
// transaction — a duplicate/concurrent approval's claim attempt matches nothing and the transaction
// commits as a no-op, falling through to the ordinary conflict response below. An unlinked line, or one
// whose linked variation can no longer fulfil the requested quantity, aborts the entire transaction —
// nothing already written in this attempt (claim, earlier deductions, earlier movements, the status
// transition) survives, never a partial deduction across the request's lines.
async function approveBulkOrderTransactionally(current, actor) {
  const entry = buildStatusEntry(actor, 'bulk', current.status, 'Approved');
  return transactionHelper.run(async (session) => {
    const claimed = await BulkOrder.findOneAndUpdate(
      { _id: current.id, status: current.status, stockDeductedAt: null },
      { $set: { stockDeductedAt: new Date() } },
      { new: true, session },
    );
    if (!claimed) return null;
    const unresolved = claimed.products.filter((item) => !item.productId);
    if (unresolved.length) throw Object.assign(new Error(`Link every item to a product before approving. Missing: ${unresolved.map((item) => item.name).join(', ')}.`), { statusCode: 409 });
    for (const item of claimed.products) {
      // Validation/snapshot read only — never session-scoped, matching stockController.js::adjustStock's
      // own convention. The mutation below is what must be session-scoped for atomicity.
      const product = await Product.findById(item.productId);
      const variation = product && resolveVariation(product, item.variationId);
      if (!variation) throw Object.assign(new Error(`${item.name}'s linked product is no longer available. Cannot approve.`), { statusCode: 409 });
      const isLegacy = isLegacyTarget(product, item.variationId);
      const updatedProduct = await deductVariationStock(Product, { productId: item.productId, variationId: item.variationId, isLegacy, quantity: item.quantity, session });
      if (!updatedProduct) throw Object.assign(new Error(`Only limited stock is available for ${item.name}. Cannot approve.`), { statusCode: 409 });
      const newStockValue = readStock(updatedProduct, item.variationId, isLegacy);
      const previousStock = newStockValue + item.quantity;
      await StockMovement.create([{
        product: item.productId,
        productName: item.name,
        variationId: isLegacy ? null : String(item.variationId),
        variationLabel: isLegacy ? 'Default' : variation.label,
        unit: variation.unit,
        type: 'remove',
        previousStock,
        newStock: newStockValue,
        difference: newStockValue - previousStock,
        reason: 'Bulk order approved',
        actor: { id: actor._id, name: actorName(actor) },
        source: { type: 'bulk_order', id: claimed._id, event: 'bulk_approved', itemKey: String(item._id) },
      }], { session });
    }
    return BulkOrder.findOneAndUpdate(
      { _id: claimed.id, status: current.status },
      statusUpdateWithAudit('status', 'Approved', entry),
      { new: true, session, runValidators: true },
    ).select('+statusHistory');
  });
}

// Phase 5B/5D: all-or-nothing stock restoration for a rejected-after-approved request, in its own
// transaction, deliberately separate from the Rejected status write that triggers it (already durable
// by the time this runs — a restoration problem must never un-reject an already-recorded decision).
async function restoreBulkOrderStockTransactionally(request, actor) {
  let anyRestorationAttempted = false;
  try {
    await transactionHelper.run(async (session) => {
      const claimed = await BulkOrder.findOneAndUpdate(
        { _id: request.id, stockDeductedAt: { $ne: null }, stockRestoredAt: null },
        { $set: { stockRestoredAt: new Date() } },
        { session },
      );
      if (!claimed) return; // never deducted, or already restored — not a failure, nothing to do
      anyRestorationAttempted = true;
      for (const item of request.products) {
        if (!item.productId) continue; // unlinked line: nothing to restore
        const isLegacy = !item.variationId;
        const updatedProduct = await addVariationStock(Product, { productId: item.productId, variationId: item.variationId, isLegacy, quantity: item.quantity, session });
        if (!updatedProduct) throw new Error(`Could not restore stock for ${item.name}.`);
        const newStockValue = readStock(updatedProduct, item.variationId, isLegacy);
        const previousStock = newStockValue - item.quantity;
        // BulkOrder.products has no stored variationLabel (unlike Order.items) — addVariationStock's
        // match proves this variation entry exists on the just-updated product, so its real label/unit
        // is read straight off that document rather than guessed from the customer's free-text line.
        const matchedVariation = isLegacy ? null : updatedProduct.variations.find((entry) => String(entry._id) === String(item.variationId));
        await StockMovement.create([{
          product: item.productId,
          productName: item.name,
          variationId: isLegacy ? null : String(item.variationId),
          variationLabel: isLegacy ? 'Default' : (matchedVariation ? matchedVariation.label : item.name),
          unit: isLegacy ? updatedProduct.unit : (matchedVariation ? matchedVariation.unit : item.unit),
          type: 'add',
          previousStock,
          newStock: newStockValue,
          difference: newStockValue - previousStock,
          reason: 'Bulk order rejected',
          actor: { id: actor._id, name: actorName(actor) },
          source: { type: 'bulk_order', id: request._id, event: 'bulk_rejected', itemKey: String(item._id) },
        }], { session });
      }
    });
    return { failed: false };
  } catch (error) {
    console.error(`Stock restoration transaction aborted for bulk request ${request.id}: ${error.message}`);
    return { failed: anyRestorationAttempted };
  }
}

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

  const isApproving = target === 'Approved' && current.status !== 'Approved';

  let request;
  if (isApproving) {
    // Phase 5D: claim + every line's deduction/movement + the Approved status transition itself are one
    // transaction (approveBulkOrderTransactionally above) — this already includes the status write, so
    // the generic status-update path below is skipped entirely for this branch. Matches
    // stockController.js::adjustStock's own convention: a deliberately-tagged failure inside the
    // transaction is caught and mapped here explicitly, rather than left to the generic error handler.
    try {
      request = await approveBulkOrderTransactionally(current, req.user);
    } catch (error) {
      if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
      throw error;
    }
    if (!request) return res.status(409).json({ message: 'This request was just updated by someone else. Refresh and try again.' });
  } else {
    // Status, optional customer note and audit entry are one atomic document update, conditional on the status we read.
    const update = statusUpdateWithAudit('status', target, buildStatusEntry(req.user, 'bulk', current.status, target));
    if (message.value) update.$set.adminResponse = { message: message.value, at: new Date() };
    const query = BulkOrder.findOneAndUpdate({ _id: current.id, status: current.status }, update, { new: true, runValidators: true });
    request = await (withHistory ? query.select('+statusHistory') : query);
    if (!request) return res.status(409).json({ message: 'This request was just updated by someone else. Refresh and try again.' });
  }

  if (current.status === 'Approved' && target === 'Rejected') {
    const { failed } = await restoreBulkOrderStockTransactionally(request, req.user);
    if (failed) {
      // The rejection itself is persisted and audited, so say exactly that instead of reporting plain
      // success. The restoration transaction aborted entirely — either all of it or none of it applied.
      return res.status(500).json({
        code: 'STOCK_RESTORE_FAILED',
        message: 'The request was rejected and recorded, but stock could not be restored. Adjust inventory manually; do not change the status again.',
        request: present(request),
      });
    }
  }
  return res.json({ request: present(request) });
}

// Admin-only, before approval. Links each free-text line to a real product/variation — the customer's
// original name/quantity/unit is never replaced or reinterpreted automatically (this project never
// fuzzy-matches a name to a real record); an admin must explicitly confirm each match.
export const resolveBulkOrderItems = asyncHandler(async (req, res) => {
  const request = await BulkOrder.findById(req.params.id);
  if (!request) return res.status(404).json({ message: 'Bulk order request not found.' });
  if (!['Pending', 'Reviewing'].includes(request.status)) return res.status(409).json({ message: 'Product links can only be set before this request is approved.' });
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  for (const entry of items) {
    const index = Number(entry.index);
    if (!Number.isInteger(index) || index < 0 || index >= request.products.length) return res.status(400).json({ message: 'One or more item references are invalid.' });
    if (entry.productId === null || entry.productId === undefined) {
      request.products[index].productId = null;
      request.products[index].variationId = null;
      continue;
    }
    if (!mongoose.isValidObjectId(entry.productId)) return res.status(400).json({ message: 'Choose a valid product.' });
    const product = await Product.findById(entry.productId);
    if (!product) return res.status(404).json({ message: 'One of the selected products was not found.' });
    const variation = resolveVariation(product, entry.variationId || null);
    if (!variation) return res.status(400).json({ message: 'Choose a valid stock option for each linked product.' });
    // Phase 6: bulk MOQ is enforced here — the first moment a free-text line can be compared against a
    // real product at all (bulk submission never carries a product reference; see createBulkOrder).
    // Nothing is assigned to `request` before this check, and `request.save()` only runs once, after
    // the whole loop — so a failure here leaves this request completely untouched, never a partial
    // resolution. Once resolved successfully, this is never re-checked at approval (Phase 5, protected).
    const moq = effectiveMoq(product, 'bulk');
    const requestedQuantity = request.products[index].quantity;
    if (moq != null && requestedQuantity < moq) {
      return res.status(400).json({
        message: `${product.name} requires a minimum order quantity of ${moq} ${variation.unit}. Correct the quantity before resolving this line.`,
        product: product.name, requestedQuantity, requiredMoq: moq, unit: variation.unit, orderType: 'bulk', index,
      });
    }
    request.products[index].productId = product._id;
    request.products[index].variationId = entry.variationId || null;
  }
  await request.save();
  res.json({ request: maskBulkOrder(request, req.user) });
});

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
