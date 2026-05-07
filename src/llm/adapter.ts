// SPDX-License-Identifier: AGPL-3.0-only
import type {LlmResponse, LlmTask, ModelProfile, ProviderConfig} from '../core/types.js';

export interface RuntimeInvocation {
  providerName: string;
  provider: ProviderConfig;
  modelProfile: ModelProfile;
  task: LlmTask;
}

export interface LlmRuntimeAdapter {
  kind: ProviderConfig['kind'];
  invoke(invocation: RuntimeInvocation): Promise<LlmResponse>;
}

export function serializeTaskForPrompt(task: LlmTask): string {
  return [
    `Task: ${task.id}`,
    `Prompt ID: ${task.promptId}`,
    '',
    task.userPrompt,
    '',
    'Context JSON:',
    JSON.stringify(task.context, null, 2)
  ].join('\n');
}

export function parseMaybeJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
