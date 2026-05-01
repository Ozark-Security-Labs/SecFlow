import {describe, expect, it} from 'vitest';
import type {RuntimeInvocation} from '../src/llm/adapter.js';
import {buildAnthropicMessagesRequest} from '../src/llm/adapters/anthropic.js';
import {buildOpenAIResponsesRequest} from '../src/llm/adapters/openai.js';
import {buildOpenRouterChatRequest} from '../src/llm/adapters/openrouter.js';

const invocation: RuntimeInvocation = {
  providerName: 'openai',
  provider: {kind: 'openai', enabled: true, apiKeyEnv: 'OPENAI_API_KEY'},
  modelProfile: {
    provider: 'openai',
    model: 'gpt-test',
    temperature: 0.1,
    maxTokens: 1234,
    reasoningEffort: 'high'
  },
  task: {
    id: 'report-synthesis',
    promptId: 'report-synthesis',
    systemPrompt: 'system prompt',
    userPrompt: 'user prompt',
    targetPath: process.cwd(),
    context: {findings: []},
    outputSchema: {type: 'object'}
  }
};

describe('provider request mapping', () => {
  it('maps OpenAI Responses requests with instructions and structured output', () => {
    const request = buildOpenAIResponsesRequest(invocation);
    expect(request.instructions).toBe('system prompt');
    expect(request.model).toBe('gpt-test');
    expect(request.reasoning).toEqual({effort: 'high'});
    expect(request.text).toMatchObject({format: {type: 'json_schema'}});
  });

  it('maps Anthropic Messages requests with top-level system prompt', () => {
    const request = buildAnthropicMessagesRequest(invocation);
    expect(request.system).toBe('system prompt');
    expect(request.messages).toEqual([expect.objectContaining({role: 'user', content: expect.stringContaining('Context JSON:')})]);
    expect(request.max_tokens).toBe(1234);
  });

  it('maps OpenRouter requests to chat-completions-compatible messages', () => {
    const request = buildOpenRouterChatRequest(invocation);
    expect(request.messages).toEqual([
      {role: 'system', content: 'system prompt'},
      expect.objectContaining({role: 'user', content: expect.stringContaining('Context JSON:')})
    ]);
    expect(request.response_format).toMatchObject({type: 'json_schema'});
  });
});
