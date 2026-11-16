import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import Vendor from '../models/Vendor.js';
import VendorPriceHistory from '../models/VendorPriceHistory.js';
import VendorPurchase from '../models/VendorPurchase.js';
import asyncHandler from '../utils/asyncHandler.js';
import { actorName, readStock } from './stockController.js';
import { addVariationStock, isLegacyTarget, resolveVariation } from '../utils/productVariations.js';
import { transactionHelper } from '../utils/withTransaction.js';

async function findProductVendor(productId, vendorId) {
  const product = await Product.findById(productId);
  if (!product) return { error: { status: 404, message: 'Product not found.' } };
  const vendor = product.vendors.find((entry) => String(entry._id) === String(vendorId));
  if (!vendor) return { error: { status: 404, message: 'Vendor not found on this product.' } };
  return { product, vendor };
}

export const listPriceHistory = asyncHandler(async (req, res) => {
  const { productId, vendorId } = req.params;
  const history = await VendorPriceHistory.find({ product: productId, vendor: vendorId }).sort({ createdAt: -1 });
  res.json({ history });
});

export const listPurchases = asyncHandler(async (req, res) => {
  const { productId, vendorId } = req.params;
  const purchases = await VendorPurchase.find({ product: productId, vendor: vendorId }).sort({ purchaseDate: -1, createdAt: -1 });

  // Summarise received purchases grouped by unit so quantities/costs of incompatible
  // units (e.g. kg vs L) are never combined into a single average.
  const byUnit = new Map();
  for (const purchase of purchases) {
    if (purchase.status !== 'Received' || !purchase.receivedQuantity) continue;
    const bucket = byUnit.get(purchase.unit) || { unit: purchase.unit, receivedQuantity: 0, totalCost: 0 };
    bucket.receivedQuantity += purchase.receivedQuantity;
    bucket.totalCost += purchase.receivedQuantity * purchase.rate;
    byUnit.set(purchase.unit, bucket);
  }
  const summary = Array.from(byUnit.values()).map((bucket) => ({ ...bucket, avgCost: bucket.receivedQuantity > 0 ? bucket.totalCost / bucket.receivedQuantity : 0 }));

  res.json({ purchases, summary });
});

export const createPurchase = asyncHandler(async (req, res) => {
  const { productId, vendorId } = req.params;
  const { product, vendor, error } = await findProductVendor(productId, vendorId);
  if (error) return res.status(error.status).json({ message: error.message });

  // Stage 6.1: the Vendor Detail Page's "Record Purchase" already disables itself for an Inactive
  // central vendor, but that's a frontend-only guard and can be bypassed by calling this endpoint
  // directly — so it's enforced here too. `vendor` above is the embedded subdocument (found by its
  // own _id, never confused with a central Vendor's _id); `vendor.vendorRef`, if present, is the
  // separate central Vendor it's linked to (Stage 1+). A legacy row with no vendorRef, or one whose
  // vendorRef no longer resolves to a real document, keeps the exact pre-existing behavior — this is
  // an added restriction only for a row genuinely linked to an Inactive central vendor.
  if (vendor.vendorRef) {
    const centralVendor = await Vendor.findById(vendor.vendorRef);
    if (centralVendor && centralVendor.status === 'Inactive') {
      return res.status(400).json({ message: 'This vendor is inactive. Reactivate it before recording a new purchase.' });
    }
  }

  const { purchaseDate, quantity, unit, rate, invoiceNumber = '', notes = '', status = 'Ordered', variationId = null } = req.body;
  const qty = Number(quantity);
  const rateNum = Number(rate);
  const date = new Date(purchaseDate);
  if (!purchaseDate || Number.isNaN(date.getTime())) return res.status(400).json({ message: 'Choose a valid purchase date.' });
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: 'Enter a valid quantity greater than 0.' });
  if (!String(unit || '').trim()) return res.status(400).json({ message: 'Choose a unit of measurement.' });
  if (!Number.isFinite(rateNum) || rateNum < 0) return res.status(400).json({ message: 'Enter a valid purchase rate.' });
  if (!['Ordered', 'Received'].includes(status)) return res.status(400).json({ message: 'Choose a valid purchase status.' });
  // Resolved against the central Product (never a name/text match) — a product with no real variations
  // resolves to its implicit default, exactly as everywhere else (utils/productVariations.js).
  const variation = resolveVariation(product, variationId);
  if (!variation) return res.status(400).json({ message: 'The selected stock option is no longer available.' });

  const isReceived = status === 'Received';
  const purchaseFields = {
    product: product._id,
    vendor: vendor._id,
    vendorName: vendor.name,
    purchaseDate: date,
    quantity: qty,
    unit: String(unit).trim(),
    rate: rateNum,
    totalAmount: qty * rateNum,
    invoiceNumber: String(invoiceNumber).trim(),
    notes: String(notes).trim(),
    status: isReceived ? 'Received' : 'Ordered',
    receivedQuantity: isReceived ? qty : 0,
    receivedAt: isReceived ? new Date() : null,
    variationId,
    createdBy: req.user?._id,
  };

  // A purchase logged straight into "Received" status increases stock immediately, exactly once, since
  // this create only ever runs once for this new document. When it does, the purchase creation, the
  // stock addition and its StockMovement are one transaction (Phase 5) — if the stock addition fails
  // (e.g. the variation vanished in the instant between the check above and this write), the purchase
  // is never created either, rather than silently existing as "Received" with no stock actually added.
  if (!isReceived) {
    const purchase = await VendorPurchase.create(purchaseFields);
    return res.status(201).json({ purchase });
  }

  const isLegacy = isLegacyTarget(product, variationId);
  // Matches stockController.js::adjustStock's own convention: a deliberately-tagged failure inside the
  // transaction is caught and mapped here explicitly, rather than left to the generic error handler.
  let purchase;
  try {
    purchase = await transactionHelper.run(async (session) => {
      const [created] = await VendorPurchase.create([purchaseFields], { session });
      const updatedProduct = await addVariationStock(Product, { productId: product._id, variationId, isLegacy, quantity: qty, session });
      if (!updatedProduct) throw Object.assign(new Error('Could not add stock for this purchase. The selected product or variation is no longer available.'), { statusCode: 409 });
      const newStockValue = readStock(updatedProduct, variationId, isLegacy);
      const previousStock = newStockValue - qty;
      await StockMovement.create([{
        product: product._id,
        productName: product.name,
        variationId: isLegacy ? null : String(variationId),
        variationLabel: isLegacy ? 'Default' : variation.label,
        unit: variation.unit,
        type: 'add',
        previousStock,
        newStock: newStockValue,
        difference: newStockValue - previousStock,
        reason: 'Vendor purchase received',
        actor: { id: req.user._id, name: actorName(req.user) },
        source: { type: 'vendor_purchase', id: created._id, event: 'vendor_received', itemKey: null },
      }], { session });
      return created;
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    throw error;
  }

  res.status(201).json({ purchase });
});

export const receivePurchase = asyncHandler(async (req, res) => {
  const { productId, vendorId, purchaseId } = req.params;

  // One transaction (Phase 5): the atomic status guard, the receivedQuantity write, the stock addition
  // and its StockMovement all commit together, or none of them do. The atomic status-flip filter below
  // is unchanged — it remains the sole guard against a duplicate/retried request double-counting stock;
  // the transaction adds that the rest of this operation can no longer partially apply around it.
  // Matches stockController.js::adjustStock's own convention: a deliberately-tagged failure inside the
  // transaction is caught and mapped below explicitly, rather than left to the generic error handler.
  let result;
  try {
    result = await transactionHelper.run(async (session) => {
      const before = await VendorPurchase.findOneAndUpdate(
        { _id: purchaseId, product: productId, vendor: vendorId, status: 'Ordered' },
        { $set: { status: 'Received', receivedAt: new Date() } },
        { new: false, session },
      );
      if (!before) return { conflict: true };

      const receivedQuantity = before.quantity; // full receipt only — no partial-receipt flow yet
      await VendorPurchase.updateOne({ _id: before._id }, { $set: { receivedQuantity } }, { session });

      // Validation/snapshot read only — never session-scoped, matching stockController.js::adjustStock's
      // own convention. The mutation below is what must be session-scoped for atomicity.
      const product = await Product.findById(before.product);
      if (!product) throw Object.assign(new Error('Could not add stock: the product for this purchase no longer exists.'), { statusCode: 409 });
      const isLegacy = !before.variationId;
      // Resolved using the purchase's own stored variationId (what was actually ordered against), never
      // the product's current state — a variation added/removed since this purchase was created never
      // changes which stock this receipt adds to.
      const variation = resolveVariation(product, before.variationId);
      if (!variation) throw Object.assign(new Error('Could not add stock: the selected variation is no longer available.'), { statusCode: 409 });

      const updatedProduct = await addVariationStock(Product, { productId: before.product, variationId: before.variationId, isLegacy, quantity: receivedQuantity, session });
      if (!updatedProduct) throw Object.assign(new Error('Could not add stock for this purchase. The product or variation may no longer exist.'), { statusCode: 409 });
      const newStockValue = readStock(updatedProduct, before.variationId, isLegacy);
      const previousStock = newStockValue - receivedQuantity;
      await StockMovement.create([{
        product: product._id,
        productName: product.name,
        variationId: isLegacy ? null : String(before.variationId),
        variationLabel: isLegacy ? 'Default' : variation.label,
        unit: variation.unit,
        type: 'add',
        previousStock,
        newStock: newStockValue,
        difference: newStockValue - previousStock,
        reason: 'Vendor purchase received',
        actor: { id: req.user._id, name: actorName(req.user) },
        source: { type: 'vendor_purchase', id: before._id, event: 'vendor_received', itemKey: null },
      }], { session });

      return { conflict: false, purchaseId: before._id };
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    throw error;
  }

  if (result.conflict) return res.status(409).json({ message: 'This purchase was not found or has already been received.' });
  const purchase = await VendorPurchase.findById(result.purchaseId);
  res.json({ purchase });
});
