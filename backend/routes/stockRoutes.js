import { Router } from 'express';
import { adjustStock, listStockMovementActors, listStockMovements, listStockRows, updateStockThreshold } from '../controllers/stockController.js';
import { getProductWiseSummary, getStaffAdjustmentSummary, getStockMovementSummary } from '../controllers/stockReportController.js';
import { requireAuth, requireAnyPermission, requirePermission } from '../middleware/auth.js';

const router = Router();
// Same broad view gate as the Inventory Dashboard — viewing stock and viewing threshold values is not
// the sensitive action here; editing a threshold is, and is gated separately, more narrowly, below.
router.get('/', requireAuth, requireAnyPermission('products:view', 'products:manage', 'inventory:update'), listStockRows);
// products:manage only — inventory:update alone (stock-quantity-only staff) may view but never edit a
// threshold; see stockController.js's own comment for why this isn't extended to that permission.
router.patch('/:productId/variations/:variationId/threshold', requireAuth, requirePermission('products:manage'), updateStockThreshold);
// Manual Stock Adjustments (Phase 3). Either permission that could already change raw stock before this
// phase (inventory:update via the old PUT /products/:id path, products:manage via the full product
// editor) may adjust it here — unlike the threshold endpoint above, this is not newly narrowed.
router.post('/:productId/variations/:variationId/adjust', requireAuth, requireAnyPermission('products:manage', 'inventory:update'), adjustStock);
// Same broad view gate as the listing above — this ledger carries no supplier/purchase-price data.
// '/movements/actors' is a literal path, registered before '/movements/:something' would ever need to
// exist (no such param route exists here, so there is no ordering hazard — see vendorRoutes.js's own
// /analytics-before-/:id comment for the pattern this mirrors when one ever is needed).
router.get('/movements/actors', requireAuth, requireAnyPermission('products:view', 'products:manage', 'inventory:update'), listStockMovementActors);
router.get('/movements', requireAuth, requireAnyPermission('products:view', 'products:manage', 'inventory:update'), listStockMovements);
// Inventory Movement Summary (Phase 7.1) — same broad view gate as every other stock endpoint above;
// this is a quantity-only aggregation with no supplier-cost data of any kind.
router.get('/reports/summary', requireAuth, requireAnyPermission('products:view', 'products:manage', 'inventory:update'), getStockMovementSummary);
// Staff Adjustment Report (Phase 7.2) — same gate; manual-only, no supplier-cost data (see
// stockReportController.js::getStaffAdjustmentSummary for the manual-only filtering).
router.get('/reports/staff', requireAuth, requireAnyPermission('products:view', 'products:manage', 'inventory:update'), getStaffAdjustmentSummary);
// Product-wise Historical Inventory Report (Phase 7.3) — same gate; opening/closing are always
// unavailable (see stockReportController.js::getProductWiseSummary), no supplier-cost data.
router.get('/reports/products', requireAuth, requireAnyPermission('products:view', 'products:manage', 'inventory:update'), getProductWiseSummary);

export default router;
