# Fixture: feature-02

Self-hosted benchmark fixture for `benchmark/tasks/feature-02.json` — see
`project-memory-bank/14-decisions.md` ADR-006/ADR-007 for why fixtures are self-hosted and
committed this way.

`rateLimiter.js` is an unimplemented stub. The task is to implement token-bucket rate limiting
keyed per (client, route), returning `{ allowed, retryAfterSeconds }`. `rateLimiter.test.js`
injects a fake clock (`now`) so refill-over-time behavior is asserted deterministically without
real elapsed time; it fails until the limiter is implemented.
