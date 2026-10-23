// Pure input validation/normalisation for business settings. Each function returns { value, error },
// mirroring the convention in utils/staffValidation.js.
export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOGO_RE = /^data:image\/(png|jpe?g|webp);base64,/;
const MAX_LOGO_BYTES = 5 * 1024 * 1024; // matches the frontend's existing per-image limit (ProductFormModal.jsx)

const isString = (value) => typeof value === 'string';
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeBusinessName(input) {
  if (!isString(input) || !input.trim()) return { error: 'Business name is required.' };
  const value = input.trim();
  if (value.length > 120) return { error: 'Business name is too long.' };
  return { value };
}

// Empty / missing means "not provided" — never a placeholder, same convention as
// utils/staffValidation.js's normalizeOptionalMobile/normalizeOptionalEmail.
export function normalizeOptionalPhone(input) {
  if (input === undefined || input === null || (isString(input) && !input.trim())) return { value: '' };
  if (!isString(input)) return { error: 'Enter a valid contact phone number.' };
  const digits = input.replace(/\D/g, '');
  const mobile = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(mobile)) return { error: 'Enter a valid 10-digit Indian phone number.' };
  return { value: mobile };
}

export function normalizeOptionalEmail(input) {
  if (input === undefined || input === null || (isString(input) && !input.trim())) return { value: '' };
  if (!isString(input)) return { error: 'Enter a valid email address.' };
  const value = input.trim().toLowerCase();
  if (value.length > 254 || !EMAIL_RE.test(value)) return { error: 'Enter a valid email address.' };
  return { value };
}

export function normalizeAddress(input) {
  if (input === undefined || input === null) return { value: { line1: '', line2: '', city: '', state: '', postalCode: '' } };
  if (!isPlainObject(input)) return { error: 'Enter a valid business address.' };
  const pick = (key, max) => (isString(input[key]) ? input[key].trim().slice(0, max) : '');
  const postalCode = pick('postalCode', 6);
  if (postalCode && !/^\d{6}$/.test(postalCode)) return { error: 'Enter a valid 6-digit pincode.' };
  return { value: { line1: pick('line1', 120), line2: pick('line2', 120), city: pick('city', 60), state: pick('state', 60), postalCode } };
}

export function normalizeOperatingHours(input) {
  const source = isPlainObject(input) ? input : {};
  const value = {};
  for (const day of DAYS) {
    const raw = isPlainObject(source[day]) ? source[day] : {};
    const closed = Boolean(raw.closed);
    const open = isString(raw.open) ? raw.open : '09:00';
    const close = isString(raw.close) ? raw.close : '21:00';
    if (!closed) {
      if (!TIME_RE.test(open) || !TIME_RE.test(close)) return { error: `Enter valid opening and closing times (HH:MM) for ${day}.` };
      if (open >= close) return { error: `Closing time must be after opening time for ${day}.` };
    }
    value[day] = { closed, open, close };
  }
  return { value };
}

export function normalizeOptionalLogo(input) {
  if (input === undefined || input === null || input === '') return { value: '' };
  if (!isString(input)) return { error: 'Invalid logo image.' };
  if (!LOGO_RE.test(input)) return { error: 'Logo must be an uploaded image (JPG, PNG or WEBP).' };
  // Base64 encodes ~4 bytes for every 3 raw bytes, so this approximates the original file size.
  if (input.length * 0.75 > MAX_LOGO_BYTES) return { error: 'Logo image is too large (max 5MB).' };
  return { value: input };
}

// Matches the Settings model's orderSettings schema defaults — today's existing hardcoded
// ₹25-below-₹500 rule, delivery always on, no minimum order.
export const ORDER_SETTINGS_DEFAULTS = { deliveryEnabled: true, deliveryFee: 25, freeDeliveryThreshold: 500, minimumOrderValue: 0 };
const MAX_AMOUNT = 100000;

function normalizeAmount(input, label, fallback) {
  if (input === undefined || input === null || input === '') return { value: fallback };
  if (typeof input !== 'number' && typeof input !== 'string') return { error: `Enter a valid ${label} (0 or more).` };
  const num = Number(input);
  if (!Number.isFinite(num) || num < 0) return { error: `Enter a valid ${label} (0 or more).` };
  if (num > MAX_AMOUNT) return { error: `${label} is too large.` };
  return { value: Math.round(num * 100) / 100 };
}

// Customer SMS notification switches. Anything missing or non-boolean normalises to false, so a partial
// or malformed body can only ever turn notifications OFF, never silently switch customer SMS on.
export const NOTIFICATION_SETTING_KEYS = ['enabled', 'orderPlaced', 'outForDelivery', 'delivered', 'orderCancelled'];

export function normalizeNotificationSettings(input) {
  if (input !== undefined && !isPlainObject(input)) return { error: 'Invalid notification settings.' };
  const source = isPlainObject(input) ? input : {};
  const value = {};
  for (const key of NOTIFICATION_SETTING_KEYS) {
    if (source[key] !== undefined && typeof source[key] !== 'boolean') return { error: `${key} must be true or false.` };
    value[key] = source[key] === true;
  }
  return { value };
}

// Every field is independently optional — a missing one falls back to its existing schema default
// rather than 0, so a partial/malformed body can never silently zero out delivery pricing.
export function normalizeOrderSettings(input) {
  const source = isPlainObject(input) ? input : {};
  if (input !== undefined && !isPlainObject(input)) return { error: 'Invalid Orders & Delivery settings.' };
  const deliveryEnabled = source.deliveryEnabled === undefined ? ORDER_SETTINGS_DEFAULTS.deliveryEnabled : Boolean(source.deliveryEnabled);
  const deliveryFee = normalizeAmount(source.deliveryFee, 'delivery fee', ORDER_SETTINGS_DEFAULTS.deliveryFee);
  if (deliveryFee.error) return { error: deliveryFee.error };
  const freeDeliveryThreshold = normalizeAmount(source.freeDeliveryThreshold, 'free-delivery threshold', ORDER_SETTINGS_DEFAULTS.freeDeliveryThreshold);
  if (freeDeliveryThreshold.error) return { error: freeDeliveryThreshold.error };
  const minimumOrderValue = normalizeAmount(source.minimumOrderValue, 'minimum order value', ORDER_SETTINGS_DEFAULTS.minimumOrderValue);
  if (minimumOrderValue.error) return { error: minimumOrderValue.error };
  return { value: { deliveryEnabled, deliveryFee: deliveryFee.value, freeDeliveryThreshold: freeDeliveryThreshold.value, minimumOrderValue: minimumOrderValue.value } };
}
