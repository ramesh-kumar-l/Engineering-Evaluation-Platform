# The EEP Benchmark

**A first live comparison run has now been executed — see [First results (pilot)](#first-results-pilot)
below.** It is a deliberately small, local, zero-cost pilot (a 7B local model over the 3
real-fixture tasks), and its headline finding is that *the result is statistically inconclusive at
this sample size and model strength* — reported here exactly as measured. This document describes
the benchmark's *design* and the pilot. Remaining artifacts that are not live results — e.g.
[`docs/sample-dashboard.html`](sample-dashboard.html) — stay explicitly labeled as synthetic demos.
See [REPRODUCING.md](REPRODUCING.md) to run it yourself.

## First results (pilot)

*Run 2026-09-27. Backend: `qwen2.5-coder:7b` via a local Ollama OpenAI-compatible endpoint (free,
offline). Scope: the 3 real-fixture tasks, `native` vs full `ecc`, 1 repetition each (n = 3 runs
per condition). This is a pilot to validate the live pipeline end-to-end, **not** a powered
comparison.*

**Per-run outcomes:**

| Task | `native` | `ecc` |
|---|---|---|
| `debugging-01` (L1) | ✅ success | ❌ failure |
| `feature-01` | ❌ failure | ❌ failure |
| `refactoring-01` | ❌ failure | ❌ failure |

**Aggregate (95% confidence intervals, baseline = `native`):**

| Metric | `native` (n=3) | `ecc` (n=3) | Mean diff | Effect size |
|---|---|---|---|---|
| task-success | 0.333 `[0.061, 0.792]` | 0.000 `[0.000, 0.561]` | −0.333 | −1.23 (large) |
| context-efficiency (success/1k tokens) | 2.80 | 0.00 | −2.80 | −0.82 (large) |

**Interpretation — read this carefully, because the effect-size labels are misleading on their own:**

1. **The comparison is statistically inconclusive.** Although the effect sizes are nominally
   "large," the task-success confidence intervals overlap substantially (`native` `[0.061, 0.792]`
   vs `ecc` `[0.000, 0.561]`). At n = 3 with a weak model, no reliable native-vs-ECC conclusion can
   be drawn — and the platform reports it as such rather than headlining the effect size.
2. **The model is the binding constraint, not ECC.** A 7B local model solved at most 1 of 3 tasks.
   With a ceiling that low the experiment cannot discriminate context quality either way; ECC's
   value is expected to appear on harder tasks that the native baseline *cannot* solve unaided.
3. **Run-to-run nondeterminism is real and large.** An earlier isolated single run had `ecc`
   *pass* `debugging-01`; this run had `ecc` *fail* the same task under identical configuration.
   Same task, same condition, opposite outcome — which is precisely why this benchmark's design
   centers on repetitions and confidence intervals rather than single runs.

**What this pilot does and does not establish.** It establishes that the full live pipeline
(harness → real LLM agent → deterministic verification → metrics → statistics) runs end-to-end
against a real model and produces traceable, honestly-reported numbers. It does **not** establish
whether ECC improves outcomes; that requires more repetitions and a stronger model (see
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
fixture's README. The **[First results (pilot)](#first-results-pilot)** above were measured on the
original 3 fixtures; a rerun over the widened set has not yet been executed (see
[Current status](#current-status)).

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

A first **live** pilot has been run against a real model (local `qwen2.5-coder:7b`) — see
[First results (pilot)](#first-results-pilot). It is intentionally small (3 tasks, n = 3 per
condition) and its outcome is statistically inconclusive; it validates the live pipeline rather than
answering whether ECC helps.

Still to do for a *powered* result: (1) more repetitions per task for tighter confidence intervals;
(2) a stronger model (a capable hosted LLM, or a larger local one) so the native baseline can solve
enough tasks to make the comparison discriminating; (3) a rerun over the widened fixture set — the
runnable set has grown from 3 to 8 fixtures across 6 categories (see [Fixture status](#fixture-status)),
which makes the per-category / per-complexity analysis (now printed by `npm run experiment:analyze`)
meaningful rather than one fixture per slice, but that widened rerun has not yet been executed. The
binding constraint remains the model strength, not the fixture count — more fixtures on the same 7B
model would very likely stay inconclusive.

The mechanism remains fully reproducible without any spend via the free, deterministic "smoke
reproduction" (`npm run reproduce:smoke` — see
[REPRODUCING.md](REPRODUCING.md#step-0-free-smoke-reproduction-start-here)), which proves the
pipeline mechanics reproduce identically across machines. Reproducing the live pilot needs your own
local model or API key and `npm run experiment:run` — see [REPRODUCING.md](REPRODUCING.md).
