# Fixture: performance-01

Self-hosted benchmark fixture for `benchmark/tasks/performance-01.json` — see
`project-memory-bank/14-decisions.md` ADR-006/ADR-007 for why fixtures are self-hosted and
committed this way.

The shipped `reportGenerator.js` fetches line items with one query per order (an N+1 pattern).
`reportGenerator.test.js` asserts both output correctness and that a 200-order report issues a
small, constant number of queries — so it fails until the fetch is batched. The `FakeDb` in
`db.js` counts queries; there is no real I/O, keeping the task fully offline and deterministic.
