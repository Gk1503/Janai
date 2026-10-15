import { Router } from 'express';
import {
  createStaff, getStaff, listStaff, resetStaffPassword, updateStaff, updateStaffPermissions, updateStaffStatus,
} from '../controllers/staffController.js';

// Mounted in adminRoutes.js behind requireAuth, requirePanelAccess and requireOwner.
const router = Router();
router.get('/', listStaff);
router.post('/', createStaff);
router.get('/:id', getStaff);
router.patch('/:id', updateStaff);
router.patch('/:id/permissions', updateStaffPermissions);
router.patch('/:id/status', updateStaffStatus);
router.post('/:id/reset-password', resetStaffPassword);
export default router;
