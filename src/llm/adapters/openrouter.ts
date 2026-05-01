import type {LlmResponse} from '../../core/types.js';
import {serializeTaskForPrompt, type LlmRuntimeAdapter, type RuntimeInvocation} from '../adapter.js';

export const openRouterAdapter: LlmRuntimeAdapter = {
  kind: 'openrouter',
  async invoke(invocation) {
    const apiKey = process.env[invocation.provider.apiKeyEnv ?? 'OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error(`Missing ${invocation.provider.apiKeyEnv ?? 'OPENROUTER_API_KEY'} for OpenRouter runtime.`);
    }
    const url = `${invocation.provider.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'X-OpenRouter-Title': 'SecFlow'
      },
      body: JSON.stringify(buildOpenRouterChatRequest(invocation))
    });
    const raw = await response.json();
    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${response.status} ${JSON.stringify(raw)}`);
    }
    return normalizeOpenRouterResponse(invocation.providerName, invocation.modelProfile.model, raw);
  }
};

export function buildOpenRouterChatRequest(invocation: RuntimeInvocation): Record<string, unknown> {
  const {task, modelProfile} = invocation;
  return dropUndefined({
    model: modelProfile.model,
    messages: [
      {role: 'system', content: task.systemPrompt},
      {role: 'user', content: serializeTaskForPrompt(task)}
    ],
    temperature: modelProfile.temperature,
    top_p: modelProfile.topP,
    max_tokens: modelProfile.maxTokens,
    response_format: task.outputSchema
      ? {
          type: 'json_schema',
          json_schema: {
            name: `${task.promptId.replaceAll('-', '_')}_schema`,
            schema: task.outputSchema,
            strict: false
          }
        }
      : undefined,
    reasoning: modelProfile.reasoningEffort ? {effort: modelProfile.reasoningEffort} : undefined,
    verbosity: modelProfile.verbosity,
    ...modelProfile.extra
  });
}

function normalizeOpenRouterResponse(runtime: string, model: string, raw: any): LlmResponse {
  const text = raw.choices?.[0]?.message?.content ?? '';
  return {
    runtime,
    model: raw.model ?? model,
    text,
    structured: parseJson(text),
    usage: raw.usage,
    raw
  };
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function dropUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
