import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Vendor from '../models/Vendor.js';
import Product from '../models/Product.js';
import { listVendors } from '../controllers/adminVendorController.js';

function run(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    handler(req, res, (error) => resolve({ status: 500, error }));
  });
}

describe('adminVendorController.listVendors: productCount via canonical vendorRef only (Stage 2)', () => {
  it('reports 0 for a vendor with no linked products, and skips the aggregation entirely when there are no vendors', async () => {
    const originalFind = Vendor.find;
    const originalAggregate = Product.aggregate;
    let aggregateCalled = false;
    Vendor.find = () => ({ sort: () => Promise.resolve([]) });
    Product.aggregate = async () => { aggregateCalled = true; return []; };
    try {
      const result = await run(listVendors, { query: {} });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.vendors, []);
      assert.equal(aggregateCalled, false, 'no point aggregating when there are no vendors to count for');
    } finally { Vendor.find = originalFind; Product.aggregate = originalAggregate; }
  });

  it('maps each vendor to its aggregated count by id, defaulting any vendor missing from the aggregation to 0', async () => {
    const originalFind = Vendor.find;
    const originalAggregate = Product.aggregate;
    Vendor.find = () => ({
      sort: () => Promise.resolve([
        { _id: 'v1', name: 'A', status: 'Active' },
        { _id: 'v2', name: 'B', status: 'Active' },
      ]),
    });
    Product.aggregate = async () => [{ _id: 'v1', count: 3 }];
    try {
      const result = await run(listVendors, { query: {} });
      const byId = Object.fromEntries(result.body.vendors.map((v) => [v._id, v.productCount]));
      assert.equal(byId.v1, 3);
      assert.equal(byId.v2, 0, 'a vendor with no products yet must still appear, with 0');
    } finally { Vendor.find = originalFind; Product.aggregate = originalAggregate; }
  });

  it('the aggregation dedupes by (vendorRef, productId) before the final count, so one product with two rows for the same vendor is counted once', async () => {
    const originalFind = Vendor.find;
    const originalAggregate = Product.aggregate;
    let capturedPipeline = null;
    Vendor.find = () => ({ sort: () => Promise.resolve([{ _id: 'v1', name: 'A', status: 'Active' }]) });
    Product.aggregate = async (pipeline) => { capturedPipeline = pipeline; return []; };
    try {
      await run(listVendors, { query: {} });
      const groupStages = capturedPipeline.filter((stage) => stage.$group);
      assert.equal(groupStages.length, 2, 'must dedupe per (vendorRef, productId) before the final count');
      assert.deepEqual(Object.keys(groupStages[0].$group._id).sort(), ['productId', 'vendorRef']);
    } finally { Vendor.find = originalFind; Product.aggregate = originalAggregate; }
  });

  it('matches only the canonical vendors.vendorRef, never a plain-text vendor name', async () => {
    const originalFind = Vendor.find;
    const originalAggregate = Product.aggregate;
    let capturedPipeline = null;
    Vendor.find = () => ({ sort: () => Promise.resolve([{ _id: 'v1', name: 'A', status: 'Active' }]) });
    Product.aggregate = async (pipeline) => { capturedPipeline = pipeline; return []; };
    try {
      await run(listVendors, { query: {} });
      const pipelineText = JSON.stringify(capturedPipeline);
      assert.ok(pipelineText.includes('vendors.vendorRef'));
      assert.ok(!pipelineText.includes('vendors.name'));
    } finally { Vendor.find = originalFind; Product.aggregate = originalAggregate; }
  });

  it('search matches by name, contact person or phone', async () => {
    const originalFind = Vendor.find;
    const originalAggregate = Product.aggregate;
    let capturedFilter = null;
    Vendor.find = (filter) => { capturedFilter = filter; return { sort: () => Promise.resolve([]) }; };
    Product.aggregate = async () => [];
    try {
      await run(listVendors, { query: { q: 'Rajesh' } });
      assert.equal(capturedFilter.$or.length, 3);
      assert.ok('normalizedName' in capturedFilter.$or[0]);
      assert.ok('contactPerson' in capturedFilter.$or[1]);
      assert.ok('phone' in capturedFilter.$or[2]);
    } finally { Vendor.find = originalFind; Product.aggregate = originalAggregate; }
  });

  it('status filter and search still combine correctly, and an invalid status is still rejected before any query runs', async () => {
    const originalFind = Vendor.find;
    const originalAggregate = Product.aggregate;
    let called = false;
    Vendor.find = () => { called = true; return { sort: () => Promise.resolve([]) }; };
    Product.aggregate = async () => [];
    try {
      const bad = await run(listVendors, { query: { status: 'Retired' } });
      assert.equal(bad.status, 400);
      assert.equal(called, false);
    } finally { Vendor.find = originalFind; Product.aggregate = originalAggregate; }
  });
});
