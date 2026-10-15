import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const addressSchema = new mongoose.Schema({
  label: { type: String, trim: true, default: 'Home' },
  recipient: { type: String, trim: true },
  phone: { type: String, trim: true },
  house: { type: String, trim: true, default: '' },
  street: { type: String, required: true, trim: true },
  landmark: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  state: { type: String, trim: true, default: '' },
  postalCode: { type: String, required: true, trim: true },
  isDefault: { type: Boolean, default: false },
});

function isNotStaff() {
  return this.role !== 'staff';
}

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true, maxlength: 60 },
  // Staff accounts are managed by the owner and may have only a single name, no email and no mobile number.
  lastName: { type: String, required: isNotStaff, trim: true, maxlength: 60, default: '' },
  // Uniqueness comes from the partial index declared below, so staff without an email never collide.
  email: { type: String, required: isNotStaff, lowercase: true, trim: true },
  phone: { type: String, required: isNotStaff, trim: true, index: true },
  adminId: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
  password: { type: String, required: true, select: false },
  // 'admin' is the single owner account; 'staff' accounts are created by the owner.
  role: { type: String, enum: ['customer', 'admin', 'staff'], default: 'customer' },
  // Documents created before these fields existed read as active with no forced password change.
  isActive: { type: Boolean, default: true },
  // Only meaningful for role 'staff'; see config/permissions.js. Never written from customer-facing endpoints.
  permissions: { type: [String], default: [] },
  staffRole: { type: String, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  mustChangePassword: { type: Boolean, default: false },
  lastLoginAt: { type: Date },
  addresses: { type: [addressSchema], default: [] },
}, { timestamps: true });

// Email is unique only where one is present. A database created before this change may still hold the
// legacy non-partial `email_1` index; see config/userIndexes.js and `npm run migrate:user-indexes`.
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } }, name: 'email_unique_when_present' });

userSchema.pre('save', async function hashPassword() {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const user = this.toObject();
  delete user.password;
  delete user.__v;
  return user;
};

export default mongoose.model('User', userSchema);
