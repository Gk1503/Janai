import { Router } from 'express';
import { addAddress, adminLogin, changePassword, login, me, register, removeAddress, updateProfile } from '../controllers/authController.js';
import { resendLoginOtp, sendLoginOtp, verifyLoginOtp } from '../controllers/otpController.js';
import { requireAuth, requireAuthAllowingPasswordChange } from '../middleware/auth.js';
import { adminLoginLimiter } from '../utils/loginRateLimit.js';

const router = Router();
router.post('/register', register);
router.post('/login', login);
router.post('/admin-login', adminLoginLimiter, adminLogin);
router.post('/send-login-otp', sendLoginOtp);
router.post('/verify-login-otp', verifyLoginOtp);
router.post('/resend-login-otp', resendLoginOtp);
// /me and change-password stay reachable while a forced password change is pending.
router.get('/me', requireAuthAllowingPasswordChange, me);
router.post('/change-password', requireAuthAllowingPasswordChange, changePassword);
router.put('/me', requireAuth, updateProfile);
router.post('/addresses', requireAuth, addAddress);
router.delete('/addresses/:addressId', requireAuth, removeAddress);

export default router;
