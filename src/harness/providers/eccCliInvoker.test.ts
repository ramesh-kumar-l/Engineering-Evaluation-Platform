import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EccInvocationError, EccTimeoutError, ProcessEccCliInvoker } from './eccCliInvoker.js';

/**
 * These tests never touch a real ECC checkout — they spawn small, self-authored Node scripts
 * (via `process.execPath`) that stand in for the CLI's success/failure/timeout behavior, so the
 * invoker's process-handling logic is verified deterministically on any machine.
 */
function writeFakeCli(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'eep-fake-ecc-'));
  const scriptPath = join(dir, 'fake-ecc.js');
  writeFileSync(scriptPath, script, 'utf-8');
  return scriptPath;
}

function writeFakeWindowsCli(scriptPath: string): string {
  const commandPath = join(dirname(scriptPath), 'fake-ecc.cmd');
  writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf-8');
  return commandPath;
}

describe('ProcessEccCliInvoker', () => {
  it('resolves with stdout on a zero exit code', async () => {
    const scriptPath = writeFakeCli(`console.log(JSON.stringify({ ok: true, argv: process.argv.slice(2) }));`);
    const invoker = new ProcessEccCliInvoker({
      command: process.execPath,
      commandArgs: [scriptPath],
      tokenBudget: 500,
    });

    const stdout = await invoker.invoke('/some/repo', 'explain the module');
    const parsed: { ok: boolean; argv: string[] } = JSON.parse(stdout) as {
      ok: boolean;
      argv: string[];
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.argv).toEqual([
      'context',
      'explain the module',
      '--path',
      '/some/repo',
      '--budget',
      '500',
    ]);
  });

  it('rejects with EccInvocationError on a nonzero exit code', async () => {
    const scriptPath = writeFakeCli(
      `console.error('boom'); process.exitCode = 1;`,
    );
    const invoker = new ProcessEccCliInvoker({ command: process.execPath, commandArgs: [scriptPath] });

    await expect(invoker.invoke('/some/repo', 'x')).rejects.toThrow(EccInvocationError);
  });

  it('rejects with EccTimeoutError when the process runs past the timeout', async () => {
    const scriptPath = writeFakeCli(`setTimeout(() => {}, 5000);`);
    const invoker = new ProcessEccCliInvoker({
      command: process.execPath,
      commandArgs: [scriptPath],
      timeoutMs: 200,
    });

    await expect(invoker.invoke('/some/repo', 'x')).rejects.toThrow(EccTimeoutError);
  }, 10_000);

  it('rejects with EccInvocationError when the command does not exist', async () => {
    const invoker = new ProcessEccCliInvoker({ command: 'eep-command-that-does-not-exist-xyz' });

    await expect(invoker.invoke('/some/repo', 'x')).rejects.toThrow(EccInvocationError);
  });

  it('passes the task description as a single argv entry (no shell interpretation)', async () => {
    const scriptPath = writeFakeCli(`console.log(JSON.stringify(process.argv.slice(2)));`);
    const invoker = new ProcessEccCliInvoker({ command: process.execPath, commandArgs: [scriptPath] });

    const stdout = await invoker.invoke('/some/repo', 'rm -rf / ; echo pwned');
    const argv: string[] = JSON.parse(stdout) as string[];

    expect(argv).toContain('rm -rf / ; echo pwned');
  });

  it.runIf(process.platform === 'win32')(
    'launches a Windows command shim and preserves shell metacharacters as argument data',
    async () => {
      const scriptPath = writeFakeCli(`console.log(JSON.stringify(process.argv.slice(2)));`);
      const commandPath = writeFakeWindowsCli(scriptPath);
      const invoker = new ProcessEccCliInvoker({ command: commandPath });

      const stdout = await invoker.invoke(tmpdir(), 'explain this ; echo should-not-run');
      const argv: string[] = JSON.parse(stdout) as string[];

      expect(argv).toEqual(['context', 'explain this ; echo should-not-run', '--path', tmpdir()]);
    },
  );
});
