// SPDX-License-Identifier: AGPL-3.0-only
import type {LlmResponse, LlmRuntimeEvent, LlmTask, SecFlowConfig} from '../core/types.js';
import {anthropicAdapter} from './adapters/anthropic.js';
import {claudeCodeCliAdapter} from './adapters/claudeCodeCli.js';
import {codexCliAdapter} from './adapters/codexCli.js';
import {openAiAdapter} from './adapters/openai.js';
import {openRouterAdapter} from './adapters/openrouter.js';
import type {LlmRuntimeAdapter} from './adapter.js';

const adapters: LlmRuntimeAdapter[] = [openAiAdapter, anthropicAdapter, openRouterAdapter, codexCliAdapter, claudeCodeCliAdapter];

export function listRuntimeSummaries(config: SecFlowConfig): Array<{name: string; kind: string; enabled: boolean; model?: string; auth?: string}> {
  return Object.entries(config.providers).map(([name, provider]) => ({
    name,
    kind: provider.kind,
    enabled: provider.enabled,
    model: provider.defaultModel,
    auth: provider.apiKeyEnv ?? (provider.command ? `command: ${provider.command}` : undefined)
  }));
}

export async function invokeConfiguredRuntime(
  config: SecFlowConfig,
  task: LlmTask,
  runtimeName = config.defaultRuntime,
  onRuntimeEvent?: (event: LlmRuntimeEvent) => void
): Promise<LlmResponse | undefined> {
  if (!runtimeName) {
    return undefined;
  }
  const provider = config.providers[runtimeName];
  if (!provider || !provider.enabled) {
    return undefined;
  }
  const modelProfile =
    Object.values(config.modelProfiles).find((profile) => profile.provider === runtimeName) ??
    Object.values(config.modelProfiles).find((profile) => profile.provider === provider.kind) ??
    {
      provider: runtimeName,
      model: provider.defaultModel ?? 'default'
    };
  const adapter = adapters.find((candidate) => candidate.kind === provider.kind);
  if (!adapter) {
    throw new Error(`No LLM runtime adapter is registered for ${provider.kind}.`);
  }
  const emit = config.runtime.streamEvents
    ? (event: Omit<LlmRuntimeEvent, 'timestamp' | 'runtime' | 'taskId' | 'promptId'>) =>
        onRuntimeEvent?.({
          timestamp: new Date().toISOString(),
          runtime: runtimeName,
          taskId: task.id,
          promptId: task.promptId,
          ...event
        })
    : undefined;
  emit?.({type: 'start', message: `Starting ${runtimeName} for ${task.promptId}.`});
  try {
    const response = await adapter.invoke({providerName: runtimeName, provider, modelProfile, task}, emit ? {onEvent: emit} : undefined);
    emit?.({type: 'complete', message: `Completed ${runtimeName} for ${task.promptId}.`});
    return response;
  } catch (error) {
    emit?.({type: 'error', message: error instanceof Error ? error.message : String(error)});
    throw error;
  }
}
