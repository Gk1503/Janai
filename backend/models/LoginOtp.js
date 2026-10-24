import mongoose from 'mongoose';

// Two independent OTP flows share this collection: a customer signing in, and a delivery staff member
// signing in. `purpose` keeps them from ever being interchangeable — a code sent for one can never
// verify the other, even if both happen to use the same mobile number.
export const OTP_PURPOSES = { CUSTOMER_LOGIN: 'customer_login', DELIVERY_LOGIN: 'delivery_login' };

// Maps a (mobile, purpose) pair to the otp_id returned by the SMS gateway, so the code can be verified
// later. See config/loginOtpIndexes.js for the one-off migration this compound index needs on a
// database created before delivery OTP existed (back when `mobile` alone was the unique key).
const loginOtpSchema = new mongoose.Schema({
  mobile: { type: String, required: true },
  purpose: { type: String, enum: Object.values(OTP_PURPOSES), required: true },
  otpId: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

loginOtpSchema.index({ mobile: 1, purpose: 1 }, { unique: true, name: 'mobile_purpose_unique' });

export default mongoose.model('LoginOtp', loginOtpSchema);
