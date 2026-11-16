import { Router } from 'express';
import { publicDeals } from '../controllers/dealsController.js';

// Public, read-only. Each endpoint returns nothing unless its section is switched on, and then only live
// promotions (active flag on, inside the date window).
const router = Router();
router.get('/best-deals', publicDeals('best_deals'));
router.get('/seasonal-deals', publicDeals('seasonal_deals'));
export default router;
