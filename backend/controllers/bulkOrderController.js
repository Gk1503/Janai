import mongoose from 'mongoose';
import BulkOrder from '../models/BulkOrder.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import asyncHandler from '../utils/asyncHandler.js';
import { hasPermission } from '../config/permissions.js';
import { maskBulkOrder } from '../utils/privacy.js';
import { addVariationStock, deductVariationStock, effectiveMoq, isLegacyTarget, resolveVariation } from '../utils/productVariations.js';
import { validateOrderQuantity } from '../utils/quantity.js';
import { buildStatusEntry, statusUpdateWithAudit, withPresentedHistory } from '../utils/statusAudit.js';
import { actorName, readStock } from './stockController.js';
import { transactionHelper } from '../utils/withTransaction.js';

const orderTypes = ['Business', 'Office', 'Event', 'Party', 'Large Family', 'Other'];
const statuses = ['Pending', 'Reviewing', 'Approved', 'Rejected', 'Completed'];

export const createBulkOrder = asyncHandler(async (req, res) => {
  const { name, phone, email, organization = '', orderType = 'Business', products, requiredDate, deliveryAddress, additionalRequirements = '' } = req.body;
  if (![name, phone, email, deliveryAddress].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Complete your contact and delivery details.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!orderTypes.includes(orderType)) return res.status(400).json({ message: 'Choose a valid bulk order type.' });
  // Decimal quantities (Phase 6) are accepted above the existing minimum of 1 — see utils/quantity.js.
  // These lines are still free text with no real Product reference yet (see resolveBulkOrderItems
  // below for where bulk MOQ is actually enforced), so this remains a pure format check.
  if (!Array.isArray(products) || !products.length || products.some((item) => !String(item.name || '').trim() || !validateOrderQuantity(item.quantity).value)) return res.status(400).json({ message: 'Add products with valid quantities.' });
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
  if (!statuses.includes(req.body.status)) return res.status(400).json({ message: 'Choose a valid request status.' });
  const withHistory = includeHistory && hasPermission(req.user, 'bulk:view');
  const currentQuery = BulkOrder.findById(req.params.id);
  const current = await (withHistory ? currentQuery.select('+statusHistory') : currentQuery);
  if (!current) return res.status(404).json({ message: 'Bulk order request not found.' });
  const present = (doc) => withPresentedHistory(maskBulkOrder(doc, req.user), req.user, withHistory);
  // Same status: nothing changes and nothing is audited (the request is still acknowledged as before).
  if (current.status === req.body.status) return res.json({ request: present(current) });

  const isApproving = req.body.status === 'Approved' && current.status !== 'Approved';

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
    // Status and audit entry are one atomic document update, conditional on the status we read.
    const update = statusUpdateWithAudit('status', req.body.status, buildStatusEntry(req.user, 'bulk', current.status, req.body.status));
    const query = BulkOrder.findOneAndUpdate({ _id: current.id, status: current.status }, update, { new: true, runValidators: true });
    request = await (withHistory ? query.select('+statusHistory') : query);
    if (!request) return res.status(409).json({ message: 'This request was just updated by someone else. Refresh and try again.' });
  }

  if (current.status === 'Approved' && req.body.status === 'Rejected') {
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
