import { Router } from 'express';
import {
  createPromotion, deletePromotion, getDealSettings, getPromotion, listDealProducts, listPromotions, previewPromotion,
  reorderPromotions, setPromotionActive, updateDealSettings, updatePromotion, updatePromotionProducts,
} from '../controllers/dealsController.js';

// Mounted in adminRoutes.js behind requireAuth, requirePanelAccess and requireOwner: managing promotions is
// owner-only, like the Settings it is configured alongside.
const router = Router();
router.get('/settings', getDealSettings);
router.patch('/settings', updateDealSettings);
router.put('/reorder', reorderPromotions);
router.get('/products', listDealProducts);
router.get('/', listPromotions);
router.post('/', createPromotion);
router.get('/:id', getPromotion);
router.put('/:id', updatePromotion);
router.delete('/:id', deletePromotion);
router.patch('/:id/active', setPromotionActive);
router.post('/:id/products', updatePromotionProducts);
router.get('/:id/preview', previewPromotion);
export default router;
