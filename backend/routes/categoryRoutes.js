import { Router } from 'express';
import { createCategory, deleteCategory, listCategories, updateCategory } from '../controllers/categoryController.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();
router.get('/', listCategories);
router.post('/', requireAuth, requireAdmin, createCategory);
router.put('/:id', requireAuth, requireAdmin, updateCategory);
router.delete('/:id', requireAuth, requireAdmin, deleteCategory);
export default router;
