import { normalizeVendorName } from '../models/Vendor.js';

// Groups every embedded vendor row across all products by case-insensitive, whitespace-normalized
// name. `products` is a plain array of {_id, name, vendors: [{_id, name, purchasePrice, vendorRef}]}
// — either real Mongoose documents/lean objects or plain test fixtures; only these fields are read.
// This never looks at VendorPurchase or VendorPriceHistory, and never writes anything.
export function groupEmbeddedVendorsByName(products) {
  const groups = new Map();
  for (const product of products || []) {
    for (const vendor of product?.vendors || []) {
      const normalizedName = normalizeVendorName(vendor?.name);
      if (!normalizedName) continue; // an unnamed vendor row has nothing to match on
      if (!groups.has(normalizedName)) groups.set(normalizedName, { normalizedName, occurrences: [] });
      groups.get(normalizedName).occurrences.push({
        productId: String(product._id),
        productName: product.name,
        vendorId: String(vendor._id),
        name: vendor.name,
        purchasePrice: vendor.purchasePrice,
        alreadyLinked: Boolean(vendor.vendorRef),
      });
    }
  }
  return Array.from(groups.values());
}

// Builds the dry-run report: one entry per normalized-name group. A group is flagged
// 'review-recommended' only when its occurrences don't even agree on the exact (non-normalized)
// spelling — a hint for whoever reviews it, never a decision; a single-spelling group across many
// products is still only 'likely-same', not an automatic merge. Every embedded vendor's existing
// `_id`, and every VendorPurchase/VendorPriceHistory row, is left completely alone — this is
// read-only reporting with no database writes anywhere in this function.
export function buildDryRunReport(products) {
  const groups = groupEmbeddedVendorsByName(products);
  const totalEmbeddedVendors = groups.reduce((sum, group) => sum + group.occurrences.length, 0);

  const reportGroups = groups
    .map((group) => {
      const distinctNames = Array.from(new Set(group.occurrences.map((occurrence) => occurrence.name)));
      const distinctProductIds = new Set(group.occurrences.map((occurrence) => occurrence.productId));
      return {
        normalizedName: group.normalizedName,
        occurrenceCount: group.occurrences.length,
        productCount: distinctProductIds.size,
        distinctNames,
        confidence: distinctNames.length > 1 ? 'review-recommended' : 'likely-same',
        alreadyLinkedCount: group.occurrences.filter((occurrence) => occurrence.alreadyLinked).length,
        occurrences: group.occurrences,
      };
    })
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.normalizedName.localeCompare(b.normalizedName));

  return {
    generatedAt: new Date().toISOString(),
    totalProducts: (products || []).length,
    totalEmbeddedVendors,
    totalGroups: reportGroups.length,
    multiProductGroups: reportGroups.filter((group) => group.productCount > 1).length,
    ambiguousGroups: reportGroups.filter((group) => group.confidence === 'review-recommended').length,
    groups: reportGroups,
  };
}

// Applies ONLY mappings a human explicitly approved after reading the dry-run report above — this
// function never derives a mapping from a name match by itself. Models are passed in (not imported
// directly) so this stays unit-testable against stubbed statics, the same convention already used for
// getPricingSettings/updatePricingSettings in settingsController.js.
//
// Each mapping: { vendorId?, vendor?: {name, contactPerson, phone, email, address, notes, status},
//                 entries: [{ productId, vendorId }, ...] }
//   - vendorId: reuse an existing central Vendor by id.
//   - vendor:   create a new central Vendor with these fields (used when neither vendorId is given).
//     Exactly one of the two should be supplied; vendorId takes precedence if both are present.
//   - entries:  the EMBEDDED (productId, vendorId) pairs to link — every one keeps its own existing
//     `_id` forever; only its `vendorRef` is ever set. VendorPurchase/VendorPriceHistory rows, which
//     already key off that same embedded vendorId, are never read or written here, so their history
//     is preserved by construction, not by any special-casing in this function.
export async function applyApprovedMappings(mappings, { Vendor, Product }) {
  if (!Array.isArray(mappings)) throw new Error('mappings must be an array of approved vendor mappings.');
  const result = { createdVendors: [], linked: [], errors: [] };

  for (const [index, mapping] of mappings.entries()) {
    const label = mapping?.vendor?.name || mapping?.vendorId || `mapping[${index}]`;
    if (!mapping?.vendorId && !mapping?.vendor?.name) {
      result.errors.push({ mapping: label, message: 'Each mapping needs either an existing vendorId or a vendor.name to create.' });
      continue;
    }
    if (!Array.isArray(mapping.entries) || !mapping.entries.length) {
      result.errors.push({ mapping: label, message: 'Each mapping needs at least one {productId, vendorId} entry to link.' });
      continue;
    }

    let vendorId = mapping.vendorId;
    if (!vendorId) {
      const created = await Vendor.create({
        name: mapping.vendor.name,
        contactPerson: mapping.vendor.contactPerson || '',
        phone: mapping.vendor.phone || '',
        email: mapping.vendor.email || '',
        address: mapping.vendor.address || '',
        notes: mapping.vendor.notes || '',
        status: mapping.vendor.status || 'Active',
      });
      vendorId = created._id;
      result.createdVendors.push({ vendorId: String(vendorId), name: created.name });
    }

    for (const entry of mapping.entries) {
      if (!entry?.productId || !entry?.vendorId) {
        result.errors.push({ mapping: label, message: `Entry missing productId/vendorId: ${JSON.stringify(entry)}` });
        continue;
      }
      // Matches by the embedded subdocument's own existing _id — it is never regenerated or replaced,
      // only its vendorRef is set.
      const updateResult = await Product.updateOne(
        { _id: entry.productId, 'vendors._id': entry.vendorId },
        { $set: { 'vendors.$.vendorRef': vendorId } },
      );
      if (!updateResult || updateResult.matchedCount === 0) {
        result.errors.push({ mapping: label, message: `No embedded vendor ${entry.vendorId} found on product ${entry.productId} — nothing changed.` });
        continue;
      }
      result.linked.push({ vendorId: String(vendorId), productId: String(entry.productId), embeddedVendorId: String(entry.vendorId) });
    }
  }

  return result;
}
