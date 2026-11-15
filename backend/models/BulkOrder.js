import mongoose from 'mongoose';
import { statusHistoryField } from '../utils/statusAudit.js';

const bulkOrderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  organization: { type: String, trim: true, default: '' },
  orderType: { type: String, enum: ['Business', 'Office', 'Event', 'Party', 'Large Family', 'Other'], default: 'Business' },
  products: [{
    name: { type: String, required: true },
    quantity: { type: Number, min: 1, required: true },
    unit: { type: String, default: 'kg' },
    // Inventory foundation (Phase 2). Optional and admin-set only, after the quote is submitted — the
    // customer's free-text name/quantity/unit above is never replaced or reinterpreted automatically
    // (this project never fuzzy-matches a name to a real record). An admin must explicitly resolve a
    // line to a real product/variation (see bulkOrderController.js::resolveBulkOrderItems) before
    // approval can deduct its stock; a line left unresolved blocks approval rather than being skipped.
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    variationId: { type: String, default: null },
  }],
  requiredDate: { type: Date, required: true },
  deliveryAddress: { type: String, required: true, trim: true },
  additionalRequirements: { type: String, trim: true, maxlength: 2000, default: '' },
  status: { type: String, enum: ['Pending', 'Reviewing', 'Approved', 'Rejected', 'Completed'], default: 'Pending' },
  // Inventory foundation (Phase 2). Same exactly-once claim pattern as Order — see that model's own
  // comment. Deduction happens on the Approved transition; restoration happens if an Approved request is
  // later moved to Rejected (there is no separate "Cancelled" status on bulk requests).
  stockDeductedAt: { type: Date, default: null },
  stockRestoredAt: { type: Date, default: null },
  // Append-only audit trail of status changes; excluded from queries unless explicitly selected.
  statusHistory: statusHistoryField,
}, { timestamps: true });

export default mongoose.model('BulkOrder', bulkOrderSchema);
