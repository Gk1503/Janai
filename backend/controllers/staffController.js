import mongoose from 'mongoose';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ROLE_PRESETS, sanitizePermissions, validatePermissionSet } from '../config/permissions.js';
import {
  normalizeLoginId, normalizeOptionalEmail, normalizeOptionalMobile, splitFullName, validateTemporaryPassword,
} from '../utils/staffValidation.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasPreset = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(ROLE_PRESETS, key);

const LEGACY_INDEX_MESSAGE = 'Another staff account without an email already exists and this database still has its legacy email index. Enter an email address for this account, or ask your developer to run "npm run migrate:user-indexes" once.';

// Safe projection of a staff account: never the password hash or any authentication secret.
export function toStaffDTO(user) {
  const plain = typeof user.toObject === 'function' ? user.toObject() : user;
  const creator = plain.createdBy && typeof plain.createdBy === 'object' && ('firstName' in plain.createdBy)
    ? { _id: String(plain.createdBy._id), name: `${plain.createdBy.firstName || ''} ${plain.createdBy.lastName || ''}`.trim() }
    : (plain.createdBy ? { _id: String(plain.createdBy), name: '' } : null);
  return {
    _id: String(plain._id),
    fullName: `${plain.firstName || ''} ${plain.lastName || ''}`.trim(),
    loginId: plain.adminId,
    email: plain.email,
    phone: plain.phone,
    preset: hasPreset(plain.staffRole) ? { key: plain.staffRole, label: ROLE_PRESETS[plain.staffRole].label } : { key: 'custom', label: ROLE_PRESETS.custom.label },
    permissions: sanitizePermissions(plain.permissions),
    isActive: plain.isActive !== false,
    mustChangePassword: Boolean(plain.mustChangePassword),
    createdAt: plain.createdAt,
    createdBy: creator,
    lastLoginAt: plain.lastLoginAt || null,
  };
}

// Only real staff accounts resolve here, so the owner and customers can never be reached through these endpoints.
async function findStaff(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return User.findOne({ _id: id, role: 'staff' });
}

function unsupportedFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  return Object.keys(body).filter((key) => !allowed.includes(key));
}

function duplicateMessage(error) {
  const key = Object.keys(error.keyPattern || error.keyValue || {})[0];
  if (key === 'adminId') return 'That login ID is already in use.';
  if (key === 'email') return error.keyValue && error.keyValue.email === null ? LEGACY_INDEX_MESSAGE : 'That email address is already in use.';
  return 'A record with that value already exists.';
}

async function saveOrConflict(res, user) {
  try {
    await user.save();
    return true;
  } catch (error) {
    if (error.code === 11000) {
      res.status(409).json({ message: duplicateMessage(error) });
      return false;
    }
    throw error;
  }
}

const badRequest = (res, message) => res.status(400).json({ message });

export const listStaff = asyncHandler(async (req, res) => {
  const filter = { role: 'staff' };
  if (req.query.status === 'active') filter.isActive = true;
  if (req.query.status === 'inactive') filter.isActive = false;
  if (hasPreset(req.query.preset)) filter.staffRole = req.query.preset;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ firstName: regex }, { lastName: regex }, { adminId: regex }];
  }
  const staff = await User.find(filter).populate('createdBy', 'firstName lastName').sort({ createdAt: -1 }).limit(500);
  res.json({ staff: staff.map(toStaffDTO), total: staff.length });
});

export const getStaff = asyncHandler(async (req, res) => {
  const user = await findStaff(req.params.id);
  if (!user) return res.status(404).json({ message: 'Staff account not found.' });
  await user.populate?.('createdBy', 'firstName lastName');
  return res.json({ staff: toStaffDTO(user) });
});

export const createStaff = asyncHandler(async (req, res) => {
  const unsupported = unsupportedFields(req.body, ['fullName', 'loginId', 'temporaryPassword', 'preset', 'email', 'phone', 'permissions']);
  if (unsupported.length) return badRequest(res, `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  const { fullName, loginId, temporaryPassword, preset, email, phone, permissions } = req.body;

  const name = splitFullName(fullName);
  if (name.error) return badRequest(res, name.error);
  const login = normalizeLoginId(loginId);
  if (login.error) return badRequest(res, login.error);
  const password = validateTemporaryPassword(temporaryPassword, login.value);
  if (password.error) return badRequest(res, password.error);
  if (!hasPreset(preset)) return badRequest(res, 'Choose a valid role preset.');
  const emailResult = normalizeOptionalEmail(email);
  if (emailResult.error) return badRequest(res, emailResult.error);
  const phoneResult = normalizeOptionalMobile(phone);
  if (phoneResult.error) return badRequest(res, phoneResult.error);

  // Start from the preset, or take the owner's explicit selection; always validated against the catalog.
  const chosen = permissions === undefined ? ROLE_PRESETS[preset].permissions : permissions;
  const validated = validatePermissionSet(chosen);
  if (!validated.ok) return badRequest(res, validated.error);

  if (await User.exists({ adminId: login.value })) return res.status(409).json({ message: 'That login ID is already in use.' });
  if (emailResult.value && await User.exists({ email: emailResult.value })) return res.status(409).json({ message: 'That email address is already in use.' });

  try {
    const user = await User.create({
      firstName: name.value.firstName,
      lastName: name.value.lastName,
      adminId: login.value,
      password: password.value, // hashed by the User model's pre-save hook
      email: emailResult.value,
      phone: phoneResult.value,
      role: 'staff',
      staffRole: preset,
      permissions: validated.permissions,
      isActive: true,
      mustChangePassword: true,
      createdBy: req.user._id, // from the authenticated owner, never the request body
    });
    return res.status(201).json({ staff: toStaffDTO(user), message: 'Staff account created. They must change the temporary password at first sign-in.' });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: duplicateMessage(error) });
    throw error;
  }
});

export const updateStaff = asyncHandler(async (req, res) => {
  const unsupported = unsupportedFields(req.body, ['fullName', 'email', 'phone', 'preset']);
  if (unsupported.length) return badRequest(res, unsupported.includes('loginId') ? 'The login ID cannot be changed.' : `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  const user = await findStaff(req.params.id);
  if (!user) return res.status(404).json({ message: 'Staff account not found.' });
  const { fullName, email, phone, preset } = req.body;

  if (fullName !== undefined) {
    const name = splitFullName(fullName);
    if (name.error) return badRequest(res, name.error);
    user.firstName = name.value.firstName;
    user.lastName = name.value.lastName;
  }
  if (email !== undefined) {
    const result = normalizeOptionalEmail(email);
    if (result.error) return badRequest(res, result.error);
    if (result.value) {
      const taken = await User.findOne({ email: result.value });
      if (taken && String(taken._id) !== String(user._id)) return res.status(409).json({ message: 'That email address is already in use.' });
    }
    user.email = result.value;
  }
  if (phone !== undefined) {
    const result = normalizeOptionalMobile(phone);
    if (result.error) return badRequest(res, result.error);
    user.phone = result.value;
  }
  if (preset !== undefined) {
    if (!hasPreset(preset)) return badRequest(res, 'Choose a valid role preset.');
    user.staffRole = preset; // label only; permissions change through the permissions endpoint
  }
  if (!(await saveOrConflict(res, user))) return undefined;
  return res.json({ staff: toStaffDTO(user) });
});

export const updateStaffPermissions = asyncHandler(async (req, res) => {
  const unsupported = unsupportedFields(req.body, ['permissions', 'preset']);
  if (unsupported.length) return badRequest(res, `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  if (req.body.permissions === undefined) return badRequest(res, 'Permissions are required.');
  const validated = validatePermissionSet(req.body.permissions);
  if (!validated.ok) return badRequest(res, validated.error);
  if (req.body.preset !== undefined && !hasPreset(req.body.preset)) return badRequest(res, 'Choose a valid role preset.');
  const user = await findStaff(req.params.id);
  if (!user) return res.status(404).json({ message: 'Staff account not found.' });
  user.permissions = validated.permissions;
  if (req.body.preset !== undefined) user.staffRole = req.body.preset;
  await user.save();
  // Access follows from the stored list on the next request; no token invalidation is needed.
  return res.json({ staff: toStaffDTO(user) });
});

export const updateStaffStatus = asyncHandler(async (req, res) => {
  const unsupported = unsupportedFields(req.body, ['isActive']);
  if (unsupported.length) return badRequest(res, `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  if (typeof req.body.isActive !== 'boolean') return badRequest(res, 'isActive must be true or false.');
  const user = await findStaff(req.params.id);
  if (!user) return res.status(404).json({ message: 'Staff account not found.' });
  user.isActive = req.body.isActive;
  await user.save();
  return res.json({ staff: toStaffDTO(user), message: req.body.isActive ? 'Account reactivated.' : 'Account deactivated. Their access is blocked immediately.' });
});

export const resetStaffPassword = asyncHandler(async (req, res) => {
  const unsupported = unsupportedFields(req.body, ['temporaryPassword']);
  if (unsupported.length) return badRequest(res, `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.`);
  const user = await User.findOne({ _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : null, role: 'staff' });
  if (!user) return res.status(404).json({ message: 'Staff account not found.' });
  const password = validateTemporaryPassword(req.body.temporaryPassword, user.adminId);
  if (password.error) return badRequest(res, password.error);
  user.password = password.value; // hashed by the pre-save hook; the plain value is never stored or returned
  user.mustChangePassword = true;
  await user.save();
  return res.json({ staff: toStaffDTO(user), message: 'Password reset. They must choose a new password at next sign-in.' });
});
