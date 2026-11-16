import mongoose from 'mongoose';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import asyncHandler from '../utils/asyncHandler.js';
import { LEGACY_VARIATION_ID } from '../utils/productVariations.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET = '+05:30'; // Asia/Kolkata — a fixed offset year-round, no DST, so no date library is needed.

// Converts an inclusive [from, to] YYYY-MM-DD pair, interpreted in Asia/Kolkata, into a [start,
// endExclusive) UTC instant range for a Mongo query. `endExclusive` is local midnight of the day AFTER
// `to`, so the entire local `to` day is included — unlike stockController.js::listStockMovements' own
// `to` filter, which treats a bare date as UTC midnight and can silently exclude the later part of that
// same India-local day. That existing imprecision is not touched; this is a separate, correct filter
// for this new endpoint only.
export function resolveIstRange(from, to) {
  if (!DATE_PATTERN.test(from || '') || !DATE_PATTERN.test(to || '')) {
    return { error: 'Enter valid from/to dates in YYYY-MM-DD format.' };
  }
  const start = new Date(`${from}T00:00:00.000${IST_OFFSET}`);
  const endExclusive = new Date(`${to}T00:00:00.000${IST_OFFSET}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime())) {
    return { error: 'Enter valid from/to dates in YYYY-MM-DD format.' };
  }
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  if (start.getTime() >= endExclusive.getTime()) {
    return { error: 'The start date must be on or before the end date.' };
  }
  return { start, endExclusive };
}

// One row per unit/category combination, never a bare combined total — a bySource or byType category
// (e.g. "vendor_received", or "add") can span products in different units, so each of the three
// breakdowns is grouped by unit internally even though only byUnit surfaces unit as its sole key. This
// is the one point in this endpoint where unit-safety is actually enforced; every other step just
// carries `unit` through unchanged.
function breakdownStage(groupId) {
  return [
    {
      $group: {
        _id: groupId,
        added: { $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$difference', 0] } },
        removed: { $sum: { $cond: [{ $eq: ['$direction', 'out'] }, { $abs: '$difference' }, 0] } },
        movementCount: { $sum: 1 },
      },
    },
    { $addFields: { net: { $subtract: ['$added', '$removed'] } } },
  ];
}

// Server-aggregated Inventory Movement Summary (Phase 7.1). Reuses the same broad stock-view
// permission gate as every other stock endpoint (see stockRoutes.js) — this response is quantity-only,
// built entirely from aggregation $group/$sum stages, and never returns a raw StockMovement document or
// any of its fields verbatim, so there is nothing here for the supplier-cost-privacy gate to apply to:
// StockMovement itself carries no price/cost field of any kind.
export const getStockMovementSummary = asyncHandler(async (req, res) => {
  const { from, to, product } = req.query;
  const { start, endExclusive, error } = resolveIstRange(from, to);
  if (error) return res.status(400).json({ message: error });

  const match = { createdAt: { $gte: start, $lt: endExclusive } };
  if (product) {
    if (!mongoose.isValidObjectId(product)) return res.status(400).json({ message: 'Invalid product filter.' });
    match.product = new mongoose.Types.ObjectId(product);
  }

  const [result] = await StockMovement.aggregate([
    { $match: match },
    {
      // `difference` is the sole source of truth for direction (never `type` alone — a set_exact's
      // direction depends entirely on its own difference). Missing `source` (manual adjustments) is
      // classified as the literal category 'manual'; present `source` keeps its own specific event
      // name (order_placed, vendor_received, ...) rather than being collapsed into "automatic".
      $addFields: {
        direction: {
          $cond: [{ $gt: ['$difference', 0] }, 'in', { $cond: [{ $lt: ['$difference', 0] }, 'out', 'zero'] }],
        },
        sourceCategory: { $ifNull: ['$source.event', 'manual'] },
      },
    },
    {
      $facet: {
        byUnit: [
          ...breakdownStage('$unit'),
          { $project: { _id: 0, unit: '$_id', added: 1, removed: 1, net: 1, movementCount: 1 } },
          { $sort: { unit: 1 } },
        ],
        bySource: [
          ...breakdownStage({ source: '$sourceCategory', unit: '$unit' }),
          { $project: { _id: 0, source: '$_id.source', unit: '$_id.unit', added: 1, removed: 1, net: 1, movementCount: 1 } },
          { $sort: { source: 1, unit: 1 } },
        ],
        byType: [
          ...breakdownStage({ type: '$type', unit: '$unit' }),
          { $project: { _id: 0, type: '$_id.type', unit: '$_id.unit', added: 1, removed: 1, net: 1, movementCount: 1 } },
          { $sort: { type: 1, unit: 1 } },
        ],
      },
    },
  ]);

  res.json({ from, to, product: product || null, byUnit: result.byUnit, bySource: result.bySource, byType: result.byType });
});

// The four exact preset strings stockController.js's adjustStock ever actually persists verbatim into
// `reason` (its own REASON_PRESETS also lists a 5th entry, the literal string 'Other', but that one is
// only ever used for request-body validation — adjustStock replaces it with the free-text explanation
// before saving, so it never appears in a stored document). Anything not matching one of these four is
// grouped under a synthetic 'Other' here; the original stored text is never altered or exposed.
const KNOWN_REASON_PRESETS = ['Physical count correction', 'Damaged / Spoiled', 'Loss / Theft', 'Received outside vendor system'];

// Server-aggregated Staff Adjustment Report (Phase 7.2). Manual adjustments only — `source` absent is
// the sole manual marker (see stockController.js::adjustStock, the only writer that omits it), applied
// in the very first $match stage before any grouping, so an automatic movement can never reach this
// report even if its snapshotted actor happens to share an id with a staff member (e.g. a customer's
// own order_placed movement). Reuses resolveIstRange unchanged — no second date-range implementation.
export const getStaffAdjustmentSummary = asyncHandler(async (req, res) => {
  const { from, to, actor } = req.query;
  const { start, endExclusive, error } = resolveIstRange(from, to);
  if (error) return res.status(400).json({ message: error });

  const match = { source: { $exists: false }, createdAt: { $gte: start, $lt: endExclusive } };
  if (actor) {
    if (!mongoose.isValidObjectId(actor)) return res.status(400).json({ message: 'Invalid actor filter.' });
    match['actor.id'] = new mongoose.Types.ObjectId(actor);
  }

  const [facets] = await StockMovement.aggregate([
    { $match: match },
    {
      $addFields: {
        reasonCategory: { $cond: [{ $in: ['$reason', KNOWN_REASON_PRESETS] }, '$reason', 'Other'] },
      },
    },
    {
      $facet: {
        // Actor-level totals: every manual record for that actor counts once, regardless of unit or
        // reason — the basis for the "unit counts sum to totalAdjustments" / "reason counts sum to
        // totalAdjustments" invariants, since every movement has exactly one unit and one reasonCategory.
        overall: [
          {
            $group: {
              _id: '$actor.id',
              totalAdjustments: { $sum: 1 },
              // Counted independently of direction — a set_exact can add, remove, or change nothing.
              setExactCount: { $sum: { $cond: [{ $eq: ['$type', 'set_exact'] }, 1, 0] } },
              lastAdjustmentAt: { $max: '$createdAt' },
            },
          },
          { $project: { _id: 0, actorId: '$_id', totalAdjustments: 1, setExactCount: 1, lastAdjustmentAt: 1 } },
        ],
        // One row per actor+historical-name combination — never per raw interval, so the same name
        // reappearing in two non-consecutive periods is still a single combined entry here.
        nameHistory: [
          {
            $group: {
              _id: { actorId: '$actor.id', name: '$actor.name' },
              adjustmentCount: { $sum: 1 },
              lastSeenAt: { $max: '$createdAt' },
            },
          },
          { $project: { _id: 0, actorId: '$_id.actorId', name: '$_id.name', adjustmentCount: 1, lastSeenAt: 1 } },
        ],
        byUnit: [
          {
            $group: {
              _id: { actorId: '$actor.id', unit: '$unit' },
              added: { $sum: { $cond: [{ $gt: ['$difference', 0] }, '$difference', 0] } },
              removed: { $sum: { $cond: [{ $lt: ['$difference', 0] }, { $abs: '$difference' }, 0] } },
              count: { $sum: 1 },
            },
          },
          { $addFields: { net: { $subtract: ['$added', '$removed'] } } },
          { $project: { _id: 0, actorId: '$_id.actorId', unit: '$_id.unit', added: 1, removed: 1, net: 1, count: 1 } },
        ],
        byReason: [
          {
            $group: {
              _id: { actorId: '$actor.id', reason: '$reasonCategory' },
              count: { $sum: 1 },
            },
          },
          { $project: { _id: 0, actorId: '$_id.actorId', reason: '$_id.reason', count: 1 } },
        ],
      },
    },
  ]);

  // Each facet above only ever produces one small row per actor (or per actor+unit / actor+reason /
  // actor+name) — this merge reshapes those already-aggregated rows into one object per actor; it never
  // re-reads or re-aggregates raw movement documents in application memory.
  const staffById = new Map();
  function rowFor(actorId) {
    const key = String(actorId);
    if (!staffById.has(key)) {
      staffById.set(key, { actorId: key, totalAdjustments: 0, setExactCount: 0, lastAdjustmentAt: null, nameHistory: [], byUnit: [], byReason: [] });
    }
    return staffById.get(key);
  }
  for (const row of facets.overall) {
    const entry = rowFor(row.actorId);
    entry.totalAdjustments = row.totalAdjustments;
    entry.setExactCount = row.setExactCount;
    entry.lastAdjustmentAt = row.lastAdjustmentAt;
  }
  for (const row of facets.nameHistory) {
    // Blank/legacy-missing name falls back to a neutral label — never fabricated from a User lookup.
    rowFor(row.actorId).nameHistory.push({ name: row.name || 'Unknown staff', adjustmentCount: row.adjustmentCount, lastSeenAt: row.lastSeenAt });
  }
  for (const row of facets.byUnit) {
    rowFor(row.actorId).byUnit.push({ unit: row.unit, added: row.added, removed: row.removed, net: row.net, count: row.count });
  }
  for (const row of facets.byReason) {
    rowFor(row.actorId).byReason.push({ reason: row.reason, count: row.count });
  }

  const staff = Array.from(staffById.values())
    .map((entry) => ({ ...entry, nameHistory: entry.nameHistory.sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt)) }))
    .sort((a, b) => new Date(b.lastAdjustmentAt) - new Date(a.lastAdjustmentAt));

  res.json({ from, to, staff });
});

// Server-aggregated Product-wise Historical Inventory Report (Phase 7.3). Grouped strictly by
// {product, variationId, unit} — never merged across units, since a product's/variation's recorded
// unit can change over time with no ledger entry at all (an ordinary product edit does not strip
// `unit` the way it strips `stock`), so the SAME (product, variationId) pair can legitimately carry
// movements recorded under two different units with nothing marking the transition. Reuses
// resolveIstRange unchanged — no second date-range implementation.
//
// Opening and closing balances are ALWAYS returned as unavailable in this phase, by deliberate design,
// never computed from boundary movements, same-unit history, or a recorded-unit-uniformity check —
// every one of those was evaluated and rejected: a unit can silently change and silently change back
// (e.g. kg → pieces → kg) with zero StockMovement evidence of either transition, so even a history that
// records only "kg" throughout does not prove the unit was actually kg the whole time. Nothing in the
// current data model can disprove an invisible round trip, so no heuristic here is allowed to imply
// verified continuity — only incoming/outgoing/net/movementCount, which depend solely on movements
// actually inside the requested range, are ever claimed as correct.
export const getProductWiseSummary = asyncHandler(async (req, res) => {
  const { from, to, product, variationId, page = '1', limit = '20' } = req.query;
  if (variationId && !product) return res.status(400).json({ message: 'A variation filter requires a product filter.' });
  const { start, endExclusive, error } = resolveIstRange(from, to);
  if (error) return res.status(400).json({ message: error });

  const match = { createdAt: { $gte: start, $lt: endExclusive } };
  if (product) {
    if (!mongoose.isValidObjectId(product)) return res.status(400).json({ message: 'Invalid product filter.' });
    match.product = new mongoose.Types.ObjectId(product);
  }
  if (variationId) match.variationId = variationId === LEGACY_VARIATION_ID ? null : variationId;

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));

  const [result] = await StockMovement.aggregate([
    { $match: match },
    // Sorted before grouping so each bucket's $first snapshot is the most recent one within the
    // requested range — the same "most-recent-wins" display convention Phase 7.2 already established
    // for a real-world identity with more than one historical display-name snapshot.
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: { product: '$product', variationId: '$variationId', unit: '$unit' },
        productName: { $first: '$productName' },
        variationLabel: { $first: '$variationLabel' },
        incoming: { $sum: { $cond: [{ $gt: ['$difference', 0] }, '$difference', 0] } },
        outgoing: { $sum: { $cond: [{ $lt: ['$difference', 0] }, { $abs: '$difference' }, 0] } },
        movementCount: { $sum: 1 },
      },
    },
    { $addFields: { net: { $subtract: ['$incoming', '$outgoing'] } } },
    { $sort: { productName: 1, variationLabel: 1, unit: 1 } },
    {
      $facet: {
        data: [{ $skip: (pageNum - 1) * limitNum }, { $limit: limitNum }],
        totalCount: [{ $count: 'count' }],
      },
    },
  ]);

  const total = result.totalCount[0]?.count || 0;
  const pages = Math.max(1, Math.ceil(total / limitNum));

  // Deleted products must still appear, using their own snapshot — never a live join. This is the one
  // place a Product lookup happens at all, and it only ever checks existence (`_id` alone) for the
  // handful of product ids on this one page, never fetching name/price/vendor fields.
  const productIds = [...new Set(result.data.map((row) => String(row._id.product)))];
  const existingIds = new Set((await Product.find({ _id: { $in: productIds } }, { _id: 1 })).map((doc) => String(doc._id)));

  const rows = result.data.map((row) => ({
    productId: String(row._id.product),
    productName: row.productName,
    isDeleted: !existingIds.has(String(row._id.product)),
    variationId: row._id.variationId,
    variationLabel: row.variationLabel,
    unit: row._id.unit,
    incoming: row.incoming,
    outgoing: row.outgoing,
    net: row.net,
    movementCount: row.movementCount,
    // Never computed — see the function comment above for why no heuristic here is trustworthy.
    opening: { available: false },
    closing: { available: false },
  }));

  res.json({ from, to, page: pageNum, limit: limitNum, total, pages, rows });
});
