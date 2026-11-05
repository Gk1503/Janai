import mongoose from 'mongoose';

export const PROMOTION_SECTIONS = ['best_deals', 'seasonal_deals'];
export const PROMOTION_TYPES = ['display_only', 'actual_discount'];
export const DISCOUNT_TYPES = ['percentage', 'fixed'];

// One collection serves both sections ("Best Deals" and "Seasonal Deals"). Whether a section is switched on
// for customers is NOT stored here: it lives in Settings.deals, so turning a section off never touches the
// promotions themselves.
// Seasonal Deals only: up to six small campaign cards shown in a grid over the section's background image.
// A card may link to one product or one category; with neither it is not clickable. Order is array order.
export const MAX_CARDS = 6;
const cardSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 40 },
  image: { type: String, default: '' },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  category: { type: String, trim: true, default: null },
}, { _id: false });

const promotionSchema = new mongoose.Schema({
  // Optional: customers see a section-level fallback heading ('Best Deals' / 'Seasonal Deals') when it is blank.
  title: { type: String, trim: true, maxlength: 80, default: '' },
  description: { type: String, trim: true, maxlength: 300, default: '' },
  section: { type: String, enum: PROMOTION_SECTIONS, required: true },
  promotionType: { type: String, enum: PROMOTION_TYPES, required: true, default: 'display_only' },
  // Same storage pattern as Product.images / Settings.general.logo: a base64 data URL, an app path or a URL.
  // For Seasonal Deals this is the campaign's Background Image (older promotions keep working unchanged).
  bannerImage: { type: String, default: '' },
  products: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
  cards: { type: [cardSchema], default: [] },
  // Seasonal Deals: products of this campaign hidden from the homepage banner (they stay in the campaign and on the
  // Seasonal Deals page). Empty by default, so every product starts visible; banner order follows `products`.
  homepageHidden: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
  // Category names exactly as stored on Product.category (products reference their category by name).
  categories: { type: [String], default: [] },
  // Only meaningful for actual_discount; null for display_only. The discount is always calculated on the
  // server from these two values and the product's current price.
  discountType: { type: String, enum: [...DISCOUNT_TYPES, null], default: null },
  discountValue: { type: Number, min: 0, default: null },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  displayOrder: { type: Number, min: 0, default: 0 },
  badgeText: { type: String, trim: true, maxlength: 30, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Public queries filter on section + active flag + date window, then sort by display order.
promotionSchema.index({ section: 1, isActive: 1, startAt: 1, endAt: 1 }, { name: 'section_active_window' });
promotionSchema.index({ section: 1, displayOrder: 1 }, { name: 'section_order' });

export default mongoose.model('Promotion', promotionSchema);
