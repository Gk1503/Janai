import mongoose from 'mongoose';

const vendorPurchaseSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  vendorName: { type: String, trim: true, default: '' },
  purchaseDate: { type: Date, required: true },
  quantity: { type: Number, min: 0.001, required: true },
  unit: { type: String, required: true, trim: true },
  rate: { type: Number, min: 0, required: true },
  totalAmount: { type: Number, min: 0, required: true },
  invoiceNumber: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['Ordered', 'Received'], default: 'Ordered' },
  receivedQuantity: { type: Number, min: 0, default: 0 },
  receivedAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

vendorPurchaseSchema.index({ product: 1, vendor: 1, purchaseDate: -1 });

export default mongoose.model('VendorPurchase', vendorPurchaseSchema);
