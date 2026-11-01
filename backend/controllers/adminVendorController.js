import Vendor, { normalizeVendorName } from '../models/Vendor.js';
import Product from '../models/Product.js';
import VendorPriceHistory from '../models/VendorPriceHistory.js';
import VendorPurchase from '../models/VendorPurchase.js';
import asyncHandler from '../utils/asyncHandler.js';

const STATUSES = ['Active', 'Inactive'];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Vendor records themselves carry no purchase-cost data (that lives on Product.vendors and
// VendorPurchase) — route-level permission checks are enough here. A later stage that aggregates a
// vendor's purchase/price history onto this controller must apply the same canViewSupplierCosts gate
// that productController.js already uses for embedded vendor data.
function presentVendor(vendor) {
  return {
    _id: vendor._id,
    name: vendor.name,
    contactPerson: vendor.contactPerson,
    phone: vendor.phone,
    email: vendor.email,
    address: vendor.address,
    notes: vendor.notes,
    status: vendor.status,
    createdBy: vendor.createdBy,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
  };
}

// Distinct PRODUCT count per vendor, keyed only by the canonical vendors.vendorRef link — never by
// name. A product that (incorrectly, or not yet) only has a plain-text vendor name with no vendorRef
// contributes to no vendor's count, and a product with two embedded vendor rows pointing at the same
// vendorRef (e.g. added twice by mistake) is still only counted once.
async function countLinkedProductsByVendorId(vendorIds) {
  if (!vendorIds.length) return new Map();
  const counts = await Product.aggregate([
    { $match: { 'vendors.vendorRef': { $in: vendorIds } } },
    { $unwind: '$vendors' },
    { $match: { 'vendors.vendorRef': { $in: vendorIds } } },
    { $group: { _id: { vendorRef: '$vendors.vendorRef', productId: '$_id' } } },
    { $group: { _id: '$_id.vendorRef', count: { $sum: 1 } } },
  ]);
  return new Map(counts.map((entry) => [String(entry._id), entry.count]));
}

export const listVendors = asyncHandler(async (req, res) => {
  const { q, status } = req.query;
  const filter = {};
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ message: 'Choose a valid vendor status.' });
    filter.status = status;
  }
  if (q && String(q).trim()) {
    const term = String(q).trim();
    const pattern = escapeRegex(term);
    // Search by name, contact person or phone — name matches case-insensitively via the same
    // normalizedName used for duplicate detection; contact/phone are matched case-insensitively too.
    filter.$or = [
      { normalizedName: { $regex: escapeRegex(normalizeVendorName(term)) } },
      { contactPerson: { $regex: pattern, $options: 'i' } },
      { phone: { $regex: pattern, $options: 'i' } },
    ];
  }
  const vendors = await Vendor.find(filter).sort({ name: 1 });
  const countByVendorId = await countLinkedProductsByVendorId(vendors.map((vendor) => vendor._id));
  res.json({
    vendors: vendors.map((vendor) => ({ ...presentVendor(vendor), productCount: countByVendorId.get(String(vendor._id)) || 0 })),
  });
});

export const getVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: 'Vendor not found.' });
  res.json({ vendor: presentVendor(vendor) });
});

// Resolves every embedded Product.vendors row that links to this central vendor via vendorRef — the
// one and only link the vendor profile is allowed to use (never a name match, and never inferred for
// a legacy row with no vendorRef — the backfill migration has not run). One product can contribute
// more than one embedded row (e.g. added twice, or re-added with different terms); every one of them
// is kept, never collapsed. A single query regardless of how many products/rows match, so none of
// the profile endpoints below become N+1 as the catalog grows.
async function resolveVendorLinks(vendorId) {
  const products = await Product.find({ 'vendors.vendorRef': vendorId }, { name: 1, category: 1, unit: 1, vendors: 1 }).sort({ name: 1 });
  const embeddedVendorIds = [];
  const productNameById = new Map();
  for (const product of products) {
    productNameById.set(String(product._id), product.name);
    for (const embedded of product.vendors) {
      if (embedded.vendorRef && String(embedded.vendorRef) === String(vendorId)) embeddedVendorIds.push(embedded._id);
    }
  }
  return { products, embeddedVendorIds, productNameById };
}

// Products supplied, resolved strictly by vendorRef. `productCount` and `categories` reflect every
// linked product regardless of any client-side category filter, so summary cards stay stable while
// the owner filters the table underneath them.
export const getVendorProducts = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: 'Vendor not found.' });

  const { products } = await resolveVendorLinks(vendor._id);
  const rows = products.flatMap((product) => product.vendors
    .filter((embedded) => embedded.vendorRef && String(embedded.vendorRef) === String(vendor._id))
    .map((embedded) => ({
      productId: product._id,
      productName: product.name,
      category: product.category,
      unit: product.unit, // Stage 6: lets Record Purchase default to the product's own unit
      vendorId: embedded._id,
      purchasePrice: embedded.purchasePrice,
      moq: embedded.moq,
      lastPurchasePrice: embedded.lastPurchasePrice,
      lastPurchaseDate: embedded.lastPurchaseDate,
      preferred: embedded.preferred,
    })));

  res.json({
    products: rows,
    productCount: products.length, // distinct products — Product.find already dedupes at the document level
    categories: Array.from(new Set(products.map((product) => product.category))).sort(),
  });
});

// Purchase history aggregated across every product linked to this vendor. Ordered and Received are
// kept entirely separate — never blended into one misleading total — and quantity is grouped by unit
// within each bucket (the same caution vendorController.js's own per-product/vendor summary already
// applies: kg and L, say, are never added together). "Ordered" amount uses the recorded totalAmount
// (quantity * rate at order time, the only figure that exists for a not-yet-received purchase);
// "Received" amount uses receivedQuantity * rate — exactly the convention vendorController.js's
// listPurchases already uses for its own totalCost/avgCost. Nothing here is estimated: every number
// comes directly from stored VendorPurchase fields.
//
// Full-receipt-only limitation: receivePurchase (vendorController.js) currently supports no partial
// receiving — receivedQuantity is always either 0 (status 'Ordered') or the complete ordered quantity
// (status 'Received', set in the same atomic update that flips status). So today, "Received" and
// "Ordered" are mutually exclusive and exhaustive per purchase row, and this summary can safely bucket
// by status alone. If partial receiving is ever introduced, a single row could need to contribute to
// BOTH a received amount/quantity and a separate outstanding amount/quantity — this summary would need
// to be redesigned around that split rather than a single status-based branch.
export const getVendorPurchases = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: 'Vendor not found.' });

  const { embeddedVendorIds, productNameById } = await resolveVendorLinks(vendor._id);
  const emptyBucket = () => ({ count: 0, amount: 0, quantityByUnit: [] });
  if (!embeddedVendorIds.length) return res.json({ purchases: [], summary: { ordered: emptyBucket(), received: emptyBucket() } });

  const { productId, from, to } = req.query;
  const filter = { vendor: { $in: embeddedVendorIds } };
  if (productId) filter.product = productId;
  if (from || to) {
    filter.purchaseDate = {};
    if (from) filter.purchaseDate.$gte = new Date(from);
    if (to) filter.purchaseDate.$lte = new Date(to);
  }

  const purchases = await VendorPurchase.find(filter).sort({ purchaseDate: -1, createdAt: -1 });

  const byUnit = { ordered: new Map(), received: new Map() };
  const summary = { ordered: { count: 0, amount: 0 }, received: { count: 0, amount: 0 } };
  for (const purchase of purchases) {
    const isReceived = purchase.status === 'Received';
    // Same defensive guard as vendorController.js's own listPurchases summary: a row marked Received
    // but with a falsy receivedQuantity (0, missing, or unset) is not reachable through the normal
    // create/receive flow, but is excluded from the summary entirely rather than silently contributing
    // a $0 "received" entry — it is not counted as Ordered either, since its own status says Received.
    if (isReceived && !purchase.receivedQuantity) continue;
    if (isReceived) {
      summary.received.count += 1;
      summary.received.amount += purchase.receivedQuantity * purchase.rate;
      byUnit.received.set(purchase.unit, (byUnit.received.get(purchase.unit) || 0) + purchase.receivedQuantity);
    } else {
      summary.ordered.count += 1;
      summary.ordered.amount += purchase.totalAmount;
      byUnit.ordered.set(purchase.unit, (byUnit.ordered.get(purchase.unit) || 0) + purchase.quantity);
    }
  }
  summary.ordered.quantityByUnit = Array.from(byUnit.ordered, ([unit, quantity]) => ({ unit, quantity }));
  summary.received.quantityByUnit = Array.from(byUnit.received, ([unit, quantity]) => ({ unit, quantity }));

  res.json({
    purchases: purchases.map((purchase) => ({
      _id: purchase._id,
      productId: purchase.product,
      productName: productNameById.get(String(purchase.product)) || '',
      vendorId: purchase.vendor,
      purchaseDate: purchase.purchaseDate,
      quantity: purchase.quantity,
      unit: purchase.unit,
      rate: purchase.rate,
      totalAmount: purchase.totalAmount,
      invoiceNumber: purchase.invoiceNumber,
      notes: purchase.notes, // Stage 7: needed by the Vendor Detail Page's purchase detail view
      status: purchase.status,
      receivedQuantity: purchase.receivedQuantity,
      receivedAt: purchase.receivedAt,
    })),
    summary,
  });
});

// Price history aggregated across every product linked to this vendor, chronological (newest first) —
// mirrors vendorController.js's own listPriceHistory, just resolved across every embedded vendor row
// instead of one (productId, vendorId) pair.
export const getVendorPriceHistory = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) return res.status(404).json({ message: 'Vendor not found.' });

  const { embeddedVendorIds, productNameById } = await resolveVendorLinks(vendor._id);
  if (!embeddedVendorIds.length) return res.json({ history: [] });

  const history = await VendorPriceHistory.find({ vendor: { $in: embeddedVendorIds } }).sort({ createdAt: -1 });
  res.json({
    history: history.map((entry) => ({
      _id: entry._id,
      productId: entry.product,
      productName: productNameById.get(String(entry.product)) || '',
      previousPrice: entry.previousPrice,
      newPrice: entry.newPrice,
      reason: entry.reason,
      createdAt: entry.createdAt,
    })),
  });
});

export const createVendor = asyncHandler(async (req, res) => {
  const { name, contactPerson = '', phone = '', email = '', address = '', notes = '', status = 'Active' } = req.body;
  if (!String(name || '').trim()) return res.status(400).json({ message: 'Vendor name is required.' });
  if (!STATUSES.includes(status)) return res.status(400).json({ message: 'Choose a valid vendor status.' });

  // Case-insensitive duplicate DETECTION, never prevention: identical names do not always mean the
  // same real-world vendor, so an existing match is only ever surfaced for the owner to review here —
  // creation is never blocked on it.
  const possibleDuplicates = await Vendor.find({ normalizedName: normalizeVendorName(name) }).sort({ createdAt: 1 });

  const vendor = await Vendor.create({
    name: String(name).trim(),
    contactPerson: String(contactPerson).trim(),
    phone: String(phone).trim(),
    email: String(email).trim(),
    address: String(address).trim(),
    notes: String(notes).trim(),
    status,
    createdBy: req.user?._id,
  });

  res.status(201).json({ vendor: presentVendor(vendor), possibleDuplicates: possibleDuplicates.map(presentVendor) });
});

export const updateVendor = asyncHandler(async (req, res) => {
  const { name, contactPerson, phone, email, address, notes, status } = req.body;
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ message: 'Vendor name is required.' });
  if (status !== undefined && !STATUSES.includes(status)) return res.status(400).json({ message: 'Choose a valid vendor status.' });

  const update = {};
  // findByIdAndUpdate runs schema-level validators (with runValidators below) but not the document
  // pre('validate') hook that keeps normalizedName in sync on Vendor.create/save — so it's set
  // explicitly here whenever name changes.
  if (name !== undefined) { update.name = String(name).trim(); update.normalizedName = normalizeVendorName(name); }
  if (contactPerson !== undefined) update.contactPerson = String(contactPerson).trim();
  if (phone !== undefined) update.phone = String(phone).trim();
  if (email !== undefined) update.email = String(email).trim();
  if (address !== undefined) update.address = String(address).trim();
  if (notes !== undefined) update.notes = String(notes).trim();
  if (status !== undefined) update.status = status;

  const vendor = await Vendor.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!vendor) return res.status(404).json({ message: 'Vendor not found.' });
  res.json({ vendor: presentVendor(vendor) });
});

// Soft-deactivate only — a vendor can be linked from embedded Product.vendors rows, VendorPurchase and
// VendorPriceHistory, so it is never deleted. Idempotent: deactivating an already-inactive vendor is a no-op.
export const deactivateVendor = asyncHandler(async (req, res) => {
  const vendor = await Vendor.findByIdAndUpdate(req.params.id, { status: 'Inactive' }, { new: true });
  if (!vendor) return res.status(404).json({ message: 'Vendor not found.' });
  res.json({ vendor: presentVendor(vendor) });
});
