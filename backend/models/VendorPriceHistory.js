import mongoose from 'mongoose';

const vendorPriceHistorySchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  vendorName: { type: String, trim: true, default: '' },
  previousPrice: { type: Number, min: 0, required: true },
  newPrice: { type: Number, min: 0, required: true },
  reason: { type: String, trim: true, default: '' },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

vendorPriceHistorySchema.index({ product: 1, vendor: 1, createdAt: -1 });

export default mongoose.model('VendorPriceHistory', vendorPriceHistorySchema);
