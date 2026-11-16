import Promotion from '../models/Promotion.js';
import Settings from '../models/Settings.js';

// The single place promotional prices are decided. Cart, checkout, product listings and the public deals
// API all call into this module, so a price shown to a customer and the price charged can never drift
// apart, and nothing a browser sends is ever read as a price.

export const SECTION_FLAGS = { best_deals: 'bestDealsEnabled', seasonal_deals: 'seasonalDealsEnabled' };
const MAX_ACTIVE_PROMOTIONS = 200;

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// Per-unit discount for a price, or null when the discount cannot validly apply. A discount larger than
// the price (a final price below zero) is never applied; the promotion is simply ignored for that product.
export function computeDiscount(price, discountType, discountValue) {
  const original = Number(price);
  const value = Number(discountValue);
  if (!Number.isFinite(original) || original <= 0 || !Number.isFinite(value) || value <= 0) return null;
  let perUnit;
  if (discountType === 'percentage') {
    if (value > 100) return null;
    perUnit = round2((original * value) / 100);
  } else if (discountType === 'fixed') {
    perUnit = round2(value);
  } else {
    return null;
  }
  if (perUnit <= 0 || perUnit > original) return null;
  return { discountPerUnit: perUnit, finalPrice: round2(original - perUnit), discountPercent: Math.round((perUnit / original) * 1000) / 10 };
}

export const promotionStatus = (promotion, now = new Date()) => {
  if (!promotion.isActive) return 'inactive';
  if (new Date(promotion.startAt) > now) return 'scheduled';
  if (new Date(promotion.endAt) <= now) return 'expired';
  return 'live';
};

// Section switches live in the single Settings document. Fail closed: unreadable or never-saved settings
// mean "off", so a database hiccup can never turn a discount on.
export async function loadDealSettings() {
  try {
    const doc = await Settings.findOne({}, 'deals').lean();
    const saved = doc?.deals || {};
    return { bestDealsEnabled: saved.bestDealsEnabled === true, seasonalDealsEnabled: saved.seasonalDealsEnabled === true };
  } catch {
    return { bestDealsEnabled: false, seasonalDealsEnabled: false };
  }
}

// Everything needed to price any number of products: the section switches plus the live discount
// promotions of the enabled sections. Costs one small settings read when both sections are off, and no
// promotion query at all in that case.
export async function loadPricingContext(now = new Date()) {
  const settings = await loadDealSettings();
  const sections = Object.entries(SECTION_FLAGS).filter(([, flag]) => settings[flag]).map(([section]) => section);
  let promotions = [];
  if (sections.length) {
    try {
      promotions = await Promotion.find({ section: { $in: sections }, promotionType: 'actual_discount', isActive: true, startAt: { $lte: now }, endAt: { $gt: now } })
        .select('title section badgeText discountType discountValue products categories displayOrder createdAt')
        .limit(MAX_ACTIVE_PROMOTIONS)
        .lean();
    } catch {
      promotions = [];
    }
  }
  return { now, settings, promotions };
}

const idOf = (product) => String(product?._id ?? product?.id ?? '');

export function promotionTargets(promotion, product) {
  const id = idOf(product);
  if ((promotion.products || []).some((entry) => String(entry) === id)) return true;
  const category = String(product?.category || '').toLowerCase();
  return Boolean(category) && (promotion.categories || []).some((name) => String(name).toLowerCase() === category);
}

// Highest customer saving wins; ties fall back to the lower display order, then the older promotion, then
// the id, so the same product always gets the same single offer. Discounts never stack.
function isBetter(candidate, current) {
  if (candidate.discountPerUnit !== current.discountPerUnit) return candidate.discountPerUnit > current.discountPerUnit;
  if (candidate.displayOrder !== current.displayOrder) return candidate.displayOrder < current.displayOrder;
  if (candidate.createdAt !== current.createdAt) return candidate.createdAt < current.createdAt;
  return candidate.promotionId < current.promotionId;
}

export function bestOfferFor(product, context) {
  if (!product || !context?.promotions?.length) return null;
  let best = null;
  for (const promotion of context.promotions) {
    if (!promotionTargets(promotion, product)) continue;
    const discount = computeDiscount(product.price, promotion.discountType, promotion.discountValue);
    if (!discount) continue;
    const candidate = {
      promotionId: String(promotion._id),
      title: promotion.title,
      section: promotion.section,
      badgeText: promotion.badgeText || '',
      discountType: promotion.discountType,
      discountValue: promotion.discountValue,
      originalPrice: round2(product.price),
      discountPerUnit: discount.discountPerUnit,
      finalPrice: discount.finalPrice,
      discountPercent: discount.discountPercent,
      displayOrder: promotion.displayOrder || 0,
      createdAt: promotion.createdAt ? new Date(promotion.createdAt).getTime() : 0,
    };
    if (!best || isBetter(candidate, best)) best = candidate;
  }
  if (!best) return null;
  const { displayOrder, createdAt, ...offer } = best;
  return offer;
}

// A product as sent to customers: the stored price is untouched; `offer` is null or the discount to show.
export function withOffer(product, context) {
  const plain = typeof product?.toJSON === 'function' ? product.toJSON() : product;
  return { ...plain, offer: bestOfferFor(plain, context) };
}

// Prices cart-style lines [{ product, quantity }] from trusted data only.
export function priceLines(lines, context) {
  let originalSubtotal = 0;
  let discountTotal = 0;
  const items = lines.map(({ product, quantity }) => {
    const offer = bestOfferFor(product, context);
    const original = round2(product.price);
    const unitPrice = offer ? offer.finalPrice : original;
    const lineOriginal = round2(original * quantity);
    const lineTotal = round2(unitPrice * quantity);
    originalSubtotal += lineOriginal;
    discountTotal += lineOriginal - lineTotal;
    return { productId: idOf(product), quantity, offer, originalPrice: original, unitPrice, lineOriginal, lineDiscount: round2(lineOriginal - lineTotal), lineTotal };
  });
  return { items, originalSubtotal: round2(originalSubtotal), discountTotal: round2(discountTotal), subtotal: round2(originalSubtotal - discountTotal) };
}
