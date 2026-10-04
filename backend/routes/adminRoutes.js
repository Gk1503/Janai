import { Router } from 'express';
import { listUsers, updateUserRole } from '../controllers/adminController.js';
import { listBulkOrders, updateBulkOrderStatus } from '../controllers/bulkOrderController.js';
import { listOrders, updateOrderStatus } from '../controllers/orderController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireAdmin);
router.get('/users', listUsers);
router.patch('/users/:id/role', updateUserRole);
router.get('/orders', listOrders);
router.get('/preorders', (req, res, next) => {
	req.query.type = 'preorder';
	return listOrders(req, res, next);
});
router.patch('/orders/:id/status', updateOrderStatus);
router.get('/bulk-orders', listBulkOrders);
router.patch('/bulk-orders/:id/status', updateBulkOrderStatus);
export default router;
