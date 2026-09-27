/**
 * Builds a report that attaches each order's line items. The current
 * implementation issues one query per order to fetch its line items — an N+1
 * query pattern that dominates report time for large order sets. Task
 * performance-01 requires fixing this to a single batched fetch while keeping
 * the report's output content identical. See benchmark/tasks/performance-01.json.
 */
function generateReport(db) {
  const orders = db.getOrders();
  return orders.map((order) => ({
    ...order,
    lineItems: db.getLineItems(order.id), // N+1: one query per order
  }));
}

module.exports = { generateReport };
