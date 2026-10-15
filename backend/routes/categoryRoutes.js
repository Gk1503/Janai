import { Router } from 'express';
import { createCategory, deleteCategory, listCategories, updateCategory } from '../controllers/categoryController.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.get('/', listCategories);
router.post('/', requireAuth, requirePermission('categories:manage'), createCategory);
router.put('/:id', requireAuth, requirePermission('categories:manage'), updateCategory);
router.delete('/:id', requireAuth, requirePermission('categories:manage'), deleteCategory);
export default router;
