import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendAuth } from '../utils/token.js';

const FAST2SMS_BASE = 'https://www.fast2sms.com/dev/otp';
const COOLDOWN_MS = 30_000;
const WINDOW_MS = 10 * 60_000;
const MAX_SENDS = 5;
const MAX_RESENDS = 5;
const requests = new Map();

function normalizeMobile(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  const mobile = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(mobile) ? mobile : null;
}

function requestState(mobile) {
  const now = Date.now();
  let state = requests.get(mobile);
  if (!state || now - state.windowStart >= WINDOW_MS) {
    state = { windowStart: now, lastRequest: 0, sendCount: 0, resendCount: 0, sent: false };
    requests.set(mobile, state);
  }
  if (state.lastRequest && now - state.lastRequest < COOLDOWN_MS) {
    return { error: `Please wait ${Math.ceil((COOLDOWN_MS - (now - state.lastRequest)) / 1000)} seconds before trying again.` };
  }
  return { state, now };
}

async function callFast2Sms(action, body) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey || !process.env.FAST2SMS_OTP_ID) {
    const error = new Error('SMS login is not configured yet. Please use email and password or contact support.');
    error.statusCode = 503;
    throw error;
  }
  let response;
  try {
    response = await fetch(`${FAST2SMS_BASE}/${action}`, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    const error = new Error('SMS service is temporarily unavailable. Please try again.');
    error.statusCode = 502;
    throw error;
  }
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok || result.success === false || result.return === false || result.status === 'failed') {
    const error = new Error('SMS service could not process this request. Please try again.');
    const rejectedOtp = action === 'verify' && response.status < 500;
    error.statusCode = response.status === 429 ? 429 : rejectedOtp ? 401 : 502;
    throw error;
  }
  return result;
}

function findRegisteredUser(mobile) {
  return User.findOne({ phone: { $in: [mobile, `+91${mobile}`, `91${mobile}`, `+91 ${mobile}`] } });
}

async function registeredMobile(req, res) {
  const mobile = normalizeMobile(req.body.mobile);
  if (!mobile) {
    res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.' });
    return null;
  }
  const user = await findRegisteredUser(mobile);
  if (!user) {
    res.status(404).json({ message: 'No account found with this mobile number. Please register first.' });
    return null;
  }
  return { mobile, user };
}

export const sendLoginOtp = asyncHandler(async (req, res) => {
  const result = await registeredMobile(req, res);
  if (!result) return;
  const { mobile } = result;
  const rate = requestState(mobile);
  if (rate.error) return res.status(429).json({ message: rate.error });
  if (rate.state.sendCount >= MAX_SENDS) return res.status(429).json({ message: 'You have reached the OTP request limit. Please try again in 10 minutes.' });
  rate.state.lastRequest = rate.now;
  try {
    await callFast2Sms('send', { otp_id: process.env.FAST2SMS_OTP_ID, mobile });
    rate.state.sendCount += 1;
    rate.state.sent = true;
    return res.json({ message: 'OTP sent successfully.', mobile });
  } catch (error) {
    rate.state.lastRequest = 0;
    throw error;
  }
});

export const resendLoginOtp = asyncHandler(async (req, res) => {
  const result = await registeredMobile(req, res);
  if (!result) return;
  const { mobile } = result;
  const rate = requestState(mobile);
  if (rate.error) return res.status(429).json({ message: rate.error });
  if (!rate.state.sent) return res.status(409).json({ message: 'Request an OTP before resending.' });
  if (rate.state.resendCount >= MAX_RESENDS) return res.status(429).json({ message: 'You have reached the OTP resend limit. Please try again in 10 minutes.' });
  rate.state.lastRequest = rate.now;
  try {
    await callFast2Sms('resend', { mobile });
    rate.state.resendCount += 1;
  } catch (error) {
    rate.state.lastRequest = 0;
    throw error;
  }
  res.json({ message: 'A new OTP has been sent.', mobile });
});

export const verifyLoginOtp = asyncHandler(async (req, res) => {
  const mobile = normalizeMobile(req.body.mobile);
  const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';
  if (!mobile) return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.' });
  if (!/^\d{6}$/.test(otp)) return res.status(400).json({ message: 'Enter the 6-digit OTP.' });
  const user = await findRegisteredUser(mobile);
  if (!user) return res.status(404).json({ message: 'No account found with this mobile number. Please register first.' });
  let result;
  try {
    result = await callFast2Sms('verify', { mobile, otp });
  } catch (error) {
    if (error.statusCode === 502 || error.statusCode === 503) throw error;
    return res.status(401).json({ message: 'Invalid or expired OTP. Please try again.' });
  }
  const verified = result.success === true || result.return === true || result.status === 'success';
  if (!verified) return res.status(401).json({ message: 'Invalid or expired OTP. Please try again.' });
  requests.delete(mobile);
  return sendAuth(res, user);
});
