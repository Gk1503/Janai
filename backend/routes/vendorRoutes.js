import { Router } from 'express';
import { createVendor, deactivateVendor, getVendor, getVendorPriceHistory, getVendorProducts, getVendorPurchases, listVendors, updateVendor } from '../controllers/adminVendorController.js';
import { exportVendorPurchases, getVendorAnalytics } from '../controllers/vendorAnalyticsController.js';
import { requireAnyPermission, requireAuth } from '../middleware/auth.js';

const router = Router();
// Same supplier-cost permission model as the existing per-product vendor routes
// (productRoutes.js's vendorRead): the owner (role 'admin') implicitly holds every permission, staff
// need products:manage or inventory:update, and everyone else (other staff, customers, delivery-only
// accounts) is rejected with 403.
const vendorAccess = requireAnyPermission('products:manage', 'inventory:update');

router.get('/', requireAuth, vendorAccess, listVendors);

// Vendor Analytics & Reports (Stage 8). Registered BEFORE '/:id' below — Express would otherwise
// match '/analytics' as if "analytics" were a vendor id, since '/:id' matches any single segment.
router.get('/analytics', requireAuth, vendorAccess, getVendorAnalytics);
router.get('/analytics/export', requireAuth, vendorAccess, exportVendorPurchases);

router.get('/:id', requireAuth, vendorAccess, getVendor);
router.post('/', requireAuth, vendorAccess, createVendor);
router.put('/:id', requireAuth, vendorAccess, updateVendor);
router.patch('/:id/deactivate', requireAuth, vendorAccess, deactivateVendor);

// Vendor detail profile (Stage 4). Same permission model as above — this is still supplier-cost data.
router.get('/:id/products', requireAuth, vendorAccess, getVendorProducts);
router.get('/:id/purchases', requireAuth, vendorAccess, getVendorPurchases);
router.get('/:id/price-history', requireAuth, vendorAccess, getVendorPriceHistory);

export default router;
