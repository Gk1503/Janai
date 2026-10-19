import bcrypt from 'bcrypt';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendAuth } from '../utils/token.js';
import { clearAdminLoginFailures, recordAdminLoginFailure } from '../utils/loginRateLimit.js';

export const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password, confirmPassword } = req.body;
  if (![firstName, lastName, phone, password].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Complete all required fields.' });
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  if (password !== confirmPassword) return res.status(400).json({ message: 'Passwords do not match.' });
  // Email is optional for customers (mobile OTP is the primary sign-in method); when given, it is still
  // validated and must be unique, exactly as before.
  const trimmedEmail = typeof email === 'string' ? email.trim() : '';
  if (trimmedEmail) {
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) return res.status(400).json({ message: 'Enter a valid email address.' });
    if (await User.exists({ email: trimmedEmail.toLowerCase() })) return res.status(409).json({ message: 'An account with this email already exists.' });
  }
  const payload = { firstName, lastName, phone: phone.trim(), password };
  // Omitted entirely (not an empty string) when not provided, so the email_unique_when_present partial
  // index never sees it and multiple email-less customers can register without a duplicate-key error.
  if (trimmedEmail) payload.email = trimmedEmail;
  const user = await User.create(payload);
  return sendAuth(res, user, 201);
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });
  // Owner and staff accounts sign in through /auth/admin-login only; they look like "wrong password" here.
  const user = await User.findOne({ email: String(email).toLowerCase().trim(), role: 'customer' }).select('+password');
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ message: 'Email or password is incorrect.' });
  return sendAuth(res, user);
});

export const adminLogin = asyncHandler(async (req, res) => {
  const { adminId, password } = req.body;
  if (typeof adminId !== 'string' || typeof password !== 'string' || !adminId || !password) return res.status(400).json({ message: 'Admin ID and password are required.' });
  const user = await User.findOne({ adminId: adminId.toLowerCase().trim(), role: { $in: ['admin', 'staff'] } }).select('+password');
  if (!user || !(await bcrypt.compare(password, user.password))) {
    recordAdminLoginFailure(req);
    return res.status(401).json({ message: 'Admin ID or password is incorrect.' });
  }
  // Only revealed after the password is verified, so it can't be used to probe for account IDs.
  if (user.isActive === false) return res.status(403).json({ message: 'This account has been deactivated. Contact the owner.' });
  clearAdminLoginFailures(req);
  user.lastLoginAt = new Date();
  await user.save();
  return sendAuth(res, user);
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) return res.status(400).json({ message: 'Enter your current and new password.' });
  if (newPassword.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  if (newPassword !== confirmPassword) return res.status(400).json({ message: 'Passwords do not match.' });
  if (newPassword === currentPassword) return res.status(400).json({ message: 'Choose a password different from your current one.' });
  const user = await User.findById(req.user.id).select('+password');
  if (!(await bcrypt.compare(currentPassword, user.password))) return res.status(401).json({ message: 'Your current password is incorrect.' });
  user.password = newPassword;
  user.mustChangePassword = false;
  await user.save();
  res.json({ user: user.toSafeJSON(), message: 'Password updated.' });
});

export const me = asyncHandler(async (req, res) => res.json({ user: req.user.toSafeJSON() }));

export const updateProfile = asyncHandler(async (req, res) => {
  // Staff identity is managed by the owner (Staff & Access); staff cannot rename themselves.
  if (req.user.role === 'staff') return res.status(403).json({ message: 'Staff profile details are managed by the owner.' });
  for (const field of ['firstName', 'lastName', 'phone']) {
    if (typeof req.body[field] === 'string' && req.body[field].trim()) req.user[field] = req.body[field].trim();
  }
  await req.user.save();
  res.json({ user: req.user.toSafeJSON() });
});

export const addAddress = asyncHandler(async (req, res) => {
  const fields = ['recipient', 'phone', 'street', 'postalCode'];
  if (!fields.every((field) => String(req.body[field] || '').trim())) return res.status(400).json({ message: 'Complete every address field.' });
  const isDefault = Boolean(req.body.isDefault) || !req.user.addresses.length;
  if (isDefault) req.user.addresses.forEach((address) => { address.isDefault = false; });
  req.user.addresses.push({ ...req.body, isDefault });
  await req.user.save();
  res.status(201).json({ user: req.user.toSafeJSON() });
});

export const removeAddress = asyncHandler(async (req, res) => {
  const address = req.user.addresses.id(req.params.addressId);
  if (!address) return res.status(404).json({ message: 'Address not found.' });
  const wasDefault = address.isDefault;
  req.user.addresses.pull({ _id: req.params.addressId });
  if (wasDefault && req.user.addresses.length) req.user.addresses[0].isDefault = true;
  await req.user.save();
  res.json({ user: req.user.toSafeJSON() });
});
