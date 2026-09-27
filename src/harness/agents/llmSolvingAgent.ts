import { generateId } from '../../domain/common/idGenerator.js';
import type { Agent, AgentRunRequest, AgentRunResult } from '../../domain/providers/agent.js';
import type { Action, ActionType } from '../../domain/trace/action.schema.js';
import type { Decision } from '../../domain/trace/decision.schema.js';
import type { LlmClient, LlmMessage, LlmToolCall } from '../llm/llmClient.types.js';
import { executeAgentTool, LLM_AGENT_TOOLS } from './llmAgentTools.js';
import { buildInitialUserMessage, buildSystemPrompt } from './promptBuilder.js';

export const LLM_SOLVING_AGENT_VERSION = '1.0.0';

const DEFAULT_MAX_TURNS = 15;
const DEFAULT_WALL_CLOCK_BUDGET_MS = 5 * 60_000;
const ACTION_DETAIL_MAX_CHARS = 500;

export interface LlmSolvingAgentOptions {
  readonly client: LlmClient;
  /**
   * Defaults to `llm-solving-agent:<providerLabel>:<model>` so `Run.metadata.agentName` always
   * identifies the exact backend and model used for that run — the only channel currently
   * available for model identity (see project-memory-bank/10-reproducibility.md's required
   * metadata and ADR-013's documented limitation that `Run.metadata.modelName`/`modelVersion`
   * themselves are not yet wired through `runHarness.ts`).
   */
  readonly name?: string;
  readonly version?: string;
  readonly maxTurns?: number;
  readonly maxTokensPerCompletion?: number;
  readonly wallClockBudgetMs?: number;
}

function actionTypeForTool(toolName: string): ActionType {
  switch (toolName) {
    case 'read_file':
      return 'file-read';
    case 'write_file':
      return 'file-edit';
    case 'run_tests':
      return 'test-run';
    default:
      return 'tool-call';
  }
}

function extractJsonObjects(content: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (start === -1) {
      if (character === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === '{') depth++;
    else if (character === '}') {
      depth--;
      if (depth === 0) {
        objects.push(content.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function parseTextToolCall(content: string, turn: number): LlmToolCall | undefined {
  const candidates = [
    content.trim(),
    ...Array.from(content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1]?.trim() ?? ''),
    ...extractJsonObjects(content),
  ];

  for (const candidateContent of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidateContent);
    } catch {
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.name !== 'string' ||
      !LLM_AGENT_TOOLS.some((tool) => tool.name === candidate.name) ||
      typeof candidate.arguments !== 'object' ||
      candidate.arguments === null ||
      Array.isArray(candidate.arguments)
    ) {
      continue;
    }

    return {
      id: `text-tool-${String(turn)}`,
      name: candidate.name,
      arguments: candidate.arguments as Record<string, unknown>,
    };
  }

  return undefined;
}

/**
 * The real, LLM-backed solving agent (Phase 6 remainder) — replaces `NativeAgent` as the "does
 * real work" agent under every condition in the actual comparison run (native baseline included;
 * only the `ContextProvider` varies — see project-memory-bank/09-experiment-strategy.md). Runs a
 * bounded tool loop against whatever `LlmClient` it is constructed with (ADR-013), so the exact
 * same agent implementation runs against Claude, ChatGPT, Gemini, or a local model purely by
 * configuration. Per ADR-008, this agent's own reported status is never authoritative — real
 * verifiers still decide `Outcome.status` independently (`determineOutcomeStatus`); this class
 * only records what the agent *believed* happened and why, as provenance.
 */
export class LlmSolvingAgent implements Agent {
  readonly name: string;
  readonly version: string;

  private readonly client: LlmClient;
  private readonly maxTurns: number;
  private readonly maxTokensPerCompletion?: number;
  private readonly wallClockBudgetMs: number;

  constructor(options: LlmSolvingAgentOptions) {
    this.client = options.client;
    this.name = options.name ?? `llm-solving-agent:${options.client.providerLabel}:${options.client.model}`;
    this.version = options.version ?? LLM_SOLVING_AGENT_VERSION;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.maxTokensPerCompletion = options.maxTokensPerCompletion;
    this.wallClockBudgetMs = options.wallClockBudgetMs ?? DEFAULT_WALL_CLOCK_BUDGET_MS;
  }

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const actions: Action[] = [];
    const decisions: Decision[] = [];
    const messages: LlmMessage[] = [
      { role: 'user', content: buildInitialUserMessage(request.task, request.contextArtifact) },
    ];

    const recordDecision = (description: string, rationale?: string): void => {
      decisions.push({
        schemaVersion: '1.0.0',
        id: generateId<'DecisionId'>('decision'),
        runId: request.runId,
        description,
        alternativesConsidered: [],
        rationale,
        timestamp: new Date().toISOString(),
      });
    };

    for (let turn = 0; turn < this.maxTurns; turn++) {
      if (Date.now() - startedAt > this.wallClockBudgetMs) {
        recordDecision('Stopped: wall-clock budget exhausted before the task was concluded.');
        return { status: 'TIMEOUT', actions, decisions };
      }

      let completion;
      try {
        completion = await this.client.complete({
          systemPrompt: buildSystemPrompt(),
          messages,
          tools: LLM_AGENT_TOOLS,
          maxTokens: this.maxTokensPerCompletion,
        });
      } catch (error) {
        recordDecision(
          'Stopped: the LLM client failed to produce a completion.',
          error instanceof Error ? error.message : String(error),
        );
        return { status: 'AGENT_FAILURE', actions, decisions };
      }

      const textToolCall =
        completion.toolCalls.length === 0 ? parseTextToolCall(completion.content, turn) : undefined;
      const toolCalls = completion.toolCalls.length > 0 ? completion.toolCalls : textToolCall ? [textToolCall] : [];
      messages.push({
        role: 'assistant',
        content: textToolCall ? '' : completion.content,
        toolCalls,
      });

      if (toolCalls.length === 0) {
        recordDecision(
          'Concluded the task without further tool calls.',
          completion.content || undefined,
        );
        return { status: 'SUCCESS', actions, decisions };
      }

      for (const call of toolCalls) {
        const timestamp = new Date().toISOString();
        const result = await executeAgentTool(request.repositoryPath, call.name, call.arguments);

        actions.push({
          schemaVersion: '1.0.0',
          id: generateId<'ActionId'>('action'),
          runId: request.runId,
          type: actionTypeForTool(call.name),
          target: typeof call.arguments.path === 'string' ? call.arguments.path : undefined,
          detail: result.slice(0, ACTION_DETAIL_MAX_CHARS),
          timestamp,
        });

        messages.push({ role: 'tool', toolCallId: call.id, toolName: call.name, content: result });
      }
    }

    recordDecision(`Stopped: reached the ${String(this.maxTurns)}-turn budget without concluding.`);
    return { status: 'INCOMPLETE', actions, decisions };
  }
}
