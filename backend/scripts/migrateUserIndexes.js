// Usage (from backend/): npm run migrate:user-indexes
// Opt-in and idempotent. Uses MONGODB_URI from the environment / .env and touches only the users collection's
// email index. Never printed: the connection string.
import '../config/dns.js';
import 'dotenv/config';
import mongoose from 'mongoose';
import { legacyEmailIndexPresent, migrateLegacyEmailIndex } from '../config/userIndexes.js';

try {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to database "${mongoose.connection.name}".`);
  console.log(`Legacy email index present: ${await legacyEmailIndexPresent()}`);
  const result = await migrateLegacyEmailIndex();
  console.log(result.changed ? 'Replaced the legacy email index with the partial unique index.' : 'Nothing to change.');
} catch (error) {
  console.error('Migration failed:', error.message.replace(/mongodb(\+srv)?:\/\/\S+/g, '[redacted-uri]'));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
