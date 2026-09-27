/** Thrown when an experiment-selection environment variable is present but malformed. */
export class InvalidExperimentSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidExperimentSelectionError';
  }
}

/**
 * An optional narrowing of what a comparison run covers — which tasks, how many repetitions, and
 * which conditions. Every field is optional; an unset one means "use `runComparisonExperiment`'s
 * own default" (all real-fixture tasks / 3 repetitions / all 9 conditions).
 */
export interface ExperimentSelection {
  readonly taskIds?: readonly string[];
  readonly repetitions?: number;
  readonly conditionNames?: readonly string[];
}

function parseCsv(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

/**
 * Resolves an optional `ExperimentSelection` from environment variables, for the
 * `runComparisonExperiment.js` CLI entry only — mirroring `llmProviderConfigFromEnv.ts`'s
 * env-boundary pattern so the programmatic API stays free of `process.env`. This exists so a first
 * *paid* live run can be scoped down for cost control (e.g. one repetition of `native` vs `ecc` on
 * a single task) without editing code; unset variables leave the full-matrix defaults untouched.
 *
 * Recognized variables:
 * - `EEP_EXPERIMENT_TASK_IDS`: comma-separated task ids (e.g. `"debugging-01,feature-01"`).
 * - `EEP_EXPERIMENT_REPETITIONS`: a positive integer.
 * - `EEP_EXPERIMENT_CONDITIONS`: comma-separated condition names — each must match
 *   `buildExperimentConditions()` exactly (`"native"`, `"ecc"`, or `"ecc-ablated:<component>"`).
 *   Unknown names are rejected later, by `runComparisonExperiment`, which owns the valid set.
 *
 * Throws `InvalidExperimentSelectionError` for a present-but-malformed repetitions value rather
 * than silently falling back to the default — a first paid run should never quietly run more times
 * than intended.
 */
export function experimentSelectionFromEnv(env: NodeJS.ProcessEnv = process.env): ExperimentSelection {
  const selection: {
    -readonly [K in keyof ExperimentSelection]: ExperimentSelection[K];
  } = {};

  const taskIds = parseCsv(env.EEP_EXPERIMENT_TASK_IDS);
  if (taskIds) selection.taskIds = taskIds;

  const conditionNames = parseCsv(env.EEP_EXPERIMENT_CONDITIONS);
  if (conditionNames) selection.conditionNames = conditionNames;

  const repsRaw = env.EEP_EXPERIMENT_REPETITIONS;
  if (repsRaw !== undefined && repsRaw.trim() !== '') {
    const trimmed = repsRaw.trim();
    if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
      throw new InvalidExperimentSelectionError(
        `EEP_EXPERIMENT_REPETITIONS must be a positive integer (got ${JSON.stringify(repsRaw)}).`,
      );
    }
    selection.repetitions = Number(trimmed);
  }

  return selection;
}
