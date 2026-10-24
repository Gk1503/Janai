import Settings from '../models/Settings.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  normalizeAddress, normalizeBusinessName, normalizeOperatingHours, normalizeOptionalEmail,
  normalizeOptionalLogo, normalizeOptionalPhone, normalizeOrderSettings,
} from '../utils/settingsValidation.js';

// Upsert-on-read: the first call ever made creates the single canonical document with schema defaults
// (setDefaultsOnInsert); every call after that returns that same one document. No separate seed step,
// and no caller ever supplies an id, so a second document can never be created this way.
async function loadSettings() {
  return Settings.findOneAndUpdate({}, {}, { upsert: true, new: true, setDefaultsOnInsert: true });
}

// Only the fields the frontend actually needs — never the raw Mongoose document (which would also
// expose `updatedBy`, `__v`, etc.).
function presentGeneral(doc) {
  const general = doc.general || {};
  return {
    businessName: general.businessName || 'Janai',
    logo: general.logo || '',
    phone: general.phone || '',
    email: general.email || '',
    address: general.address || {},
    operatingHours: general.operatingHours || {},
    updatedAt: doc.updatedAt,
  };
}

// Public: business name, logo, contact details, address and hours are storefront information shown to
// anyone (e.g. a future Contact/footer integration), not a secret — same precedent as GET /api/products
// and GET /api/categories, which also carry no auth requirement.
export const getGeneralSettings = asyncHandler(async (req, res) => {
  const settings = await loadSettings();
  res.json({ settings: presentGeneral(settings) });
});

const ALLOWED_FIELDS = ['businessName', 'logo', 'phone', 'email', 'address', 'operatingHours'];

// Owner-only (enforced by requireOwner on the route, not here) — this handler only validates and
// writes. No field outside ALLOWED_FIELDS is ever read from the request body, so the request can never
// set anything beyond the five General fields (no mass assignment).
export const updateGeneralSettings = asyncHandler(async (req, res) => {
  const unsupported = Object.keys(req.body || {}).filter((key) => !ALLOWED_FIELDS.includes(key));
  if (unsupported.length) return res.status(400).json({ message: `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.` });

  const name = normalizeBusinessName(req.body.businessName);
  if (name.error) return res.status(400).json({ message: name.error });
  const phone = normalizeOptionalPhone(req.body.phone);
  if (phone.error) return res.status(400).json({ message: phone.error });
  const email = normalizeOptionalEmail(req.body.email);
  if (email.error) return res.status(400).json({ message: email.error });
  const address = normalizeAddress(req.body.address);
  if (address.error) return res.status(400).json({ message: address.error });
  const hours = normalizeOperatingHours(req.body.operatingHours);
  if (hours.error) return res.status(400).json({ message: hours.error });
  const logo = normalizeOptionalLogo(req.body.logo);
  if (logo.error) return res.status(400).json({ message: logo.error });

  const settings = await Settings.findOneAndUpdate(
    {},
    {
      $set: {
        general: { businessName: name.value, logo: logo.value, phone: phone.value, email: email.value, address: address.value, operatingHours: hours.value },
        updatedBy: req.user._id,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );
  res.json({ settings: presentGeneral(settings), message: 'Settings saved.' });
});

// Only the fields the frontend needs, never the raw Mongoose document.
function presentOrderSettings(doc) {
  const orderSettings = doc.orderSettings || {};
  return {
    deliveryEnabled: orderSettings.deliveryEnabled !== false,
    deliveryFee: typeof orderSettings.deliveryFee === 'number' ? orderSettings.deliveryFee : 25,
    freeDeliveryThreshold: typeof orderSettings.freeDeliveryThreshold === 'number' ? orderSettings.freeDeliveryThreshold : 500,
    minimumOrderValue: typeof orderSettings.minimumOrderValue === 'number' ? orderSettings.minimumOrderValue : 0,
    updatedAt: doc.updatedAt,
  };
}

// Public for the same reason GET /general is: cart/checkout pages need the current delivery fee and
// minimum-order rule before (and while) a customer is signing in, not just after.
export const getOrderSettings = asyncHandler(async (req, res) => {
  const settings = await loadSettings();
  res.json({ settings: presentOrderSettings(settings) });
});

const ORDER_SETTINGS_ALLOWED_FIELDS = ['deliveryEnabled', 'deliveryFee', 'freeDeliveryThreshold', 'minimumOrderValue'];

// Owner-only (enforced by requireOwner on the route, not here).
export const updateOrderSettings = asyncHandler(async (req, res) => {
  const unsupported = Object.keys(req.body || {}).filter((key) => !ORDER_SETTINGS_ALLOWED_FIELDS.includes(key));
  if (unsupported.length) return res.status(400).json({ message: `Unsupported field${unsupported.length > 1 ? 's' : ''}: ${unsupported.join(', ')}.` });

  const orderSettings = normalizeOrderSettings(req.body);
  if (orderSettings.error) return res.status(400).json({ message: orderSettings.error });

  const settings = await Settings.findOneAndUpdate(
    {},
    { $set: { orderSettings: orderSettings.value, updatedBy: req.user._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );
  res.json({ settings: presentOrderSettings(settings), message: 'Settings saved.' });
});
