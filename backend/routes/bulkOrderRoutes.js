import { Router } from 'express';
import { cancelBulkOrder, createBulkOrder, getBulkOrder, listBulkOrders, updateBulkOrderStatus } from '../controllers/bulkOrderController.js';
import { optionalAuth, requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
// optionalAuth: guests may still submit, but a signed-in customer's request is linked to their account.
router.post('/', optionalAuth, createBulkOrder);
router.get('/', requireAuth, listBulkOrders);
router.get('/:id', requireAuth, getBulkOrder);
router.put('/:id/cancel', requireAuth, cancelBulkOrder);
router.patch('/:id/status', requireAuth, requirePermission('bulk:update'), updateBulkOrderStatus);
export default router;
