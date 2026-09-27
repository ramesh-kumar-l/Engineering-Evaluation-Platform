# Fixture: test-generation-01

Self-hosted benchmark fixture for `benchmark/tasks/test-generation-01.json` — see
`project-memory-bank/14-decisions.md` ADR-006/ADR-007 for why fixtures are self-hosted and
committed this way.

`dateUtil.js` is a complete, correct module with no test coverage. The task is to **write** a
thorough unit-test suite (replacing the failing placeholder `dateUtil.test.js`) covering typical
inputs, weekend boundaries, and invalid input — without modifying `dateUtil.js`.

**Note on discrimination:** because the agent authors the tests that the `test-suite` verifier
then runs, this fixture is largely self-graded — task-success does not sharply distinguish context
conditions the way the source-fixing fixtures (e.g. `debugging-01`, `performance-01`) do. It is
included for **category coverage** (test-generation) and for secondary metrics (tokens, turns),
not as a strong success discriminator. This limitation is stated plainly rather than hidden.
