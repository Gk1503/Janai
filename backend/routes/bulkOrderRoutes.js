import { Router } from 'express';
import { createBulkOrder, getBulkOrder, listBulkOrders, updateBulkOrderStatus } from '../controllers/bulkOrderController.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.post('/', createBulkOrder);
router.get('/', requireAuth, listBulkOrders);
router.get('/:id', requireAuth, getBulkOrder);
router.patch('/:id/status', requireAuth, requirePermission('bulk:update'), updateBulkOrderStatus);
export default router;
