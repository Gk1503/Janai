import { Router } from 'express';
import { createProduct, deleteProduct, getProduct, listProducts, updateProduct } from '../controllers/productController.js';
import { createPurchase, listPriceHistory, listPurchases, receivePurchase } from '../controllers/vendorController.js';
import { optionalAuth, requireAnyPermission, requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
// optionalAuth: supplier cost data is only included for the owner or staff with products:view.
router.get('/', optionalAuth, listProducts);
router.get('/:id', optionalAuth, getProduct);
router.post('/', requireAuth, requirePermission('products:manage'), createProduct);
// Staff with only inventory:update may send { stock } alone; the controller enforces that.
router.put('/:id', requireAuth, requireAnyPermission('products:manage', 'inventory:update'), updateProduct);
router.delete('/:id', requireAuth, requirePermission('products:manage'), deleteProduct);

const vendorRead = requireAnyPermission('products:manage', 'inventory:update');
router.get('/:productId/vendors/:vendorId/price-history', requireAuth, vendorRead, listPriceHistory);
router.get('/:productId/vendors/:vendorId/purchases', requireAuth, vendorRead, listPurchases);
router.post('/:productId/vendors/:vendorId/purchases', requireAuth, requirePermission('inventory:update'), createPurchase);
router.patch('/:productId/vendors/:vendorId/purchases/:purchaseId/receive', requireAuth, requirePermission('inventory:update'), receivePurchase);
export default router;
