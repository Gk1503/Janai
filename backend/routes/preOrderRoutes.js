import { Router } from 'express';
import { cancelPreOrder, createOrder, getOrder, listOrders } from '../controllers/orderController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.post('/', createOrder('preorder'));
router.get('/', (req, res, next) => {
	req.query.type = 'preorder';
	return listOrders(req, res, next);
});
router.get('/:id', getOrder);
router.put('/:id/cancel', cancelPreOrder);
export default router;
