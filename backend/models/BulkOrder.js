import mongoose from 'mongoose';
import { statusHistoryField } from '../utils/statusAudit.js';
import { BULK_STATUSES } from '../utils/bulkOrderWorkflow.js';

// Prices are set by staff only; totals are computed on the server (see utils/bulkOrderWorkflow.js).
const quotationSchema = new mongoose.Schema({
  items: [{ name: { type: String, required: true }, quantity: { type: Number, min: 1, required: true }, unit: { type: String, required: true }, unitPrice: { type: Number, min: 0, required: true }, lineTotal: { type: Number, min: 0, required: true }, _id: false }],
  deliveryCharge: { type: Number, min: 0, default: 0 },
  totalAmount: { type: Number, min: 0, required: true },
  validUntil: { type: Date, default: null },
  message: { type: String, trim: true, maxlength: 1000, default: '' },
  quotedAt: { type: Date, required: true },
  quotedByName: { type: String, default: '' },
}, { _id: false });

const bulkOrderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  organization: { type: String, trim: true, default: '' },
  orderType: { type: String, enum: ['Business', 'Office', 'Event', 'Party', 'Large Family', 'Other'], default: 'Business' },
  products: [{ product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, name: { type: String, required: true }, quantity: { type: Number, min: 1, required: true }, unit: { type: String, default: 'kg' } }],
  requiredDate: { type: Date, required: true },
  deliveryAddress: { type: String, required: true, trim: true },
  additionalRequirements: { type: String, trim: true, maxlength: 2000, default: '' },
  status: { type: String, enum: BULK_STATUSES, default: 'Pending' },
  // Absent until staff send a quotation.
  quotation: { type: quotationSchema, default: undefined },
  // Customer-visible note from the business (for example the reason a request was rejected).
  adminResponse: { type: new mongoose.Schema({ message: { type: String, trim: true, maxlength: 1000, default: '' }, at: { type: Date } }, { _id: false }), default: undefined },
  // Append-only audit trail of status changes; excluded from queries unless explicitly selected.
  statusHistory: statusHistoryField,
}, { timestamps: true });

export default mongoose.model('BulkOrder', bulkOrderSchema);
