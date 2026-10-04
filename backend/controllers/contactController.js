import ContactMessage from '../models/ContactMessage.js';
import asyncHandler from '../utils/asyncHandler.js';

export const createContactMessage = asyncHandler(async (req, res) => {
  const { name, email, phone = '', subject, message } = req.body;
  if (![name, email, subject, message].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Complete all required contact fields.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  await ContactMessage.create({ name, email, phone, subject, message });
  res.status(201).json({ message: 'Your message has been sent to Janai.' });
});

export const listContactMessages = asyncHandler(async (req, res) => {
  const messages = await ContactMessage.find().sort({ createdAt: -1 }).limit(300);
  res.json({ messages });
});
