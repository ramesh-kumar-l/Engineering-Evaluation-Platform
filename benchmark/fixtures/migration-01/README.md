# Fixture: migration-01

Self-hosted benchmark fixture for `benchmark/tasks/migration-01.json` — see
`project-memory-bank/14-decisions.md` ADR-006/ADR-007 for why fixtures are self-hosted and
committed this way.

`src/` ships a CommonJS utility module. The task is to migrate it to native ES modules
(import/export) with a documented CommonJS interop path. `calc.test.mjs` encodes the migration
invariant directly — it asserts that no `require()`/`module.exports`/`exports.*` remain in `src/`
(EEP has no repository-invariant verifier, so the check lives in the test suite) — and confirms
behavior is preserved via dynamic `import()`, which works for both a CommonJS and an ES module.
The test therefore fails while `src/` is still CommonJS and passes once it is migrated. Any CJS
interop shim should live outside `src/` (e.g. a root `.cjs` entry or an `exports` map).
