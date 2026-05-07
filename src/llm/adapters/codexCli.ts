// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import type {LlmResponse} from '../../core/types.js';
import {writeText} from '../../util/files.js';
import {runProcess} from '../../util/process.js';
import type {LlmRuntimeAdapter, RuntimeInvocation} from '../adapter.js';
import {parseMaybeJson, serializeTaskForPrompt} from '../adapter.js';

export const codexCliAdapter: LlmRuntimeAdapter = {
  kind: 'codex-cli',
  async invoke(invocation) {
    const prompt = serializeTaskForPrompt(invocation.task);
    const schemaPath = invocation.task.outputSchema ? path.join(invocation.task.targetPath, '.secflow', 'tmp', `${invocation.task.id}.schema.json`) : undefined;
    if (schemaPath && invocation.task.outputSchema) {
      await writeText(schemaPath, JSON.stringify(invocation.task.outputSchema, null, 2));
    }
    const args = buildCodexExecArgs(invocation, schemaPath);
    const result = await runProcess({
      command: invocation.provider.command ?? 'codex',
      args,
      cwd: invocation.task.targetPath,
      input: prompt,
      timeoutMs: 300000,
      outputLimitBytes: 5_000_000
    });
    const structured = parseMaybeJson(result.stdout);
    return {
      runtime: invocation.providerName,
      model: invocation.modelProfile.model,
      text: typeof structured === 'object' && structured && 'output' in structured ? String((structured as {output: unknown}).output) : result.stdout,
      structured,
      raw: {stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode}
    } satisfies LlmResponse;
  }
};

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
