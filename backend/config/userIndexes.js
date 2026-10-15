import User from '../models/User.js';

const LEGACY = 'email_1';

// Reports whether the database still has the pre-staff, non-partial unique index on email.
// Read-only: safe to call at startup.
export async function legacyEmailIndexPresent() {
  const indexes = await User.collection.indexes().catch(() => []);
  const legacy = indexes.find((index) => index.name === LEGACY);
  return Boolean(legacy && legacy.unique && !legacy.partialFilterExpression);
}

// One-off, opt-in migration (see scripts/migrateUserIndexes.js): replaces the legacy index with the partial one
// declared in the User schema so several staff accounts can exist without an email. Customer email
// uniqueness is preserved: the replacement index is built first, then the legacy one is removed.
export async function migrateLegacyEmailIndex() {
  await User.createIndexes(); // builds email_unique_when_present (and any other declared indexes)
  if (!(await legacyEmailIndexPresent())) return { changed: false };
  await User.collection.dropIndex(LEGACY);
  return { changed: true };
}
