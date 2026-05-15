// SPDX-License-Identifier: AGPL-3.0-only
import {describe, expect, it} from 'vitest';
import {renderJsonReport, renderMarkdownReport, renderPatchDrafts, renderSarif} from '../src/core/reports.js';
import type {AuditRun, NormalizedFinding} from '../src/core/types.js';

describe('reports', () => {
  it('renders SARIF for normalized findings', () => {
    const finding: NormalizedFinding = {
      id: 'business-logic:test',
      source: 'business-logic',
      title: 'Approval bypass',
      severity: 'high',
      confidence: 0.7,
      path: 'src/routes.ts',
      line: 42,
      description: 'Approval transition may be bypassed.',
      evidence: ['src/routes.ts'],
      recommendation: 'Add authorization and approval tests.'
    };
    const sarif = renderSarif([finding]) as any;
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results[0].level).toBe('error');
  });

  it('renders JSON reports with separated finding categories', () => {
    const report = renderJsonReport(fakeRun());
    expect(report).toMatchObject({schema: 'secflow.audit-report.v1'});
    expect((report as any).scannerFindings).toHaveLength(1);
    expect((report as any).businessLogicHypotheses).toHaveLength(1);
    expect((report as any).llmEvents).toEqual([]);
  });

  it('renders LLM synthesis content in Markdown reports', () => {
    const markdown = renderMarkdownReport({
      ...fakeRun(),
      llmResponses: [{runtime: 'codex', model: 'gpt-test', text: '**Bottom Line**\nReview fixture findings separately from product findings.'}]
    });
    expect(markdown).toContain('### codex (gpt-test)');
    expect(markdown).toContain('Review fixture findings separately');
  });

  it('renders reviewable patch draft artifacts without editing repositories', () => {
    const drafts = renderPatchDrafts([businessFinding()]);
    expect(drafts[0].patch).toContain('No repository files were edited by SecFlow.');
    expect(drafts[0]).toMatchObject({findingId: 'business-logic:test', status: 'drafted'});
  });
});

function businessFinding(): NormalizedFinding {
  return {
    id: 'business-logic:test',
    source: 'business-logic',
    title: 'Approval bypass',
    severity: 'high',
    confidence: 0.7,
    path: 'src/routes.ts',
    line: 42,
    description: 'Approval transition may be bypassed.',
    evidence: ['src/routes.ts'],
    assumptions: ['Workflow ownership needs confirmation.'],
    exploitPath: 'Submit an approval transition as the initiator.',
    validationSteps: ['Add an approval bypass regression test.'],
    recommendation: 'Add authorization and approval tests.'
  };
}

function scannerFinding(): NormalizedFinding {
  return {
    ...businessFinding(),
    id: 'semgrep:test',
    source: 'semgrep',
    title: 'Semgrep finding'
  };
}

function fakeRun(): Omit<AuditRun, 'reportPath' | 'sarifPath'> {
  return {
    runId: 'test',
    caseId: 'test',
    targetPath: '/repo',
    runDir: '/repo/.secflow/cases/test/artifacts',
    profile: {
      targetPath: '/repo',
      generatedAt: new Date().toISOString(),
      fileCount: 1,
      totalBytes: 10,
      extensions: {'.ts': 1},
      manifests: ['package.json'],
      securityRelevantFiles: ['src/routes.ts'],
      likelyFrameworks: ['Node.js'],
      notableDirectories: ['src'],
      sampledFiles: []
    },
    business: {
      generatedAt: new Date().toISOString(),
      actors: ['user'],
      roles: [],
      assets: ['invoice'],
      trustBoundaries: [],
      entryPoints: ['route'],
      stateTransitions: ['approve'],
      permissionChecks: [],
      moneyOrDataMovement: [],
      approvalFlows: ['approval'],
      externalSideEffects: [],
      reviewQuestions: ['Who can approve?'],
      risks: []
    },
    toolResults: [],
    findings: [businessFinding(), scannerFinding()],
    llmResponses: [],
    remediationDrafts: renderPatchDrafts([businessFinding()])
  };
}
