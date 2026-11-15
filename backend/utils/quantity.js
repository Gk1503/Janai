// Shared customer-facing quantity validation (Phase 6). Decimal quantities are now accepted above the
// existing minimum of 1 — this phase does not introduce sub-1 ordering, and does not touch vendor
// purchase or manual stock adjustment quantity handling, which already accepted decimals safely before
// this phase (see vendorController.js / stockController.js, both Number.isFinite-based already).
const MAX_DECIMALS = 3;

// Counts decimal places from the value's own canonical string form rather than the original input
// string, so "4.1200" (a value, not a user keystroke string) correctly counts as 2 decimals, not 4.
// Safe for a JSON-parsed number too: ECMAScript's Number::toString always produces the shortest string
// that parses back to the exact same double, so a clean 3-decimal input round-trips exactly here.
function countDecimals(value) {
  const text = String(value);
  if (/e/i.test(text)) return Infinity; // scientific notation is never a clean decimal entry
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

// Returns { value } on success or { error } on failure. `raw` may be a number or a string — whichever
// shape the caller already has (JSON body vs. form input). Rejects: empty/missing, non-finite (NaN,
// Infinity, malformed strings), below `min` (default 1 — the existing, unchanged floor), and more than
// 3 decimal places.
export function validateOrderQuantity(raw, { min = 1 } = {}) {
  if (raw === '' || raw === null || raw === undefined) return { error: 'Enter a quantity.' };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: 'Enter a valid quantity.' };
  if (value < min) return { error: `Quantity must be at least ${min}.` };
  if (countDecimals(value) > MAX_DECIMALS) return { error: `Quantity can have at most ${MAX_DECIMALS} decimal places.` };
  return { value };
}
