import mongoose from 'mongoose';

// Automatic movements only (Phase 5). Identifies which order/bulk-order/vendor-purchase lifecycle event
// produced this row. Omitted entirely for manual adjustments (Phase 3) — never present as an empty
// object. IMPORTANT: the parent `source` path on the main schema below must declare `default: undefined`
// explicitly — verified empirically (disposable real-DB probe) that without that explicit parent
// default, Mongoose materializes `source: { itemKey: null }` on every document purely because itemKey
// below has its own `default: null`, which then collides every manual movement under the unique index.
const stockMovementSourceSchema = new mongoose.Schema({
  type: { type: String, enum: ['order', 'bulk_order', 'vendor_purchase'], required: true },
  id: { type: mongoose.Schema.Types.ObjectId, required: true },
  event: {
    type: String,
    enum: ['order_placed', 'order_cancelled', 'preorder_confirmed', 'bulk_approved', 'bulk_rejected', 'vendor_received'],
    required: true,
  },
  // Stringified Order.items array index, stringified BulkOrder.products subdocument _id, or null for a
  // vendor purchase (one event per whole purchase document, never per sub-item).
  itemKey: { type: String, default: null },
}, { _id: false });

// Permanent, append-only record of every manual stock adjustment (Phase 3). No update or delete route
// is ever exposed for this collection — a correction is a new document, never an edit — mirroring how
// Order/BulkOrder's own statusHistory is append-only (utils/statusAudit.js).
//
// Every display field below (productName, variationLabel, unit, actor.name) is a SNAPSHOT taken at the
// moment of the adjustment, never a live lookup. This is deliberate: the Inventory Dashboard previously
// had a real bug where a purchase's product name went blank once the product was deleted, because it
// depended on a live join. A movement record must stay fully readable forever regardless of what later
// happens to the product, the variation, or the staff account — `product`/`actor.id` are kept only as
// optional references for future filtering, never for display.
const stockMovementSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  productName: { type: String, required: true },
  // null = the legacy implicit "Default" variation; otherwise a real variation's own _id, as a string
  // (matching the convention already used for variationId everywhere else — Order.items, VendorPurchase).
  variationId: { type: String, default: null, index: true },
  variationLabel: { type: String, required: true },
  unit: { type: String, required: true },
  type: { type: String, enum: ['add', 'remove', 'set_exact'], required: true, index: true },
  previousStock: { type: Number, required: true, min: 0 },
  newStock: { type: Number, required: true, min: 0 },
  difference: { type: Number, required: true },
  reason: { type: String, required: true, trim: true, minlength: 1 },
  actor: {
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
  },
  // Automatic movements only (Phase 5) — additive, optional. Manual adjustments (Phase 3) never set
  // this at all; `default: undefined` here (not an object literal) is what keeps it genuinely absent
  // rather than materializing as `{ itemKey: null }` — see stockMovementSourceSchema above.
  source: { type: stockMovementSourceSchema, default: undefined },
}, { timestamps: true }); // createdAt is the server-generated record of when the adjustment happened

stockMovementSchema.index({ createdAt: -1 });
stockMovementSchema.index({ product: 1, variationId: 1, createdAt: -1 });
// Sparse: a document is only indexed if at least one of these four fields is present. Every manual
// movement has none of them, so they are excluded from this index entirely and never collide with one
// another. Automatic movements always set all four (itemKey may be the literal value null, which still
// counts as "present"), so this enforces exactly-once-per-lifecycle-event as defense-in-depth alongside
// each workflow's own claim guard.
stockMovementSchema.index(
  { 'source.type': 1, 'source.id': 1, 'source.event': 1, 'source.itemKey': 1 },
  { unique: true, sparse: true },
);

export default mongoose.model('StockMovement', stockMovementSchema);
