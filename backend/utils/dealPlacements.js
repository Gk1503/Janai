import Promotion from '../models/Promotion.js';

// Product.dealPlacements keys -> Promotion.section values.
export const PLACEMENT_SECTIONS = { bestDeals: 'best_deals', seasonalDeals: 'seasonal_deals' };
export const SECTION_PLACEMENTS = { best_deals: 'bestDeals', seasonal_deals: 'seasonalDeals' };
export const SECTION_LABELS = { best_deals: 'Best Deals', seasonal_deals: 'Seasonal Deals' };

export const isMarked = (product, section) => product?.dealPlacements?.[SECTION_PLACEMENTS[section]] === true;

// Whitelists the placement flags of a request body. Returns { value } (only the keys sent, as booleans) or { error }.
export function parsePlacements(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Promotional placement must be an object.' };
  const value = {};
  for (const [key, flag] of Object.entries(input)) {
    if (!PLACEMENT_SECTIONS[key]) return { error: `Unknown promotional placement: ${key}.` };
    if (typeof flag !== 'boolean') return { error: `${key} must be true or false.` };
    value[key] = flag;
  }
  return Object.keys(value).length ? { value } : { error: 'Choose Best Deals, Seasonal Deals or neither.' };
}

// Promotions of the given placements' sections that currently include the product.
export async function promotionsUsing(productId, keys) {
  const found = [];
  for (const key of keys) {
    const section = PLACEMENT_SECTIONS[key];
    const rows = await Promotion.find({ section, products: productId }).select('title section products').lean();
    found.push(...rows.map((row) => ({ _id: String(row._id), title: row.title, section: row.section, productCount: (row.products || []).length })));
  }
  return found;
}

// Takes the product out of the promotions of the given sections only. The Product document, the promotions
// themselves and every other product reference are left alone.
export async function pullFromPromotions(productId, keys, userId) {
  const sections = keys.map((key) => PLACEMENT_SECTIONS[key]);
  if (!sections.length) return;
  await Promotion.updateMany({ section: { $in: sections }, products: productId }, { $pull: { products: productId, homepageHidden: productId }, $set: { updatedBy: userId } });
}

// A deleted product must not stay referenced, or the promotion could never be saved again.
export async function pullFromAllPromotions(productId) {
  await Promotion.updateMany({ products: productId }, { $pull: { products: productId, homepageHidden: productId } });
}
