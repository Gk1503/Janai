import { Router } from 'express';
import { getGeneralSettings, getOrderSettings, updateGeneralSettings, updateOrderSettings } from '../controllers/settingsController.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';

const router = Router();
// Public read: business name/logo/contact/address/hours are storefront information, not a secret.
router.get('/general', getGeneralSettings);
// Only an active owner/admin account may write business settings.
router.patch('/general', requireAuth, requireOwner, updateGeneralSettings);

// Public read: cart/checkout need the current delivery fee and minimum-order rule before sign-in too.
router.get('/orders-delivery', getOrderSettings);
router.patch('/orders-delivery', requireAuth, requireOwner, updateOrderSettings);

export default router;
