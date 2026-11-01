import mongoose from 'mongoose';

// Lowercase, trimmed, whitespace-collapsed form of a vendor name — used only to find
// case-insensitive duplicate *candidates* to surface to the owner. Never used to enforce
// uniqueness: two distinct real-world vendors can legitimately share a name (e.g. the same
// common name in different areas), so matching names are a signal for review, not a merge.
export function normalizeVendorName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const vendorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 140 },
  // Derived from `name` by the pre('validate') hook below — never supplied directly, so it is not
  // itself `required`. That hook runs on the async validate()/save() path (Vendor.create, .save()),
  // which is how every real write happens; it does not run under the synchronous validateSync().
  normalizedName: { type: String, index: true },
  contactPerson: { type: String, trim: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// No `next` parameter: Mongoose 9's Kareem middleware runner inspects function arity, and a callback
// declared here would need to be invoked — this hook has nothing async to wait on, so it's plain sync.
vendorSchema.pre('validate', function setNormalizedName() {
  this.normalizedName = normalizeVendorName(this.name);
});

export default mongoose.model('Vendor', vendorSchema);
