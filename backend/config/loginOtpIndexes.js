import LoginOtp from '../models/LoginOtp.js';

const LEGACY = 'mobile_1';

// Reports whether the database still has the pre-delivery-OTP unique index on mobile alone, which would
// collide with the compound (mobile, purpose) index declared in the LoginOtp schema the moment a
// customer and a delivery login OTP are both pending for the same mobile number. Read-only: safe to
// call at startup.
export async function legacyMobileIndexPresent() {
  const indexes = await LoginOtp.collection.indexes().catch(() => []);
  const legacy = indexes.find((index) => index.name === LEGACY);
  return Boolean(legacy && legacy.unique);
}

// One-off, opt-in migration (see scripts/migrateLoginOtpIndexes.js): replaces the legacy single-field
// unique index with the compound (mobile, purpose) index declared in the schema. The replacement index
// is built first, then the legacy one is removed, so uniqueness is never briefly unenforced.
export async function migrateLegacyMobileIndex() {
  await LoginOtp.createIndexes(); // builds mobile_purpose_unique (and any other declared indexes)
  if (!(await legacyMobileIndexPresent())) return { changed: false };
  await LoginOtp.collection.dropIndex(LEGACY);
  return { changed: true };
}
