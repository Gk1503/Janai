import mongoose from 'mongoose';

// Manual Stock Adjustments (Phase 3) — the one place in this codebase that runs a real multi-document
// MongoDB transaction (every other multi-step stock flow here uses a claim-then-manually-roll-back
// pattern instead; this feature is simple enough — exactly one product write and one movement insert —
// to use a genuine transaction instead of hand-rolled compensation). Exported as a property on a plain
// object, not a bare named function, so tests can monkey-patch `transactionHelper.run` exactly the way
// every model method in this codebase's existing tests is already stubbed (ES module named exports
// can't be reassigned from outside the module; a mutable object property can).
export const transactionHelper = {
  async run(work) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => { result = await work(session); });
      return result;
    } finally {
      await session.endSession();
    }
  },
};
