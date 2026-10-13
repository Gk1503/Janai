import mongoose from 'mongoose';

// Maps a mobile number to the otp_id returned by the SMS gateway, so the code can be verified later.
const loginOtpSchema = new mongoose.Schema({
  mobile: { type: String, required: true, unique: true },
  otpId: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

export default mongoose.model('LoginOtp', loginOtpSchema);
