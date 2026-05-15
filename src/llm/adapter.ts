// SPDX-License-Identifier: AGPL-3.0-only
import type {LlmResponse, LlmRuntimeEvent, LlmTask, ModelProfile, ProviderConfig} from '../core/types.js';

export interface RuntimeInvocation {
  providerName: string;
  provider: ProviderConfig;
  modelProfile: ModelProfile;
  task: LlmTask;
}

export interface LlmRuntimeAdapter {
  kind: ProviderConfig['kind'];
  invoke(invocation: RuntimeInvocation, events?: LlmRuntimeEventSink): Promise<LlmResponse>;
}

export interface LlmRuntimeEventSink {
  onEvent: (event: Omit<LlmRuntimeEvent, 'timestamp' | 'runtime' | 'taskId' | 'promptId'>) => void;
}

export function serializeTaskForPrompt(task: LlmTask): string {
  return [
    `Task: ${task.id}`,
    `Prompt ID: ${task.promptId}`,
    '',
    task.userPrompt,
    task.outputSchema ? ['', 'Return only JSON matching this JSON Schema:', JSON.stringify(task.outputSchema, null, 2)].join('\n') : undefined,
    '',
    'Context JSON:',
    JSON.stringify(task.context, null, 2)
  ]
    .filter((part): part is string => part !== undefined)
    .join('\n');
}

export function parseMaybeJson(value: string): unknown | undefined {
  const trimmed = stripJsonFence(value.trim());
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function stripJsonFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1]!.trim() : value;
}
