// SPDX-License-Identifier: AGPL-3.0-only
import {describe, expect, it} from 'vitest';
import type {RuntimeInvocation} from '../src/llm/adapter.js';
import {buildClaudeCodeArgs} from '../src/llm/adapters/claudeCodeCli.js';
import {buildCodexExecArgs} from '../src/llm/adapters/codexCli.js';

const invocation: RuntimeInvocation = {
  providerName: 'codex',
  provider: {kind: 'codex-cli', enabled: true, command: 'codex'},
  modelProfile: {provider: 'codex', model: 'gpt-test'},
  task: {
    id: 'business',
    promptId: 'business-invariant-review',
    systemPrompt: 'system',
    userPrompt: 'user',
    targetPath: '/repo',
    context: {}
  }
};

describe('CLI runtime adapters', () => {
  it('builds safe Codex exec args', () => {
    const args = buildCodexExecArgs(invocation, '/tmp/schema.json');
    expect(args).toContain('exec');
    expect(args).toContain('--json');
    expect(args).toContain('read-only');
    expect(args).toContain('--output-schema');
    expect(args.at(-1)).toBe('-');
  });

  it('builds Claude Code print-mode args with plan permissions', () => {
    const args = buildClaudeCodeArgs({...invocation, provider: {kind: 'claude-code-cli', enabled: true, command: 'claude'}}, '/tmp/system.md', 'prompt');
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).toContain('--permission-mode');
    expect(args).toContain('plan');
    expect(args).toContain('--system-prompt-file');
  });
});
