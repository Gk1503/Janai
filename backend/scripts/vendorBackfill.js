// Usage (from backend/):
//   npm run vendors:backfill:dry-run
//   node scripts/vendorBackfill.js --execute --mappings=./approved-vendor-mappings.json
//
// Dry run (the default, and the only mode without --execute) makes ABSOLUTELY NO database writes: it
// only reads every product's embedded vendors, groups them by case-insensitive name, and prints a
// report for manual review. Nothing here ever merges or links anything automatically from that report.
//
// Execute mode requires --mappings pointing at a JSON file of mappings a human has already reviewed
// and approved (see applyApprovedMappings in vendorBackfillLogic.js for the exact shape) — it never
// derives mappings from the dry-run report itself. Every existing embedded vendor _id, and every
// VendorPurchase/VendorPriceHistory row, is left untouched; only vendorRef is ever set.
import '../config/dns.js';
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Vendor from '../models/Vendor.js';
import { applyApprovedMappings, buildDryRunReport } from './vendorBackfillLogic.js';

function parseArgs(argv) {
  const args = { mode: 'dry-run', mappingsPath: null, outPath: null };
  for (const raw of argv) {
    if (raw === '--execute') args.mode = 'execute';
    else if (raw === '--dry-run') args.mode = 'dry-run';
    else if (raw.startsWith('--mappings=')) args.mappingsPath = raw.slice('--mappings='.length);
    else if (raw.startsWith('--out=')) args.outPath = raw.slice('--out='.length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to database "${mongoose.connection.name}".`);

  if (args.mode === 'dry-run') {
    const products = await Product.find({}, { name: 1, vendors: 1 }).lean();
    const report = buildDryRunReport(products);
    console.log(JSON.stringify(report, null, 2));
    if (args.outPath) {
      writeFileSync(args.outPath, JSON.stringify(report, null, 2));
      console.log(`Report written to ${args.outPath}`);
    }
    console.log(`\nDry run only — no database changes were made. ${report.totalGroups} name group(s) found across ${report.totalProducts} product(s); ${report.ambiguousGroups} flagged for manual review.`);
    return;
  }

  if (!args.mappingsPath) throw new Error('--execute requires --mappings=<path to an approved mappings JSON file>.');
  const mappings = JSON.parse(readFileSync(args.mappingsPath, 'utf8'));
  const result = await applyApprovedMappings(mappings, { Vendor, Product });
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nCreated ${result.createdVendors.length} vendor(s), linked ${result.linked.length} embedded vendor row(s), ${result.errors.length} error(s).`);
}

try {
  await main();
} catch (error) {
  console.error('Vendor backfill failed:', error.message.replace(/mongodb(\+srv)?:\/\/\S+/g, '[redacted-uri]'));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
