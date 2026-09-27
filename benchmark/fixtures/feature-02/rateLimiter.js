/**
 * Per-route request rate limiting via a token-bucket algorithm. Not implemented
 * yet — see benchmark/tasks/feature-02.json for the required behavior.
 *
 * Expected shape:
 *   createRateLimiter({ capacity, refillPerSecond, now? }) -> { check(clientId, route) }
 * where `check` returns { allowed: boolean, retryAfterSeconds: number }. `now` is
 * an injectable clock (a function returning epoch milliseconds) so that refill
 * behavior can be tested deterministically without real elapsed time.
 */
function createRateLimiter({ capacity, refillPerSecond, now = () => Date.now() }) {
  throw new Error('createRateLimiter is not implemented yet');
}

module.exports = { createRateLimiter };
