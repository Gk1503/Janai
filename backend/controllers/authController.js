import bcrypt from 'bcrypt';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendAuth } from '../utils/token.js';

export const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password, confirmPassword } = req.body;
  if (![firstName, lastName, email, phone, password].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Complete all required fields.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  if (password !== confirmPassword) return res.status(400).json({ message: 'Passwords do not match.' });
  if (await User.exists({ email: email.toLowerCase().trim() })) return res.status(409).json({ message: 'An account with this email already exists.' });
  const user = await User.create({ firstName, lastName, email, phone: phone.trim(), password });
  return sendAuth(res, user, 201);
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+password');
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ message: 'Email or password is incorrect.' });
  return sendAuth(res, user);
});

export const me = asyncHandler(async (req, res) => res.json({ user: req.user.toSafeJSON() }));

export const updateProfile = asyncHandler(async (req, res) => {
  for (const field of ['firstName', 'lastName', 'phone']) {
    if (typeof req.body[field] === 'string' && req.body[field].trim()) req.user[field] = req.body[field].trim();
  }
  await req.user.save();
  res.json({ user: req.user.toSafeJSON() });
});

export const addAddress = asyncHandler(async (req, res) => {
  const fields = ['recipient', 'phone', 'street', 'city', 'state', 'postalCode'];
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
