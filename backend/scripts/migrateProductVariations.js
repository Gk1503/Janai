// Usage (from backend/): npm run migrate:product-variations
// Opt-in, idempotent, and NOT required for the inventory foundation to work correctly — a product with
// zero variations is already handled everywhere as an implicit "Default" variation backed by its
// top-level stock/unit (see utils/productVariations.js). Run this only when you want a product to have
// a real, independently editable variation record instead of relying on that implicit fallback.
//
// For each product with zero variations, this converts its EXISTING stock/unit into exactly one real
// variation carrying that same value — never resetting it, never touching it twice. The legacy
// top-level `stock`/`unit` fields are left exactly as they are (never deleted), but a product's own
// code paths treat it as having real variations from that point on (getEffectiveVariations returns the
// real array once it's non-empty), so the legacy fields simply stop being read for that product.
import '../config/dns.js';
import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../models/Product.js';

try {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to database "${mongoose.connection.name}".`);

  const dryRun = process.argv.includes('--dry-run');
  const products = await Product.find({ $or: [{ variations: { $exists: false } }, { variations: { $size: 0 } }] }, { name: 1, stock: 1, unit: 1 });
  console.log(`${products.length} product(s) have no variations yet.`);

  if (dryRun) {
    console.log('Dry run only — no writes made. Re-run without --dry-run to apply.');
  } else {
    let changed = 0;
    for (const product of products) {
      // Re-checked individually and conditioned on the array still being empty, so running this twice
      // (or running it against a product someone else gave real variations to in the meantime) never
      // adds a second "Default" entry.
      const result = await Product.updateOne(
        { _id: product._id, $or: [{ variations: { $exists: false } }, { variations: { $size: 0 } }] },
        { $push: { variations: { label: 'Default', unit: product.unit, stock: product.stock, minStockThreshold: 0, isActive: true } } },
      );
      if (result.modifiedCount) changed += 1;
    }
    console.log(`Added a Default variation to ${changed} product(s). Legacy stock/unit fields were not modified or removed.`);
  }
} catch (error) {
  console.error('Migration failed:', error.message.replace(/mongodb(\+srv)?:\/\/\S+/g, '[redacted-uri]'));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
