import bcrypt from 'bcrypt';
import User from '../models/User.js';

const KNOWN_DEFAULT_PASSWORDS = ['admin123', 'admin', 'password', 'password123', '12345678', 'changeme'];
const isProduction = () => process.env.NODE_ENV === 'production';

// Environment-only checks; run before connecting to the database.
export function assertSecureConfig() {
  if (!isProduction()) return;
  const problems = [];
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || /replace-with|changeme|secret$/i.test(secret)) problems.push('JWT_SECRET must be a random value of at least 32 characters');
  const password = process.env.ADMIN_PASSWORD || '';
  if (password.length < 12 || KNOWN_DEFAULT_PASSWORDS.includes(password.toLowerCase())) problems.push('ADMIN_PASSWORD must be set to a strong, non-default value of at least 12 characters');
  if (problems.length) throw new Error(`Insecure production configuration: ${problems.join('; ')}.`);
}

// Refuses to start in production while the owner account still uses a well-known password.
export async function assertOwnerNotUsingDefaultPassword() {
  if (!isProduction()) return;
  const owners = await User.find({ role: 'admin' }).select('+password');
  for (const owner of owners) {
    for (const candidate of KNOWN_DEFAULT_PASSWORDS) {
      if (await bcrypt.compare(candidate, owner.password)) throw new Error(`Insecure production configuration: owner account "${owner.adminId || owner.email}" still uses a default password. Change it before starting in production.`);
    }
  }
}
