import User from '../models/User.js';

// Default admin credentials. Override in backend/.env with ADMIN_ID / ADMIN_PASSWORD.
export async function ensureDefaultAdmin() {
  const adminId = (process.env.ADMIN_ID || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  if (await User.exists({ adminId })) return;
  await User.create({
    firstName: 'Janai',
    lastName: 'Admin',
    email: `${adminId}@janai.local`,
    phone: '0000000000',
    adminId,
    password,
    role: 'admin',
  });
  console.log(`Default admin created. ID: ${adminId}`);
}
