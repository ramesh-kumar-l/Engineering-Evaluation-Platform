# Fixture: refactoring-02

Self-hosted benchmark fixture for `benchmark/tasks/refactoring-02.json` — see
`project-memory-bank/14-decisions.md` ADR-006/ADR-007 for why fixtures are self-hosted and
committed this way.

`dataStore.js` ships a Node-style callback API. The task is to convert the public surface to
Promise-returning async functions while keeping a backward-compatible `getCallback` wrapper.
`dataStore.test.js` exercises the async/await style, Promise rejection on a missing key, and the
callback wrapper — so it fails against the callback-only implementation and passes once the
module returns Promises.
