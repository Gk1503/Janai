import { Router } from 'express';
import { addAddress, adminLogin, changePassword, login, me, register, removeAddress, updateProfile } from '../controllers/authController.js';
import {
  resendDeliveryOtp, resendLoginOtp, sendDeliveryOtp, sendLoginOtp, verifyDeliveryOtp, verifyLoginOtp,
} from '../controllers/otpController.js';
import { requireAuth, requireAuthAllowingPasswordChange } from '../middleware/auth.js';
import { adminLoginLimiter } from '../utils/loginRateLimit.js';

const router = Router();
router.post('/register', register);
router.post('/login', login);
router.post('/admin-login', adminLoginLimiter, adminLogin);
router.post('/send-login-otp', sendLoginOtp);
router.post('/verify-login-otp', verifyLoginOtp);
router.post('/resend-login-otp', resendLoginOtp);
// Delivery staff sign-in: same OTP gateway and rate-limit shape as customer login, kept on a separate
// purpose (see models/LoginOtp.js) so the two can never verify each other.
router.post('/send-delivery-otp', sendDeliveryOtp);
router.post('/verify-delivery-otp', verifyDeliveryOtp);
router.post('/resend-delivery-otp', resendDeliveryOtp);
// /me and change-password stay reachable while a forced password change is pending.
router.get('/me', requireAuthAllowingPasswordChange, me);
router.post('/change-password', requireAuthAllowingPasswordChange, changePassword);
router.put('/me', requireAuth, updateProfile);
router.post('/addresses', requireAuth, addAddress);
router.delete('/addresses/:addressId', requireAuth, removeAddress);

export default router;
