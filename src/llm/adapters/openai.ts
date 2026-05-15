// SPDX-License-Identifier: AGPL-3.0-only
import type {LlmResponse} from '../../core/types.js';
import {serializeTaskForPrompt, type LlmRuntimeAdapter, type RuntimeInvocation} from '../adapter.js';

export const openAiAdapter: LlmRuntimeAdapter = {
  kind: 'openai',
  async invoke(invocation, events) {
    const apiKey = process.env[invocation.provider.apiKeyEnv ?? 'OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error(`Missing ${invocation.provider.apiKeyEnv ?? 'OPENAI_API_KEY'} for OpenAI runtime.`);
    }
    const url = `${invocation.provider.baseUrl ?? 'https://api.openai.com/v1'}/responses`;
    events?.onEvent({type: 'status', message: `POST ${url}`});
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(buildOpenAIResponsesRequest(invocation))
    });
    const raw = await response.json();
    events?.onEvent({type: 'status', message: `OpenAI response ${response.status}.`});
    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${JSON.stringify(raw)}`);
    }
    return normalizeOpenAIResponse(invocation.providerName, invocation.modelProfile.model, raw);
  }
};

export function buildOpenAIResponsesRequest(invocation: RuntimeInvocation): Record<string, unknown> {
  const {task, modelProfile} = invocation;
  const request: Record<string, unknown> = {
    model: modelProfile.model,
    instructions: task.systemPrompt,
    input: [
      {
        role: 'user',
        content: [{type: 'input_text', text: serializeTaskForPrompt(task)}]
      }
    ],
    store: false,
    temperature: modelProfile.temperature,
    top_p: modelProfile.topP,
    max_output_tokens: modelProfile.maxTokens,
    text: task.outputSchema
      ? {
          format: {
            type: 'json_schema',
            name: `${task.promptId.replaceAll('-', '_')}_schema`,
            schema: task.outputSchema,
            strict: false
          }
        }
      : {format: {type: 'text'}},
    ...modelProfile.extra
  };

  if (modelProfile.reasoningEffort) {
    request.reasoning = {effort: modelProfile.reasoningEffort};
  }
  if (modelProfile.verbosity) {
    request.verbosity = modelProfile.verbosity;
  }
  return dropUndefined(request);
}

function normalizeOpenAIResponse(runtime: string, model: string, raw: any): LlmResponse {
  const text =
    raw.output_text ??
    raw.output
      ?.flatMap((item: any) => item.content ?? [])
      ?.filter((content: any) => content.type === 'output_text')
      ?.map((content: any) => content.text)
      ?.join('\n') ??
    '';
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
