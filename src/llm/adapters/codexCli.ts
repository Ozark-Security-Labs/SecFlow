// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import type {LlmResponse} from '../../core/types.js';
import {writeText} from '../../util/files.js';
import {runProcess, runProcessStreaming} from '../../util/process.js';
import type {LlmRuntimeAdapter, LlmRuntimeEventSink, RuntimeInvocation} from '../adapter.js';
import {parseMaybeJson, serializeTaskForPrompt} from '../adapter.js';

export const codexCliAdapter: LlmRuntimeAdapter = {
  kind: 'codex-cli',
  async invoke(invocation, events) {
    const prompt = serializeTaskForPrompt(invocation.task);
    const schemaPath = invocation.task.outputSchema ? path.join(invocation.task.targetPath, '.secflow', 'tmp', `${invocation.task.id}.schema.json`) : undefined;
    if (schemaPath && invocation.task.outputSchema) {
      await writeText(schemaPath, JSON.stringify(invocation.task.outputSchema, null, 2));
    }
    const args = buildCodexExecArgs(invocation, schemaPath);
    const options = {
      command: invocation.provider.command ?? 'codex',
      args,
      cwd: invocation.task.targetPath,
      input: prompt,
      timeoutMs: 300000,
      outputLimitBytes: 5_000_000
    };
    events?.onEvent({type: 'status', message: `Running ${options.command} ${args.slice(0, 3).join(' ')}...`});
    const result = events
      ? await runProcessStreaming(options, (event) => emitCodexProcessEvent(event.stream, event.line, events))
      : await runProcess(options);
    const codexStream = parseCodexJsonStream(result.stdout);
    const structured = (codexStream ? parseMaybeJson(codexStream.text) : undefined) ?? codexStream ?? parseMaybeJson(result.stdout);
    return {
      runtime: invocation.providerName,
      model: invocation.modelProfile.model,
      text: codexStream?.text ?? (typeof structured === 'object' && structured && 'output' in structured ? String((structured as {output: unknown}).output) : result.stdout),
      structured,
      raw: {stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode}
    } satisfies LlmResponse;
  }
};

function emitCodexProcessEvent(stream: 'stdout' | 'stderr', line: string, events: LlmRuntimeEventSink): void {
  if (stream === 'stderr') {
    events.onEvent({type: 'stderr', message: line});
    return;
  }
  const trimmed = line.trim();
  try {
    const event = JSON.parse(trimmed) as unknown;
    const item = typeof event === 'object' && event && 'item' in event ? (event as {item?: unknown}).item : undefined;
    if (typeof item === 'object' && item && 'type' in item && (item as {type?: unknown}).type === 'agent_message') {
      const text = (item as {text?: unknown}).text;
      events.onEvent({type: 'message', message: typeof text === 'string' ? text : 'Codex emitted an agent message.', data: {event}});
      return;
    }
    const type = typeof event === 'object' && event && 'type' in event ? String((event as {type?: unknown}).type) : 'event';
    events.onEvent({type: 'status', message: `Codex ${type}`, data: {event}});
  } catch {
    events.onEvent({type: 'stdout', message: trimmed});
  }
}

export function buildCodexExecArgs(invocation: RuntimeInvocation, schemaPath?: string): string[] {
  const args = ['exec', '--ephemeral', '--json', '--sandbox', 'read-only', '--cd', invocation.task.targetPath];
  if (invocation.modelProfile.model) {
    args.push('--model', invocation.modelProfile.model);
  }
  if (schemaPath) {
    args.push('--output-schema', schemaPath);
  }
  args.push(...(invocation.provider.args ?? []));
  args.push('-');
  return args;
}

export function parseCodexJsonStream(value: string): {text: string; agentMessages: string[]; events: unknown[]} | undefined {
  const events: unknown[] = [];
  const agentMessages: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
    events.push(event);
    const item = typeof event === 'object' && event && 'item' in event ? (event as {item?: unknown}).item : undefined;
    if (typeof item !== 'object' || !item || !('type' in item) || (item as {type?: unknown}).type !== 'agent_message') {
      continue;
    }
    const text = (item as {text?: unknown}).text;
    if (typeof text === 'string' && text.trim()) {
      agentMessages.push(text.trim());
    }
  }
  if (events.length === 0 || agentMessages.length === 0) {
    return undefined;
  }
  return {
    text: agentMessages.at(-1)!,
    agentMessages,
    events
  };
}
