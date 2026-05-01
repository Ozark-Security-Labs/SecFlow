import type {LlmResponse} from '../../core/types.js';
import {serializeTaskForPrompt, type LlmRuntimeAdapter, type RuntimeInvocation} from '../adapter.js';

export const anthropicAdapter: LlmRuntimeAdapter = {
  kind: 'anthropic',
  async invoke(invocation) {
    const apiKey = process.env[invocation.provider.apiKeyEnv ?? 'ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error(`Missing ${invocation.provider.apiKeyEnv ?? 'ANTHROPIC_API_KEY'} for Anthropic runtime.`);
    }
    const url = `${invocation.provider.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(buildAnthropicMessagesRequest(invocation))
    });
    const raw = await response.json();
    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${response.status} ${JSON.stringify(raw)}`);
    }
    return normalizeAnthropicResponse(invocation.providerName, invocation.modelProfile.model, raw);
  }
};

export function buildAnthropicMessagesRequest(invocation: RuntimeInvocation): Record<string, unknown> {
  const {task, modelProfile} = invocation;
  return dropUndefined({
    model: modelProfile.model,
    system: task.systemPrompt,
    max_tokens: modelProfile.maxTokens ?? 4000,
    temperature: modelProfile.temperature,
    top_p: modelProfile.topP,
    messages: [{role: 'user', content: serializeTaskForPrompt(task)}],
    ...modelProfile.extra
  });
}

function normalizeAnthropicResponse(runtime: string, model: string, raw: any): LlmResponse {
  const text = Array.isArray(raw.content)
    ? raw.content.filter((content: any) => content.type === 'text').map((content: any) => content.text).join('\n')
    : '';
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
