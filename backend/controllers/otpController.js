import LoginOtp from '../models/LoginOtp.js';
import User from '../models/User.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendAuth } from '../utils/token.js';

const OTP_TTL_MS = 5 * 60_000;
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

// Calls the self-hosted SMS gateway, which generates, sends and verifies the OTP.
async function callGateway(path, body) {
  const { SMS_GATEWAY_URL: baseUrl, SMS_GATEWAY_KEY: apiKey } = process.env;
  if (!baseUrl || !apiKey) {
    const error = new Error('SMS login is not configured yet. Please use email and password or contact support.');
    error.statusCode = 503;
    throw error;
  }
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (cause) {
    console.error(`SMS gateway unreachable at ${baseUrl}: ${cause.message}`);
    const error = new Error('SMS service is temporarily unavailable. Please try again.');
    error.statusCode = 502;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

function gatewayFailure(status, data) {
  console.error(`SMS gateway returned ${status}: ${JSON.stringify(data).slice(0, 300)}`);
  const error = new Error(status === 409
    ? 'SMS service is offline right now. Please try again shortly.'
    : 'SMS service could not process this request. Please try again.');
  error.statusCode = status === 429 ? 429 : status === 409 ? 503 : 502;
  return error;
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

async function issueOtp(mobile) {
  const { status, data } = await callGateway('/v1/otp/send', {
    to: `+91${mobile}`,
    message: 'Your Janai login OTP is {code}. It is valid for 5 minutes. Do not share it with anyone.',
  });
  if (status !== 202 || !data.otp_id) throw gatewayFailure(status, data);
  await LoginOtp.findOneAndUpdate(
    { mobile },
    { otpId: data.otp_id, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    { upsert: true },
  );
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
    await issueOtp(mobile);
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
    await issueOtp(mobile);
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
  const record = await LoginOtp.findOne({ mobile });
  if (!record || record.expiresAt < new Date()) return res.status(401).json({ message: 'Invalid or expired OTP. Please try again.' });
  const { status, data } = await callGateway('/v1/otp/verify', { otp_id: record.otpId, code: otp });
  if (status === 400) return res.status(401).json({ message: 'Invalid or expired OTP. Please try again.' });
  if (status !== 200) throw gatewayFailure(status, data);
  if (data.valid !== true) return res.status(401).json({ message: 'Invalid or expired OTP. Please try again.' });
  await record.deleteOne();
  requests.delete(mobile);
  return sendAuth(res, user);
});
