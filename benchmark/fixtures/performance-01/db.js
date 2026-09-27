/**
 * A tiny in-memory fake database that counts how many queries it issues, so a
 * performance test can assert on query count without any real I/O. `getLineItems`
 * accepts either a single order id or an array of ids and counts as one query per
 * call — this is what lets a test distinguish an N+1 pattern (one call per order)
 * from a single batched fetch.
 */
class FakeDb {
  constructor(orders, lineItems) {
    this._orders = orders; // [{ id, customer }]
    this._lineItems = lineItems; // [{ orderId, sku, qty }]
    this.queryCount = 0;
  }

  /** One query: every order. */
  getOrders() {
    this.queryCount += 1;
    return this._orders.map((o) => ({ ...o }));
  }

  /** One query regardless of how many order ids are requested. */
  getLineItems(orderIdOrIds) {
    this.queryCount += 1;
    const ids = Array.isArray(orderIdOrIds) ? orderIdOrIds : [orderIdOrIds];
    const idSet = new Set(ids);
    return this._lineItems.filter((li) => idSet.has(li.orderId)).map((li) => ({ ...li }));
  }
}

/** Builds a FakeDb seeded with `orderCount` orders, each having two line items. */
function makeDb(orderCount) {
  const orders = [];
  const lineItems = [];
  for (let i = 1; i <= orderCount; i += 1) {
    orders.push({ id: i, customer: `customer-${i}` });
    lineItems.push({ orderId: i, sku: `sku-${i}-a`, qty: 1 });
    lineItems.push({ orderId: i, sku: `sku-${i}-b`, qty: 2 });
  }
  return new FakeDb(orders, lineItems);
}

module.exports = { FakeDb, makeDb };
