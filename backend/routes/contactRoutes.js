import { Router } from 'express';
import { createContactMessage, listContactMessages } from '../controllers/contactController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();
router.post('/', createContactMessage);
router.get('/', requireAuth, requireAdmin, listContactMessages);
export default router;
