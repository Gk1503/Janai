import { Router } from 'express';
import { createProduct, deleteProduct, getProduct, listProducts, updateProduct } from '../controllers/productController.js';
import { createPurchase, listPriceHistory, listPurchases, receivePurchase } from '../controllers/vendorController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();
router.get('/', listProducts);
router.get('/:id', getProduct);
router.post('/', requireAuth, requireAdmin, createProduct);
router.put('/:id', requireAuth, requireAdmin, updateProduct);
router.delete('/:id', requireAuth, requireAdmin, deleteProduct);

router.get('/:productId/vendors/:vendorId/price-history', requireAuth, requireAdmin, listPriceHistory);
router.get('/:productId/vendors/:vendorId/purchases', requireAuth, requireAdmin, listPurchases);
router.post('/:productId/vendors/:vendorId/purchases', requireAuth, requireAdmin, createPurchase);
router.patch('/:productId/vendors/:vendorId/purchases/:purchaseId/receive', requireAuth, requireAdmin, receivePurchase);
export default router;
