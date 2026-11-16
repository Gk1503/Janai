// Shared, variation-aware stock helpers (Inventory foundation, Phase 2). Every stock mutation in this
// codebase — order placement/cancellation, pre-order confirmation, bulk order approval, vendor
// purchase create/receive — goes through deductVariationStock/restoreVariationStock below, so there is
// exactly one place that knows how to target either a real Product.variations[] entry or the legacy
// top-level stock/unit fields.
//
// A product with zero entries in `variations` is never migrated or rewritten: it is treated, read-only,
// as having one implicit "Default" variation backed by its own top-level `stock`/`unit`. This sentinel
// id identifies that implicit variation wherever a variationId is stored (Order.items, VendorPurchase,
// BulkOrder.products) so old records with no variationId at all, and new records that explicitly opt
// into "the whole product, no real variations", both resolve the same way.
export const LEGACY_VARIATION_ID = 'legacy';

// The variation set actually in effect for this product right now — real ones if any exist, otherwise
// one synthesized, NEVER PERSISTED pseudo-variation mirroring the legacy fields, including the
// persistent top-level minStockThreshold (Stock Management, Phase 3) — `?? 0` only covers a product
// loaded through a projection that omitted the field; Product.js's own schema default already makes it
// 0 on every real document, never undefined.
export function getEffectiveVariations(product) {
  if (product.variations && product.variations.length) return product.variations;
  return [{
    _id: LEGACY_VARIATION_ID,
    label: 'Default',
    packDescription: '',
    unit: product.unit,
    stock: product.stock,
    minStockThreshold: product.minStockThreshold ?? 0,
    isActive: true,
    isLegacy: true,
  }];
}

// One stock-status rule, shared by the Inventory Dashboard and Stock Management so they can never
// disagree: out-of-stock is checked first regardless of threshold; a threshold of 0 (the default for
// every variation, real or implicit, until an admin sets one) means "never configured", not "healthy at
// zero" — it is tracked as its own state rather than silently folded into either neighbour.
export function classifyVariationStock(variation) {
  if (variation.stock <= 0) return 'outOfStock';
  if (!variation.minStockThreshold || variation.minStockThreshold <= 0) return 'unconfigured';
  if (variation.stock <= variation.minStockThreshold) return 'lowStock';
  return 'healthy';
}

// Resolves one variation by id (a missing/null/sentinel id means "the implicit default"). Returns null
// if the id doesn't match anything currently active — callers must treat that as "cannot fulfill",
// never fall back to guessing a different variation.
export function resolveVariation(product, variationId) {
  const id = variationId || LEGACY_VARIATION_ID;
  return getEffectiveVariations(product).find((variation) => String(variation._id) === String(id) && variation.isActive !== false) || null;
}

// Whether a given (product, variationId) pair targets the legacy top-level fields rather than a real
// variations[] entry — decided once by the caller from an already-loaded product, then threaded through
// to the atomic calls below so they never need their own extra read.
export function isLegacyTarget(product, variationId) {
  return !(product.variations && product.variations.length) || !variationId || variationId === LEGACY_VARIATION_ID;
}

// Customer-facing Minimum Order Quantity (Phase 6), centralized so normal/pre-order/bulk validation can
// never disagree on the fallback chain. `orderType` is 'normal' | 'preorder' | 'bulk'. Returns the
// effective MOQ as a number, or null when no minimum is enforced at all — callers must check `!= null`
// (never a truthiness check) since an explicitly configured 0 is a real, deliberate "no minimum" value,
// distinct from "never configured". Bulk/pre-order fall back to normalMoq only when their own override
// is null/undefined (nullish, not falsy) — normalMoq itself absent means no minimum for any order type.
export function effectiveMoq(product, orderType) {
  if (orderType === 'bulk') return product.bulkMoq ?? product.normalMoq ?? null;
  if (orderType === 'preorder') return product.preOrderMoq ?? product.normalMoq ?? null;
  return product.normalMoq ?? null;
}

// Atomically decrements stock for one variation (or the implicit default) by `quantity`, but only if
// that exact target currently has enough — the guard is embedded directly in the filter, so this is
// race-safe against any concurrent order/purchase/adjustment regardless of what was read earlier.
// Returns the updated Product document, or null if nothing matched (not found, inactive, or
// insufficient stock) — callers must treat null as "deduction did not happen", never partial.
// `session` is optional and purely additive (Manual Stock Adjustments, Phase 3) — every existing caller
// (order placement, pre-order confirmation, bulk approval) omits it and runs exactly as before; only the
// new adjustment endpoint passes one, to run inside its own transaction.
export async function deductVariationStock(Product, { productId, variationId, isLegacy, quantity, session }) {
  const options = { new: true, ...(session ? { session } : {}) };
  if (isLegacy) {
    return Product.findOneAndUpdate(
      { _id: productId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      options,
    );
  }
  return Product.findOneAndUpdate(
    { _id: productId, variations: { $elemMatch: { _id: variationId, stock: { $gte: quantity }, isActive: { $ne: false } } } },
    { $inc: { 'variations.$[elem].stock': -quantity } },
    { ...options, arrayFilters: [{ 'elem._id': variationId }] },
  );
}

// Best-effort restoration (mirrors the existing pre-Phase-2 restoration convention: the write itself is
// unconditional — there is no "too much stock" failure mode — but a deleted product/variation matches
// nothing, which the caller must detect via matchedCount and report rather than silently ignore.
// `session` is optional and purely additive, exactly as above — the return shape (a write result, not a
// document) is unchanged, since existing callers (order/bulk-order cancellation restoration) already
// depend on reading `.matchedCount` from it.
export async function restoreVariationStock(Product, { productId, variationId, isLegacy, quantity, session }) {
  const options = session ? { session } : {};
  if (isLegacy) {
    return Product.updateOne({ _id: productId }, { $inc: { stock: quantity } }, options);
  }
  return Product.updateOne(
    { _id: productId, 'variations._id': variationId },
    { $inc: { 'variations.$.stock': quantity } },
    options,
  );
}

// Manual Stock Adjustments (Phase 3) only — unconditional, atomic increment that (unlike
// restoreVariationStock above) returns the updated Product document, so the caller can read the true
// post-write stock value rather than trusting a value computed from an earlier read. Deliberately a
// separate function rather than changing restoreVariationStock's own return shape, which existing
// order/bulk-order cancellation-restoration callers already depend on.
export async function addVariationStock(Product, { productId, variationId, isLegacy, quantity, session }) {
  const options = { new: true, ...(session ? { session } : {}) };
  if (isLegacy) {
    return Product.findOneAndUpdate({ _id: productId }, { $inc: { stock: quantity } }, options);
  }
  return Product.findOneAndUpdate(
    { _id: productId, 'variations._id': variationId },
    { $inc: { 'variations.$.stock': quantity } },
    options,
  );
}

// Manual Stock Adjustments (Phase 3) only — Set Exact. An absolute replace, not an increment, so it
// needs its own optimistic-concurrency guard: the write only applies if the target's stock still equals
// `expectedPreviousStock` (the value the client saw when it opened/confirmed the adjustment). A real
// variation is matched with $elemMatch on BOTH _id and the expected stock on the SAME array element,
// then updated via the positional $ operator — never a bare positional field in the filter itself.
// Returns the updated document, or null if the expected value was already stale — callers must treat
// null as "do not write the movement record either" and respond 409, never retry with a guessed value.
export async function setVariationStock(Product, { productId, variationId, isLegacy, newStock, expectedPreviousStock, session }) {
  const options = { new: true, ...(session ? { session } : {}) };
  if (isLegacy) {
    return Product.findOneAndUpdate(
      { _id: productId, stock: expectedPreviousStock },
      { $set: { stock: newStock } },
      options,
    );
  }
  return Product.findOneAndUpdate(
    { _id: productId, variations: { $elemMatch: { _id: variationId, stock: expectedPreviousStock } } },
    { $set: { 'variations.$.stock': newStock } },
    options,
  );
}
