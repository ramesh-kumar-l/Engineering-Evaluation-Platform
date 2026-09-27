import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExperimentId, RunId } from '../domain/common/ids.js';
import type { Metric } from '../domain/metric/metric.schema.js';
import type { TaskCategory, TaskComplexity } from '../domain/task/task.schema.js';
import type { Verification } from '../domain/verification/verification.schema.js';
import { analyzeComparisonResults } from './analyzeComparisonResults.js';
import { writeRunResult, type RunResultBundle } from './resultsWriter.js';

function successMetric(runId: RunId, value: number): Metric {
  return {
    schemaVersion: '1.0.0',
    id: `metric-${runId}` as Metric['id'],
    runId,
    name: 'task-success',
    value,
    computedAt: '2026-09-13T00:00:00Z',
  };
}

function testSuiteVerification(runId: RunId, passed: boolean): Verification {
  return {
    schemaVersion: '1.0.0',
    id: `verification-${runId}` as Verification['id'],
    runId,
    method: 'test-suite',
    passed,
    evidenceIds: [],
    timestamp: '2026-09-13T00:00:00Z',
  };
}

interface BundleOverrides {
  readonly taskId?: string;
  readonly taskCategory?: TaskCategory;
  readonly taskComplexity?: TaskComplexity;
}

function bundleFor(conditionName: string, runId: RunId, value: number, overrides: BundleOverrides = {}): RunResultBundle {
  return {
    conditionName,
    taskId: overrides.taskId ?? 'debugging-01',
    taskCategory: overrides.taskCategory ?? 'debugging',
    taskComplexity: overrides.taskComplexity ?? 'L1',
    run: { id: runId } as unknown as RunResultBundle['run'],
    trace: { id: `trace-${runId}` } as unknown as RunResultBundle['trace'],
    outcome: { id: `outcome-${runId}`, status: value === 1 ? 'SUCCESS' : 'TASK_FAILURE' } as unknown as RunResultBundle['outcome'],
    verifications: [testSuiteVerification(runId, value === 1)],
    evidence: [],
    metrics: [successMetric(runId, value)],
  };
}

/**
 * End-to-end wiring check using synthetic bundles (no live LLM/ECC call — those are gated behind
 * real credentials/checkouts, per project-memory-bank/16-risks.md and the eccContextProvider
 * "real CLI" test's precedent). Proves `analyzeComparisonResults` correctly reconstructs
 * `RunAnalysisRecord[]` from dumped bundles and drives Phase 7/8's analysis functions unchanged.
 */
describe('analyzeComparisonResults', () => {
  it('reconstructs analysis records from dumped bundles and reports native/ecc plus every ablation component', async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), 'eep-analyze-'));
    const experimentId = 'experiment-analyze-1' as ExperimentId;

    await writeRunResult(bundleFor('native', 'run-n1' as RunId, 0), experimentId, 'run-n1' as RunId, resultsDir);
    await writeRunResult(bundleFor('native', 'run-n2' as RunId, 0), experimentId, 'run-n2' as RunId, resultsDir);
    await writeRunResult(bundleFor('ecc', 'run-e1' as RunId, 1), experimentId, 'run-e1' as RunId, resultsDir);
    await writeRunResult(bundleFor('ecc', 'run-e2' as RunId, 1), experimentId, 'run-e2' as RunId, resultsDir);
    await writeRunResult(
      bundleFor('ecc-ablated:history', 'run-h1' as RunId, 0),
      experimentId,
      'run-h1' as RunId,
      resultsDir,
    );

    const result = await analyzeComparisonResults(experimentId, resultsDir, ['task-success'], 0.95);

    expect(result.runCount).toBe(5);
    expect(result.repeatedRunReport.conditionsObserved).toEqual(
      expect.arrayContaining(['native', 'ecc', 'ecc-ablated:history']),
    );
    expect(result.componentReports).toHaveLength(7);

    const historyContribution = result.componentReports.find((c) => c.component === 'history');
    expect(historyContribution?.analysis.conditionsObserved).toEqual(
      expect.arrayContaining(['ecc', 'ecc-ablated:history']),
    );

    expect(result.failureClusterReport.methodsObserved).toEqual(['test-suite']);
    const overall = result.failureClusterReport.overall[0];
    expect(overall?.method).toBe('test-suite');
    expect(overall?.totalAttempts).toBe(5);
    expect(overall?.failureCount).toBe(3);
    const nativeCluster = result.failureClusterReport.byCondition.find((s) => s.dimensionValue === 'native');
    expect(nativeCluster?.failureRate).toBe(1);
    const eccCluster = result.failureClusterReport.byCondition.find((s) => s.dimensionValue === 'ecc');
    expect(eccCluster?.failureRate).toBe(0);
  });

  it('produces per-category and per-complexity repeated-run slices across multiple fixtures', async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), 'eep-analyze-slices-'));
    const experimentId = 'experiment-analyze-slices' as ExperimentId;

    const debugging: BundleOverrides = { taskId: 'debugging-01', taskCategory: 'debugging', taskComplexity: 'L1' };
    const performance: BundleOverrides = { taskId: 'performance-01', taskCategory: 'performance', taskComplexity: 'L3' };

    // Two categories / two complexity levels, each with n=2 per condition so the slices are analyzable.
    await writeRunResult(bundleFor('native', 'run-dn1' as RunId, 0, debugging), experimentId, 'run-dn1' as RunId, resultsDir);
    await writeRunResult(bundleFor('native', 'run-dn2' as RunId, 0, debugging), experimentId, 'run-dn2' as RunId, resultsDir);
    await writeRunResult(bundleFor('ecc', 'run-de1' as RunId, 1, debugging), experimentId, 'run-de1' as RunId, resultsDir);
    await writeRunResult(bundleFor('ecc', 'run-de2' as RunId, 1, debugging), experimentId, 'run-de2' as RunId, resultsDir);
    await writeRunResult(bundleFor('native', 'run-pn1' as RunId, 0, performance), experimentId, 'run-pn1' as RunId, resultsDir);
    await writeRunResult(bundleFor('native', 'run-pn2' as RunId, 1, performance), experimentId, 'run-pn2' as RunId, resultsDir);
    await writeRunResult(bundleFor('ecc', 'run-pe1' as RunId, 1, performance), experimentId, 'run-pe1' as RunId, resultsDir);
    await writeRunResult(bundleFor('ecc', 'run-pe2' as RunId, 1, performance), experimentId, 'run-pe2' as RunId, resultsDir);

    const result = await analyzeComparisonResults(experimentId, resultsDir, ['task-success'], 0.95);

    const categories = result.repeatedRunReport.byCategory.map((s) => s.dimensionValue);
    expect(categories).toEqual(expect.arrayContaining(['debugging', 'performance']));
    const complexities = result.repeatedRunReport.byComplexity.map((s) => s.dimensionValue);
    expect(complexities).toEqual(expect.arrayContaining(['L1', 'L3']));

    // Each category slice carries a native-vs-ecc comparison (the effect size the printer now emits).
    const debuggingSlice = result.repeatedRunReport.byCategory.find(
      (s) => s.dimensionValue === 'debugging' && s.metricName === 'task-success',
    );
    expect(debuggingSlice?.comparisons.some((c) => c.treatmentCondition === 'ecc')).toBe(true);
  });

  it('resolves the most recently written experiment when no experimentId is given', async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), 'eep-analyze-latest-'));
    const experimentId = 'experiment-analyze-latest' as ExperimentId;
    await writeRunResult(bundleFor('native', 'run-1' as RunId, 1), experimentId, 'run-1' as RunId, resultsDir);

    const result = await analyzeComparisonResults(undefined, resultsDir, ['task-success'], 0.95);
    expect(result.experimentId).toBe(experimentId);
  });

  it('throws when no run results exist for the requested experiment', async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), 'eep-analyze-empty-'));
    await expect(
      analyzeComparisonResults('experiment-missing' as ExperimentId, resultsDir),
    ).rejects.toThrow();
  });
});
