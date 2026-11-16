import { DISCOUNT_TYPES, MAX_CARDS, PROMOTION_SECTIONS, PROMOTION_TYPES } from '../models/Promotion.js';

export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 300;
export const MAX_BADGE = 30;
export const MAX_REFERENCES = 100;
export const MAX_FIXED_DISCOUNT = 1_000_000;
export const MAX_BANNER_LENGTH = 3_000_000;
export const MAX_CARD_IMAGE_LENGTH = 1_500_000;
export const MAX_CARD_TITLE = 40;
export const MIN_SEASONAL_PRODUCTS = 3;
export const SEASONAL_MIN_MESSAGE = `Please select at least ${MIN_SEASONAL_PRODUCTS} products for a Seasonal Deal.`;

export const ALLOWED_FIELDS = ['title', 'description', 'section', 'promotionType', 'bannerImage', 'products', 'categories', 'discountType', 'discountValue', 'startAt', 'endAt', 'isActive', 'displayOrder', 'badgeText', 'cards', 'homepageHidden'];

export const isObjectId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const blank = (value) => value === undefined || value === null || value === '';

export function unsupportedFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  return Object.keys(body).filter((key) => !ALLOWED_FIELDS.includes(key));
}

function validBanner(value, max = MAX_BANNER_LENGTH) {
  if (value === '') return true;
  if (typeof value !== 'string') return false;
  if (value.startsWith('data:image/')) return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= max;
  return value.length <= 500 && (value.startsWith('/') || /^https:\/\//.test(value));
}

// Validates a complete promotion (create, or an update merged over the stored values). Returns
// { error } or { value } holding only whitelisted, normalised fields. Referenced products and categories
// are checked against the database separately (see dealsController.resolveReferences).
// `minSeasonalProducts` lets the Add Products endpoint keep an older, shorter campaign editable while it grows.
export function validatePromotion(input, { now = new Date(), creating = false, minSeasonalProducts = MIN_SEASONAL_PRODUCTS } = {}) {
  const title = text(input.title);
  if (title.length > MAX_TITLE) return { error: `The title can be at most ${MAX_TITLE} characters.` };
  const description = blank(input.description) ? '' : input.description;
  if (typeof description !== 'string' || description.trim().length > MAX_DESCRIPTION) return { error: `The description can be at most ${MAX_DESCRIPTION} characters.` };
  const badgeText = blank(input.badgeText) ? '' : input.badgeText;
  if (typeof badgeText !== 'string' || badgeText.trim().length > MAX_BADGE) return { error: `The badge text can be at most ${MAX_BADGE} characters.` };
  if (!PROMOTION_SECTIONS.includes(input.section)) return { error: 'Choose Best Deals or Seasonal Deals.' };
  if (!PROMOTION_TYPES.includes(input.promotionType)) return { error: 'Choose Display Only or Actual Discount.' };
  if (blank(input.bannerImage) ? false : !validBanner(input.bannerImage)) return { error: 'The banner must be a PNG, JPEG, WebP or GIF image of at most about 2 MB.' };
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') return { error: 'Active must be true or false.' };

  const products = input.products === undefined ? [] : input.products;
  if (!Array.isArray(products) || products.length > MAX_REFERENCES || products.some((id) => !isObjectId(id))) return { error: `Select up to ${MAX_REFERENCES} valid products.` };
  const uniqueProducts = Array.isArray(products) ? [...new Set(products)] : [];
  if (input.section === 'seasonal_deals' && uniqueProducts.length < minSeasonalProducts) return { error: SEASONAL_MIN_MESSAGE };
  // Homepage visibility: only products that belong to the campaign can be hidden, and only Seasonal Deals use it.
  const hiddenInput = input.homepageHidden === undefined || input.homepageHidden === null ? [] : input.homepageHidden;
  if (!Array.isArray(hiddenInput) || hiddenInput.length > MAX_REFERENCES || hiddenInput.some((id) => !isObjectId(id))) return { error: 'Homepage visibility is not valid.' };
  const homepageHidden = input.section === 'seasonal_deals' ? [...new Set(hiddenInput)].filter((id) => uniqueProducts.includes(id)) : [];
  const categories = input.categories === undefined ? [] : input.categories;
  if (!Array.isArray(categories) || categories.length > MAX_REFERENCES || categories.some((name) => typeof name !== 'string' || !name.trim() || name.length > 60)) return { error: 'Select valid categories.' };

  // Seasonal campaign cards: title required, image / product / category optional, never both a product and a category.
  const rawCards = input.cards === undefined || input.cards === null ? [] : input.cards;
  if (!Array.isArray(rawCards) || rawCards.length > MAX_CARDS) return { error: `A campaign can have at most ${MAX_CARDS} cards.` };
  if (rawCards.length && input.section !== 'seasonal_deals') return { error: 'Campaign cards are only available for Seasonal Deals.' };
  const cards = [];
  for (const [index, card] of rawCards.entries()) {
    const label = `Card ${index + 1}`;
    if (!card || typeof card !== 'object' || Array.isArray(card)) return { error: `${label} is not valid.` };
    const cardTitle = text(card.title);
    if (!cardTitle || cardTitle.length > MAX_CARD_TITLE) return { error: `${label}: enter a title of up to ${MAX_CARD_TITLE} characters.` };
    if (!blank(card.image) && !validBanner(card.image, MAX_CARD_IMAGE_LENGTH)) return { error: `${label}: the image must be a PNG, JPEG, WebP or GIF of at most about 1 MB.` };
    const product = blank(card.product) ? null : card.product;
    const category = blank(card.category) ? null : text(card.category);
    if (product !== null && !isObjectId(product)) return { error: `${label}: choose a valid product.` };
    if (category !== null && (!category || category.length > 60)) return { error: `${label}: choose a valid category.` };
    if (product && category) return { error: `${label}: link either a product or a category, not both.` };
    cards.push({ title: cardTitle, image: blank(card.image) ? '' : card.image, product, category });
  }

  let displayOrder = input.displayOrder;
  if (!blank(displayOrder)) {
    displayOrder = Number(displayOrder);
    if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 9999) return { error: 'Display order must be a whole number from 0 to 9999.' };
  } else displayOrder = undefined;

  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (blank(input.startAt) || Number.isNaN(startAt.getTime())) return { error: 'Enter a valid start date and time.' };
  if (blank(input.endAt) || Number.isNaN(endAt.getTime())) return { error: 'Enter a valid end date and time.' };
  if (endAt <= startAt) return { error: 'The end date and time must be after the start.' };
  if (creating && endAt <= now) return { error: 'The end date and time must be in the future.' };

  let discountType = null;
  let discountValue = null;
  if (input.promotionType === 'actual_discount') {
    if (!DISCOUNT_TYPES.includes(input.discountType)) return { error: 'Choose a percentage or fixed-amount discount.' };
    discountType = input.discountType;
    discountValue = typeof input.discountValue === 'string' && input.discountValue.trim() !== '' ? Number(input.discountValue) : input.discountValue;
    if (typeof discountValue !== 'number' || !Number.isFinite(discountValue) || discountValue <= 0) return { error: 'Enter a discount value greater than 0.' };
    if (discountType === 'percentage' && discountValue > 100) return { error: 'A percentage discount cannot be more than 100.' };
    if (discountType === 'fixed' && discountValue > MAX_FIXED_DISCOUNT) return { error: `A fixed discount cannot be more than ${MAX_FIXED_DISCOUNT}.` };
    discountValue = Math.round(discountValue * 100) / 100;
    if (!products.length && !categories.length) return { error: 'Select at least one product or category for the discount.' };
  } else if (!blank(input.discountType) || !blank(input.discountValue)) {
    return { error: 'A Display Only promotion cannot carry a discount. Choose Actual Discount instead.' };
  }

  return {
    value: {
      title, description: description.trim(), section: input.section, promotionType: input.promotionType, bannerImage: blank(input.bannerImage) ? '' : input.bannerImage,
      cards, homepageHidden, products: [...new Set(products)], categories: [...new Set(categories.map((name) => name.trim()))], discountType, discountValue,
      startAt, endAt, isActive: input.isActive === undefined ? true : input.isActive, displayOrder, badgeText: badgeText.trim(),
    },
  };
}
