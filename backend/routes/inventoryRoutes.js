import { Router } from 'express';
import { getInventoryOverview } from '../controllers/inventoryController.js';
import { requireAnyPermission, requireAuth } from '../middleware/auth.js';

const router = Router();
// Same broad "can see products in some capacity" set already used to gate the product catalog itself;
// supplier purchase values within the response are separately masked for an inventory:update-only
// viewer (see inventoryController.js), mirroring canViewSupplierCosts everywhere else in this app.
router.get('/overview', requireAuth, requireAnyPermission('products:view', 'products:manage', 'inventory:update'), getInventoryOverview);

export default router;
