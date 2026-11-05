import Category from '../models/Category.js';
import Product from '../models/Product.js';
import Promotion, { PROMOTION_SECTIONS } from '../models/Promotion.js';
import Settings from '../models/Settings.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  SECTION_FLAGS, bestOfferFor, loadDealSettings, loadPricingContext, promotionStatus, withOffer,
} from '../utils/promotionPricing.js';
import { MAX_REFERENCES, isObjectId, unsupportedFields, validatePromotion } from '../utils/promotionValidation.js';
import { SECTION_LABELS, SECTION_PLACEMENTS, isMarked } from '../utils/dealPlacements.js';

const PUBLIC_LIMIT = 10;
const PRODUCTS_PER_DEAL = 12;
// The dedicated Best Deals / Seasonal Deals pages ask for ?full=1 to browse everything a promotion holds.
const FULL_PRODUCTS_PER_DEAL = 100;
const PREVIEW_PRODUCTS = 100;
const ADMIN_LIST_LIMIT = 500;
const CATEGORY_COLLATION = { locale: 'en', strength: 2 };
const badRequest = (res, message) => res.status(400).json({ message });
const notFound = (res) => res.status(404).json({ message: 'Promotion not found.' });

// ---------------------------------------------------------------- helpers
const idString = (value) => String(value?._id ?? value ?? '');

const presentCard = (card) => ({ title: card.title, image: card.image || '', product: card.product ? idString(card.product) : null, category: card.category || null });

// A stored promotion in the shape the validator expects (ids as strings).
const normalizeStored = (promotion) => ({ ...promotion, products: (promotion.products || []).map(idString), cards: (promotion.cards || []).map(presentCard), homepageHidden: (promotion.homepageHidden || []).map(idString) });

function presentForAdmin(promotion, now) {
  const plain = typeof promotion.toObject === 'function' ? promotion.toObject() : promotion;
  const { __v, ...rest } = plain;
  return {
    ...rest,
    _id: idString(plain._id),
    products: (plain.products || []).map(idString),
    cards: (plain.cards || []).map(presentCard),
    homepageHidden: (plain.homepageHidden || []).map(idString),
    status: promotionStatus(plain, now),
    discountLabel: plain.promotionType === 'actual_discount' ? (plain.discountType === 'percentage' ? `${plain.discountValue}% off` : `₹${plain.discountValue} off`) : 'Display Only',
  };
}

// Confirms every referenced product and category still exists. Categories are stored under their canonical
// (database) spelling so they keep matching Product.category.
// A product newly added to a promotion must be marked for that promotion's section in Product Edit. Products
// the promotion already holds (including ones added before placements existed) are never re-checked.
async function resolveReferences(value, existingIds = []) {
  const found = value.products.length ? await Product.find({ _id: { $in: value.products } }).select('name price dealPlacements').lean() : [];
  if (found.length !== value.products.length) return { error: 'One or more selected products no longer exist.' };
  const already = new Set(existingIds.map(String));
  const unmarked = found.find((product) => !already.has(idString(product)) && !isMarked(product, value.section));
  if (unmarked) return { error: `${unmarked.name} is not marked for ${SECTION_LABELS[value.section]}. Mark it in Product Edit under Promotional Placement first.` };
  // Campaign cards may link to any existing product or category (a link is navigation, not a promotion).
  const cards = value.cards || [];
  const cardProducts = [...new Set(cards.map((card) => card.product).filter(Boolean))];
  if (cardProducts.length) {
    const exist = await Product.find({ _id: { $in: cardProducts } }).select('_id').lean();
    if (exist.length !== cardProducts.length) return { error: 'A campaign card links to a product that no longer exists.' };
  }
  let categories = [];
  let canonicalCards = cards;
  if (value.categories.length || cards.some((card) => card.category)) {
    const known = await Category.find({}).select('name').lean();
    const byLower = new Map(known.map((category) => [category.name.toLowerCase(), category.name]));
    categories = value.categories.map((name) => byLower.get(name.toLowerCase()));
    if (categories.some((name) => !name)) return { error: 'One or more selected categories do not exist.' };
    canonicalCards = cards.map((card) => ({ ...card, category: card.category ? byLower.get(card.category.toLowerCase()) : null }));
    if (canonicalCards.some((card, index) => cards[index].category && !card.category)) return { error: 'A campaign card links to a category that does not exist.' };
  }
  if (value.discountType === 'fixed') {
    const tooCheap = found.find((product) => product.price < value.discountValue);
    if (tooCheap) return { error: `A fixed discount of ₹${value.discountValue} is more than the price of ${tooCheap.name} (₹${tooCheap.price}).` };
  }
  return { categories: [...new Set(categories)], cards: canonicalCards };
}

// Products shown on a deal card: the explicitly chosen ones first (in the admin's order), then products
// from the chosen categories, up to the limit. Supplier data and anything unpublished is never selected.
async function productsFor(promotion, limit) {
  const explicit = (promotion.products || []).map(idString);
  const picked = explicit.length ? await Product.find({ _id: { $in: explicit } }).select('-vendors').lean() : [];
  const byId = new Map(picked.map((product) => [idString(product), product]));
  const ordered = explicit.map((id) => byId.get(id)).filter(Boolean);
  if (ordered.length < limit && (promotion.categories || []).length) {
    const extra = await Product.find({ category: { $in: promotion.categories }, _id: { $nin: explicit } })
      .collation(CATEGORY_COLLATION).select('-vendors').sort({ featured: -1, createdAt: -1 }).limit(limit - ordered.length).lean();
    ordered.push(...extra);
  }
  return ordered.slice(0, limit);
}

// Cards as customers see them: a link to a product that has since been deleted is dropped, so the card is simply
// not clickable instead of leading to a dead page.
async function cardsFor(promotion) {
  const cards = (promotion.cards || []).map(presentCard);
  const ids = [...new Set(cards.map((card) => card.product).filter(Boolean))];
  const live = ids.length ? new Set((await Product.find({ _id: { $in: ids } }).select('_id').lean()).map(idString)) : new Set();
  return cards.map((card) => ({ ...card, product: card.product && live.has(card.product) ? card.product : null }));
}

const BANNER_PRODUCTS = 3;

// The small product cards on the Seasonal Deals homepage banner: the first three products of the campaign (in the
// admin's order) whose homepage checkbox is on. Hidden products stay in the campaign and on the Seasonal Deals
// page. Priced by the same engine as everything else.
async function bannerProductsFor(promotion, context) {
  if (promotion.section !== 'seasonal_deals') return [];
  const hidden = new Set((promotion.homepageHidden || []).map(idString));
  const ids = (promotion.products || []).map(idString).filter((id) => !hidden.has(id)).slice(0, 10);
  if (!ids.length) return [];
  const docs = await Product.find({ _id: { $in: ids } }).select('-vendors').lean();
  const byId = new Map(docs.map((product) => [idString(product), product]));
  return ids.map((id) => byId.get(id)).filter(Boolean).slice(0, BANNER_PRODUCTS).map((product) => withOffer(product, context));
}

async function viewFor(promotion, context, limit) {
  const products = await productsFor(promotion, limit);
  const cards = await cardsFor(promotion);
  const bannerProducts = await bannerProductsFor(promotion, context);
  const hasReferences = (promotion.products || []).length > 0 || (promotion.categories || []).length > 0;
  return {
    hasReferences,
    view: {
      _id: idString(promotion._id),
      title: promotion.title || '',
      description: promotion.description || '',
      bannerImage: promotion.bannerImage || '',
      badgeText: promotion.badgeText || '',
      cards,
      bannerProducts,
      section: promotion.section,
      promotionType: promotion.promotionType,
      discount: promotion.promotionType === 'actual_discount' ? { type: promotion.discountType, value: promotion.discountValue } : null,
      endAt: promotion.endAt,
      // Prices always come from the pricing engine, so a card can never show a price the cart would not charge.
      products: products.map((product) => withOffer(product, context)),
    },
  };
}

// ---------------------------------------------------------------- public API
// A section that is switched off, or has nothing eligible, returns an empty list. Nothing about disabled,
// inactive, scheduled or expired promotions is ever included.
export const publicDeals = (section) => asyncHandler(async (req, res) => {
  const settings = await loadDealSettings();
  if (!settings[SECTION_FLAGS[section]]) return res.json({ enabled: false, promotions: [] });
  const context = await loadPricingContext();
  const promotions = await Promotion.find({ section, isActive: true, startAt: { $lte: context.now }, endAt: { $gt: context.now } })
    .sort({ displayOrder: 1, createdAt: -1 }).limit(PUBLIC_LIMIT).lean();
  const views = [];
  for (const promotion of promotions) {
    const { view, hasReferences } = await viewFor(promotion, context, req.query.full === '1' ? FULL_PRODUCTS_PER_DEAL : PRODUCTS_PER_DEAL);
    // Every referenced product was deleted: skip it rather than show an empty card.
    if (hasReferences && !view.products.length) continue;
    views.push(view);
  }
  return res.json({ enabled: true, promotions: views });
});

// ---------------------------------------------------------------- admin: section switches
export const getDealSettings = asyncHandler(async (req, res) => res.json({ settings: await loadDealSettings() }));

export const updateDealSettings = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const unsupported = Object.keys(body).filter((key) => !['bestDealsEnabled', 'seasonalDealsEnabled'].includes(key));
  if (unsupported.length) return badRequest(res, `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  const set = {};
  for (const key of ['bestDealsEnabled', 'seasonalDealsEnabled']) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'boolean') return badRequest(res, `${key} must be true or false.`);
    set[`deals.${key}`] = body[key];
  }
  if (!Object.keys(set).length) return badRequest(res, 'Send bestDealsEnabled or seasonalDealsEnabled.');
  set.updatedBy = req.user._id;
  // Writes only the switch(es) sent; promotions and the other switch are untouched.
  await Settings.findOneAndUpdate({}, { $set: set }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return res.json({ settings: await loadDealSettings(), message: 'Deals visibility saved.' });
});

// ---------------------------------------------------------------- admin: promotions
export const listPromotions = asyncHandler(async (req, res) => {
  const section = req.query.section;
  if (section !== undefined && !PROMOTION_SECTIONS.includes(section)) return badRequest(res, 'Choose Best Deals or Seasonal Deals.');
  const now = new Date();
  const promotions = await Promotion.find(section ? { section } : {}).select('-bannerImage -cards.image').sort({ section: 1, displayOrder: 1, createdAt: -1 }).limit(ADMIN_LIST_LIMIT).lean();
  const presented = promotions.map((promotion) => presentForAdmin(promotion, now));
  const stats = {};
  for (const name of PROMOTION_SECTIONS) {
    const mine = presented.filter((promotion) => promotion.section === name);
    stats[name] = { total: mine.length, active: mine.filter((p) => p.status === 'live').length, scheduled: mine.filter((p) => p.status === 'scheduled').length, expired: mine.filter((p) => p.status === 'expired').length, inactive: mine.filter((p) => p.status === 'inactive').length };
  }
  return res.json({ promotions: presented, stats, settings: await loadDealSettings() });
});

export const getPromotion = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const promotion = await Promotion.findById(req.params.id).lean();
  if (!promotion) return notFound(res);
  const presented = presentForAdmin(promotion, new Date());
  // The form shows the name of each card's linked product.
  const ids = [...new Set(presented.cards.map((card) => card.product).filter(Boolean))];
  const names = new Map((ids.length ? await Product.find({ _id: { $in: ids } }).select('name').lean() : []).map((product) => [idString(product), product.name]));
  presented.cards = presented.cards.map((card) => ({ ...card, productName: card.product ? names.get(card.product) || '' : '' }));
  return res.json({ promotion: presented });
});

export const createPromotion = asyncHandler(async (req, res) => {
  const unsupported = unsupportedFields(req.body);
  if (unsupported.length) return badRequest(res, `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  const checked = validatePromotion(req.body, { creating: true });
  if (checked.error) return badRequest(res, checked.error);
  const references = await resolveReferences(checked.value);
  if (references.error) return badRequest(res, references.error);
  const value = { ...checked.value, categories: references.categories, cards: references.cards };
  if (value.displayOrder === undefined) {
    const last = await Promotion.findOne({ section: value.section }).select('displayOrder').sort({ displayOrder: -1 }).lean();
    value.displayOrder = last ? (last.displayOrder || 0) + 1 : 0;
  }
  const promotion = await Promotion.create({ ...value, createdBy: req.user._id, updatedBy: req.user._id });
  return res.status(201).json({ promotion: presentForAdmin(promotion, new Date()), message: 'Promotion created.' });
});

export const updatePromotion = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const unsupported = unsupportedFields(req.body);
  if (unsupported.length) return badRequest(res, `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  const existing = await Promotion.findById(req.params.id).lean();
  if (!existing) return notFound(res);
  if (req.body.section !== undefined && req.body.section !== existing.section) return badRequest(res, 'A promotion cannot be moved to the other section. Create a new one instead.');
  // Only the fields sent change; the rest keep their stored values, and the merged result is validated as a whole.
  const merged = { ...normalizeStored(existing), ...req.body, section: existing.section };
  const checked = validatePromotion(merged);
  if (checked.error) return badRequest(res, checked.error);
  const references = await resolveReferences(checked.value, existing.products);
  if (references.error) return badRequest(res, references.error);
  const { displayOrder, ...rest } = checked.value;
  const update = { ...rest, categories: references.categories, cards: references.cards, updatedBy: req.user._id };
  if (displayOrder !== undefined) update.displayOrder = displayOrder;
  const promotion = await Promotion.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true }).lean();
  return res.json({ promotion: presentForAdmin(promotion, new Date()), message: 'Promotion saved.' });
});

// Products offered by the "Add Products" picker, with their placement and whether the chosen promotion already
// holds them. Only the first image is read (images are stored inline) and supplier data is never selected.
const PICKER_PAGE = 30;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const listDealProducts = asyncHandler(async (req, res) => {
  const { section, promotionId, q, category, scope = 'marked' } = req.query;
  if (!PROMOTION_SECTIONS.includes(section)) return badRequest(res, 'Choose Best Deals or Seasonal Deals.');
  if (!['marked', 'all', 'included'].includes(scope)) return badRequest(res, 'Unknown product filter.');
  let promotion = null;
  if (promotionId !== undefined && promotionId !== '') {
    if (!isObjectId(promotionId)) return notFound(res);
    promotion = await Promotion.findById(promotionId).select('section products').lean();
    if (!promotion || promotion.section !== section) return notFound(res);
  }
  const included = new Set((promotion?.products || []).map(idString));
  const filter = {};
  const search = typeof q === 'string' ? q.trim().slice(0, 80) : '';
  if (search) filter.name = { $regex: escapeRegExp(search), $options: 'i' };
  if (typeof category === 'string' && category && category !== 'All') filter.category = category;
  if (scope === 'marked') filter[`dealPlacements.${SECTION_PLACEMENTS[section]}`] = true;
  if (scope === 'included') filter._id = { $in: [...included] };
  const page = Math.max(1, Number(req.query.page) || 1);
  const rows = await Product.find(filter).collation(CATEGORY_COLLATION).select('name category price unit stock dealPlacements').select({ images: { $slice: 1 } })
    .sort({ name: 1 }).skip((page - 1) * PICKER_PAGE).limit(PICKER_PAGE + 1).lean();
  const products = rows.slice(0, PICKER_PAGE).map((product) => ({
    _id: idString(product), name: product.name, category: product.category, price: product.price, unit: product.unit, stock: product.stock ?? 0,
    image: (product.images || [])[0] || '',
    markedBestDeals: product.dealPlacements?.bestDeals === true, markedSeasonalDeals: product.dealPlacements?.seasonalDeals === true,
    marked: isMarked(product, section), included: included.has(idString(product)),
  }));
  return res.json({ products, page, hasMore: rows.length > PICKER_PAGE });
});

// Adds and/or removes references on one promotion. Only `products` (and updatedBy) is written; the rest of the
// promotion is validated as a whole but never rewritten, and no Product document is created or changed.
export const updatePromotionProducts = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const unsupported = Object.keys(req.body || {}).filter((key) => !['add', 'remove'].includes(key));
  if (unsupported.length) return badRequest(res, `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  const add = req.body?.add === undefined ? [] : req.body.add;
  const remove = req.body?.remove === undefined ? [] : req.body.remove;
  const valid = (list) => Array.isArray(list) && list.length <= MAX_REFERENCES && list.every(isObjectId);
  if (!valid(add) || !valid(remove)) return badRequest(res, 'Send valid product ids.');
  if (!add.length && !remove.length) return badRequest(res, 'Choose at least one product to add or remove.');
  const existing = await Promotion.findById(req.params.id).lean();
  if (!existing) return notFound(res);
  const current = (existing.products || []).map(idString);
  const dropped = new Set(remove);
  const next = current.filter((id) => !dropped.has(id));
  for (const id of add) if (!next.includes(id)) next.push(id);
  // A campaign that already had fewer than three products may grow toward three without being blocked; it may never shrink below three.
  const checked = validatePromotion({ ...normalizeStored(existing), products: next }, { minSeasonalProducts: next.length >= current.length ? 0 : 3 });
  if (checked.error) return badRequest(res, checked.error);
  const references = await resolveReferences(checked.value, current);
  if (references.error) return badRequest(res, references.error);
  const promotion = await Promotion.findByIdAndUpdate(req.params.id, { $set: { products: checked.value.products, homepageHidden: checked.value.homepageHidden, updatedBy: req.user._id } }, { new: true }).select('-bannerImage').lean();
  return res.json({
    promotion: presentForAdmin(promotion, new Date()),
    added: next.filter((id) => !current.includes(id)).length,
    removed: current.filter((id) => dropped.has(id)).length,
    message: 'Products updated.',
  });
});

export const setPromotionActive = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const unsupported = Object.keys(req.body || {}).filter((key) => key !== 'isActive');
  if (unsupported.length) return badRequest(res, `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  if (typeof req.body?.isActive !== 'boolean') return badRequest(res, 'isActive must be true or false.');
  const promotion = await Promotion.findByIdAndUpdate(req.params.id, { $set: { isActive: req.body.isActive, updatedBy: req.user._id } }, { new: true }).select('-bannerImage').lean();
  if (!promotion) return notFound(res);
  return res.json({ promotion: presentForAdmin(promotion, new Date()), message: req.body.isActive ? 'Promotion activated.' : 'Promotion deactivated.' });
});

export const deletePromotion = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  // Orders keep their own price snapshot (title and amounts), so deleting a promotion never changes an order.
  const promotion = await Promotion.findByIdAndDelete(req.params.id);
  if (!promotion) return notFound(res);
  return res.json({ message: 'Promotion deleted.' });
});

export const reorderPromotions = asyncHandler(async (req, res) => {
  const unsupported = Object.keys(req.body || {}).filter((key) => !['section', 'ids'].includes(key));
  if (unsupported.length) return badRequest(res, `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  const { section, ids } = req.body || {};
  if (!PROMOTION_SECTIONS.includes(section)) return badRequest(res, 'Choose Best Deals or Seasonal Deals.');
  if (!Array.isArray(ids) || !ids.length || ids.length > ADMIN_LIST_LIMIT || ids.some((id) => !isObjectId(id)) || new Set(ids).size !== ids.length) return badRequest(res, 'Send the promotion ids in the order you want.');
  // Scoped to the section, so ids from the other section can never be reordered through this call.
  await Promotion.bulkWrite(ids.map((id, index) => ({ updateOne: { filter: { _id: id, section }, update: { $set: { displayOrder: index, updatedBy: req.user._id } } } })));
  return res.json({ message: 'Display order saved.' });
});

// What the promotion would show customers, priced by the same engine, whatever its current status.
export const previewPromotion = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) return notFound(res);
  const promotion = await Promotion.findById(req.params.id).lean();
  if (!promotion) return notFound(res);
  const now = new Date();
  const settings = await loadDealSettings();
  const preview = { now, settings, promotions: promotion.promotionType === 'actual_discount' ? [promotion] : [] };
  const { view } = await viewFor(promotion, preview, PREVIEW_PRODUCTS);
  const status = promotionStatus(promotion, now);
  const sectionEnabled = settings[SECTION_FLAGS[promotion.section]] === true;
  return res.json({
    preview: view,
    status,
    sectionEnabled,
    visibleToCustomers: sectionEnabled && status === 'live',
    pricing: view.products.map((product) => {
      const offer = bestOfferFor(product, preview);
      return { productId: idString(product._id), name: product.name, originalPrice: product.price, discountPerUnit: offer?.discountPerUnit ?? 0, finalPrice: offer?.finalPrice ?? product.price, discountPercent: offer?.discountPercent ?? 0, applied: Boolean(offer) };
    }),
  });
});
