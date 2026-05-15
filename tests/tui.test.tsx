// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import {describe, expect, it} from 'vitest';
import {render} from 'ink-testing-library';
import {App, ConfigScreen, ContextApprovalScreen, DraftApprovalScreen, HomeScreen, PreflightScreen, ResultsScreen, RunningScreen, SavedRunsScreen, TargetScreen, applyConfigUpdate} from '../src/tui/App.js';
import {ProgressRail} from '../src/tui/components.js';
import type {AuditEvent, AuditRun, ContextPreview} from '../src/core/types.js';
import type {SavedRunSummary} from '../src/core/savedRuns.js';
import type {PreflightData} from '../src/tui/preflight.js';
import {defaultConfig} from '../src/core/defaults.js';

const cwd = process.cwd();

describe('TUI screens', () => {
  it('renders the home screen', () => {
    const instance = render(<HomeScreen onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('AppSec audit harness');
    expect(instance.lastFrame()).toContain('Start audit wizard');
    expect(instance.lastFrame()).toContain('Load previous run');
    expect(instance.lastFrame()).toContain('Edit config');
  });

  it('renders saved runs', () => {
    const instance = render(<SavedRunsScreen targetPath={cwd} runs={[fakeSavedRun()]} onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('Saved Runs');
    expect(instance.lastFrame()).toContain('1 total');
    expect(instance.lastFrame()).toContain('1 scan');
    expect(instance.lastFrame()).toContain('0 biz');
    expect(instance.lastFrame()).toContain('case-test');
    expect(instance.lastFrame()).toContain('Back home');
  });

  it('renders config editing actions', () => {
    const instance = render(<ConfigScreen config={defaultConfig} onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('Config');
    expect(instance.lastFrame()).toContain('Default runtime');
    expect(instance.lastFrame()).toContain('codex');
    expect(instance.lastFrame()).toContain('context approval');
    expect(instance.lastFrame()).toContain('Runtime events');
  });

  it('renders the target screen', () => {
    const instance = render(<TargetScreen value={cwd} onChange={() => undefined} onSubmit={() => undefined} />);
    expect(instance.lastFrame()).toContain('Target Repository');
  });

  it('renders the preflight screen', () => {
    const instance = render(<PreflightScreen data={fakePreflight()} onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('Preflight');
    expect(instance.lastFrame()).toContain('install or disable');
    expect(instance.lastFrame()).toContain('Run audit');
    expect(instance.lastFrame()).toContain('Load previous run for this target');
  });

  it('renders running progress', () => {
    const events: AuditEvent[] = [{type: 'step:start', step: 'profile', message: 'Profiling repository.', timestamp: new Date().toISOString()}];
    const instance = render(<RunningScreen events={events} />);
    expect(instance.lastFrame()).toContain('Audit Steps');
    expect(instance.lastFrame()).toContain('… Profile');
    expect(instance.lastFrame()).toContain('Profiling repository');
  });

  it('renders skipped LLM status in the progress rail', () => {
    const events: AuditEvent[] = [{type: 'llm:skipped', step: 'llm', reason: 'No default runtime configured.', timestamp: new Date().toISOString()}];
    const instance = render(<ProgressRail events={events} />);
    expect(instance.lastFrame()).toContain('- LLM');
    expect(instance.lastFrame()).toContain('LLM');
  });

  it('renders context approval', () => {
    const instance = render(<ContextApprovalScreen preview={fakePreview()} onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('LLM Context Approval');
    expect(instance.lastFrame()).toContain('Approve LLM runtime call');
  });

  it('renders patch draft approval', () => {
    const instance = render(<DraftApprovalScreen findings={fakeRun().findings} onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('Patch Draft Approval');
    expect(instance.lastFrame()).toContain('Generate patch draft artifacts');
    expect(instance.lastFrame()).toContain('Approval bypass');
  });

  it('renders results', () => {
    const instance = render(<ResultsScreen run={fakeRun()} onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('Results');
    expect(instance.lastFrame()).toContain('Report Actions');
    expect(instance.lastFrame()).toContain('Review analysis context');
    expect(instance.lastFrame()).toContain('Review report artifacts');
  });

  it('renders analysis context as a focused results action', () => {
    const instance = render(<ResultsScreen run={fakeRun({llm: true})} view="analysis" onSelect={() => undefined} />);
    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('Repo Map');
    expect(frame).toContain('Workflows');
    expect(frame).toContain('Tool Outcomes');
    expect(frame).toContain('LLM Activity');
    expect(frame).toContain('LLM Runtime Events');
    expect(frame).toContain('codex');
    expect(maxLineLength(frame)).toBeLessThanOrEqual(80);
  });

  it('renders report artifacts as a focused results action', () => {
    const instance = render(<ResultsScreen run={fakeRun({longPaths: true})} view="reports" onSelect={() => undefined} />);
    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('Report Artifacts');
    expect(frame).toContain('report.md');
    expect(frame).toContain('Back to overview');
    expect(maxLineLength(frame)).toBeLessThanOrEqual(80);
  });

  it('renders selectable findings', () => {
    const instance = render(<ResultsScreen run={fakeRun()} view="findings" onSelect={() => undefined} />);
    expect(instance.lastFrame()).toContain('Select Finding');
    expect(instance.lastFrame()).toContain('2 findings');
    expect(instance.lastFrame()).toContain('page 1/1');
    expect(instance.lastFrame()).toContain('Approval bypass');
    expect(instance.lastFrame()).toContain('Hardcoded credential');
  });

  it('paginates large finding sets', () => {
    const run = fakeRun({extraFindings: 25});
    const firstPage = render(<ResultsScreen run={run} view="findings" onSelect={() => undefined} />);
    const firstFrame = firstPage.lastFrame() ?? '';
    expect(firstFrame).toContain('27 findings');
    expect(firstFrame).toContain('page 1/3');
    expect(firstFrame).toContain('Next page (2/3)');
    expect(firstFrame).not.toContain('Generated finding 25');

    const secondPage = render(<ResultsScreen run={run} view="findings" findingsPage={1} onSelect={() => undefined} />);
    const secondFrame = secondPage.lastFrame() ?? '';
    expect(secondFrame).toContain('page 2/3');
    expect(secondFrame).toContain('Previous page (1/3)');
    expect(secondFrame).toContain('Next page (3/3)');
    expect(secondFrame).toContain('Generated finding');
    expect(maxLineLength(secondFrame)).toBeLessThanOrEqual(80);
  });

  it('renders finding details with evidence and remediation context', () => {
    const instance = render(<ResultsScreen run={fakeRun()} view="finding-detail" selectedFindingIndex={0} onSelect={() => undefined} />);
    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('Finding Detail');
    expect(frame).toContain('Evidence');
    expect(frame).toContain('src/routes.ts');
    expect(frame).toContain('Recommendation');
    expect(frame).toContain('lower-privileged');
    expect(frame).toContain('request initiator');
    expect(frame).toContain('Back to findings');
    expect(maxLineLength(frame)).toBeLessThanOrEqual(80);
  });
});

describe('TUI interactions', () => {
  it('applies codex config updates', () => {
    const updated = applyConfigUpdate(defaultConfig, 'use-runtime:codex');
    expect(updated.defaultRuntime).toBe('codex');
    expect(updated.providers.codex?.enabled).toBe(true);
    expect(updated.modelProfiles.default?.provider).toBe('codex');
  });

  it('toggles runtime event streaming config', () => {
    const updated = applyConfigUpdate(defaultConfig, 'toggle-runtime-events');
    expect(updated.runtime.streamEvents).toBe(true);
  });

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
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Run audit');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Run: test-run');
  }, 10000);

  it('loads a previous run from the home screen', async () => {
    const instance = render(
      <App
        cwd={cwd}
        listSavedRuns={async () => [fakeSavedRun()]}
        loadSavedRun={async () => fakeRun()}
      />
    );

    instance.stdin.write('\t');
    await new Promise((resolve) => setTimeout(resolve, 20));
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Saved Runs');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Run: test-run');
    expect(instance.lastFrame()).toContain('Review findings (2)');
  }, 10000);

  it('loads a previous run after selecting a target', async () => {
    const selectedTarget = '/tmp/secflow-selected-target';
    let listedTarget = '';
    let loadedTarget = '';
    const instance = render(
      <App
        cwd={cwd}
        loadPreflight={async () => fakePreflight({targetPath: selectedTarget})}
        listSavedRuns={async (target) => {
          listedTarget = target;
          return [fakeSavedRun({targetPath: selectedTarget})];
        }}
        loadSavedRun={async (target) => {
          loadedTarget = target;
          return fakeRun();
        }}
      />
    );

    instance.stdin.write('\r');
    await waitForFrame(instance, 'Target Repository');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Load previous run for this target');
    instance.stdin.write('\t');
    await new Promise((resolve) => setTimeout(resolve, 20));
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Saved Runs');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Run: test-run');
    expect(listedTarget).toBe(selectedTarget);
    expect(loadedTarget).toBe(selectedTarget);
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
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Run audit');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'LLM Context Approval');
    instance.stdin.write('\t');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Run: test-run');
  }, 10000);

  it('approves patch drafts from the TUI', async () => {
    const instance = render(
      <App
        cwd={cwd}
        loadPreflight={async () => fakePreflight()}
        runAudit={async (options) => {
          const approved = await options.approveRemediationDraft?.(fakeRun().findings);
          return fakeRun({drafts: Boolean(approved)});
        }}
      />
    );

    instance.stdin.write('\r');
    await waitForFrame(instance, 'Target Repository');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Run audit');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Patch Draft Approval');
    instance.stdin.write('\r');
    await waitForFrame(instance, 'Patch drafts: 1');
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
    instance.stdin.write('\r');
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

function fakeSavedRun(overrides: Partial<SavedRunSummary> = {}): SavedRunSummary {
  return {
    caseId: 'case-test',
    title: 'SecFlow audit for test',
    targetPath: cwd,
    updatedAt: '2026-05-14T18:49:57.000Z',
    status: 'complete',
    findingCount: 1,
    scannerFindingCount: 1,
    businessFindingCount: 0,
    llmInvoked: false,
    remediationDraftCount: 0,
    ...overrides
  };
}

function fakeRun(options: {longPaths?: boolean; drafts?: boolean; extraFindings?: number; llm?: boolean} = {}): AuditRun {
  const baseRunDir = options.longPaths
    ? `${cwd}/.secflow/cases/2026-05-14T19-52-07-103Z/artifacts/with/a/very/deep/reporting/path/that/used/to/wrap/outside/containers`
    : `${cwd}/.secflow/runs/test-run`;
  return {
    runId: 'test-run',
    targetPath: cwd,
    runDir: baseRunDir,
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
    repoMap: {
      generatedAt: new Date().toISOString(),
      root: cwd,
      manifests: ['package.json'],
      frameworks: ['Node.js'],
      notableDirectories: ['src'],
      extensionSummary: {'.ts': 2},
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
    toolResults: [
      {
        tool: 'semgrep',
        command: 'semgrep',
        available: false,
        skipped: true,
        durationMs: 0,
        message: options.longPaths ? 'missing from PATH with a long diagnostic that should stay inside the report container' : 'missing',
        findings: []
      }
    ],
    findings: [
      {
        id: 'business-logic:test',
        source: 'business-logic',
        title: 'Approval bypass',
        severity: 'high',
        confidence: 0.7,
        path: 'src/routes.ts',
        line: 12,
        description: 'Approval may be bypassed.',
        evidence: ['src/routes.ts'],
        assumptions: ['The approval route is reachable by lower-privileged users.'],
        exploitPath: 'Submit an approval transition as the request initiator.',
        validationSteps: ['Add a regression test for initiator self-approval.'],
        recommendation: 'Add authorization tests.'
      },
      {
        id: 'semgrep:test',
        source: 'semgrep',
        title: 'Hardcoded credential',
        severity: 'medium',
        confidence: 0.8,
        path: 'src/config.ts',
        line: 4,
        description: 'A hard-coded credential was detected.',
        evidence: ['src/config.ts:4 contains a token-like string.'],
        recommendation: 'Move the credential to a secret manager.',
        cwe: ['CWE-798'],
        references: ['https://cwe.mitre.org/data/definitions/798.html'],
        metadata: {ruleId: 'generic.secrets.security.detected-generic-secret'}
      },
      ...Array.from({length: options.extraFindings ?? 0}, (_, index) => ({
        id: `semgrep:generated-${index}`,
        source: 'semgrep' as const,
        title: `Generated finding ${index + 1}`,
        severity: 'medium' as const,
        confidence: 0.8,
        path: `src/generated-${index}.ts`,
        line: index + 1,
        description: 'Generated scanner finding.',
        evidence: [`src/generated-${index}.ts:${index + 1}`],
        recommendation: 'Review generated finding.'
      }))
    ],
    llmResponses: options.llm ? [{runtime: 'codex', model: 'gpt-test', text: 'Reviewed scanner and workflow context.'}] : [],
    llmEvents: options.llm
      ? [
          {
            timestamp: new Date().toISOString(),
            runtime: 'codex',
            taskId: 'report-synthesis',
            promptId: 'report-synthesis',
            type: 'status',
            message: 'Codex report synthesis started.'
          }
        ]
      : [],
    reportPath: `${baseRunDir}/report.md`,
    jsonReportPath: `${baseRunDir}/report.json`,
    remediationDrafts: options.drafts
      ? [
          {
            id: 'patch-draft:business-logic:test',
            findingId: 'business-logic:test',
            title: 'Patch draft for Approval bypass',
            status: 'drafted',
            createdAt: new Date().toISOString(),
            summary: 'Add authorization tests.',
            patch: 'No repository files were edited by SecFlow.'
          }
        ]
      : [],
    sarifPath: `${baseRunDir}/report.sarif`
  };
}

function maxLineLength(value: string): number {
  return Math.max(...value.split('\n').map((line) => line.replace(/\u001b\[[0-9;]*m/g, '').length));
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
