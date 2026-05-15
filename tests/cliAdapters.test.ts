// SPDX-License-Identifier: AGPL-3.0-only
import {describe, expect, it} from 'vitest';
import type {RuntimeInvocation} from '../src/llm/adapter.js';
import {buildClaudeCodeArgs} from '../src/llm/adapters/claudeCodeCli.js';
import {buildCodexExecArgs, parseCodexJsonStream} from '../src/llm/adapters/codexCli.js';
import {runProcessStreaming} from '../src/util/process.js';

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

  it('extracts the final agent message from Codex JSONL output', () => {
    const parsed = parseCodexJsonStream(
      [
        JSON.stringify({type: 'thread.started', thread_id: 'thread'}),
        JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: 'checking context'}}),
        JSON.stringify({type: 'item.completed', item: {type: 'command_execution', command: 'sed', aggregated_output: 'source'}}),
        JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: '**Bottom Line**\nUseful synthesis.'}})
      ].join('\n')
    );

    expect(parsed?.text).toContain('Useful synthesis');
    expect(parsed?.agentMessages).toHaveLength(2);
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

  it('streams process output lines before completion', async () => {
    const lines: string[] = [];
    const result = await runProcessStreaming(
      {
        command: 'sh',
        args: ['-c', 'printf "first\\n"; printf "second\\n" >&2'],
        cwd: process.cwd(),
        timeoutMs: 5000
      },
      (event) => lines.push(`${event.stream}:${event.line}`)
    );
    expect(result.exitCode).toBe(0);
    expect(lines).toContain('stdout:first');
    expect(lines).toContain('stderr:second');
  });
});
