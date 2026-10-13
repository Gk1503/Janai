import mongoose from 'mongoose';

const vendorSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: '' },
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
  rating: { type: Number, min: 0, max: 5, default: 4.7 },
  reviews: { type: Number, min: 0, default: 0 },
  preOrderAvailable: { type: Boolean, default: false },
  bulkAvailable: { type: Boolean, default: false },
  featured: { type: Boolean, default: false },
  vendors: { type: [vendorSchema], default: [] },
}, { timestamps: true });

productSchema.index({ name: 'text', description: 'text', category: 'text' });
export default mongoose.model('Product', productSchema);
