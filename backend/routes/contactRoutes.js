import { Router } from 'express';
import { createContactMessage, listContactMessages } from '../controllers/contactController.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.post('/', createContactMessage);
router.get('/', requireAuth, requirePermission('contact:view'), listContactMessages);
export default router;
