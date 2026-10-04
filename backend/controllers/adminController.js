import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';

export const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).limit(500);
  res.json({ users: users.map((user) => user.toSafeJSON()) });
});

export const updateUserRole = asyncHandler(async (req, res) => {
  if (!['customer', 'admin'].includes(req.body.role)) return res.status(400).json({ message: 'Choose a valid role.' });
  if (String(req.params.id) === String(req.user.id)) return res.status(400).json({ message: 'You cannot change your own role.' });
  const user = await User.findByIdAndUpdate(req.params.id, { role: req.body.role }, { new: true, runValidators: true });
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ user: user.toSafeJSON() });
});
