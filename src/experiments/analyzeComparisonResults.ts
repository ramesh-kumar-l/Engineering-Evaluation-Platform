import { pathToFileURL } from 'node:url';
import type { RunAnalysisRecord } from '../analysis/analysisInput.js';
import { analyzeComponentContributions, type ComponentContribution } from '../analysis/componentContribution.js';
import type { RunVerificationRecord } from '../analysis/failureAnalysisInput.js';
import { analyzeFailureClusters, type FailureClusterReport } from '../analysis/failureClustering.js';
import { analyzeRepeatedRuns, type DimensionAnalysis, type RepeatedRunAnalysisReport } from '../analysis/groupedAnalysis.js';
import type { ConfidenceLevel } from '../analysis/tDistribution.js';
import type { ExperimentId } from '../domain/common/ids.js';
import { PRIMARY_METRIC_NAMES, type MetricName } from '../domain/metric/metric.schema.js';
import { ablatedConditionName, ECC_ABLATION_COMPONENTS } from '../harness/providers/eccAblation.js';
import { defaultResultsDir, latestExperimentId, readAllRunResults } from './resultsWriter.js';

const DEFAULT_CONFIDENCE_LEVEL: ConfidenceLevel = 0.95;
const BASELINE_CONDITION_NAME = 'native';
const FULL_ECC_CONDITION_NAME = 'ecc';

export interface ComparisonAnalysisResult {
  readonly experimentId: ExperimentId;
  readonly runCount: number;
  readonly repeatedRunReport: RepeatedRunAnalysisReport;
  readonly componentReports: readonly ComponentContribution[];
  readonly failureClusterReport: FailureClusterReport;
}

/**
 * Phase 6-remainder analysis entry point: reads one comparison run's raw dumped bundles back
 * (`resultsWriter.ts`) and runs Phase 7's `analyzeRepeatedRuns()` and Phase 8's
 * `analyzeComponentContributions()` unchanged against them — the first time either runs against
 * real, not synthetic, data. Both underlying functions are reused exactly as-is: no bespoke
 * statistics live here, only assembling `RunAnalysisRecord[]` from the dumped bundles.
 */
export async function analyzeComparisonResults(
  experimentId?: ExperimentId,
  resultsDir: string = defaultResultsDir(),
  metricNames: readonly MetricName[] = PRIMARY_METRIC_NAMES,
  level: ConfidenceLevel = DEFAULT_CONFIDENCE_LEVEL,
): Promise<ComparisonAnalysisResult> {
  const id = experimentId ?? (await latestExperimentId(resultsDir));
  const bundles = await readAllRunResults(id, resultsDir);
  if (bundles.length === 0) {
    throw new Error(`No run results found for experiment ${id} under ${resultsDir}`);
  }

  const records: RunAnalysisRecord[] = bundles.map((bundle) => ({
    runId: bundle.run.id,
    conditionName: bundle.conditionName,
    taskCategory: bundle.taskCategory,
    taskComplexity: bundle.taskComplexity,
    metrics: bundle.metrics,
  }));

  const repeatedRunReport = analyzeRepeatedRuns(records, {
    metricNames,
    baselineCondition: BASELINE_CONDITION_NAME,
    level,
  });

  const ablatedConditionsByComponent = Object.fromEntries(
    ECC_ABLATION_COMPONENTS.map((component) => [component, ablatedConditionName(component)]),
  );
  const componentReports = analyzeComponentContributions(records, {
    fullConditionName: FULL_ECC_CONDITION_NAME,
    ablatedConditionsByComponent,
    metricNames,
    level,
  });

  const verificationRecords: RunVerificationRecord[] = bundles.map((bundle) => ({
    runId: bundle.run.id,
    conditionName: bundle.conditionName,
    taskCategory: bundle.taskCategory,
    taskComplexity: bundle.taskComplexity,
    verifications: bundle.verifications,
  }));
  const failureClusterReport = analyzeFailureClusters(verificationRecords, { level });

  return { experimentId: id, runCount: bundles.length, repeatedRunReport, componentReports, failureClusterReport };
}

/** Human label for one analysis slice, e.g. `overall`, `category=debugging`, `complexity=L3`. */
function sliceLabel(slice: DimensionAnalysis): string {
  return slice.dimension === 'overall' ? 'overall' : `${slice.dimension}=${slice.dimensionValue}`;
}

/** Prints one metric's per-condition CIs and baseline-vs-condition effect sizes for a single slice. */
function printRepeatedRunSlice(slice: DimensionAnalysis): void {
  console.log(`\nMetric: ${slice.metricName} (${sliceLabel(slice)})`);
  for (const summary of slice.summariesByCondition) {
    console.log(
      summary.status === 'ok'
        ? `  ${summary.conditionName}: n=${String(summary.n)} mean=${summary.mean.toFixed(3)} CI=[${summary.confidenceInterval.lower.toFixed(3)}, ${summary.confidenceInterval.upper.toFixed(3)}]`
        : `  ${summary.conditionName}: insufficient data (${summary.reason})`,
    );
  }
  for (const comparison of slice.comparisons) {
    console.log(
      comparison.status === 'ok'
        ? `  ${comparison.baselineCondition} vs ${comparison.treatmentCondition}: meanDiff=${comparison.meanDifference.toFixed(3)} effectSize=${comparison.effectSize.value.toFixed(3)} (${comparison.effectSize.magnitude})`
        : `  ${comparison.baselineCondition} vs ${comparison.treatmentCondition}: insufficient data (${comparison.reason})`,
    );
  }
}

function printComparisonAnalysisResult(result: ComparisonAnalysisResult): void {
  console.log(`\n=== Comparison analysis: experiment ${result.experimentId} (${String(result.runCount)} runs) ===`);

  console.log(`\n--- Repeated-run analysis (baseline: ${BASELINE_CONDITION_NAME}) ---`);
  for (const slice of result.repeatedRunReport.overall) {
    printRepeatedRunSlice(slice);
  }

  // The per-category / per-complexity slices are computed by analyzeRepeatedRuns() but were not
  // previously printed; they only become meaningful once several fixtures share a category or
  // complexity level (with a single fixture per slice each is n=1 and reports insufficient data).
  console.log(`\n--- Repeated-run analysis by category (baseline: ${BASELINE_CONDITION_NAME}) ---`);
  for (const slice of result.repeatedRunReport.byCategory) {
    printRepeatedRunSlice(slice);
  }

  console.log(`\n--- Repeated-run analysis by complexity (baseline: ${BASELINE_CONDITION_NAME}) ---`);
  for (const slice of result.repeatedRunReport.byComplexity) {
    printRepeatedRunSlice(slice);
  }

  console.log(`\n--- Component ablation analysis (full: ${FULL_ECC_CONDITION_NAME}) ---`);
  for (const contribution of result.componentReports) {
    console.log(`\nComponent: ${contribution.component}`);
    for (const slice of contribution.analysis.overall) {
      for (const comparison of slice.comparisons) {
        console.log(
          comparison.status === 'ok'
            ? `  ${slice.metricName}: meanDiff=${comparison.meanDifference.toFixed(3)} effectSize=${comparison.effectSize.value.toFixed(3)} (${comparison.effectSize.magnitude})`
            : `  ${slice.metricName}: insufficient data (${comparison.reason})`,
        );
      }
    }
  }

  console.log(`\n--- Failure clustering (worst verificationMethod first) ---`);
  console.log('Overall:');
  for (const summary of result.failureClusterReport.overall) {
    console.log(
      `  ${summary.method}: ${String(summary.failureCount)}/${String(summary.totalAttempts)} failed ` +
        `(rate=${summary.failureRate.toFixed(3)}, CI=[${summary.confidenceInterval.lower.toFixed(3)}, ${summary.confidenceInterval.upper.toFixed(3)}])`,
    );
  }
  for (const [label, summaries] of [
    ['By condition', result.failureClusterReport.byCondition],
    ['By category', result.failureClusterReport.byCategory],
    ['By complexity', result.failureClusterReport.byComplexity],
  ] as const) {
    console.log(`${label}:`);
    for (const summary of summaries) {
      console.log(
        `  ${summary.dimensionValue} / ${summary.method}: ${String(summary.failureCount)}/${String(summary.totalAttempts)} failed (rate=${summary.failureRate.toFixed(3)})`,
      );
    }
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const experimentIdArg = process.argv[2] as ExperimentId | undefined;
  analyzeComparisonResults(experimentIdArg)
    .then(printComparisonAnalysisResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
