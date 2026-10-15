import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import { hasPermission } from '../config/permissions.js';

// allowPasswordChange lets the few routes a user needs to finish a forced password change through.
function authenticate({ allowPasswordChange = false } = {}) {
  return asyncHandler(async (req, res, next) => {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(payload.sub);
      if (!user) return res.status(401).json({ message: 'Your session is no longer valid.' });
      // Checked against the database on every request, so deactivation takes effect immediately.
      if (user.isActive === false) return res.status(401).json({ message: 'This account has been deactivated.' });
      if (user.mustChangePassword && !allowPasswordChange) return res.status(403).json({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your temporary password to continue.' });
      req.user = user;
      return next();
    } catch (error) {
      return res.status(401).json({ message: error.name === 'TokenExpiredError' ? 'Your session expired. Please sign in again.' : 'Invalid authentication token.' });
    }
  });
}

export const requireAuth = authenticate();
export const requireAuthAllowingPasswordChange = authenticate({ allowPasswordChange: true });

// For public routes whose response differs for privileged users. A missing, invalid, deactivated or
// password-change-pending session is simply treated as anonymous.
export const optionalAuth = asyncHandler(async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (user && user.isActive !== false && !user.mustChangePassword) req.user = user;
  } catch {
    // anonymous
  }
  return next();
});

// Owner or staff; customers are rejected. Individual routes then require a specific permission.
export function requirePanelAccess(req, res, next) {
  if (!['admin', 'staff'].includes(req.user?.role)) return res.status(403).json({ message: 'Administrator access is required.' });
  return next();
}

const forbidden = (res) => res.status(403).json({ message: 'You do not have permission to do this.' });

// Permissions are evaluated against the user loaded from the database on this request.
export function requirePermission(permission) {
  return (req, res, next) => (hasPermission(req.user, permission) ? next() : forbidden(res));
}

export function requireAnyPermission(...permissions) {
  return (req, res, next) => (permissions.some((permission) => hasPermission(req.user, permission)) ? next() : forbidden(res));
}

// The owner is the only account with role 'admin'.
export function requireOwner(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Only the owner can do this.' });
  return next();
}
