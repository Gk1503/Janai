import { Router } from 'express';
import { exportReport, reportHandler } from '../controllers/reportController.js';

// Mounted in adminRoutes.js behind requireAuth, requirePanelAccess and requireOwner: reports are
// owner-only, the same rule the Reports sidebar item already follows.
const router = Router();
router.get('/export', exportReport);
for (const section of ['overview', 'sales', 'orders', 'products', 'customers', 'preorders', 'bulk', 'inventory']) {
  router.get(`/${section}`, reportHandler(section));
}
export default router;
