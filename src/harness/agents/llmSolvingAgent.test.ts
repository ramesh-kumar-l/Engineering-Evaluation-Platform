import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Task } from '../../domain/task/task.schema.js';
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from '../llm/llmClient.types.js';
import { LlmSolvingAgent } from './llmSolvingAgent.js';

const task = {
  schemaVersion: '1.0.0',
  id: 'debugging-01',
  taskVersion: '1.0.0',
  title: 'Off-by-one error in pagination utility',
  description: 'Fix the pagination boundary bug.',
  category: 'debugging',
  complexity: 'L1',
  repository: { url: 'benchmark/fixtures/debugging-01', commitSha: 'abc123' },
  acceptanceCriteria: ['paginate() returns correct pages.'],
  verificationMethod: 'test-suite: run the pagination tests.',
  tags: [],
  createdAt: '2026-09-13T00:00:00Z',
} as Task;

/** Returns each scripted completion in order (or throws a scripted Error) — no real network I/O. */
class ScriptedLlmClient implements LlmClient {
  readonly providerLabel = 'scripted';
  readonly model = 'scripted-model';
  callCount = 0;
  readonly requests: LlmCompletionRequest[] = [];

  constructor(private readonly script: readonly (LlmCompletionResult | Error)[]) {}

  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.requests.push(request);
    const next = this.script[this.callCount];
    this.callCount++;
    if (next === undefined) throw new Error('ScriptedLlmClient script exhausted');
    if (next instanceof Error) throw next;
    return Promise.resolve(next);
  }
}

function freshWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eep-llmagent-'));
  writeFileSync(join(dir, 'a.js'), '// placeholder', 'utf-8');
  return dir;
}

describe('LlmSolvingAgent', () => {
  it('reports SUCCESS and records a concluding decision when the model calls no tools', async () => {
    const client = new ScriptedLlmClient([{ role: 'assistant', content: 'Nothing to fix.', toolCalls: [] }]);
    const agent = new LlmSolvingAgent({ client });
    const result = await agent.run({ runId: 'run-1', task, repositoryPath: freshWorkspace() });

    expect(result.status).toBe('SUCCESS');
    expect(result.actions).toHaveLength(0);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.description).toContain('Concluded');
  });

  it('executes tool calls, records one Action per call, and feeds results back for the next turn', async () => {
    const client = new ScriptedLlmClient([
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'a.js' } }] },
      { role: 'assistant', content: 'Done.', toolCalls: [] },
    ]);
    const agent = new LlmSolvingAgent({ client });
    const result = await agent.run({ runId: 'run-1', task, repositoryPath: freshWorkspace() });

    expect(result.status).toBe('SUCCESS');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.type).toBe('file-read');
    expect(result.actions[0]?.target).toBe('a.js');
    expect(client.callCount).toBe(2);
  });

  it.each([
    [
      'inline prose',
      'I will inspect the file first.\n\n1. Read the file.\n    {"name":"read_file","arguments":{"path":"a.js"}}',
    ],
    [
      'a fenced block',
      'I will inspect the file first.\n\n```json\n{"name":"read_file","arguments":{"path":"a.js"}}\n```',
    ],
    [
      'inline prose after a code example',
      'Example:\n```javascript\nfunction paginate() {\n  const bounds = { end: 3 };\n}\nmodule.exports = { paginate };\n```\nRead the file:\n{"name":"read_file","arguments":{"path":"a.js"}}',
    ],
  ])('executes a recognized tool call in %s', async (_format, content) => {
    const client = new ScriptedLlmClient([
      { role: 'assistant', content, toolCalls: [] },
      { role: 'assistant', content: 'Done.', toolCalls: [] },
    ]);
    const agent = new LlmSolvingAgent({ client });
    const result = await agent.run({ runId: 'run-1', task, repositoryPath: freshWorkspace() });

    expect(result.status).toBe('SUCCESS');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.target).toBe('a.js');
    expect(result.actions[0]?.detail).toContain('// placeholder');
    expect(client.requests[1]?.messages[1]).toMatchObject({
      role: 'assistant',
      content: '',
      toolCalls: [{ name: 'read_file', arguments: { path: 'a.js' } }],
    });
  });

  it('reports INCOMPLETE when the max-turn budget is exhausted without concluding', async () => {
    const alwaysCallsATool: LlmCompletionResult = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c', name: 'list_files', arguments: {} }],
    };
    const client = new ScriptedLlmClient(Array.from({ length: 5 }, () => alwaysCallsATool));
    const agent = new LlmSolvingAgent({ client, maxTurns: 3 });
    const result = await agent.run({ runId: 'run-1', task, repositoryPath: freshWorkspace() });

    expect(result.status).toBe('INCOMPLETE');
    expect(result.actions).toHaveLength(3);
    expect(result.decisions.at(-1)?.description).toContain('turn budget');
  });

  it('reports TIMEOUT immediately when the wall-clock budget is already exhausted, without calling the client', async () => {
    const client = new ScriptedLlmClient([]);
    const agent = new LlmSolvingAgent({ client, wallClockBudgetMs: -1 });
    const result = await agent.run({ runId: 'run-1', task, repositoryPath: freshWorkspace() });

    expect(result.status).toBe('TIMEOUT');
    expect(client.callCount).toBe(0);
  });

  it('reports AGENT_FAILURE when the LLM client throws, recording why as a Decision', async () => {
    const client = new ScriptedLlmClient([new Error('upstream 500')]);
    const agent = new LlmSolvingAgent({ client });
    const result = await agent.run({ runId: 'run-1', task, repositoryPath: freshWorkspace() });

    expect(result.status).toBe('AGENT_FAILURE');
    expect(result.decisions[0]?.rationale).toContain('upstream 500');
  });
});
