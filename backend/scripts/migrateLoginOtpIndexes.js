// Usage (from backend/): npm run migrate:login-otp-indexes
// Opt-in and idempotent. Uses MONGODB_URI from the environment / .env and touches only the loginotps
// collection's mobile index. Never printed: the connection string.
import '../config/dns.js';
import 'dotenv/config';
import mongoose from 'mongoose';
import { legacyMobileIndexPresent, migrateLegacyMobileIndex } from '../config/loginOtpIndexes.js';

try {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to database "${mongoose.connection.name}".`);
  console.log(`Legacy mobile-only index present: ${await legacyMobileIndexPresent()}`);
  const result = await migrateLegacyMobileIndex();
  console.log(result.changed ? 'Replaced the legacy mobile index with the compound (mobile, purpose) index.' : 'Nothing to change.');
} catch (error) {
  console.error('Migration failed:', error.message.replace(/mongodb(\+srv)?:\/\/\S+/g, '[redacted-uri]'));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
