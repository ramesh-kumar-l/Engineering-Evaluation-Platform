import { pathToFileURL } from 'node:url';
import { loadAllTasks } from '../benchmark/loadTasks.js';
import { generateId } from '../domain/common/idGenerator.js';
import type { ExperimentId } from '../domain/common/ids.js';
import type { Task } from '../domain/task/task.schema.js';
import { executeEvaluatedRun } from '../evaluation/evaluateRun.js';
import { LlmSolvingAgent } from '../harness/agents/llmSolvingAgent.js';
import { createLlmClient, type LlmProviderConfig } from '../harness/llm/createLlmClient.js';
import type { EccCliInvokerOptions } from '../harness/providers/eccCliInvoker.js';
import { computeRunMetrics } from '../metrics/computeMetrics.js';
import { buildExperimentConditions, type ExperimentConditionEntry } from './experimentConditions.js';
import { experimentSelectionFromEnv } from './experimentSelectionFromEnv.js';
import { agentBudgetConfigFromEnv, llmProviderConfigFromEnv } from './llmProviderConfigFromEnv.js';
import { writeRunResult } from './resultsWriter.js';

const EEP_VERSION = '0.1.0';
const EVALUATOR_VERSION = '0.1.0';
const BENCHMARK_VERSION = '1.0.0';

/** The 3 tasks with real, runnable fixture code today — see project-memory-bank/20-next-actions.md #3 for the remaining 27's fixture backlog. */
const REAL_FIXTURE_TASK_IDS: readonly string[] = ['debugging-01', 'feature-01', 'refactoring-01'];
const DEFAULT_REPETITIONS = 3;

export interface RunComparisonExperimentOptions {
  readonly taskIds?: readonly string[];
  readonly repetitions?: number;
  readonly resultsDir?: string;
  readonly environment?: string;
  /**
   * Explicit LLM backend config, bypassing `llmProviderConfigFromEnv()`. Used by Phase 12's smoke
   * reproduction (`runSmokeReproduction.ts`) to force the free `fake-deterministic` provider
   * without mutating `process.env` — see ADR-017 in project-memory-bank/14-decisions.md. Omit for
   * the existing, unchanged behavior (resolve from `EEP_LLM_*` environment variables).
   */
  readonly llmProviderConfig?: LlmProviderConfig;
  /** Optional ECC CLI configuration for programmatic runs and deterministic tests. */
  readonly eccCliInvokerOptions?: EccCliInvokerOptions;
  /**
   * Restricts the run to a subset of the conditions from `buildExperimentConditions()`, by name
   * (`"native"`, `"ecc"`, `"ecc-ablated:<component>"`). Omit to run all 9. Used for cost control on
   * a first paid live run (e.g. just `["native", "ecc"]`); unknown names throw rather than run a
   * partial, misleading comparison.
   */
  readonly conditionNames?: readonly string[];
}

export interface RunComparisonExperimentResult {
  readonly experimentId: ExperimentId;
  /** Number of cases that ran to completion and were written to disk. */
  readonly runCount: number;
  /**
   * Number of cases that threw an unexpected error and were skipped (logged, batch continued). A
   * healthy run is 0; a non-zero count means some `(task, condition, rep)` cases were lost but the
   * rest of the comparison still completed — see `runCasesResiliently`.
   */
  readonly failedCaseCount: number;
}

/** One planned `(task, condition, rep)` case: a human-readable label plus the thunk that runs it. */
interface PlannedCase {
  readonly label: string;
  readonly run: () => Promise<void>;
}

/**
 * Runs every planned case, isolating failures: a throw in one case is handed to `onError` and
 * counted, and the remaining cases still run. This is the batch-robustness guard — before it, a
 * single malformed run (e.g. a weak model emitting an action the Trace schema rejects, which throws
 * from `runHarness.ts`'s `traceSchema.parse`, *outside* that module's agent try/catch) aborted the
 * entire experiment and discarded every not-yet-run case. Expected per-run failure modes are still
 * recorded as an explicit `RunStatus` upstream (see `runHarness.ts`); this only catches the
 * genuinely unexpected so one bad case cannot cost the whole batch.
 */
export async function runCasesResiliently(
  cases: readonly PlannedCase[],
  onError: (label: string, error: unknown) => void,
): Promise<{ readonly succeeded: number; readonly failed: number }> {
  let succeeded = 0;
  let failed = 0;
  for (const planned of cases) {
    try {
      await planned.run();
      succeeded++;
    } catch (error) {
      failed++;
      onError(planned.label, error);
    }
  }
  return { succeeded, failed };
}

/**
 * Phase 6 (remainder) entry point: runs the *same* `LlmSolvingAgent` under every condition
 * (native baseline + full ECC + 7 per-component ablations, from `experimentConditions.ts`)
 * against the given tasks, repeated `repetitions` times each, and dumps each run's full evaluated
 * bundle (Run/Trace/Outcome/Verification/Evidence/Metric) to `resultsDir`. See
 * project-memory-bank/09-experiment-strategy.md: every condition shares task, repository state,
 * agent, model, tools, environment, and evaluator version — only the `ContextProvider` varies.
 * Requires `EEP_LLM_PROVIDER`/`EEP_LLM_MODEL`/etc. to already be set (see
 * `llmProviderConfigFromEnv.ts`); never picks a default backend on its own.
 */
export async function runComparisonExperiment(
  options: RunComparisonExperimentOptions = {},
): Promise<RunComparisonExperimentResult> {
  const taskIds = options.taskIds ?? REAL_FIXTURE_TASK_IDS;
  const repetitions = options.repetitions ?? DEFAULT_REPETITIONS;
  const environment = options.environment ?? `node-${process.version}`;

  const allTasks = loadAllTasks();
  const tasks = allTasks.filter((task) => taskIds.includes(task.id));
  const missing = taskIds.filter((id) => !tasks.some((task) => task.id === id));
  if (missing.length > 0) {
    throw new Error(`Task(s) not found in benchmark/tasks: ${missing.join(', ')}`);
  }

  const client = createLlmClient(options.llmProviderConfig ?? llmProviderConfigFromEnv());
  const agent = new LlmSolvingAgent({ client, ...agentBudgetConfigFromEnv() });
  const conditions = selectConditions(
    buildExperimentConditions(options.eccCliInvokerOptions),
    options.conditionNames,
  );
  const experimentId = generateId<'ExperimentId'>('experiment');

  const cases: PlannedCase[] = [];
  for (const task of tasks) {
    for (const entry of conditions) {
      for (let rep = 0; rep < repetitions; rep++) {
        const label = `task=${task.id} condition=${entry.condition.name} rep=${String(rep + 1)}/${String(repetitions)}`;
        cases.push({
          label,
          run: () =>
            runOneEvaluatedCase(task, entry, agent, experimentId, environment, options.resultsDir),
        });
      }
    }
  }

  const { succeeded, failed } = await runCasesResiliently(cases, (label, error) => {
    console.error(
      `Run failed and was skipped (${label}): ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  return { experimentId, runCount: succeeded, failedCaseCount: failed };
}

/**
 * Returns the conditions to run: all of them when `names` is undefined, or exactly the named subset
 * otherwise. Throws on any name absent from `buildExperimentConditions()` (listing the valid names)
 * so a typo can never silently shrink the comparison to a partial, misleading result.
 */
function selectConditions(
  all: readonly ExperimentConditionEntry[],
  names: readonly string[] | undefined,
): ExperimentConditionEntry[] {
  if (names === undefined) return [...all];
  const known = new Set(all.map((entry) => entry.condition.name));
  const missing = names.filter((name) => !known.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Unknown condition name(s): ${missing.join(', ')}. Valid conditions: ${[...known].join(', ')}.`,
    );
  }
  const wanted = new Set(names);
  return all.filter((entry) => wanted.has(entry.condition.name));
}

async function runOneEvaluatedCase(
  task: Task,
  entry: ExperimentConditionEntry,
  agent: LlmSolvingAgent,
  experimentId: ExperimentId,
  environment: string,
  resultsDir: string | undefined,
): Promise<void> {
  const evaluated = await executeEvaluatedRun(
    task,
    { agent, contextProvider: entry.contextProvider },
    {
      experimentId,
      conditionId: entry.condition.id,
      eepVersion: EEP_VERSION,
      evaluatorVersion: EVALUATOR_VERSION,
      benchmarkVersion: BENCHMARK_VERSION,
      environment,
    },
  );

  const metrics = computeRunMetrics({
    run: evaluated.run,
    trace: evaluated.trace,
    outcome: evaluated.outcome,
    verifications: evaluated.verifications,
    evidence: evaluated.evidence,
    contextArtifact: evaluated.contextArtifact,
    executionErrors: evaluated.executionErrors,
  });

  await writeRunResult(
    {
      conditionName: entry.condition.name,
      taskId: task.id,
      taskCategory: task.category,
      taskComplexity: task.complexity,
      run: evaluated.run,
      trace: evaluated.trace,
      outcome: evaluated.outcome,
      verifications: evaluated.verifications,
      evidence: evaluated.evidence,
      metrics,
      contextArtifact: evaluated.contextArtifact,
    },
    experimentId,
    evaluated.run.id,
    resultsDir,
  );
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  runComparisonExperiment(experimentSelectionFromEnv())
    .then(({ experimentId, runCount, failedCaseCount }) => {
      console.log(`Wrote ${String(runCount)} run(s) for experiment ${experimentId} to experiment-results/${experimentId}/`);
      if (failedCaseCount > 0) {
        console.warn(`${String(failedCaseCount)} case(s) failed unexpectedly and were skipped (see errors above); the rest of the batch completed.`);
      }
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
