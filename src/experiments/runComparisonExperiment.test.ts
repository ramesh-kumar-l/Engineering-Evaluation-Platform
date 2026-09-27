import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAllRunResults } from './resultsWriter.js';
import { runCasesResiliently, runComparisonExperiment } from './runComparisonExperiment.js';

async function writeFakeEccCli(directory: string): Promise<string> {
  const scriptPath = join(directory, 'fake-ecc.js');
  const packageJson = JSON.stringify({
    version: '0.1',
    task: { type: 'test', request: 'fake task' },
    repository: { name: 'fixture', commit: 'abc123' },
    context: { primary: [], supporting: [] },
    conflicts: [],
    history: [],
    constraints: [],
    unknowns: [],
    verification: [],
    excluded: [],
  });
  await writeFile(scriptPath, `console.log(${JSON.stringify(packageJson)});`, 'utf-8');
  return scriptPath;
}

/**
 * These tests exercise the condition-selection behavior only, using the free `fake-deterministic`
 * backend (never a paid vendor) and a throwaway results directory. They assert *which* conditions
 * run, not any outcome quality — the fake agent solves nothing (see DeterministicFakeLlmClient).
 */
describe('runComparisonExperiment condition selection', () => {
  it('runs only the named subset of conditions', async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), 'eep-run-subset-'));
    const fakeEccCli = await writeFakeEccCli(resultsDir);
    const { experimentId, runCount } = await runComparisonExperiment({
      llmProviderConfig: { provider: 'fake-deterministic' },
      eccCliInvokerOptions: { command: process.execPath, commandArgs: [fakeEccCli] },
      taskIds: ['debugging-01'],
      repetitions: 1,
      conditionNames: ['native', 'ecc'],
      resultsDir,
    });

    expect(runCount).toBe(2);
    const bundles = await readAllRunResults(experimentId, resultsDir);
    expect(new Set(bundles.map((bundle) => bundle.conditionName))).toEqual(new Set(['native', 'ecc']));
  }, 30_000);

  it('reports failedCaseCount 0 on a clean run', async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), 'eep-run-clean-'));
    const fakeEccCli = await writeFakeEccCli(resultsDir);
    const result = await runComparisonExperiment({
      llmProviderConfig: { provider: 'fake-deterministic' },
      eccCliInvokerOptions: { command: process.execPath, commandArgs: [fakeEccCli] },
      taskIds: ['debugging-01'],
      repetitions: 1,
      conditionNames: ['native', 'ecc'],
      resultsDir,
    });

    expect(result.runCount).toBe(2);
    expect(result.failedCaseCount).toBe(0);
  }, 30_000);

  it('throws on an unknown condition name and writes nothing', async () => {
    const resultsDir = await mkdtemp(join(tmpdir(), 'eep-run-bad-'));
    await expect(
      runComparisonExperiment({
        llmProviderConfig: { provider: 'fake-deterministic' },
        taskIds: ['debugging-01'],
        repetitions: 1,
        conditionNames: ['native', 'not-a-condition'],
        resultsDir,
      }),
    ).rejects.toThrow(/Unknown condition name\(s\): not-a-condition/);

    // The throw happens before any run is executed, so the results directory stays empty.
    await expect(readdir(resultsDir)).resolves.toEqual([]);
  });
});

describe('runCasesResiliently', () => {
  it('isolates a failing case: the throw is reported and counted, and every other case still runs', async () => {
    const ran: string[] = [];
    const errors: { label: string; message: string }[] = [];
    const { succeeded, failed } = await runCasesResiliently(
      [
        { label: 'case-1', run: () => { ran.push('case-1'); return Promise.resolve(); } },
        { label: 'case-2', run: () => Promise.reject(new Error('boom')) },
        { label: 'case-3', run: () => { ran.push('case-3'); return Promise.resolve(); } },
      ],
      (label, error) => errors.push({ label, message: error instanceof Error ? error.message : String(error) }),
    );

    // The failure in case-2 must NOT prevent case-3 from running — the whole point of the guard.
    expect(ran).toEqual(['case-1', 'case-3']);
    expect(succeeded).toBe(2);
    expect(failed).toBe(1);
    expect(errors).toEqual([{ label: 'case-2', message: 'boom' }]);
  });
});
