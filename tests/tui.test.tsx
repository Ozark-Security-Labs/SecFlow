import React from 'react';
import {describe, expect, it} from 'vitest';
import {render} from 'ink-testing-library';
import {App, ContextApprovalScreen, HomeScreen, PreflightScreen, ResultsScreen, RunningScreen, TargetScreen} from '../src/tui/App.js';
import {ProgressRail} from '../src/tui/components.js';
import type {AuditEvent, AuditRun, ContextPreview} from '../src/core/types.js';
import type {PreflightData} from '../src/tui/preflight.js';
import {defaultConfig} from '../src/core/defaults.js';

const cwd = process.cwd();

describe('TUI screens', () => {
  it('renders the home screen', () => {
    const instance = render(<HomeScreen onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('AppSec audit harness');
    expect(instance.lastFrame()).toContain('Start audit wizard');
  });

  it('renders the target screen', () => {
    const instance = render(<TargetScreen value={cwd} onChange={() => undefined} onSubmit={() => undefined} />);
    expect(instance.lastFrame()).toContain('Target Repository');
  });

  it('renders the preflight screen', () => {
    const instance = render(<PreflightScreen data={fakePreflight()} onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('╭');
    expect(instance.lastFrame()).toContain('Preflight');
    expect(instance.lastFrame()).toContain('install or disable');
    expect(instance.lastFrame()).toContain('Run audit');
  });

  it('renders running progress', () => {
    const events: AuditEvent[] = [{type: 'step:start', step: 'profile', message: 'Profiling repository.', timestamp: new Date().toISOString()}];
    const instance = render(<RunningScreen events={events} />);
    expect(instance.lastFrame()).toContain('Audit Steps');
    expect(instance.lastFrame()).toContain('[RUNNING]');
    expect(instance.lastFrame()).toContain('Profiling repository');
  });

  it('renders skipped LLM status in the progress rail', () => {
    const events: AuditEvent[] = [{type: 'llm:skipped', step: 'llm', reason: 'No default runtime configured.', timestamp: new Date().toISOString()}];
    const instance = render(<ProgressRail events={events} />);
    expect(instance.lastFrame()).toContain('[SKIPPED]');
    expect(instance.lastFrame()).toContain('LLM');
  });

  it('renders context approval', () => {
    const instance = render(<ContextApprovalScreen preview={fakePreview()} onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('LLM Context Approval');
    expect(instance.lastFrame()).toContain('Approve LLM runtime call');
  });

  it('renders results', () => {
    const instance = render(<ResultsScreen run={fakeRun()} onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('Results');
    expect(instance.lastFrame()).toContain('report.md');
  });
});

describe('TUI interactions', () => {
  it('starts an audit and reaches results', async () => {
    const instance = render(
      <App
        cwd={cwd}
        loadPreflight={async () => fakePreflight()}
        runAudit={async (options) => {
          options.onEvent?.({type: 'step:start', step: 'profile', message: 'Profiling repository.', timestamp: new Date().toISOString()});
          return fakeRun();
        }}
      />
    );

    expect(instance.lastFrame()).toContain('Tab or arrows move');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Target Repository');
    instance.stdin.write('\n');
    await waitForFrame(instance, 'Run audit');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Run: test-run');
  }, 10000);

  it('skips LLM context approval and completes', async () => {
    const instance = render(
      <App
        cwd={cwd}
        loadPreflight={async () => fakePreflight({defaultRuntime: 'openai'})}
        runAudit={async (options) => {
          const approved = await options.approveContext?.(fakePreview());
          options.onEvent?.({
            type: 'llm:skipped',
            step: 'llm',
            timestamp: new Date().toISOString(),
            reason: approved ? 'approved' : 'skipped by user'
          });
          return fakeRun();
        }}
      />
    );

    instance.stdin.write('\r');
    await waitForFrame(instance, 'Target Repository');
    instance.stdin.write('\n');
    await waitForFrame(instance, 'Run audit');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'LLM Context Approval');
    instance.stdin.write('\t');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Run: test-run');
  }, 10000);

  it('confirms quit during context approval', async () => {
    const instance = render(
      <App
        cwd={cwd}
        loadPreflight={async () => fakePreflight({defaultRuntime: 'openai'})}
        runAudit={async (options) => {
          await options.approveContext?.(fakePreview());
          return fakeRun();
        }}
      />
    );

    instance.stdin.write('\r');
    await waitForFrame(instance, 'Target Repository');
    instance.stdin.write('\n');
    await waitForFrame(instance, 'Run audit');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'LLM Context Approval');
    instance.stdin.write('q');
    await waitForFrame(instance, 'Exit Active Run?');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'LLM Context Approval');
  }, 10000);
});

function fakePreflight(overrides: Partial<PreflightData> = {}): PreflightData {
  return {
    targetPath: cwd,
    config: defaultConfig,
    configPath: undefined,
    tooling: [
      {name: 'semgrep', command: 'semgrep', enabled: true, available: false},
      {name: 'trivy', command: 'trivy', enabled: true, available: false}
    ],
    runtimes: [{name: 'openai', kind: 'openai', enabled: false, model: 'gpt-test', auth: 'OPENAI_API_KEY'}],
    defaultRuntime: undefined,
    warnings: ['No default LLM runtime is configured; audit will run local-only.'],
    ...overrides
  };
}

function fakePreview(): ContextPreview {
  return {
    runtime: 'openai',
    promptId: 'report-synthesis',
    sizeBytes: 512,
    maxBytes: 1024,
    requireApproval: true,
    redactionPatternCount: 2,
    contextPath: `${cwd}/.secflow/runs/test/llm-context-preview.json`
  };
}

function fakeRun(): AuditRun {
  return {
    runId: 'test-run',
    targetPath: cwd,
    runDir: `${cwd}/.secflow/runs/test-run`,
    profile: {
      targetPath: cwd,
      generatedAt: new Date().toISOString(),
      fileCount: 2,
      totalBytes: 100,
      extensions: {'.ts': 2},
      manifests: ['package.json'],
      securityRelevantFiles: ['src/routes.ts'],
      likelyFrameworks: ['Node.js'],
      notableDirectories: ['src'],
      sampledFiles: []
    },
    business: {
      generatedAt: new Date().toISOString(),
      actors: ['user'],
      roles: ['admin'],
      assets: ['account'],
      trustBoundaries: [],
      entryPoints: ['route'],
      stateTransitions: ['approve'],
      permissionChecks: [],
      moneyOrDataMovement: [],
      approvalFlows: [],
      externalSideEffects: [],
      reviewQuestions: ['Who can approve invoices?'],
      risks: []
    },
    toolResults: [{tool: 'semgrep', command: 'semgrep', available: false, skipped: true, durationMs: 0, message: 'missing', findings: []}],
    findings: [
      {
        id: 'business-logic:test',
        source: 'business-logic',
        title: 'Approval bypass',
        severity: 'high',
        confidence: 0.7,
        description: 'Approval may be bypassed.',
        evidence: ['src/routes.ts'],
        recommendation: 'Add authorization tests.'
      }
    ],
    llmResponses: [],
    reportPath: `${cwd}/.secflow/runs/test-run/report.md`,
    sarifPath: `${cwd}/.secflow/runs/test-run/report.sarif`
  };
}

async function waitForFrame(instance: ReturnType<typeof render>, text: string): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    if (instance.lastFrame()?.includes(text)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for frame containing "${text}". Last frame:\n${instance.lastFrame()}`);
}
