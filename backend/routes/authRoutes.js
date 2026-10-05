import { Router } from 'express';
import { addAddress, adminLogin, login, me, register, removeAddress, updateProfile } from '../controllers/authController.js';
import { resendLoginOtp, sendLoginOtp, verifyLoginOtp } from '../controllers/otpController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.post('/register', register);
router.post('/login', login);
router.post('/admin-login', adminLogin);
router.post('/send-login-otp', sendLoginOtp);
router.post('/verify-login-otp', verifyLoginOtp);
router.post('/resend-login-otp', resendLoginOtp);
router.get('/me', requireAuth, me);
router.put('/me', requireAuth, updateProfile);
router.post('/addresses', requireAuth, addAddress);
router.delete('/addresses/:addressId', requireAuth, removeAddress);

export default router;
