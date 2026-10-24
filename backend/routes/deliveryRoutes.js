import { Router } from 'express';
import { listMyDeliveryOrders, updateMyDeliveryOrderStatus } from '../controllers/deliveryController.js';
import { requireAuthAllowingPasswordChange, requirePermission } from '../middleware/auth.js';

const router = Router();
// Rider-only endpoints, deliberately separate from /admin/delivery/* (routes/adminRoutes.js), which is
// untouched by this feature.
// requireAuthAllowingPasswordChange, not requireAuth: a delivery staff account signed in purely by OTP
// never sets or changes a password, so it must never be blocked behind the forced-password-change gate
// that exists for the password-login flows (adminLogin). Permission checks below still apply in full.
router.use(requireAuthAllowingPasswordChange);
router.get('/my-orders', requirePermission('delivery:view'), listMyDeliveryOrders);
router.patch('/my-orders/:id/status', requirePermission('delivery:update'), updateMyDeliveryOrderStatus);

export default router;
