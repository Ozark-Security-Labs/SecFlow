// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import type {LlmResponse} from '../../core/types.js';
import {writeText} from '../../util/files.js';
import {runProcess, runProcessStreaming} from '../../util/process.js';
import type {LlmRuntimeAdapter, RuntimeInvocation} from '../adapter.js';
import {parseMaybeJson, serializeTaskForPrompt} from '../adapter.js';

export const claudeCodeCliAdapter: LlmRuntimeAdapter = {
  kind: 'claude-code-cli',
  async invoke(invocation, events) {
    const promptPath = path.join(invocation.task.targetPath, '.secflow', 'tmp', `${invocation.task.id}.system.md`);
    await writeText(promptPath, invocation.task.systemPrompt);
    const prompt = serializeTaskForPrompt(invocation.task);
    const args = buildClaudeCodeArgs(invocation, promptPath, prompt);
    const options = {
      command: invocation.provider.command ?? 'claude',
      args,
      cwd: invocation.task.targetPath,
      timeoutMs: 300000,
      outputLimitBytes: 5_000_000
    };
    events?.onEvent({type: 'status', message: `Running ${options.command} in print mode.`});
    const result = events
      ? await runProcessStreaming(options, (event) => events.onEvent({type: event.stream, message: event.line}))
      : await runProcess(options);
    const structured = parseMaybeJson(result.stdout);
    return {
      runtime: invocation.providerName,
      model: invocation.modelProfile.model,
      text: typeof structured === 'object' && structured && 'result' in structured ? String((structured as {result: unknown}).result) : result.stdout,
      structured,
      raw: {stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode}
    } satisfies LlmResponse;
  }
};

export function buildClaudeCodeArgs(invocation: RuntimeInvocation, systemPromptPath: string, prompt: string): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--permission-mode',
    'plan',
    '--model',
    invocation.modelProfile.model,
    '--system-prompt-file',
    systemPromptPath,
    '--tools',
    'Read,Grep,Glob',
    '--cwd',
    invocation.task.targetPath
  ];
  args.push(...(invocation.provider.args ?? []));
  args.push(prompt);
  return args;
}
