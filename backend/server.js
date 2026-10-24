import './config/dns.js';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import preOrderRoutes from './routes/preOrderRoutes.js';
import bulkOrderRoutes from './routes/bulkOrderRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import deliveryRoutes from './routes/deliveryRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import { ensureDefaultAdmin } from './config/defaultAdmin.js';
import { assertOwnerNotUsingDefaultPassword, assertSecureConfig } from './config/startupChecks.js';
import { legacyEmailIndexPresent } from './config/userIndexes.js';
import { legacyMobileIndexPresent } from './config/loginOtpIndexes.js';
import { ensureDefaultCategories } from './config/defaultCategories.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const app = express();
app.use(cors());
// Default body limit (100kb) is too small for products with several base64-encoded
// images; 15mb comfortably covers up to 8 compressed images.
app.use(express.json({ limit: '15mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/preorders', preOrderRoutes);
app.use('/api/bulk-orders', bulkOrderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/contact', contactRoutes);
app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || 5000;

try {
  assertSecureConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Read-only notice; the index is replaced only by the explicit `npm run migrate:user-indexes`.
async function warnAboutLegacyEmailIndex() {
  if (await legacyEmailIndexPresent()) console.warn('Notice: the legacy unique email index is still present, so only one staff account without an email can exist. Run "npm run migrate:user-indexes" once to allow several.');
}

// Read-only notice; the index is replaced only by the explicit `npm run migrate:login-otp-indexes`.
async function warnAboutLegacyMobileIndex() {
  if (await legacyMobileIndexPresent()) console.warn('Notice: the legacy unique index on LoginOtp.mobile is still present, so a customer login OTP and a delivery login OTP cannot both be pending for the same mobile number. Run "npm run migrate:login-otp-indexes" once to replace it with the compound (mobile, purpose) index.');
}

connectDB()
  .then(ensureDefaultAdmin)
  .then(assertOwnerNotUsingDefaultPassword)
  .then(warnAboutLegacyEmailIndex)
  .then(warnAboutLegacyMobileIndex)
  .then(ensureDefaultCategories)
  .then(() => app.listen(port, () => console.log(`Server running on port ${port}`)))
  .catch((error) => {
    if (error.message?.startsWith('Insecure production configuration')) {
      console.error(error.message);
      process.exit(1);
    }
    const code = error.code || error.cause?.code;
    console.error('Startup failed: database connection could not be established.', code ? `[${code}]` : '');
    process.exit(1);
  });
