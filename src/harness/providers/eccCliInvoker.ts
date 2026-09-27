import crossSpawn from 'cross-spawn';

const DEFAULT_COMMAND = 'ecc';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export interface EccCliInvokerOptions {
  /** Executable to run. Default: `ECC_CLI_COMMAND` env var, else `"ecc"` (assumes a PATH link). */
  readonly command?: string;
  /** Args prepended before `context <request> --path <dir>`, e.g. `["<dist>/cli/index.js"]` when `command` is `"node"`. */
  readonly commandArgs?: readonly string[];
  readonly tokenBudget?: number;
  readonly timeoutMs?: number;
  readonly maxBufferBytes?: number;
}

/** Thrown when the ECC CLI could not be run or exited with a failure. */
export class EccInvocationError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EccInvocationError';
  }
}

/** Thrown when the ECC CLI exceeded its allotted time budget. */
export class EccTimeoutError extends EccInvocationError {
  constructor(message: string) {
    super(message);
    this.name = 'EccTimeoutError';
  }
}

/** Abstraction over "run ECC and get its stdout" — lets EccContextProvider be tested without a real subprocess. */
export interface EccCliInvoker {
  invoke(repositoryPath: string, request: string): Promise<string>;
}

/**
 * Shells out to ECC's own published CLI contract (`ecc context "<task>" --path <dir> [--budget
 * <n>]`, documented in ECC's README) — EEP's only integration point with ECC, per
 * project-memory-bank/00-project-charter.md's repository boundary rule. Never imports ECC
 * source; which command actually runs is fully configurable so a deployment can point at a
 * global `ecc` link or `node <path-to-ecc-checkout>/dist/cli/index.js` without any EEP code
 * change. Uses cross-spawn's argument escaping for Windows command shims, so a task description
 * containing shell metacharacters remains one argument rather than becoming a second command.
 */
export class ProcessEccCliInvoker implements EccCliInvoker {
  private readonly command: string;
  private readonly commandArgs: readonly string[];
  private readonly tokenBudget?: number;
  private readonly timeoutMs: number;
  private readonly maxBufferBytes: number;

  constructor(options: EccCliInvokerOptions = {}) {
    this.command = options.command ?? process.env.ECC_CLI_COMMAND ?? DEFAULT_COMMAND;
    this.commandArgs = options.commandArgs ?? [];
    this.tokenBudget = options.tokenBudget;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  }

  invoke(repositoryPath: string, request: string): Promise<string> {
    const args = [
      ...this.commandArgs,
      'context',
      request,
      '--path',
      repositoryPath,
      ...(this.tokenBudget !== undefined ? ['--budget', String(this.tokenBudget)] : []),
    ];

    return new Promise((resolvePromise, reject) => {
      const child = crossSpawn(this.command, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finish = (error?: Error, output?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolvePromise(output ?? '');
      };

      const timeout = setTimeout(() => {
        child.kill();
        finish(new EccTimeoutError(`ECC CLI exceeded ${String(this.timeoutMs)}ms`));
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        stdoutBytes += Buffer.byteLength(text, 'utf-8');
        if (stdoutBytes > this.maxBufferBytes) {
          child.kill();
          finish(new EccInvocationError(`ECC CLI stdout exceeded ${String(this.maxBufferBytes)} bytes`));
          return;
        }
        stdout += text;
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        stderrBytes += Buffer.byteLength(text, 'utf-8');
        if (stderrBytes > this.maxBufferBytes) {
          child.kill();
          finish(new EccInvocationError(`ECC CLI stderr exceeded ${String(this.maxBufferBytes)} bytes`));
          return;
        }
        stderr += text;
      });

      child.on('error', (error: Error) => {
        finish(new EccInvocationError(`ECC CLI invocation failed: ${error.message}`, error));
      });

      child.on('close', (code, signal) => {
        if (settled) return;
        if (code === 0) {
          finish(undefined, stdout);
          return;
        }
        finish(
          new EccInvocationError(
            `ECC CLI invocation failed: ${signal ? `terminated by ${signal}` : `exited with code ${String(code)}`}` +
              (stderr ? ` (stderr: ${stderr.slice(0, 2000)})` : ''),
          ),
        );
      });
    });
  }
}
