# The EEP Benchmark

**A live comparison has now been run over the full 8-fixture set — see
[First results (widened live comparison)](#first-results-widened-live-comparison) below.** It is a
local, zero-cost run (a 7B local model, `native` vs full `ecc`, 3 repetitions across all 8 runnable
fixtures — 48 runs), and its headline finding is that *the result is statistically inconclusive at
this model strength* — reported here exactly as measured. This document describes the benchmark's
*design* and this result. Remaining artifacts that are not live results — e.g.
[`docs/sample-dashboard.html`](sample-dashboard.html) — stay explicitly labeled as synthetic demos.
See [REPRODUCING.md](REPRODUCING.md) to run it yourself.

## First results (widened live comparison)

*Run 2026-09-27. Backend: `qwen2.5-coder:7b` via a local Ollama OpenAI-compatible endpoint (free,
offline). Scope: all **8 real-fixture tasks**, `native` vs full `ecc`, **3 repetitions each** —
**48 runs** (n = 24 per condition). This supersedes the earlier n = 3, 3-fixture pilot; it widens
coverage across categories and complexity levels, but — as predicted — it does **not** make the
comparison conclusive, because the binding constraint is model strength, not fixture count.*

**Per-fixture task success (successes / 3 repetitions):**

| Fixture | Complexity | `native` | `ecc` |
|---|---|---|---|
| `debugging-01` | L1 | 1/3 | 1/3 |
| `test-generation-01` | L1 | 0/3 | 0/3 |
| `refactoring-01` | L2 | 1/3 | 0/3 |
| `refactoring-02` | L2 | 0/3 | 0/3 |
| `feature-01` | L3 | 0/3 | 0/3 |
| `feature-02` | L3 | 0/3 | 0/3 |
| `migration-01` | L3 | 0/3 | 0/3 |
| `performance-01` | L3 | 0/3 | 0/3 |
| **Total** | | **2/24** | **1/24** |

Across all 48 runs the model produced **3 verified successes**: `debugging-01` (once each arm) and
`refactoring-01` (native only). Every other run failed verification (or, in two cases, timed out).

**Aggregate — primary metrics (95% confidence intervals, baseline = `native`):**

| Metric | `native` (n=24) | `ecc` (n=24) | Mean diff | Effect size |
|---|---|---|---|---|
| task-success | 0.083 `[0.023, 0.258]` | 0.042 `[0.007, 0.202]` | −0.042 | −0.18 (negligible) |
| engineering-quality | 0.125 `[−0.003, 0.253]` | 0.104 `[−0.003, 0.212]` | −0.021 | −0.07 (negligible) |
| time-to-correct-outcome (ms) | 95,273 | 99,895 | +4,622 | 0.06 (negligible) |
| context-efficiency (success/1k tok) | 0.622 `[−0.276, 1.521]` | 0.116 `[−0.124, 0.355]` | −0.507 | −0.33 (small) |
| human-intervention | 0.000 | 0.000 | 0.000 | 0.00 |

**Interpretation — read this carefully, because the per-slice effect-size labels mislead on their own:**

1. **The comparison is statistically inconclusive.** The overall task-success effect is *negligible*
   and the confidence intervals overlap almost entirely (`native` `[0.023, 0.258]` vs `ecc`
   `[0.007, 0.202]`). No reliable native-vs-ECC conclusion can be drawn.
2. **The direction is not even stable, which is itself the finding.** This full 8-fixture run
   nominally favors `native` on task-success; an earlier partial 6-fixture batch nominally favored
   `ecc`. When the sign of a "difference" flips between runs, the honest reading is that there is no
   signal at this sample size and model strength — only noise. It is exactly why this benchmark is
   built on repetitions and confidence intervals rather than single numbers.
3. **The model is the binding constraint, not ECC.** 3 verified successes out of 48 runs, and
   **0 of 24 L3 runs** succeeded under either arm (the L3 test-suite failure rate is 23/23 = 100%).
   With a ceiling this low the experiment cannot discriminate context quality either way; ECC's
   value is expected to appear on harder tasks a *stronger* baseline can begin to solve.
4. **Do not cherry-pick the per-category "large" effects.** Some slices show nominally "large"
   effects in *both* directions — e.g. task-success favors `native` on refactoring (0.167 vs 0.000),
   while time-to-correct-outcome favors `ecc` on refactoring/performance/L3 but favors `native`
   massively on test-generation (a single `ecc` timeout dominates a 3-run slice). These are n = 3–6
   slices with wide, overlapping intervals; they are texture, not conclusions. The one honest,
   still-caveated observation is that `ecc` *tended* to reach its outcome faster on the harder
   slices — worth a powered re-test, not a claim.

**What this run does and does not establish.** It establishes that the full live pipeline
(harness → real LLM agent → deterministic verification → metrics → statistics) runs end-to-end over
the widened benchmark and that the per-category / per-complexity analysis is populated and
meaningful (not one fixture per slice). It does **not** establish whether ECC improves outcomes;
that requires a stronger model so the baseline can solve enough tasks to be discriminating (see
[Current status](#current-status)).

## What this measures

The Engineering Evaluation Platform (EEP) measures whether an AI coding agent performs
measurably better on realistic engineering tasks when paired with a given context-compilation
system, versus a native baseline with no curated context. Its first subject under test is the
[Engineering Context Compiler (ECC)](../README.md#relationship-to-ecc), a separate, unmodified
system integrated only through its public CLI contract.

## Task categories

30 tasks total, each one JSON file under `benchmark/tasks/<id>.json`:

| Category | Count |
|---|---|
| Debugging | 6 |
| Feature | 6 |
| Refactoring | 5 |
| Test generation | 4 |
| Migration | 3 |
| Performance | 2 |
| Code review | 2 |
| Architecture | 2 |
| **Total** | **30** |

Each task also carries a complexity rating from L1 (trivial) to L5 (architectural/systemic).

## Fixture status

A task's JSON definition (title, description, acceptance criteria, verification method, ground
truth) is separate from having a real, runnable fixture repository behind it. As of today:

| Task | Fixture status |
|---|---|
| `debugging-01`, `feature-01`, `refactoring-01` | Real fixture, pinned commit SHA |
| `performance-01`, `feature-02`, `refactoring-02`, `migration-01`, `test-generation-01` | Real fixture, self-verifying `npm test`; commit SHA not yet pinned |
| Remaining 22 tasks | Task definition only — fixture source code not yet authored |

The runnable set was widened from 3 to **8 fixtures across 6 categories** (debugging, feature,
refactoring, performance, migration, test-generation). Each new fixture is deterministic and
offline, and its own `npm test` is the pass/fail gate (EEP has no separate repository-invariant
verifier, so any invariant — e.g. `migration-01`'s "no CommonJS left in `src/`" — is asserted
inside the test). `test-generation-01` is included for category coverage but is a weak *success*
discriminator, because the agent authors the very tests the verifier runs — noted plainly in that
fixture's README. The **[First results (widened live comparison)](#first-results-widened-live-comparison)**
above were measured over all 8 fixtures (48 runs); the `test-generation-01` runs behaved as that
caveat predicts (both arms failed verification, one `ecc` run timed out) and add little success
signal.

Fixtures are self-hosted inside this repository under `benchmark/fixtures/<id>/` — never an
external GitHub repository — specifically to avoid benchmark contamination (well-known public code
may already be in a model's training data) and to keep every task fully offline and reproducible.

## Experiment design

Every run pairs one agent against one task under one **condition** — a condition is defined
entirely by which `ContextProvider` the agent receives, holding everything else constant (same
agent, same model, same task, same repository state, same evaluator version):

| Condition | Context source |
|---|---|
| `native` | No curated context — task text plus a plain file listing only |
| `ecc` | ECC's full compiled context package |
| `ecc-ablated:history` | ECC's context with the `history` field neutralized |
| `ecc-ablated:memory` | ECC's context with memory-sourced evidence removed |
| `ecc-ablated:ranking` | ECC's context with relevance ranking replaced by a neutral order |
| `ecc-ablated:provenance` | ECC's context with per-evidence provenance stripped |
| `ecc-ablated:risk` | ECC's context with conflict/risk flags removed |
| `ecc-ablated:budgeting` | ECC's context with the excluded-items list removed |
| `ecc-ablated:verification` | ECC's context with verification data removed |

That is 9 conditions per task. The same task is run 3 times per condition (default, configurable)
to give the statistics layer (confidence intervals, effect sizes) something to work with —
individual LLM runs are not deterministic.

**Why the same agent runs every condition:** an earlier design would have kept a deterministic,
non-code-generating agent as the "native" baseline while only the ECC condition used a real
LLM-backed agent. That conflates two different variables — "having a capable agent at all" and
"having curated context" — into one measurement. Every condition here uses the identical
LLM-backed solving agent; only the `ContextProvider` varies, which isolates context quality as the
one thing actually being tested.

**Ablation methodology:** ECC is integrated only through its documented CLI contract, which has no
flag to disable an internal component. Ablation is therefore done at the *content* level: after
ECC returns its full, validated context package, exactly one already-present field is
deterministically stripped or neutralized before the agent sees it, holding every other field
constant. This measures the marginal contribution of that field's information, not necessarily
ECC's internal architecture — if a component's effect leaks into another field this scheme doesn't
touch, the isolation is imperfect. That is a known, documented limitation, not an oversight.

## Verification methodology

An agent's own claim that it succeeded is never trusted on its own. Every run's outcome is decided
by independent, deterministic verifiers appropriate to that task (for example, running the
fixture's real test suite, or checking that the repository content actually changed). A run is
only marked successful when verification independently confirms it; infrastructure failures
(environment errors, timeouts) are always reported as such and never miscategorized as a task or
agent failure.

## Metrics

Metrics are never collapsed into one composite score — every number stays traceable back to the
run, trace, and evidence that produced it. The primary metrics are task success, engineering
quality, time to correct outcome, context efficiency, and human intervention. A further set of
secondary metrics (context tokens, tool calls, agent turns, files read/changed, retries, failed
attempts, provenance completeness, verification completeness) is also computed; a handful of
secondary metrics (e.g. evidence recall/precision/authority, regression rate) are not yet computed
because no real data source for them exists yet — they are documented as not-yet-available rather
than approximated.

## Scientific-integrity commitment

This benchmark is not optimized to make ECC, or any system under test, look good. Tasks, metrics,
verification methods, and analysis are not adjusted based on which system performs better.
Negative or mixed results are reported exactly as measured. EEP and ECC are separate repositories
with no shared code — EEP never modifies ECC's source or behavior to influence a result.

## Current status

A **live** comparison has been run against a real model (local `qwen2.5-coder:7b`) over the full
widened fixture set — see
[First results (widened live comparison)](#first-results-widened-live-comparison): 8 fixtures,
`native` vs `ecc`, 3 repetitions (48 runs). Its outcome is statistically inconclusive and the
direction is unstable across runs; it validates the live pipeline and the per-category /
per-complexity analysis surface rather than answering whether ECC helps.

Still to do for a *powered* result: (1) **a stronger model** (a capable hosted LLM, or a larger
local one) so the native baseline can solve enough tasks to make the comparison discriminating —
**this is the binding constraint**, confirmed by the widened run (0 of 24 L3 runs succeeded under
either arm); (2) more repetitions per task for tighter confidence intervals. Widening the fixture
set from 3 to 8 has already been done and, as predicted, did not by itself make the result
conclusive — more fixtures on the same 7B model stay inconclusive.

**Harness robustness (why this 48-run batch completed):** an earlier attempt at this same run
aborted mid-batch when the weak model emitted a malformed action the `Trace` schema rejected, whose
`parse` runs outside the agent's own try/catch. The experiment loop now (a) maps an empty tool-path
argument to a targetless action rather than a schema-invalid empty string, and (b) isolates each
`(task, condition, rep)` case so an unexpected throw is logged and counted (`failedCaseCount`) and
the remaining cases still run — one bad run can no longer discard the whole batch. This run reported
`failedCaseCount = 0`.

The mechanism remains fully reproducible without any spend via the free, deterministic "smoke
reproduction" (`npm run reproduce:smoke` — see
[REPRODUCING.md](REPRODUCING.md#step-0-free-smoke-reproduction-start-here)), which proves the
pipeline mechanics reproduce identically across machines. Reproducing the live pilot needs your own
local model or API key and `npm run experiment:run` — see [REPRODUCING.md](REPRODUCING.md).
