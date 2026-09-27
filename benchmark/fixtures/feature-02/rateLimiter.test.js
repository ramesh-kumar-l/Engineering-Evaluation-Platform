const assert = require('node:assert');
const { createRateLimiter } = require('./rateLimiter');

// Injectable clock so refill is deterministic without real time.
let clockMs = 0;
const now = () => clockMs;
const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1, now });

// Under the limit: the first two requests for a (client, route) pass through.
assert.strictEqual(limiter.check('client-a', '/x').allowed, true);
assert.strictEqual(limiter.check('client-a', '/x').allowed, true);

// The third immediate request exceeds the limit -> blocked with a numeric,
// positive Retry-After (seconds).
const blocked = limiter.check('client-a', '/x');
assert.strictEqual(blocked.allowed, false);
assert.strictEqual(typeof blocked.retryAfterSeconds, 'number');
assert.ok(blocked.retryAfterSeconds > 0);

// Limits are tracked independently per client and per route.
assert.strictEqual(limiter.check('client-b', '/x').allowed, true, 'different client is independent');
assert.strictEqual(limiter.check('client-a', '/y').allowed, true, 'different route is independent');

// The bucket refills over elapsed time rather than only at fixed window resets:
// after 1s at 1 token/s, client-a on /x may proceed again.
clockMs += 1000;
assert.strictEqual(limiter.check('client-a', '/x').allowed, true);
// ...but a further immediate request is blocked again (only one token refilled).
assert.strictEqual(limiter.check('client-a', '/x').allowed, false);

console.log('rate limiter tests passed');
