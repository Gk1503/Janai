import mongoose from 'mongoose';

// Variation-level stock (Inventory foundation, Phase 2). A product with zero entries here is treated
// everywhere as having one implicit "Default" variation backed by the legacy top-level `stock`/`unit`
// fields below — see utils/productVariations.js, which is the ONLY place that distinction is resolved.
// Nothing here ever migrates or resets `stock`/`unit`; they remain the live source of truth until a
// product actually has a real variation.
const variationSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 60 },
  packDescription: { type: String, trim: true, default: '' },
  unit: { type: String, required: true, trim: true },
  stock: { type: Number, min: 0, default: 0 },
  minStockThreshold: { type: Number, min: 0, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const vendorSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: '' },
  // Optional link to a central Vendor record (backend/models/Vendor.js). Absent on every embedded
  // vendor created before this field existed, and still optional going forward — nothing here or in
  // productController.js requires it, so existing products, history and procurement are unaffected.
  vendorRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
  purchasePrice: { type: Number, min: 0, default: 0 },
  moq: { type: String, trim: true, default: '' },
  leadTime: { type: String, trim: true, default: '' },
  preferred: { type: Boolean, default: false },
  lastPurchasePrice: { type: Number, min: 0, default: null },
  lastPurchaseDate: { type: Date, default: null },
  notes: { type: String, trim: true, default: '' },
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 140 },
  category: { type: String, required: true, trim: true, index: true },
  subCategory: { type: String, trim: true, default: '' },
  description: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true, trim: true, default: 'kg' },
  images: { type: [String], default: [] },
  stock: { type: Number, min: 0, default: 0 },
  // Stock Management (Phase 2). The legacy, top-level counterpart to variations[].minStockThreshold —
  // lets a product with no real variations have a persistent, editable minimum, exactly like a real
  // variation does. Defaults to 0 ("never configured"), identical to a real variation's own default —
  // adding this field changes nothing for any existing product until an admin explicitly sets it;
  // `stock` itself is never touched by this addition.
  minStockThreshold: { type: Number, min: 0, default: 0 },
  rating: { type: Number, min: 0, max: 5, default: 4.7 },
  reviews: { type: Number, min: 0, default: 0 },
  preOrderAvailable: { type: Boolean, default: false },
  bulkAvailable: { type: Boolean, default: false },
  featured: { type: Boolean, default: false },
  // Customer-facing Minimum Order Quantity (Phase 6) — unrelated to vendors[].moq above, which is a
  // supplier's own procurement minimum. All three optional and nullable: absent/null means "no minimum
  // enforced", never a silent default — see utils/productVariations.js::effectiveMoq for the fallback
  // chain (bulk/pre-order fall back to normalMoq when unset; normalMoq absent means no minimum at all).
  // Every pre-Phase-6 product already satisfies this by having all three absent.
  normalMoq: { type: Number, min: 0, default: null },
  bulkMoq: { type: Number, min: 0, default: null },
  preOrderMoq: { type: Number, min: 0, default: null },
  vendors: { type: [vendorSchema], default: [] },
  // Optional, additive. Empty for every product until explicitly given real variations — see
  // utils/productVariations.js for how "no variations" falls back to the legacy stock/unit fields.
  variations: { type: [variationSchema], default: [] },
}, { timestamps: true });

productSchema.index({ name: 'text', description: 'text', category: 'text' });
export default mongoose.model('Product', productSchema);
