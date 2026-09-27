# 14 — Architectural Decision Records

Format: Decision / Context / Options / Chosen approach / Reason / Trade-offs / Consequences / Status.

## ADR-001: EEP is a separate repository from ECC

- **Context:** ECC is an existing, working system. EEP evaluates it.
- **Options:** (a) monorepo with ECC, (b) separate repository integrating via interfaces.
- **Chosen approach:** (b) separate repository.
- **Reason:** Master system prompt hard constraint — EEP must remain evaluation-independent and
  never risk coupling to or modifying ECC internals.
- **Trade-offs:** Slightly more integration friction (no shared build/tooling); accepted
  deliberately.
- **Consequences:** All ECC integration goes through a `ContextProvider` contract, never direct
  imports. See [[00-project-charter]], [[04-architecture]].
- **Status:** Accepted, permanent.

## ADR-002: TypeScript on Node.js as the implementation stack

- **Context:** Phase 0 needed a language/runtime choice before any scaffolding could be written.
- **Options considered:** Python (strong stats/data ecosystem, pydantic, pytest), TypeScript/Node
  (strong JSON/schema tooling, CLI ergonomics, likely alignment with agent/ECC tooling), Go
  (single-binary CLI, strong concurrency, weaker stats ecosystem).
- **Chosen approach:** TypeScript on Node.js (>=20), ESM, strict mode.
- **Reason:** User's explicit choice. The evaluation domain is JSON/schema-artifact-heavy
  (Tasks, Runs, Traces, Reports), which TypeScript's type system and ecosystem (Zod, etc.) suits
  well; one language across CLI, adapters, and a future dashboard reduces context-switching.
- **Trade-offs:** Statistical/ablation analysis (Phase 7-8) has a smaller native ecosystem than
  Python's; will rely on well-tested small libraries or hand-rolled statistics with unit tests
  rather than assuming a mature stats stack.
- **Consequences:** All future phases' code is TypeScript; schemas (Phase 1) will likely use Zod
  or a similar runtime-validated approach so schemas double as both compile-time types and
  runtime validators.
- **Status:** Accepted.

## ADR-003: Vitest as the test runner

- **Context:** Needed a TypeScript-native test runner for Phase 0 scaffolding onward.
- **Options considered:** Jest (+ ts-jest), Node's built-in test runner, Vitest.
- **Chosen approach:** Vitest.
- **Reason:** Native ESM/TypeScript support without a separate transpilation config; fast; good
  DX; widely adopted in the current TS ecosystem.
- **Trade-offs:** Slightly less battle-tested than Jest in very large codebases; not a concern at
  current project scale.
- **Status:** Accepted.

## ADR-004: Local-first, no database/queue/service infrastructure initially

- **Context:** Master prompt §54/§60 explicitly warns against premature infrastructure.
- **Chosen approach:** Evaluation artifacts are files on disk (JSON/JSONL/CSV/Markdown/HTML); no
  database, message queue, or microservices until a real requirement demonstrates the need.
- **Reason:** Matches the "scientific instrument first" objective and local-first principle;
  avoids infrastructure complexity before the data model/metrics are validated.
- **Status:** Accepted; revisit only when a concrete Phase 9+ requirement demands it.

## ADR-005: Zod for schemas, semver literal field for versioning

- **Context:** Phase 1 (Evaluation Contract) needed a concrete way to define the 14 domain
  entities ([[05-domain-model]]) as both compile-time types and runtime validators, plus a
  versioning convention satisfying NFR6 (independent versioning per schema).
- **Options considered:** hand-written TS interfaces + manual runtime checks; io-ts; Zod.
- **Chosen approach:** Zod schemas as the single source of truth; each entity module exports a
  `<ENTITY>_SCHEMA_VERSION` constant and embeds it as a `z.literal(...)` `schemaVersion` field on
  the schema itself, so every serialized artifact self-describes the schema version it was
  written against. Entity IDs are compile-time-branded strings (e.g. `TaskId` vs `RunId` cannot
  be substituted for each other) via a small local `brandedId()` helper, not Zod's built-in
  `.brand()`, to stay resilient to Zod major-version API changes.
- **Reason:** Zod gives one definition for both static types (`z.infer`) and runtime validation,
  which the JSON/artifact-heavy domain model needs; the memory-bank `schemas/*.md` stubs
  explicitly deferred concrete schema choice to this phase.
- **Trade-offs:** All future contributors must know Zod; schema files sit above the file-size
  norm for trivial entities only in the sense that each carries its own version constant and
  doc-comment, not extra logic.
- **Consequences:** `project-memory-bank/schemas/*.md` files are now thin pointers to
  `src/domain/**/*.schema.ts` rather than duplicated specs, to avoid drift (memory-bank
  token-efficiency rule). A breaking field change bumps the relevant `*_SCHEMA_VERSION` and gets
  a new ADR entry or an addendum here.
- **Status:** Accepted.

## ADR-006: Self-hosted benchmark fixtures, one JSON task file per task

- **Context:** Phase 2 (Benchmark V1) needed to decide where the 30 `Task` records
  ([[07-benchmark-strategy]]) live on disk, and what `repository` (url + commitSha) should point
  to for each — `taskSchema` requires both fields non-empty.
- **Options considered:** (a) real external GitHub repositories pinned by a real commit SHA
  (SWE-bench style); (b) self-hosted fixture repositories versioned inside EEP itself under
  `benchmark/fixtures/<id>/`; (c) one giant tasks.json array vs. one file per task.
- **Chosen approach:** (b) self-hosted fixtures, path convention `benchmark/fixtures/<id>/`; (c)
  one JSON file per task under `benchmark/tasks/<id>.json`, loaded/validated by
  `src/benchmark/loadTasks.ts` against `taskSchema`. Every Phase 2 task record uses the sentinel
  `repository.commitSha: "unpinned"` — actual fixture source code and a real pinned SHA are
  deferred to Phase 3 (Experiment Harness), which owns "environment isolation" per
  [[13-roadmap]]; Phase 2's job is the task *contract* (title, description, category, complexity,
  acceptance criteria, verification method, ground truth), not a runnable checkout.
- **Reason:** External repos risk contamination (well-known code may be in agent training data —
  directly against the "avoid benchmark contamination" quality rule), risk drift/unavailability
  over time (breaks reproducibility), and require network access (against the local-first
  principle in [[04-architecture]]). Self-hosted fixtures keep EEP in full control of history and
  are fully offline. One-file-per-task keeps each file small (strict modularity) and diff-friendly
  in code review, versus one large array file.
- **Trade-offs:** EEP must author and maintain its own small fixture codebases rather than reusing
  real-world repositories; fixture realism is bounded by what EEP authors, not sampled from
  production code. Accepted as appropriate for a controlled, reproducible V1 benchmark.
- **Consequences:** `"unpinned"` in `repository.commitSha` is a documented Phase 2/3 boundary
  marker, not a defect — see [[07-benchmark-strategy]] §Benchmark structure. Phase 3 must replace
  it with a real commit SHA once each fixture's source code is authored and committed.
- **Status:** Accepted.

## ADR-007: Phase 3 environment isolation, fixture commit-SHA method, and two small interface fixes

- **Context:** Phase 3 (Experiment Harness) needed to implement real environment isolation, a
  concrete `Agent`/`ContextProvider` pair, and — per ADR-006 — replace the `"unpinned"` sentinel
  with a real `commitSha` for at least a proof set of fixtures.
- **Options considered (isolation):** (a) container-based sandboxing (Docker), (b) OS-level
  process sandboxing, (c) filesystem-level isolation — copy the fixture into a disposable temp
  directory before an agent ever touches it.
- **Chosen approach (isolation):** (c). `src/harness/workspace.ts`'s `createIsolatedWorkspace()`
  copies a fixture into a fresh `os.tmpdir()` directory (excluding any `.git`) and returns a
  `cleanup()` that removes it; every `Agent`/`ContextProvider` call receives only the sandbox
  path, never the canonical fixture path.
- **Reason (isolation):** Matches the local-first stance (ADR-004) — no new infrastructure
  dependency (Docker) before a concrete need (e.g. running untrusted agent-generated code)
  demonstrates it. Filesystem isolation is sufficient to guarantee a run can never mutate
  `benchmark/fixtures/` and is trivially reproducible on any contributor's machine.
- **Trade-offs (isolation):** Does not sandbox CPU/memory/network or protect against a malicious
  agent executing arbitrary commands — acceptable now because Phase 3's agents (native
  exploration only) don't execute fixture code; revisit before any agent that runs untrusted
  generated commands (flagged in [[16-risks]]).
- **Options considered (commit SHA):** (a) `git init` directly inside
  `benchmark/fixtures/<id>/`, committed as part of the main EEP repo; (b) build each fixture in a
  scratch location, `git commit` it there to obtain a real SHA, then copy only the resulting
  working tree (no `.git`) into `benchmark/fixtures/<id>/`.
- **Chosen approach (commit SHA):** (b). `debugging-01`, `feature-01`, and `refactoring-01` were
  authored this way; their `repository.commitSha` is now a real git commit SHA
  (`f3518a14...`, `ab3a1260...`, `78e0541a...` respectively), computed by an actual `git commit`
  against that fixture's own content, not fabricated.
- **Reason (commit SHA):** (a) would embed a nested `.git` directory inside the main repository's
  tree, which Git treats as an embedded-repository "gitlink" — `git add` in the parent repo
  would then track only a commit pointer for that directory instead of its files, silently
  breaking the one-file-per-task / diff-friendly fixture convention from ADR-006. (b) yields an
  equally real, verifiable commit SHA without that footgun.
- **Trade-offs (commit SHA):** The ephemeral git repo used to mint the SHA is not itself
  preserved in EEP's history — only its resulting file tree and the SHA recorded on the task are.
  This is acceptable: reproducibility requires the pinned *content* to be stable and inspectable
  (it is, under `benchmark/fixtures/<id>/`), not a replayable git history of how it was authored.
- **Consequences (commit SHA):** Per the "representative subset" scope agreed with the user for
  this phase, only 3 of the 30 tasks were converted from `"unpinned"` to a real `commitSha` in
  Phase 3; the remaining 27 stay `"unpinned"` and are explicit backlog (see [[20-next-actions]]),
  to be picked up incrementally — most urgently by whichever task Phase 4 (Deterministic
  Evaluation) first needs to actually execute verification against.
- **Interface fixes:** Implementing the first real `Agent`/`ContextProvider` adapters surfaced two
  gaps in the Phase 1 interfaces (`src/domain/providers/agent.ts`,
  `src/domain/providers/context-provider.ts`), neither of which had an implementation yet to
  break: (1) `AgentRunRequest` and `ContextProviderRequest` gained a required `runId: RunId` field
  — without it, an adapter has no way to stamp a schema-valid, correctly-linked `Action`,
  `Decision`, or `ContextArtifact` (all of which require `runId`). (2) `traceSchema` gained an
  optional `agentReportedStatus: RunStatus` field — the agent's own self-reported completion
  signal, captured for provenance; it is never authoritative (only a Verification-backed
  `Outcome.status`, Phase 4, is) and defaults to absent for backward compatibility, so no
  `TRACE_SCHEMA_VERSION` bump was needed.
- **Status:** Accepted.

## ADR-008: Verification as a pluggable, text-triggered checker registry; Outcome.status always overrides agentReportedStatus

- **Context:** Phase 4 (Deterministic Evaluation) needed to turn a Trace into an authoritative
  `Outcome`, using `task.verificationMethod` (a free-text field like `"test-suite: run the
  pagination tests."` or `"diff-analysis: confirm duplication removed, combined with a
  test-suite run."`) to decide which checks to run, and needed a single rule for combining
  possibly-conflicting signals (the agent's own self-report vs. what verification actually found)
  into one `RunStatus`.
- **Options considered (verifier selection):** (a) a rigid enum-to-verifier 1:1 mapping requiring
  every task's `verificationMethod` to name exactly one method; (b) a small `Verifier` interface
  (`appliesTo(task)` + `run(context)`) with a registry (`ALL_VERIFIERS`), where each verifier
  text-matches its own keyword against `verificationMethod` and multiple verifiers may apply to
  one task.
- **Chosen approach (verifier selection):** (b). `src/evaluation/verifiers/`: `testSuiteVerifier`
  (spawns the fixture's own `npm test`, no shell-injection risk since the command is fixed and
  never built from task/agent-controlled input) and `diffAnalysisVerifier` (generic structural
  check: did any file actually change relative to the pristine fixture — necessary-but-not-
  sufficient evidence, catches "explored and claimed success without changing anything"). A
  verifier that cannot run at all (missing test script, unreadable fixture) throws
  `VerificationExecutionError`/`VerificationTimeoutError` rather than returning a fabricated
  `passed: false`, so "evaluation unavailable" is never silently reported as "evaluation failed."
- **Reason (verifier selection):** Matches
  project-memory-bank/06-evaluation-methodology.md §Multi-evidence outcome evaluation ("prefer
  combining, where available") — `refactoring-01`'s verificationMethod names both `diff-analysis`
  and `test-suite`, and both genuinely run and get combined into one Outcome.
- **Options considered (status combination):** (a) trust `agentReportedStatus` when it says
  `SUCCESS` and only fall back to verification on `INCOMPLETE`; (b) `agentReportedStatus` governs
  only the infra-level statuses (`ENVIRONMENT_FAILURE`, `AGENT_FAILURE`, `TIMEOUT`) — for every
  other case, verification alone decides `SUCCESS` vs. `TASK_FAILURE`, and an empty verification
  result is `EVALUATION_FAILURE`.
- **Chosen approach (status combination):** (b), implemented as the pure function
  `determineOutcomeStatus()` in `src/evaluation/determineOutcome.ts`.
- **Reason (status combination):** This is the entire point of Phase 4 per
  [[schemas/trace-schema]] and ADR-007's interface-fix note: an agent claiming `SUCCESS` does not
  mean the work is correct. Trusting the self-report for `SUCCESS` would make `Outcome.status`
  redundant with `agentReportedStatus` and defeat the purpose of building verification at all.
  Proven concretely by two fixtures under test: `debugging-01` run by a test-only agent that
  writes a genuine fix reports `agentReportedStatus: SUCCESS` and independently verifies to
  `Outcome.status: SUCCESS`; `refactoring-01` run by `NativeAgent` has its `test-suite` check pass
  (pre-refactor behavior is intact) but its `diff-analysis` check fail (nothing was actually
  changed), correctly yielding `TASK_FAILURE` overall — multi-evidence combination doing exactly
  the job the methodology describes.
- **Trade-offs:** `diffAnalysisVerifier`'s "did anything change" check is a coarse, task-agnostic
  signal — it cannot tell a correct refactor from a destructive one; it only rules out "no attempt
  was made." Finer-grained diff analysis (e.g., "duplication actually removed") would need
  task-specific assertions, deferred until a concrete need arises.
- **Consequences:** `src/harness/runHarness.ts` gained one small, backward-compatible extension
  point (`HarnessDependencies.onBeforeCleanup`, optional) so verification can run against the
  agent-modified workspace before it is cleaned up, without `executeRun()`/Phase 3 tests knowing
  anything about `Verification`/`Outcome`. Contract: the hook must never throw (a throw would be
  indistinguishable from `AGENT_FAILURE`); `src/evaluation/evaluateRun.ts`'s hook guarantees this
  by construction (`runVerifiers()` catches every verifier's errors internally).
- **Status:** Accepted.

## ADR-009: Metrics computed only where a real data source exists; single-run definition before multi-run aggregation

- **Context:** Phase 5 (Metrics) needed to populate the `Metric` schema with real values for the 5
  primary + 17 secondary metric names named in [[08-metrics]], computed from the
  `Run`/`Trace`/`Outcome`/`Verification`/`Evidence`/`ContextArtifact` records Phases 3-4 produce,
  and to decide how metrics aggregate across repeated runs of the same Task×Condition pair ahead
  of Phase 7's full statistical rigor.
- **Options considered (coverage):** (a) implement all 22 named metrics now, approximating the
  ones with no real data source (e.g. `evidence-recall` with no ground-truth evidence set,
  `risk-classification` with no risk field on `Task`); (b) implement only the metrics honestly
  computable from data that already exists, and explicitly document the rest as not-yet-computable
  rather than fabricating a placeholder value.
- **Chosen approach (coverage):** (b). 14 of 22 metrics are implemented — all 5 primary
  (`task-success`, `engineering-quality`, `time-to-correct-outcome`, `context-efficiency`,
  `human-intervention`) and 9 secondary (`context-tokens`, `tool-calls`, `agent-turns`,
  `files-read`, `files-changed`, `retries`, `failed-attempts`, `provenance-completeness`,
  `verification-completeness`). `evidence-recall`, `evidence-precision`, `evidence-authority`,
  `evidence-freshness`, `context-redundancy`, `regression-rate`, `risk-classification`, and
  `decision-confidence` are not computed — each needs a data source (a curated "required evidence"
  set, a source-authority model, cross-run history, a `Task.risk` field, a `Decision.confidence`
  field) that does not exist yet.
- **Reason (coverage):** Fabricating a value for a metric with no real basis would silently
  misrepresent the system under test — the same integrity principle already governing
  [[00-project-charter]] and ADR-008's "throw rather than report a false negative" rule. Two
  metrics needed an honest proxy rather than their literal memory-bank definition, and that
  substitution is documented in code, not hidden: `engineering-quality` (full definition needs
  static-analysis/security-check/architecture-check verifiers that don't exist yet — Phase 5
  computes it as "fraction of executed verifications that passed," which is real, non-fabricated
  data) and `context-efficiency` (the "usefulness" side of the ratio has no ground truth until
  ECC/Phase 6 provides curated context to compare against — Phase 5 approximates usefulness as
  "did the run succeed," expressed per 1000 context tokens).
- **Options considered (aggregation):** (a) build full statistical machinery now (confidence
  intervals, significance testing) even though Phase 5 only produces single-run data; (b) define
  and unit-test a single run's metric value correctly first, and ship only a lightweight
  mean/median/sample-stddev summarizer (`aggregateMetricsByName()`) as a preview, explicitly
  deferring real statistical rigor to Phase 7 (Experimental Analysis).
- **Chosen approach (aggregation):** (b). `src/metrics/aggregateMetrics.ts` groups a list of
  `Metric` records by `name` and reports count/mean/median/sample-stddev; it does not know about
  Task/Condition identity (a `Metric` only carries `runId`) and performs no significance testing —
  callers are responsible for only passing metrics from the same Task×Condition pair.
- **Reason (aggregation):** [[13-roadmap]] scopes "aggregation" into Phase 5 and "repeated runs"/
  full analysis into Phase 7 separately; building rigorous statistics before there is more than a
  handful of real repeated runs to validate against would be premature infrastructure, the same
  anti-pattern ADR-004 already rejects.
- **Trade-offs:** The 8 unimplemented secondary metrics remain enum-only (matching the same
  pattern ADR-008 already established for unimplemented `Verifier` methods); a reader of
  [[08-metrics]] alone (without also reading [[implementation-status]]) could mistakenly assume
  all 22 are live.
- **Consequences:** `src/harness/runHarness.ts`'s `HarnessRunOutcome` gained an additive, optional
  `contextArtifact` field (the full `ContextArtifact`, not just its id) and
  `src/evaluation/evaluateRun.ts`'s `EvaluatedRunOutcome` gained an additive `executionErrors`
  field — both were already computed internally and discarded; Phase 5's `context-tokens`/
  `context-efficiency` and `verification-completeness` metrics need them. Neither change altered
  any existing field, and all pre-existing Phase 3/4 tests passed unchanged. Adding a metric for a
  now-existing data source later is a new file under `src/metrics/`, following the same
  registry-free "one function per concern" pattern as `primaryMetrics.ts`/`secondaryMetrics.ts`.
- **Status:** Accepted.

## ADR-010: ECC integration via subprocess CLI invocation, EEP owns an independent schema mirror

- **Context:** Phase 6's exit criterion is a real `ContextProvider` backed by ECC, wired through
  ECC's external interface only — never an import of ECC's internal modules — per the hard
  repository-boundary rule in [[00-project-charter]]. [[04-architecture]] left the exact
  mechanism ("likely CLI invocation or a documented artifact contract") deferred to this phase.
- **Options:** (a) CLI subprocess invocation of ECC's published `ecc` binary/`dist/cli/index.js`
  entry point, parsing its documented stdout JSON contract; (b) a filesystem artifact contract
  (ECC writes a context file, EEP reads it); (c) importing ECC's TypeScript modules directly as a
  library dependency.
- **Chosen approach:** (a) subprocess CLI invocation.
- **Reason:** ECC's own README documents exactly one stable, versioned, human-and-machine-
  readable contract for this purpose: `ecc context "<task>" --path <dir> [--budget <n>]` printing
  a validated `EngineeringContextPackage` JSON document to stdout (ECC validates its own output
  against its internal schema before printing — see ECC's `src/cli/cli.ts`). This is lower
  friction than (b) for a synchronous request/response shape, and (c) is categorically
  disallowed by the repository boundary rule regardless of friction.
- **Trade-offs:** A subprocess call is slower and has weaker type safety at the boundary than an
  in-process call would; mitigated by owning an independent Zod schema (`eccPackageSchema.ts`)
  that mirrors ECC's documented package shape and validates every invocation's output before any
  of it is trusted, so a future ECC contract change fails loudly (a `EccInvocationError`) rather
  than silently producing garbage. The invoked command is not hardcoded — `EccCliInvokerOptions`
  (`command`/`commandArgs`, defaulting to `ECC_CLI_COMMAND` env var else `"ecc"`) lets a
  deployment point at a global link or `node <checkout>/dist/cli/index.js` with zero EEP code
  changes, so this repo never bakes in another machine's absolute path.
- **Consequences:** New `src/harness/providers/ecc*.ts` (all under 300 lines):
  `eccPackageSchema.ts` (independent contract mirror), `eccCliInvoker.ts`
  (`ProcessEccCliInvoker`, array-argument `execFile` — never shell string interpolation, matching
  ECC's own documented security posture — with `EccInvocationError`/`EccTimeoutError`), and
  `eccContextProvider.ts` (`EccContextProvider implements ContextProvider`, condition B/C's real
  context source per [[09-experiment-strategy]]). The full validated package JSON becomes the
  `ContextArtifact.content`; `tokenCount` uses Phase 5's `estimateTokenCount()` since ECC's CLI
  contract does not itself report a token count. Unit tests inject a fake `EccCliInvoker` (no
  subprocess) or spawn small self-authored fake-CLI scripts (matching the ADR-007 fixture
  discipline of never depending on uncontrolled external state); one additional test
  (`eccContextProvider.realCli.test.ts`) does invoke a real sibling ECC checkout end-to-end but is
  `skipIf`-gated on that checkout existing and being built, so the suite stays green in any
  environment that only has this repo. Exit criterion scope note: this phase, as instructed,
  covers only the `ContextProvider`; a real solving agent and an actual multi-condition
  comparison run remain open next actions (roadmap Phase 6 originally scoped both together) —
  see [[phases/phase-06]] and [[20-next-actions]].
- **Status:** Accepted.

## ADR-011: Hand-rolled statistics module with exact published critical values, never approximated formulas; explicit insufficient-data results instead of exceptions bubbling through orchestration

- **Context:** Phase 7's exit criterion is repeated-run statistical analysis (confidence
  intervals, effect size) across categories/complexity — explicitly deferred by ADR-009 when
  Phase 5 shipped only a non-statistical mean/median/stddev summarizer
  (`aggregateMetricsByName()`). No statistics library is in `package.json` (ADR-002 anticipated
  this trade-off: "will rely on well-tested small libraries or hand-rolled statistics with unit
  tests rather than assuming a mature stats stack").
- **Options considered (implementation):** (a) add a third-party statistics npm dependency; (b)
  hand-roll the needed statistics, approximating the inverse t-distribution and inverse normal
  CDF with a numerical formula (e.g. rational approximations); (c) hand-roll the needed
  statistics using exact, published critical values for a fixed, small set of confidence levels
  rather than a general inverse-distribution function.
- **Chosen approach:** (c). `src/analysis/tDistribution.ts` hardcodes the standard published
  two-tailed t-table for degrees of freedom 1-30 at exactly three confidence levels (90%/95%/99%),
  falling back to the exact standard-normal z-critical value beyond df=30 (where the t and normal
  distributions are already close). `src/analysis/confidenceInterval.ts` builds
  `meanConfidenceInterval()` (Student's t, for continuous metrics) and
  `proportionConfidenceInterval()` (Wilson score interval, for `task-success` — chosen over the
  naive normal approximation because Wilson stays well-behaved at small n and at proportions near
  0/1, both expected here). `src/analysis/effectSize.ts` implements Cohen's d (continuous metrics,
  pooled-variance standardized mean difference) and Cohen's h (proportion metrics, arcsine-
  transform difference), both classified into Cohen's conventional negligible/small/medium/large
  buckets.
- **Reason:** (a) adds a new runtime dependency for a small, well-understood set of formulas —
  premature per ADR-004's infrastructure-discipline. (b) risks a subtly wrong inverse-CDF
  approximation being silently trusted as "rigorous" when the whole point of this phase is
  producing numbers a reader can trust; (c) is fully unit-testable against hand-verified worked
  examples (see `tDistribution.test.ts`, `confidenceInterval.test.ts`, `effectSize.test.ts`) and
  every value traces to a citeable published table or an exact closed-form constant, not an
  approximation of unproven accuracy.
- **Options considered (grouping/orchestration):** (a) let `meanConfidenceInterval()`/`cohensD()`
  throw all the way up through the category/complexity orchestrator whenever a group has too few
  runs, aborting the whole analysis; (b) have the orchestrator (`groupedAnalysis.ts`) catch or
  pre-check sample size per group and return a typed `{status: 'insufficient-data', reason}` result
  for that one group/comparison, leaving every other group's result intact.
- **Chosen approach (orchestration):** (b). `GroupStatisticalSummary` and `GroupComparison` are
  discriminated unions (`status: 'ok' | 'insufficient-data'`); the low-level functions in
  `confidenceInterval.ts`/`effectSize.ts` still throw when called directly (so a test or a direct
  caller can't silently receive a fabricated interval), but `repeatedRunAnalysis.ts`/
  `groupedAnalysis.ts` check sample size explicitly before calling them and produce an
  `insufficient-data` result instead of letting the exception propagate.
- **Reason (orchestration):** A real experiment will have plenty of (category × complexity ×
  condition) cells with only 1-2 runs, especially before many repeated runs accumulate; one
  underpowered cell should not crash the entire analysis or silently disappear from the report —
  it should say plainly why no interval could be computed. Matches the "never silently convert
  unavailable into failed" discipline already established for verification
  (project-memory-bank/06-evaluation-methodology.md §Explicit failure taxonomy, ADR-008).
- **Trade-offs:** Only three confidence levels are supported (90/95/99) rather than an arbitrary
  one — an intentional restriction, not a gap, since it lets every critical value be an exact
  table lookup instead of an approximation. `analyzeRepeatedRuns()` never labels a condition
  "better" (project-memory-bank/08-metrics.md §Anti-goal: direction of improvement is metric-
  specific, e.g. lower `time-to-correct-outcome` is better but higher `task-success` is better) —
  interpretation is left to a human reader or a later reporting layer (Phase 9).
- **Consequences:** New `src/analysis/*.ts` (all under 300 lines; largest is
  `repeatedRunAnalysis.ts` at 157): `stats.ts` (generic descriptive stats + shared
  `InsufficientSampleSizeError`), `tDistribution.ts`, `confidenceInterval.ts`, `effectSize.ts`,
  `groupBy.ts`, `analysisInput.ts` (`RunAnalysisRecord`, the structural input type pairing a run's
  already-computed `Metric[]` with its condition name and task category/complexity — decoupled
  from `harness`/`evaluation` types the same way `RunMetricsInput` is), `repeatedRunAnalysis.ts`
  (per-condition summaries and pairwise comparisons), and `groupedAnalysis.ts`
  (`analyzeRepeatedRuns()`, the Phase 7 entry point: overall + by-category + by-complexity). No
  new Zod domain entity was added — like Phase 5's `AggregatedMetric`, these are plain TypeScript
  interfaces, not a 15th schema-versioned entity in the fixed domain model
  ([[05-domain-model]]) — since nothing here is persisted yet; that remains Phase 9's job.
  `analyzeRepeatedRuns()` has not yet been run against real multi-condition experiment data,
  since no such data exists yet (Phase 6's remaining scope — a real solving agent and an actual
  comparison run — is still open); it is validated against synthetic fixture data in tests, the
  same way Phase 5's metrics functions were validated before 30 real fixtures existed.
- **Status:** Accepted.

## ADR-012: Content-level ablation of ECC's package fields as Condition-level treatments, measured by reusing Phase 7's analysis unchanged

- **Context:** Phase 8's exit criterion is per-component measurement of ECC's contribution
  (project-memory-bank/06-evaluation-methodology.md §Ablation discipline names 7 candidate
  components: history, memory, ranking, provenance, risk, budgeting, verification). ADR-010's
  repository-boundary rule means EEP integrates with ECC only through its documented CLI contract
  (`ecc context "<task>" --path <dir> [--budget <n>]`) — that contract has no flag to disable an
  internal ECC component, so true inside-ECC ablation is not reachable without violating the
  boundary rule.
- **Options considered (ablation mechanism):** (a) treat ablation as out of scope until ECC
  documents per-component flags; (b) fork/patch a local ECC checkout to add such flags (violates
  ADR-001's repository-independence rule); (c) ablate at the *content* level — after ECC returns
  its full, validated `EccContextPackage`, deterministically strip or neutralize exactly one
  already-present field before it becomes a `ContextArtifact`, holding every other field (and the
  task/repository/agent) constant.
- **Chosen approach:** (c). `src/harness/providers/eccAblation.ts` maps each of the 7 named
  components onto a real, already-validated field of `EccContextPackage`
  (`eccPackageSchema.ts`) — never a fabricated dimension, matching ADR-009's "only compute from a
  real data source" discipline: `history`→`history: []`; `memory`→evidence items whose
  `source === 'memory'` removed from `context.primary`/`context.supporting`; `ranking`→primary and
  supporting evidence merged into one list ordered by a ranking-independent key (path/identifier)
  instead of ECC's relevance ordering, with `supporting` emptied; `provenance`→each evidence
  item's optional `provenance` sub-object stripped; `risk`→`conflicts: []`; `budgeting`→
  `excluded: []`; `verification`→`verification: []`. `ablatePackage()` is a pure function
  (`structuredClone` input, never mutates it). `src/harness/providers/
  ablatedEccContextProvider.ts` (`AblatedEccContextProvider implements ContextProvider`) wraps one
  component's ablation as its own named Condition (`ecc-ablated:<component>`, via
  `ablatedConditionName()`) — per project-memory-bank/09-experiment-strategy.md, "the only varying
  dimension is the ContextProvider," so running the same agent against `EccContextProvider` (the
  control) and each `AblatedEccContextProvider` (one per component) isolates that component's
  marginal effect on outcomes. The shared invoke+parse+validate logic both providers need was
  extracted out of Phase 6's `eccContextProvider.ts` into a new `eccPackageFetcher.ts` (`
  fetchValidatedEccPackage()`) rather than duplicated.
- **Reason:** Option (a) would leave Phase 8 permanently blocked on an external project's roadmap;
  option (b) is categorically disallowed by ADR-001. Option (c) genuinely varies only the named
  component's information while measuring the same agent against the same task/repository — the
  same causal-isolation logic already governing Condition design — and every ablated field is one
  ECC itself already reports as real, not invented by EEP.
- **Options considered (measurement):** (a) build new statistical/orchestration code specific to
  ablation; (b) reuse Phase 7's `analyzeRepeatedRuns()` unchanged, since an ablation comparison is
  structurally identical to any other Condition-vs-baseline comparison it already generalizes to.
- **Chosen approach (measurement):** (b). `src/analysis/componentContribution.ts`
  (`analyzeComponentContributions()`) takes a caller-supplied `component → ablated condition name`
  map (kept decoupled from any specific provider's naming convention, the same one-way-dependency
  discipline `analysisInput.ts` established), filters the records to just the full-condition and
  that one ablated condition per component, and calls `analyzeRepeatedRuns()` once per component.
  No new confidence-interval, effect-size, or insufficient-data logic was written.
- **Reason (measurement):** Phase 7 was deliberately built to compare an arbitrary baseline
  against every other condition present in a dataset, across categories/complexity, with explicit
  `insufficient-data` handling — an ablated-component condition is not a special case of that, so
  writing new statistics for it would duplicate ADR-011's logic for no benefit.
- **Trade-offs:** This is content-level, black-box ablation, not a measurement of ECC's actual
  internal component architecture — if ECC computes a component's contribution in a way that also
  leaks into another field EEP doesn't strip (e.g. a ranking algorithm's influence surviving in
  which items were selected as `primary` at all, not just their order), the isolation is
  imperfect. This is a real, documented limitation, not silently assumed away — see
  [[phases/phase-08]] and [[16-risks]]. `ranking`'s ablation (reordering by path/identifier) is a
  judgment call for "what would no-ranking-benefit look like" — a different neutral ordering
  (e.g. random) was also viable; the alphabetical-by-identity choice was made because it is
  deterministic and reproducible across runs, per [[10-reproducibility]].
- **Consequences:** New files (all under 300 lines): `src/harness/providers/eccAblation.ts` (82
  lines), `ablatedEccContextProvider.ts` (64), `eccPackageFetcher.ts` (31, extracted from
  `eccContextProvider.ts` with no behavior change — its existing tests pass unmodified), and
  `src/analysis/componentContribution.ts` (59). No new Zod domain entity and no new statistics —
  consistent with ADR-011 and ADR-009's precedent of not building infrastructure ahead of a
  concrete, already-real need. `analyzeComponentContributions()` has not yet been run against real
  experiment data, for the same reason `analyzeRepeatedRuns()` hasn't (Phase 6's remaining scope
  is still open) — validated against synthetic fixtures in tests.
- **Status:** Accepted.

## ADR-013: Multi-provider LLM solving agent (two wire adapters for four backends); the same agent runs under every condition, including the native baseline

- **Context:** Phase 6's remaining roadmap scope — a real solving agent for Condition B/C, and an
  actual native-vs-ECC (and per-ablation-component) comparison run — was still open after ADR-010
  ([[phases/phase-06]]). The user explicitly required support for **both a local LLM and
  pluggable cloud backends** (Claude, Gemini, ChatGPT), not a single hardcoded vendor. Building
  this also required resolving a latent design flaw in [[20-next-actions]] item 2's literal
  wording ("replacing `NativeAgent` as the 'does real work' condition — `NativeAgent` remains the
  native/no-context baseline"): taken literally, this would compare a real LLM agent (ECC
  condition) against a deterministic, always-`INCOMPLETE`, never-edits-code agent (native
  baseline) — conflating "having a real agent" with "having ECC context" as one variable, directly
  contradicting [[09-experiment-strategy]]'s explicit causal-isolation principle ("All conditions
  share task, repository state, model, tools, environment, evaluator version. The only varying
  dimension is the `ContextProvider`") and matching the already-open "Baseline weakness" risk in
  [[16-risks]].
- **Options considered (backend coverage):** (a) one bespoke client per vendor (4 implementations:
  Anthropic, OpenAI, Google, and a generic local-server client); (b) exactly two wire adapters
  against an EEP-owned generic `LlmClient` interface — one Anthropic-native, one OpenAI-compatible
  — since ChatGPT, Gemini (via Google's own OpenAI-compatibility endpoint), and most local model
  servers (Ollama, LM Studio) all speak the same OpenAI-style `/chat/completions` +
  function-calling wire format.
- **Chosen approach (backend coverage):** (b). `src/harness/llm/`: `llmClient.types.ts` (the
  neutral `LlmClient`/`LlmMessage`/`LlmToolCall` shape — never a vendor SDK type leaking upward),
  `anthropicLlmClient.ts` (`AnthropicLlmClient`, covers Claude), `openAiCompatibleLlmClient.ts`
  (`OpenAiCompatibleLlmClient`, covers ChatGPT at `api.openai.com/v1`, Gemini at Google's
  OpenAI-compatibility endpoint, and any local OpenAI-compatible server via `baseUrl`), and
  `createLlmClient.ts` (`createLlmClient(config)` factory over an explicit `LlmProviderConfig`
  union — no provider is hardcoded as a default, mirroring ADR-010's "never hardcode, always
  configurable" convention). Both clients use Node ≥20's global `fetch`; no new npm dependency.
- **Reason:** Four bespoke clients would triple the new surface area for no real benefit, since
  three of the four target backends already converge on one wire format. `createLlmClient`'s
  config is always resolved from explicit environment variables
  (`src/experiments/llmProviderConfigFromEnv.ts`: `EEP_LLM_PROVIDER`/`EEP_LLM_MODEL`/
  `EEP_LLM_BASE_URL`/`EEP_LLM_API_KEY`), never a built-in fallback vendor — satisfies
  [[11-security]]'s "no source code leaves the local machine unless the user explicitly configures
  that": running against any cloud vendor is always an explicit opt-in, while the local-LLM path
  (`EEP_LLM_PROVIDER=openai-compatible` + a `localhost` `EEP_LLM_BASE_URL`) sends nothing off the
  machine.
- **Trade-offs (backend coverage):** Reusing each vendor's own OpenAI-compatibility shim for 3 of
  4 backends inherits any gaps in that vendor's compatibility layer (e.g. partial tool-calling
  support on some local models) rather than using that vendor's native wire format — a documented
  limitation, not silently assumed away (ADR-009 discipline).
- **Options considered (which agent runs which condition):** (a) follow [[20-next-actions]]'s
  literal wording — a new real agent only for the ECC condition, `NativeAgent` stays the baseline;
  (b) the new `LlmSolvingAgent` runs under *every* condition in the real comparison, including
  native — only the `ContextProvider` varies.
- **Chosen approach:** (b). `NativeAgent` (`src/harness/agents/nativeAgent.ts`) is left completely
  unmodified — it still proves the harness plumbing cheaply in its own tests — but is excluded
  from the real comparison run (`src/experiments/runComparisonExperiment.ts`); `LlmSolvingAgent`
  is the one agent used across all 9 conditions there (native + full ECC + 7 per-component
  ablations, from `src/experiments/experimentConditions.ts`).
- **Reason:** This is the only design that isolates context quality as the sole independent
  variable, per [[09-experiment-strategy]] — otherwise a measured "ECC helps" effect could equally
  be "having any real agent at all helps," an uncontrolled confound. This correction is called out
  explicitly rather than silently applied; [[20-next-actions]] and [[09-experiment-strategy]] are
  updated to match.
- **Solving agent design:** `LlmSolvingAgent implements Agent`
  (`src/harness/agents/llmSolvingAgent.ts`) runs a bounded tool loop: build an initial prompt from
  `Task` + optional `ContextArtifact.content` (`promptBuilder.ts`), then alternate model turn →
  tool execution → feed result back, until the model calls no further tools (agent-reported
  `SUCCESS`), a turn budget is exhausted (`INCOMPLETE`), a wall-clock budget is exhausted
  (`TIMEOUT`), or the LLM client errors unrecoverably (caught and returned as `AGENT_FAILURE`,
  never thrown — so a real `Decision` records why, instead of being lost to `runHarness.ts`'s
  blanket catch-all-to-`AGENT_FAILURE`). Per ADR-008, none of this self-report is authoritative —
  `determineOutcomeStatus()` and the real verifiers still decide `Outcome.status` independently,
  unchanged. The tool surface (`llmAgentTools.ts`) is deliberately narrow — `list_files`,
  `read_file`, `write_file` (every path resolved against the workspace root and rejected if it
  escapes it, since tool-call arguments come from model output and are untrusted input) and
  `run_tests` (always the fixture's own fixed `npm test`, never an arbitrary model-supplied
  command) — no generic shell-exec tool is exposed at all, directly addressing the "revisit before
  any agent executes untrusted generated commands" note on the environment-isolation risk in
  [[16-risks]]. `testSuiteVerifier.ts`'s `runNpmTest`/`SpawnOutcome` spawn logic was extracted
  unchanged into a shared `src/harness/support/runNpmTest.ts` (same extract-don't-duplicate
  pattern ADR-012 used for `fetchValidatedEccPackage`), reused by both the verifier and the
  `run_tests` tool; the verifier's own tests pass unmodified.
- **Experiment orchestration:** `src/experiments/` (`experimentConditions.ts`,
  `llmProviderConfigFromEnv.ts`, `resultsWriter.ts`, `runComparisonExperiment.ts`,
  `analyzeComparisonResults.ts`) runs 3 real-fixture tasks (`debugging-01`, `feature-01`,
  `refactoring-01` — the other 27 remain [[20-next-actions]]'s fixture backlog) × 9 conditions × 3
  repetitions through `executeEvaluatedRun()` + `computeRunMetrics()`, and dumps each run's full
  bundle as raw JSON to a new gitignored `experiment-results/<experimentId>/<runId>.json` — Phase
  9's canonical `Report`/persistence format doesn't exist yet, so this is deliberately a plain data
  dump with no long-term schema commitment, not a pre-emption of that phase.
  `analyzeComparisonResults.ts` reads the dumped bundles back, reconstructs `RunAnalysisRecord[]`,
  and calls Phase 7's `analyzeRepeatedRuns()` and Phase 8's `analyzeComponentContributions()`
  completely unchanged — the first time either runs against real, not synthetic, data.
- **Known limitation:** `Run.metadata.modelName`/`modelVersion` (required run metadata per
  [[10-reproducibility]]) are still not populated — `HarnessRunConfig`/`runHarness.ts` have no
  channel for an agent to report which model powered a run, and extending them is outside this
  round's approved file scope. As a partial mitigation, `LlmClient` now exposes `model` publicly,
  and `LlmSolvingAgent`'s default `Agent.name` is `llm-solving-agent:<providerLabel>:<model>` (e.g.
  `llm-solving-agent:anthropic:claude-sonnet-5`), so `Run.metadata.agentName` at least
  distinguishes runs by exact backend/model even though the dedicated fields stay empty. Flagged
  as a next action for whoever next touches `runHarness.ts`.
- **Trade-offs:** Actually **executing** a live comparison run against a paid cloud API or a local
  model is not part of this round's automatic implementation — the mechanism is built and tested
  with mocked LLM responses (`vi.stubGlobal('fetch', ...)` — no real network calls or API cost in
  CI) plus a synthetic-bundle wiring test for the analysis path; running it for real requires the
  user's own API key or local server, triggered via `npm run experiment:run` /
  `npm run experiment:analyze`.
- **Consequences:** New files (all under 300 lines; largest is `anthropicLlmClient.ts` at 143):
  `src/harness/llm/*` (5 files), `src/harness/agents/llmAgentTools.ts`,
  `src/harness/agents/promptBuilder.ts`, `src/harness/agents/llmSolvingAgent.ts`,
  `src/harness/support/runNpmTest.ts`, `src/experiments/*` (6 files including a barrel). Edited:
  `src/evaluation/verifiers/testSuiteVerifier.ts` (uses the extracted `runNpmTest`, no behavior
  change), `src/harness/index.ts` (barrel additions), `package.json` (`experiment:run`/
  `experiment:analyze` scripts), `.gitignore` (`experiment-results/`). No existing schema changed.
- **Status:** Accepted.

## ADR-014: Canonical Report persistence as a self-contained `ReportGraph`, built by a new pure `src/reporting/` layer decoupled from `src/experiments/`

- **Context:** Phase 9's exit criterion, as scoped by the user this round: a canonical `Report`
  schema/persistence format — a `Report` entity that aggregates Runs→Metrics→Evidence with full
  traceability, replacing `experiment-results/`'s raw per-run JSON dump
  (project-memory-bank/13-roadmap.md Phase 9 row; ADR-013's own note that "Phase 9's canonical
  Report/persistence format doesn't exist yet"). `reportSchema` (Zod) already existed from Phase 1
  (`src/domain/report/report.schema.ts`) but nothing had ever constructed a schema-valid `Report`
  or the `Evaluation` records it references — `evaluationSchema` also existed unused since Phase 1.
- **Options considered (what "full traceability" persists):** (a) persist only the thin `Report`
  record itself (id, experimentId, title, evaluationIds, limitations, generatedAt), leaving
  `evaluationIds` as floating references a reader must separately resolve against
  `experiment-results/`; (b) persist one self-contained `ReportGraph` object — the `Report` plus
  every `Evaluation`/`Run`/`Trace`/`Outcome`/`Metric`/`Verification`/`Evidence`/`ContextArtifact`
  it (transitively) references, deduplicated by id, in the same JSON file.
- **Chosen approach:** (b). `src/reporting/reportGraph.ts` defines `ReportGraph`; `src/reporting/
  buildReport.ts` (`buildReport()`) builds one `Evaluation` per evaluated run
  (`buildEvaluation.ts`), validates the `Report` via `reportSchema.parse`, and assembles the full
  graph with `dedupeById.ts`. `src/reporting/traceEvaluation.ts` (`traceEvaluation()`) is the
  concrete drill-down reader implementing project-memory-bank/12-dashboard-strategy.md's design
  principle ("Why should I trust this result? ... No black-box KPI.") — given a graph and an
  `EvaluationId`, it resolves the full chain (run, trace, outcome, metrics, verifications,
  evidence) purely by id lookup within the same object, throwing `BrokenReportGraphError` if a
  referenced id is missing (should never happen for a graph `buildReport()` produced; catches a
  hand-edited or corrupted `report.json` loudly instead of silently returning a partial trace).
- **Reason:** project-memory-bank/10-reproducibility.md is explicit: "Every public claim EEP
  produces... must be traceable back through report → aggregate metric → individual run → trace →
  evidence → evaluation decision." Option (a) would leave that chain only as loose, unenforced ids
  a reader has to separately look up (and could easily fail to find, e.g. if the raw dump were
  later deleted) — the opposite of a *canonical* artifact. Option (b) makes every citable claim in
  a `Report` resolvable from that one file alone, with no dependency on `experiment-results/`
  still existing.
- **Options considered (where the new code lives / evaluatorVersion source):** (a) put the Report
  builder inside `src/experiments/` next to `resultsWriter.ts`/`analyzeComparisonResults.ts`,
  since that's the only current producer of evaluated-run data; (b) a new top-level
  `src/reporting/` module depending only on `src/domain/`, with a structural input type
  (`EvaluatedRunRecord`, `evaluatedRunInput.ts`) decoupled from `src/experiments/`'s
  `RunResultBundle` — the same one-way-dependency discipline ADR-011 established for
  `src/analysis/` (`RunAnalysisRecord`/`RunVerificationRecord`, decoupled from `harness`/
  `evaluation` types).
- **Chosen approach:** (b), matching ADR-011's precedent exactly. `src/reporting/` depends only on
  `src/domain/`; `src/experiments/generateReport.ts` (the new Phase 9 entry-point script, parallel
  to `runComparisonExperiment.ts`/`analyzeComparisonResults.ts`) reads raw bundles via
  `resultsWriter.ts`'s `readAllRunResults()`, adapts each `RunResultBundle` into an
  `EvaluatedRunRecord` (drops the orchestration-only `conditionName`/`taskId`/`taskCategory`/
  `taskComplexity` labels — a Report's traceability runs through `Run.conditionId`/`Run.taskId`,
  not a human-readable label), and calls `buildReport()`/`writeReport()`. `Evaluation.
  evaluatorVersion` is read from `record.run.metadata.evaluatorVersion` (already-recorded
  reproducibility metadata, project-memory-bank/10-reproducibility.md) rather than passed as a
  second, independently-suppliable parameter that could drift from what the Run itself claims.
- **Reason:** `src/reporting/` being a pure, reusable layer over `src/domain/` alone means a
  `Report` can be built from any evaluated-run data, not only `src/experiments/`'s specific
  comparison-run orchestration — the same reusability argument ADR-011 made for
  `src/analysis/`. This also keeps the dependency graph acyclic:
  `src/experiments` → `src/reporting` (and → `src/analysis`), never the reverse.
- **Options considered (relationship to `experiment-results/`'s raw dump):** (a) delete/replace
  `resultsWriter.ts`'s per-run write entirely, accumulating all runs in memory and writing only
  the final `ReportGraph`; (b) keep the existing per-run write exactly as-is as a crash-safe
  write-ahead record during a long live run (an LLM-backed comparison run can take a long time and
  fail partway through), and add the canonical `ReportGraph` as a new, separate, later
  finalization step (`generateReport.ts` / `npm run report:generate`) a caller runs once all raw
  bundles exist.
- **Chosen approach:** (b). `resultsWriter.ts`'s `RunResultBundle`/`writeRunResult()`/
  `readAllRunResults()` are unchanged in behavior (only `latestExperimentId()` was extracted out of
  `analyzeComparisonResults.ts` into `resultsWriter.ts` so `analyzeComparisonResults.ts` and the
  new `generateReport.ts` share one implementation instead of duplicating it — no behavior change,
  existing tests pass unmodified). Its doc-comment now explains it is a write-ahead record, not the
  canonical output.
- **Reason:** Discarding per-run incremental writes would mean a long live run that crashes at run
  60 of 81 loses everything with no partial artifact — a real operational risk for LLM-backed runs
  (ADR-013). Keeping both, with the `ReportGraph` as the one artifact meant for actual
  citation/consumption, satisfies "replacing the raw dump" as *the canonical/authoritative format*
  without removing a genuine crash-safety mechanism a later phase would have to reinvent.
- **Trade-offs:** This round's exit criterion was explicitly narrowed by the user to the `Report`
  entity/persistence format itself — CSV/Markdown/HTML export ([[13-roadmap]]'s full Phase 9 row)
  is not built this round; a `ReportGraph` is JSON only. Folding Phase 7/8's statistical analysis
  output (`RepeatedRunAnalysisReport`/`ComponentContribution[]`/`FailureClusterReport`) into the
  persisted `Report` was considered and deliberately deferred — it would duplicate scope already
  covered by `analyzeComparisonResults.ts`'s console output and isn't part of this round's literal
  exit criterion (Runs→Metrics→Evidence traceability, not interpreted statistics); a natural
  follow-up, not silently done. `ReportGraph` is currently a plain TypeScript interface, not a 15th
  schema-versioned domain entity — only its embedded `report` field is a real, versioned domain
  entity (`reportSchema`); the graph wrapper itself has no independent version, matching how
  `ComparisonAnalysisResult` (Phase 6-remainder) is also an unversioned plain wrapper around
  versioned pieces.
- **Consequences:** New `src/reporting/*.ts` (all under 300 lines; largest is `traceEvaluation.ts`
  at 66): `dedupeById.ts`, `reportGraph.ts`, `evaluatedRunInput.ts`, `buildEvaluation.ts`,
  `buildReport.ts`, `traceEvaluation.ts`, `reportWriter.ts`, `index.ts`. New
  `src/experiments/generateReport.ts` (78 lines) plus `npm run report:generate` script and a new
  gitignored `reports/` output directory (parallel to `experiment-results/`). Edited (no behavior
  change): `src/experiments/resultsWriter.ts` (`latestExperimentId()` extracted, exported, doc
  comment updated), `src/experiments/analyzeComparisonResults.ts` (imports the extracted function
  instead of a local copy), `src/experiments/index.ts` (barrel addition). No existing schema
  changed — `REPORT_SCHEMA_VERSION`/`EVALUATION_SCHEMA_VERSION` both stay `1.0.0`. Like Phase 7/8
  before it, `buildReport()`/`generateReport()` have not yet run against a real live comparison
  run's data (none has been executed yet — Phase 6's remaining scope); validated against synthetic
  evaluated-run fixtures in tests (19 new tests across 6 new/edited test files, 284 total).
- **Status:** Accepted.

## ADR-015: Static, self-contained HTML dashboard — a new pure `src/dashboard/` layer reading only the Phase 9 `ReportGraph`, no server process or new dependency

- **Context:** Phase 10's exit criterion, as scoped by the user this round: a feasibility spike,
  then an MVP dashboard reading from Phase 9's `Report` format ([[13-roadmap]]'s Phase 10 row,
  "Only after the data layer stabilizes"; [[12-dashboard-strategy]]'s sequencing rule and design
  principle, "Why should I trust this result? ... No black-box KPI."). Phase 9 (ADR-014) already
  produces one self-contained `ReportGraph` per experiment; nothing yet renders it for a human.
- **Feasibility spike — options considered (rendering/serving mechanism):** (a) a client-side SPA
  (React/Vue or similar) fetching `report.json` at runtime; (b) a long-running local dynamic
  server (e.g. Express) with API routes reading `reports/` on each request; (c) a static
  server-rendered HTML generator — a pure function `ReportGraph -> HTML string`, written to
  `dashboard/<experimentId>/index.html`, opened directly in a browser with no process to keep
  running.
- **Chosen approach:** (c). New `src/dashboard/` (`htmlEscape.ts`, `outcomeStatusCounts.ts`,
  `renderOverview.ts`, `renderEvaluationDetail.ts`, `renderDashboardPage.ts`,
  `dashboardWriter.ts`, `index.ts`) renders one complete, self-contained HTML document per
  `ReportGraph`: an overview panel (title, experiment id, generated timestamp, required
  `limitations`, outcome-status breakdown via `outcomeStatusCounts.ts`) plus one drill-down
  section per `Evaluation`, built by reusing `src/reporting/traceEvaluation.ts` unchanged (run
  metadata, outcome summary, metrics/verifications tables, evidence list respecting
  `Evidence.redacted`). Inline `<style>`, zero external stylesheet/script/CDN reference. New
  `src/experiments/generateDashboard.ts` (orchestration entry point, `npm run
  dashboard:generate`) reads a persisted `report.json` via `src/reporting/reportWriter.ts`'s
  `readReport()` (a new `latestReportedExperimentId()` helper added there, mirroring
  `resultsWriter.ts`'s `latestExperimentId()`, resolves the default experiment) and writes the
  rendered page via `dashboardWriter.ts`.
- **Reason:** project-memory-bank/04-architecture.md is explicit: "No database, no message queue,
  no microservices, no cloud infra until a real requirement demonstrates the need... Local-first:
  results are files on disk." Options (a) and (b) both introduce a new dependency surface (a
  frontend framework/bundler, or a server runtime) and a running process, for data that is
  already fully computed and static once a report exists — neither is justified by any concrete
  requirement yet (ADR-004/ADR-009 discipline: don't build ahead of a real need). Option (c) needs
  zero new npm packages (Node's built-in `fs`/`path` plus template strings), is trivially
  shareable (a single HTML file), and directly satisfies "MVP dashboard reading from Phase 9's
  Report format" — it reads `report.json` and nothing else.
- **Dependency direction:** `src/dashboard/` depends only on `src/domain/` and `src/reporting/`
  (for `ReportGraph`/`traceEvaluation`/`EvaluationTrace`), never on `src/experiments/`/`harness`/
  `evaluation` — the same one-way-dependency discipline ADR-011/ADR-014 established, and the exact
  shape project-memory-bank/04-architecture.md's layering diagram specifies ("Dashboard... reads
  canonical artifacts only, owns no evaluation logic"). `src/experiments/generateDashboard.ts` is
  the one place that resolves *which* report to read from disk; `src/dashboard/` itself never
  touches the filesystem except through `dashboardWriter.ts`'s write step.
- **Security note:** every string sourced from report data (titles, limitations, run metadata,
  outcome summaries, verification detail, evidence descriptions/content) is passed through
  `htmlEscape.ts` before being embedded in the generated page — this data can ultimately be
  LLM/agent-authored text (project-memory-bank/11-security.md), and the generated HTML must never
  let it be interpreted as markup by a browser. `Evidence.redacted` is honored: redacted evidence
  renders `[redacted]` instead of its `content` field.
- **Trade-offs:** MVP scope only — a single-experiment view, not [[12-dashboard-strategy]]'s full
  target view list. Deliberately deferred, not silently omitted: multi-experiment/condition
  comparison views, complexity/category breakdowns, and failure-cluster views (Phase 7/8's
  `analyzeComparisonResults.ts` output is not yet folded into `ReportGraph` — a known limitation
  already flagged in [[phases/phase-09]]) all require data this dashboard's only input,
  `ReportGraph`, does not yet carry. No client-side interactivity (filtering, sorting, search) —
  purely static markup. Task/Condition human-readable names are not shown, only their raw
  `taskId`/`conditionId`, since `ReportGraph` does not include `Task`/`Condition` entities.
- **Consequences:** New `src/dashboard/*.ts` (all under 300 lines; largest source file
  `renderEvaluationDetail.ts` at 59 lines) plus `src/experiments/generateDashboard.ts` (45 lines)
  and `npm run dashboard:generate`. New gitignored `dashboard/` output directory (parallel to
  `reports/`/`experiment-results/`; `.gitignore` entries for all three anchored to the repo root
  with a leading `/` after discovering the unanchored `dashboard/` pattern also matched the new
  `src/dashboard/` source directory). Extended `src/reporting/reportWriter.ts` with
  `latestReportedExperimentId()` (no behavior change to existing exports). 15 new tests across 8
  new/edited test files (299 total). Like Phase 7/8/9 before it, not yet exercised against a real
  live comparison run's data — validated against synthetic `ReportGraph` fixtures in tests.
- **Status:** Accepted.

## ADR-016: Public-facing docs live in `docs/`, not `project-memory-bank/`; publishing a result reuses the existing dashboard file — no new publish pipeline

- **Context:** Phase 11's exit criterion is "Benchmark documentation, reproducibility, public
  results" ([[13-roadmap]]). No live comparison run has ever been executed, so "public results"
  this round cannot mean publishing a real finding — the only existing public-facing result
  artifact is `docs/sample-dashboard.html`, which was hand-copied into git after manually running
  the real `buildReport` → `writeDashboard` pipeline against typed-in synthetic data (no script
  regenerates it). Phase 12 ("External Reproduction") is the later, separate phase for onboarding
  actual external users — this phase is EEP producing its own documentation/artifacts first.
- **Options considered (where public docs live):** (a) write the benchmark design doc and
  reproduction guide into `project-memory-bank/`, alongside the existing internal reference docs
  ([[07-benchmark-strategy]], [[10-reproducibility]]); (b) new files under `docs/`, written for an
  external reader, distinct from `project-memory-bank/`'s internal AI/dev-facing compressed
  save-state.
- **Chosen approach:** (b). New `docs/BENCHMARK.md` and `docs/REPRODUCING.md` synthesize and
  paraphrase the relevant `project-memory-bank/` content (07/08/09/10-*.md, the charter's
  scientific-integrity rule) for an external reader, rather than linking into
  `project-memory-bank/` from public-facing prose.
- **Reason:** `project-memory-bank/` is explicitly this project's internal "compressed save state"
  for future AI sessions (per this round's own user instruction and every prior phase's
  convention) — its files assume that context, cross-reference each other densely by `[[wikilink]]`,
  and are not meant to be a stable public reading surface. A reader arriving at the repository from
  outside needs a self-contained explanation, not internal state.
- **Options considered (how a result gets "published"):** (a) build a new `publish`/`export`
  orchestration script (e.g. `src/experiments/publishBenchmarkResults.ts`) that bundles a report
  and dashboard into some new output location; (b) treat the dashboard's existing self-contained
  HTML file (`dashboard/<experimentId>/index.html`, from `dashboard:generate`, ADR-015) as already
  being the publishable artifact — copying it anywhere is "publishing" — and add no new pipeline.
- **Chosen approach:** (b). `docs/REPRODUCING.md` documents this explicitly: the dashboard file has
  no external resource references, so it can be shared as-is (a gist, a GitHub Pages branch, a
  release attachment) with zero new code.
- **Reason:** Option (a) would duplicate `generateDashboard.ts`'s read-report → render → write
  sequence almost entirely, with no decoupling justification (unlike the `resultsWriter.ts`/
  `reportWriter.ts` precedent, which had a real cross-layer reason for its small duplication) —
  pure duplication for no benefit, against this project's "extract don't duplicate" discipline. It
  would also add hosting/deployment concerns ([[04-architecture]]'s "no cloud infra until a real
  requirement demonstrates the need") that belong to Phase 13 (CI/GitHub Integration), not here.
- **The one real gap closed this round:** the *existing* demo artifact was not reproducible — it
  was hand-copied, not scripted. New `src/experiments/demoRunRecords.ts` (two literal, schema-valid
  `EvaluatedRunRecord` values, explicitly commented as synthetic-only) and
  `src/experiments/generateDemoDashboard.ts` (`demoRunRecords()` → `buildReport()` →
  `renderDashboardPage()` → write, all three reused completely unchanged from Phases 9/10) replace
  the manual step with `npm run demo:generate`. Running it reproduces `docs/sample-dashboard.html`
  near-identically — only the randomly-generated report/evaluation ids differ between runs, which
  is expected and harmless (they are never used as stable references).
- **Trade-offs:** This round still does not produce or publish a real benchmark result — that
  remains gated on a live comparison run, unchanged. `docs/BENCHMARK.md`/`docs/REPRODUCING.md` are
  plain Markdown with no automated freshness check against `project-memory-bank/`'s source content
  — a future change to, e.g., the metric list or ablation components could drift out of sync with
  these public docs if not updated alongside. Not fixed this round: `Run.metadata.modelName`/
  `modelVersion` (open risk-register row) — `docs/REPRODUCING.md` now surfaces this gap to a wider
  audience but does not resolve it; phrased there as an open limitation, not a closure.
- **Consequences:** New `src/experiments/demoRunRecords.ts` (102 lines) and
  `src/experiments/generateDemoDashboard.ts` (43 lines), plus 2 new test files (3 new tests, 302
  total across 80 files). New `npm run demo:generate` script. New `docs/BENCHMARK.md` and
  `docs/REPRODUCING.md`. `docs/sample-dashboard.html` regenerated via the new script (content
  unchanged apart from random ids). `README.md` updated to link both new docs and describe the
  demo as a script output. No existing schema, dashboard, or reporting code changed.
- **Status:** Accepted.

## ADR-017: Zero-cost "smoke reproduction" via a deterministic fake LLM provider; comparison keyed by raw-bundle `(taskId, conditionName)`, never `report.json`'s `conditionId`; `time-to-correct-outcome` excluded; reference is a checked-in, never-auto-regenerated file

- **Context:** Phase 12's exit criterion is "External users, independent runs, comparison"
  ([[13-roadmap]]). No live comparison run against a real, paid LLM has ever been executed, so "an
  external user independently reproduces a result" cannot mean reproducing a real ECC-vs-native
  finding this round — same constraint every phase since 6 has carried. The concrete, honest
  interpretation adopted: let an external user run the *real* harness/agent/verifier/metrics/
  analysis/report/dashboard pipeline end-to-end, for free, with no credentials, and *verify* their
  run against a checked-in reference — proving the mechanism reproduces identically across
  machines, not that any context provider helps.
- **Options considered (how to fake the LLM without faking the pipeline):** (a) hand-author
  `EvaluatedRunRecord` fixtures again, as Phase 11's demo did; (b) add a real `LlmClient`
  implementation (`DeterministicFakeLlmClient`, `src/harness/llm/`) that plugs into the existing,
  unmodified `LlmSolvingAgent`/`runComparisonExperiment.ts` orchestration, so every layer below the
  network call runs for real (real file I/O, real `npm test` subprocess execution via the same
  `runNpmTest` the test-suite verifier uses, real verifier/metric/analysis/report/dashboard code).
- **Chosen approach:** (b). `DeterministicFakeLlmClient` is a pure function of
  `request.messages` — no network, no mutable state — so it is safe to reuse across every run in a
  sequential comparison loop: it calls `list_files` once, then concludes with no further tool
  calls. It never reads task-specific content or edits any file, so it can never be tuned, even by
  accident, to make one condition look better than another — the scientific-integrity rule from
  [[00-project-charter]] is satisfied by construction, not by disclaimer alone. Wired in as a third
  `LlmProviderConfig` variant (`'fake-deterministic'`), special-cased in
  `llmProviderConfigFromEnv.ts` to need zero environment variables.
- **Critical correctness finding — comparison must key off raw bundles, not `report.json`:**
  `experimentConditions.ts`'s `buildCondition()` mints a fresh random `Condition.id` on *every*
  call to `buildExperimentConditions()` — so `Run.conditionId` can never be a stable join key
  across two independently-generated runs of the pipeline. `condition.name` (`'native'`, `'ecc'`,
  `ablatedConditionName(component)` for each of the 7 fixed `ECC_ABLATION_COMPONENTS`) *is* stable
  and survives into the raw `RunResultBundle` dump (`resultsWriter.ts`), but is dropped when
  `generateReport.ts` adapts a bundle into an `EvaluatedRunRecord` for `buildReport()`. Consequence:
  the new `src/experiments/reproductionReference.ts`/`compareRunResults.ts` key strictly by
  `(taskId, conditionName)` from the raw `experiment-results-smoke/**.json` bundles
  (`readAllRunResults()`, already exported), never from `report.json`.
- **Critical correctness finding — `time-to-correct-outcome` must be excluded:** it is the one
  metric built from `Date.now()`-derived wall-clock timestamps ([[08-metrics]]); it will never
  match between two runs, even seconds apart on the same machine. `reproductionReference.ts`'s
  `extractReferenceEntries()` drops it from every entry's `metrics`. Every other primary/secondary
  metric is a pure function of deterministic inputs (outcome status, verification counts, trace
  actions the deterministic client fully controls, token-estimate over deterministic content) and
  was confirmed, by actually running `npm run reproduce:smoke` three independent times on this
  machine, to reproduce exactly.
- **Native-vs-ECC comparison scoping:** `runHarness.ts`'s `executeRun()` catches any
  `ContextProvider` failure (e.g. `EccInvocationError` when no local `ecc` CLI is reachable) inside
  a generic `try/catch` and records `AGENT_FAILURE` — it never throws and crashes the loop. This
  means all 9 conditions can run unmodified in the smoke path with no special-casing: for a reader
  with no local ECC checkout (the common case), all 9 conditions are actually fully deterministic;
  for a reader who *does* have a working `ecc` CLI, the 8 ECC-based conditions will legitimately
  diverge from a reference generated without one. `compareRunResults.ts`'s
  `compareReferenceEntries()` treats a `'native'`-condition mismatch as always hard, and downgrades
  an ECC-based condition's mismatch to informational only when a quick, best-effort probe
  (`eccAvailabilityCheck.ts`'s `isEccCliAvailable()`, the same command-resolution convention as
  `ProcessEccCliInvoker`) detects a local `ecc` CLI. An entry present in the reference but entirely
  missing from a run's output is always hard, regardless of condition.
- **Reference artifact policy:** `docs/reproduction-reference/smoke-reference.json` is generated
  once, manually, during implementation (`extractReferenceEntries()` over a real
  `npm run reproduce:smoke` run's bundles) and committed as-is — the same "run it for real, commit
  the faithful output" discipline as ADR-016's `docs/sample-dashboard.html`. `runSmokeReproduction.ts`
  throws a plain, actionable error if the reference is missing rather than silently regenerating
  it from the reader's own run — auto-regenerating the very reference a user's run is supposed to
  be checked against would defeat the comparison's purpose and is exactly the kind of
  self-serving convenience [[00-project-charter]]'s integrity rule rules out. `writeReferenceEntries()`
  exists only for that one manual step; nothing in the shipped orchestration path calls it.
- **`process.env` never mutated by an importable function:** `runComparisonExperiment.ts` gained an
  optional `llmProviderConfig?: LlmProviderConfig` field on `RunComparisonExperimentOptions` (used
  in place of `llmProviderConfigFromEnv()` when supplied; defaults to today's env-resolved behavior
  otherwise — no change for existing callers). `runSmokeReproduction()` passes
  `{provider: 'fake-deterministic'}` explicitly through this seam, so it never reads or mutates
  `EEP_LLM_*` environment variables at all, and can never accidentally reach a real paid backend
  regardless of what the caller's shell already has configured.
- **Trade-offs:** The smoke path proves pipeline *mechanics*, not ECC's (or any provider's)
  quality — this must stay clearly labeled, including in the dashboard/report `limitations` field
  it generates, so it is never mistaken for a real finding. `docs/reproduction-reference/
  smoke-reference.json` has no automated check that it stays in sync if a fixture's own test suite
  or the metrics/verifier set changes — a future edit to `benchmark/fixtures/{debugging,feature,
  refactoring}-01/` or the metric/verifier set must regenerate and re-commit the reference in the
  same change, or `reproduce:smoke` will start failing for reasons unrelated to this ADR.
- **Consequences:** New `src/harness/llm/deterministicFakeLlmClient.ts` (40 lines),
  `src/experiments/eccAvailabilityCheck.ts` (22 lines), `reproductionReference.ts` (73 lines),
  `compareRunResults.ts` (111 lines), `runSmokeReproduction.ts` (117 lines), plus 5 new/extended
  test files. New `npm run reproduce:smoke` script; new gitignored `/experiment-results-smoke/`,
  `/reports-smoke/`, `/dashboard-smoke/` directories. New checked-in
  `docs/reproduction-reference/smoke-reference.json` (27 entries: 3 real-fixture tasks × 9
  conditions). `docs/REPRODUCING.md`/`docs/BENCHMARK.md` updated to document and link the new Step
  0. No existing schema, harness, verifier, or metrics logic changed; `runComparisonExperiment.ts`'s
  only change is the additive `llmProviderConfig` option.
- **Status:** Accepted.

## ADR-018: CI runs `reproduce:smoke` as its real "automated run"; GitHub Pages hosting is a manual-opt-in, GitHub-operated static publish; cross-user comparison is a new symmetric, offline diff — never asymmetric `compareReferenceEntries`

- **Context:** Phase 13's exit criterion: "automated runs wired into CI, cross-user report
  comparison/hosting." Two constraints from every prior phase still apply: no live comparison run
  against a real, paid LLM has ever been executed (still gated on a separate future approval), and
  [[04-architecture]]'s local-first mandate rules out any new database/queue/service/cloud infra
  until a real need demonstrates it.
- **"Automated runs wired into CI":** `.github/workflows/ci.yml` runs `npm run build`/`lint`/`test`
  on `push`/`pull_request` to `main` (Node 20.x and 22.x matrix), then runs
  `node dist/experiments/runSmokeReproduction.js` directly (not via `npm run reproduce:smoke`,
  which would trigger a second, non-incremental `tsc` build — `tsconfig.json` has no
  `incremental`/`tsBuildInfoFile` configured). This is a genuine "run," not just build/lint/test:
  Phase 12's free, zero-credential, deterministic pipeline execution, checked against the reference
  committed at `docs/reproduction-reference/smoke-reference.json`. Every CI run is a fresh,
  independent machine re-proving the real harness/verifier/metrics/analysis/report/dashboard
  pipeline reproduces identically — strengthening confidence in mechanics, not adding a performance
  claim. Confirmed safe on `pull_request` (not `pull_request_target`, which would be actively wrong
  here) for fork-authored PRs: the smoke path never touches `process.env`/`EEP_LLM_*` (explicit
  `{provider: 'fake-deterministic'}` per ADR-017), makes no network calls, and needs no secrets.
  `permissions: contents: read` and a `concurrency` group are set at the workflow level as
  least-privilege/anti-pile-up hardening. A live-LLM CI job was explicitly rejected — it would need
  stored secrets and incur real, recurring API cost on every push, which must never happen
  automatically.
- **Explicitly deferred — `format:check`:** a Plan-subagent review, run before any code was
  written, caught that `npx prettier --check .` currently reports formatting drift across ~105
  files (`format` has always been write-only; nothing has enforced it). Adding a `format:check` CI
  gate this round would fail on day one over a purely cosmetic, whole-repo diff the user should
  approve deliberately as its own explicit step, not have bundled silently into a CI-wiring phase.
  Left out of `ci.yml`; tracked as an open item in [[20-next-actions]] and [[17-known-limitations]].
- **"Hosting":** `.github/workflows/pages.yml` publishes `docs/` (a new `docs/index.html` landing
  page, `sample-dashboard.html`, `BENCHMARK.md`, `REPRODUCING.md`) via the current, non-deprecated
  two-job GitHub Pages pattern (`actions/configure-pages`/`upload-pages-artifact` in a `build` job,
  `actions/deploy-pages` in a `deploy` job needing it, `permissions: pages: write, id-token: write`,
  a `github-pages` environment) — not the legacy branch-based approach. This is judged compliant
  with [[04-architecture]]'s local-first/no-cloud-infra constraint because GitHub, not EEP, operates
  the hosting, and it only ever serves already-generated static files, the same "the HTML file is
  the publishable artifact, copy it anywhere" precedent ADR-015/016 already established. Trigger is
  `workflow_dispatch` only, deliberately not automatic on push — GitHub Pages must first be enabled
  once in repository Settings (source: "GitHub Actions"), and an auto-triggered deploy against an
  unconfigured repository would fail loudly on every push until then. `docs/REPRODUCING.md`
  documents the one-time manual opt-in and how to add a `push`-on-`docs/**` trigger afterward.
  Neither enabling Pages in Settings nor pushing/triggering any workflow was done as part of this
  implementation — that is the user's explicit action, per the Git Safety Protocol (no push without
  an explicit ask, and enabling a public-facing setting is exactly the kind of externally-visible
  action that needs confirmation, not silent execution).
- **"Cross-user report comparison":** new `src/experiments/independentRunDiff.ts`
  (`diffEntrySets()`) and `compareIndependentRuns.ts` (`npm run report:compare` CLI), entirely
  local/offline — two users exchange their `<resultsDir>/<experimentId>/` directory out-of-band
  (email, a shared drive, a git branch); there is no upload or server. Deliberately a **new**
  function, not a reuse of `compareRunResults.ts`'s `compareReferenceEntries()`: that function's
  entire contract is asymmetric (`reference` vs. `actual`, an `eccCliAvailable`-gated
  informational/hard split, a `passed` verdict) and meaningless between two peer users, neither of
  whom is authoritative. `diffEntrySets()` is a symmetric diff (matched / differs-with-per-field-
  detail / onlyInA / onlyInB, no verdict, no exit-code-1 semantics). The one piece of real shared
  logic — comparing `outcomeStatus` and every metric key between two `ReferenceEntry` values — was
  extracted from `compareRunResults.ts`'s previously-private `diffEntry()` into a newly-exported,
  purely-mechanical `diffEntryFields()`, reused by both `compareReferenceEntries()` (refactored to
  call it, behavior-preserving, all pre-existing tests pass unmodified) and `diffEntrySets()`. An
  optional `formatDiffMarkdown()`/`--out <path>` lets a user write a self-contained Markdown summary
  and, if they choose, drop it into `docs/` for `pages.yml` to publish — connecting the comparison
  and hosting halves of this phase's exit criterion instead of leaving them disjoint (a gap a
  Plan-subagent review flagged before implementation).
- **Also explicitly deferred:** Dependabot, CodeQL/security scanning, branch protection rules, and
  Windows/macOS CI runners — no concrete need demonstrated yet (ADR-004/ADR-009 discipline); any
  general Report-to-CSV/Markdown/HTML export pipeline (unchanged Phase 9 roadmap backlog item; the
  new Markdown formatter here is narrowly for the comparison-diff summary only, not a general
  exporter).
- **Consequences:** New `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `docs/index.html`;
  new `src/experiments/independentRunDiff.ts`, `compareIndependentRuns.ts`, plus 2 new test files;
  `compareRunResults.ts` edited to export `diffEntryFields`/`FieldDifference` (behavior-preserving);
  new `npm run report:compare` script; `docs/REPRODUCING.md`/`README.md` updated with CI/Pages/
  cross-user-comparison documentation. No existing schema, harness, verifier, metrics, reporting, or
  dashboard logic changed. Workflow YAML was reviewed for structural correctness and current
  (non-deprecated) action versions but, since no local GitHub Actions runner is available, is
  unverified against a real GitHub-hosted execution until pushed — flagged explicitly, not silently
  assumed working.
- **Status:** Accepted.

## ADR-019: Accept `cross-spawn` as a runtime dependency for Windows `.cmd`-shim invocation of the ECC CLI; and recognize text-embedded tool calls in the solving agent

- **Context:** Bringing up the first live comparison run on Windows (local `qwen2.5-coder:7b` via
  Ollama) surfaced two concrete runtime failures that no synthetic test had exercised. (1) The ECC
  CLI, when installed via `npm link`, is reachable only as a Windows command shim (`ecc.cmd`).
  Node's `child_process.execFile` — what `ProcessEccCliInvoker` used (ADR-013's CLI-boundary
  integration) — cannot launch a `.cmd` on Windows without a shell, and using a shell would reopen
  the argument-injection risk the array-argument `execFile` was specifically chosen to avoid. (2)
  The local model does not emit OpenAI-style structured `tool_calls`; it returns the intended tool
  call as JSON in the assistant's text content (bare, inline after prose, or in a ```json fence),
  so `LlmSolvingAgent` saw zero tool calls and concluded at turn 1 without ever acting.
- **Options considered (Windows shim):** (a) `execFile` with `shell: true` — reintroduces shell
  metacharacter interpretation of the task description; rejected on security grounds
  ([[11-security]]). (b) Detect `.cmd`/`.bat` and special-case `cmd.exe /c` ourselves — zero new
  dependency, but re-implements exactly the quoting/escaping edge cases `cross-spawn` already
  handles correctly, and is easy to get subtly wrong. (c) Avoid the shim entirely by configuring the
  invoker with `command: "node"`, `commandArgs: ["<ecc>/dist/cli/index.js"]` — zero-dependency and
  cross-platform, but requires every operator to know and wire the ECC checkout's dist path, and the
  path is not currently env-configurable. (d) Add `cross-spawn` and route the subprocess through it.
- **Chosen approach:** (d). `eccCliInvoker.ts` now launches via `cross-spawn` with manual
  stdout/stderr accumulation that preserves the previous timeout and max-buffer guards and the
  array-argument (never shell-string) safety. For the tool-call issue, `llmSolvingAgent.ts` gains a
  fallback that, only when the client returns no structured `toolCalls`, scans the completion text
  for a JSON object whose `name` matches an allow-listed tool in `LLM_AGENT_TOOLS` and whose
  `arguments` is an object, via a balanced-brace scanner plus fenced-block extraction.
- **Reason:** `cross-spawn` is the de-facto standard remedy for this exact Node-on-Windows shim
  limitation — small, single-purpose, widely audited — and (d) keeps the ECC CLI reachable by its
  documented default name (`ecc`) with no per-operator path wiring, while (b) would hand-roll
  security-sensitive escaping and (c) shifts a setup burden onto every reproducer. This is a
  deliberate, narrow exception to the project's minimal-dependency posture (previously `zod` only),
  taken because a concrete, reproduced requirement demonstrated the need (the ADR-004/ADR-009
  "don't add surface without a real need" test is met here, in reverse: the need is real).
- **Trade-offs — stated honestly:** (1) This ends the "one runtime dependency" property the project
  advertised; runtime deps are now `zod` + `cross-spawn`. That is a real reduction in the
  dependency-hygiene signal, accepted consciously and recorded here rather than slipped in silently.
  Option (c) remains available to anyone who wants to restore zero-runtime-deps by configuring the
  invoker to call `node` directly. (2) The text-tool-call fallback lives in the vendor-neutral
  `LlmSolvingAgent`, which is a mild layering compromise against ADR-013 (wire-format quirks ideally
  belong in the client adapter, `openAiCompatibleLlmClient`); it currently recognizes only a single
  tool call per completion and does not preserve the surrounding prose. Moving it into the adapter
  is a documented follow-up, not done this round.
- **Consequences:** `eccCliInvoker.ts` rewritten to use `cross-spawn` (public `EccCliInvoker`
  interface unchanged); `llmSolvingAgent.ts` gains `extractJsonObjects`/`parseTextToolCall`;
  `cross-spawn` added to `dependencies` and `@types/cross-spawn` to `devDependencies`; regression
  tests added for both formats and for Windows invocation, and the comparison test switched to a
  fake ECC CLI so it no longer depends on a live install. Validated by the first live pilot
  ([[../docs/BENCHMARK]] "First results (pilot)") and 353 passing tests. EEP has no `DEPENDENCIES.md`;
  the runtime-dependency set is documented by `package.json`'s `dependencies` (now `zod` +
  `cross-spawn`) and this ADR.
- **Status:** Accepted.
