import mongoose from 'mongoose';

const bulkOrderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  organization: { type: String, trim: true, default: '' },
  orderType: { type: String, enum: ['Business', 'Office', 'Event', 'Party', 'Large Family', 'Other'], default: 'Business' },
  products: [{ name: { type: String, required: true }, quantity: { type: Number, min: 1, required: true }, unit: { type: String, default: 'kg' } }],
  requiredDate: { type: Date, required: true },
  deliveryAddress: { type: String, required: true, trim: true },
  additionalRequirements: { type: String, trim: true, maxlength: 2000, default: '' },
  status: { type: String, enum: ['Pending', 'Reviewing', 'Approved', 'Rejected', 'Completed'], default: 'Pending' },
}, { timestamps: true });

export default mongoose.model('BulkOrder', bulkOrderSchema);
