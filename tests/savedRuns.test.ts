// SPDX-License-Identifier: AGPL-3.0-only
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {describe, expect, it} from 'vitest';
import {createCaseStore} from '../src/core/caseStore.js';
import {listSavedRuns, loadSavedRun} from '../src/core/savedRuns.js';
import {writeJson} from '../src/util/files.js';

describe('saved runs', () => {
  it('lists and loads completed case files as audit runs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'secflow-saved-'));
    const store = createCaseStore(root);
    const created = await store.create({caseId: 'saved-case', targetPath: root});
    await store.save({
      ...created,
      status: 'complete',
      profile: {
        targetPath: root,
        generatedAt: '2026-05-14T18:49:57.000Z',
        fileCount: 1,
        totalBytes: 10,
        extensions: {'.ts': 1},
        manifests: [],
        securityRelevantFiles: ['routes.ts'],
        likelyFrameworks: ['Node.js'],
        notableDirectories: [],
        sampledFiles: []
      },
      business: {
        generatedAt: '2026-05-14T18:49:57.000Z',
        actors: [],
        roles: [],
        assets: [],
        trustBoundaries: [],
        entryPoints: [],
        stateTransitions: [],
        permissionChecks: [],
        moneyOrDataMovement: [],
        approvalFlows: [],
        externalSideEffects: [],
        reviewQuestions: [],
        risks: []
      },
      findings: [
        {
          id: 'semgrep:test',
          source: 'semgrep',
          title: 'Hardcoded credential',
          severity: 'medium',
          confidence: 0.8,
          description: 'A hard-coded credential was detected.',
          evidence: ['routes.ts'],
          recommendation: 'Move the credential to a secret manager.'
        }
      ],
      reportPath: path.join(root, '.secflow', 'cases', 'saved-case', 'artifacts', 'report.md'),
      jsonReportPath: path.join(root, '.secflow', 'cases', 'saved-case', 'artifacts', 'report.json'),
      sarifPath: path.join(root, '.secflow', 'cases', 'saved-case', 'artifacts', 'report.sarif')
    });

    const summaries = await listSavedRuns(root);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({caseId: 'saved-case', findingCount: 1, scannerFindingCount: 1});

    const run = await loadSavedRun(root, 'saved-case');
    expect(run.runId).toBe('saved-case');
    expect(run.findings[0]?.title).toBe('Hardcoded credential');
    expect(run.reportPath.endsWith('report.md')).toBe(true);
  });

  it('returns an empty list when no case directory exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'secflow-saved-empty-'));
    await expect(listSavedRuns(root)).resolves.toEqual([]);
  });

  it('hydrates scanner findings and analysis sections from report JSON', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'secflow-saved-report-'));
    const store = createCaseStore(root);
    const created = await store.create({caseId: 'report-case', targetPath: root});
    const jsonReportPath = path.join(root, '.secflow', 'cases', 'report-case', 'artifacts', 'report.json');
    const profile = {
      targetPath: root,
      generatedAt: '2026-05-14T18:49:57.000Z',
      fileCount: 1,
      totalBytes: 10,
      extensions: {'.ts': 1},
      manifests: ['package.json'],
      securityRelevantFiles: ['routes.ts'],
      likelyFrameworks: ['Node.js'],
      notableDirectories: ['src'],
      sampledFiles: []
    };
    const business = {
      generatedAt: '2026-05-14T18:49:57.000Z',
      actors: ['user'],
      roles: [],
      assets: [],
      trustBoundaries: [],
      entryPoints: ['route'],
      stateTransitions: [],
      permissionChecks: [],
      moneyOrDataMovement: [],
      approvalFlows: [],
      externalSideEffects: [],
      reviewQuestions: ['Who can approve?'],
      risks: []
    };
    await store.save({
      ...created,
      status: 'complete',
      profile,
      business,
      findings: [
        {
          id: 'business-logic:test',
          source: 'business-logic',
          title: 'Approval bypass',
          severity: 'medium',
          confidence: 0.7,
          description: 'Approval can be bypassed.',
          evidence: ['routes.ts'],
          recommendation: 'Add authorization checks.'
        }
      ],
      reportPath: path.join(root, '.secflow', 'cases', 'report-case', 'artifacts', 'report.md'),
      jsonReportPath,
      sarifPath: path.join(root, '.secflow', 'cases', 'report-case', 'artifacts', 'report.sarif')
    });
    await writeJson(jsonReportPath, {
      repository: profile,
      repoMap: {
        manifests: ['package.json'],
        frameworks: ['Express'],
        notableDirectories: ['src'],
        extensionSummary: {'.ts': 1},
        sampledFiles: []
      },
      business,
      scannerFindings: [
        {
          id: 'semgrep:test',
          source: 'semgrep',
          title: 'Hardcoded credential',
          severity: 'medium',
          confidence: 0.8,
          description: 'A hard-coded credential was detected.',
          evidence: ['routes.ts'],
          recommendation: 'Move the credential to a secret manager.'
        }
      ],
      businessLogicHypotheses: [
        {
          id: 'business-logic:test',
          source: 'business-logic',
          title: 'Approval bypass',
          severity: 'medium',
          confidence: 0.7,
          description: 'Approval can be bypassed.',
          evidence: ['routes.ts'],
          recommendation: 'Add authorization checks.'
        }
      ],
      toolResults: [
        {
          tool: 'semgrep',
          command: 'semgrep',
          available: true,
          skipped: false,
          durationMs: 10,
          message: 'ok',
          findings: [
            {
              id: 'semgrep:tool-only',
              source: 'semgrep',
              title: 'Tool-only finding',
              severity: 'medium',
              confidence: 0.8,
              description: 'A finding recorded only on the tool result.',
              evidence: ['routes.ts'],
              recommendation: 'Review the tool result.'
            }
          ]
        }
      ],
      llmResponses: [{runtime: 'codex', text: 'Reviewed workflow context.'}],
      llmEvents: [
        {
          timestamp: '2026-05-14T18:49:58.000Z',
          runtime: 'codex',
          taskId: 'workflow-extraction',
          promptId: 'workflow-extraction',
          type: 'status',
          message: 'Codex started.'
        }
      ],
      remediationDrafts: []
    });

    const summaries = await listSavedRuns(root);
    expect(summaries[0]).toMatchObject({findingCount: 3, scannerFindingCount: 2, businessFindingCount: 1, llmInvoked: true});

    const run = await loadSavedRun(root, 'report-case');
    expect(run.findings.map((finding) => finding.id).sort()).toEqual(['business-logic:test', 'semgrep:test', 'semgrep:tool-only']);
    expect(run.toolResults[0]?.tool).toBe('semgrep');
    expect(run.llmResponses[0]?.runtime).toBe('codex');
    expect(run.llmEvents?.[0]?.message).toBe('Codex started.');
    expect(run.repoMap?.frameworks).toEqual(['Express']);
  });
});
