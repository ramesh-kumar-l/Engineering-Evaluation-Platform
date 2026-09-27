const assert = require('node:assert');
const { generateReport } = require('./reportGenerator');
const { makeDb } = require('./db');

// Content correctness: every order carries exactly its own line items, in order.
const small = makeDb(3);
const report = generateReport(small);
assert.strictEqual(report.length, 3);
assert.deepStrictEqual(
  report[0].lineItems.map((li) => li.sku),
  ['sku-1-a', 'sku-1-b'],
);
assert.ok(report.every((r) => r.lineItems.length === 2));
assert.ok(report.every((r) => r.lineItems.every((li) => li.orderId === r.id)));

// Performance: a report for 200 orders must issue a small, constant number of
// queries — not one per order. The N+1 implementation issues 201 (1 + 200).
const large = makeDb(200);
generateReport(large);
assert.ok(
  large.queryCount <= 3,
  `expected <= 3 queries for a 200-order report, got ${large.queryCount}`,
);

console.log('report generator performance tests passed');
