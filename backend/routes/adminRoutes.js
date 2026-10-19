import { Router } from 'express';
import { getCustomerDetail, getCustomerStats, listUsers, updateUserRole } from '../controllers/adminController.js';
import { listAdminBulkOrders, updateAdminBulkOrderStatus } from '../controllers/bulkOrderController.js';
import { assignDeliveryOrder, listDeliveryOrders, listEligibleDeliveryStaff } from '../controllers/deliveryController.js';
import { listAdminOrders, updateOrderStatus } from '../controllers/orderController.js';
import { requireAnyPermission, requireAuth, requireOwner, requirePanelAccess, requirePermission } from '../middleware/auth.js';
import staffRoutes from './staffRoutes.js';

const router = Router();
// Owner or staff only; each route below then needs its own permission (order-type checks continue in the controllers).
router.use(requireAuth, requirePanelAccess);
// Staff & Access: owner only, enforced here once for every staff endpoint.
router.use('/staff', requireOwner, staffRoutes);
router.get('/users', requirePermission('customers:view'), listUsers);
router.get('/customers/stats', requirePermission('customers:view'), getCustomerStats);
router.get('/customers/:id', requirePermission('customers:view'), getCustomerDetail);
router.patch('/users/:id/role', requireOwner, updateUserRole);
router.get('/orders', requireAnyPermission('orders:view', 'preorders:view', 'bulk:view'), listAdminOrders);
router.get('/preorders', requirePermission('preorders:view'), (req, res, next) => {
	req.query.type = 'preorder';
	return listAdminOrders(req, res, next);
});
// delivery:update is included here so delivery-only staff can reach the handler at all; the handler
// itself still restricts them to exactly the preparing -> out_for_delivery -> delivered steps.
router.patch('/orders/:id/status', requireAnyPermission('orders:update_status', 'preorders:update', 'bulk:update', 'delivery:update'), updateOrderStatus);
router.get('/bulk-orders', requirePermission('bulk:view'), listAdminBulkOrders);
router.patch('/bulk-orders/:id/status', requirePermission('bulk:update'), updateAdminBulkOrderStatus);
router.get('/delivery/orders', requirePermission('delivery:view'), listDeliveryOrders);
router.get('/delivery/staff', requirePermission('delivery:view'), listEligibleDeliveryStaff);
router.patch('/delivery/orders/:id/assign', requirePermission('delivery:update'), assignDeliveryOrder);
export default router;
