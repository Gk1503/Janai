import Product from '../models/Product.js';
import VendorPriceHistory from '../models/VendorPriceHistory.js';
import VendorPurchase from '../models/VendorPurchase.js';
import asyncHandler from '../utils/asyncHandler.js';

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

  const { purchaseDate, quantity, unit, rate, invoiceNumber = '', notes = '', status = 'Ordered' } = req.body;
  const qty = Number(quantity);
  const rateNum = Number(rate);
  const date = new Date(purchaseDate);
  if (!purchaseDate || Number.isNaN(date.getTime())) return res.status(400).json({ message: 'Choose a valid purchase date.' });
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ message: 'Enter a valid quantity greater than 0.' });
  if (!String(unit || '').trim()) return res.status(400).json({ message: 'Choose a unit of measurement.' });
  if (!Number.isFinite(rateNum) || rateNum < 0) return res.status(400).json({ message: 'Enter a valid purchase rate.' });
  if (!['Ordered', 'Received'].includes(status)) return res.status(400).json({ message: 'Choose a valid purchase status.' });

  const isReceived = status === 'Received';
  const purchase = await VendorPurchase.create({
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
    createdBy: req.user?._id,
  });

  // A purchase logged straight into "Received" status increases stock immediately,
  // exactly once, since this create only ever runs once for this new document.
  if (isReceived) await Product.updateOne({ _id: product._id }, { $inc: { stock: qty } });

  res.status(201).json({ purchase });
});

export const receivePurchase = asyncHandler(async (req, res) => {
  const { productId, vendorId, purchaseId } = req.params;

  // Guarded, atomic status flip: only a purchase still "Ordered" can match, so a
  // duplicate/retried request finds nothing to update and never double-counts stock.
  const before = await VendorPurchase.findOneAndUpdate(
    { _id: purchaseId, product: productId, vendor: vendorId, status: 'Ordered' },
    { $set: { status: 'Received', receivedAt: new Date() } },
    { new: false }
  );
  if (!before) return res.status(409).json({ message: 'This purchase was not found or has already been received.' });

  const receivedQuantity = before.quantity; // full receipt only — no partial-receipt flow yet
  await VendorPurchase.updateOne({ _id: before._id }, { $set: { receivedQuantity } });
  await Product.updateOne({ _id: before.product }, { $inc: { stock: receivedQuantity } });

  const purchase = await VendorPurchase.findById(before._id);
  res.json({ purchase });
});
