// SPDX-License-Identifier: AGPL-3.0-only
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {afterEach, describe, expect, it} from 'vitest';
import {defaultConfig} from '../src/core/defaults.js';
import {runAudit} from '../src/core/auditEngine.js';

const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.SECFLOW_TEST_OPENAI_KEY;
});

describe('MVP audit acceptance', () => {
  it('runs a local audit with missing scanners and exports reports', async () => {
    const targetPath = await createTarget();
    const run = await runAudit({targetPath, config: missingToolConfig()});

    expect(run.findings.length).toBeGreaterThan(0);
    expect(run.toolResults.every((result) => result.skipped)).toBe(true);
    expect(await readFile(run.reportPath, 'utf8')).toContain('Scanner-Backed Findings');
    expect(await readFile(run.jsonReportPath!, 'utf8')).toContain('businessLogicHypotheses');
    expect(await readFile(run.sarifPath, 'utf8')).toContain('"version": "2.1.0"');
  });

  it('normalizes mocked scanner output', async () => {
    const targetPath = await createTarget();
    const semgrepOutput = JSON.stringify({
        results: [
          {
            check_id: 'secflow.test',
            path: 'routes.ts',
            start: {line: 2},
            extra: {message: 'Mock scanner finding', severity: 'ERROR', metadata: {confidence: 'HIGH'}}
          }
        ]
      });
    const config = {
      ...missingToolConfig(),
      tools: {
        ...missingToolConfig().tools,
        semgrep: {...defaultConfig.tools.semgrep!, command: 'printf', args: [semgrepOutput]}
      }
    };

    const run = await runAudit({targetPath, config});

    expect(run.findings.some((finding) => finding.source === 'semgrep' && finding.title === 'Mock scanner finding')).toBe(true);
  });

  it('denies LLM approval without invoking the runtime', async () => {
    const targetPath = await createTarget();
    const run = await runAudit({targetPath, config: openAiConfig('http://127.0.0.1:9/v1'), approveContext: () => false});

    expect(run.llmResponses).toHaveLength(0);
  });

  it('invokes an approved mocked OpenAI runtime', async () => {
    const targetPath = await createTarget();
    globalThis.fetch = async (_url, init) =>
      new Response(JSON.stringify({model: 'gpt-test', output_text: JSON.stringify(mockOutputForRequest(init)), usage: {input_tokens: 1, output_tokens: 1}}), {
        status: 200,
        headers: {'content-type': 'application/json'}
      });
    process.env.SECFLOW_TEST_OPENAI_KEY = 'test-key';

    const run = await runAudit({targetPath, config: openAiConfig('https://mock.openai.local/v1'), approveContext: () => true});

    expect(run.llmResponses[0]).toMatchObject({runtime: 'openai'});
    expect(run.llmResponses[0]?.structured).toMatchObject({summary: 'mock synthesis'});
    expect(run.llmResponses[0]?.text).toContain('Finding Assessments');
    expect(run.business.actors).toContain('approver');
  });

  it('fails loudly when approved LLM workflow output is malformed', async () => {
    const targetPath = await createTarget();
    globalThis.fetch = async () =>
      new Response(JSON.stringify({model: 'gpt-test', output_text: 'not json', usage: {input_tokens: 1, output_tokens: 1}}), {
        status: 200,
        headers: {'content-type': 'application/json'}
      });
    process.env.SECFLOW_TEST_OPENAI_KEY = 'test-key';

    await expect(runAudit({targetPath, config: openAiConfig('https://mock.openai.local/v1'), approveContext: () => true})).rejects.toThrow(/workflow-extraction schema/);
  });

  it('generates remediation drafts after explicit approval', async () => {
    const targetPath = await createTarget();
    const run = await runAudit({targetPath, config: missingToolConfig(), remediationDraftApproved: true});

    expect(run.remediationDrafts?.length).toBeGreaterThan(0);
    expect(await readFile(run.remediationDrafts![0]!.artifactPath!, 'utf8')).toContain('Patch Draft');
  });
});

async function createTarget(): Promise<string> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), 'secflow-e2e-'));
  await writeFile(
    path.join(targetPath, 'routes.ts'),
    `
      export function approveInvoice(req) {
        sendEmail(req.body.email);
        return { ok: true };
      }
    `,
    'utf8'
  );
  await writeFile(path.join(targetPath, 'package.json'), '{"name":"demo"}\n', 'utf8');
  return targetPath;
}

function missingToolConfig() {
  return {
    ...defaultConfig,
    defaultRuntime: undefined,
    tools: {
      semgrep: {...defaultConfig.tools.semgrep!, command: 'definitely-missing-semgrep'},
      trivy: {...defaultConfig.tools.trivy!, command: 'definitely-missing-trivy'},
      joern: {...defaultConfig.tools.joern!, command: 'definitely-missing-joern'}
    }
  };
}

function openAiConfig(baseUrl: string) {
  return {
    ...missingToolConfig(),
    defaultRuntime: 'openai',
    providers: {
      ...defaultConfig.providers,
      openai: {...defaultConfig.providers.openai!, enabled: true, baseUrl, apiKeyEnv: 'SECFLOW_TEST_OPENAI_KEY'}
    },
    modelProfiles: {
      default: {...defaultConfig.modelProfiles.default!, provider: 'openai', model: 'gpt-test'}
    }
  };
}

function mockOutputForRequest(init: RequestInit | undefined): unknown {
  const body = typeof init?.body === 'string' ? init.body : '';
  return body.includes('workflow-extraction') ? mockWorkflowExtraction() : mockSynthesis();
}

function mockWorkflowExtraction() {
  return {
    actors: ['approver', 'requester'],
    roles: ['admin'],
    assets: ['invoice'],
    trustBoundaries: ['route'],
    entryPoints: ['approveInvoice'],
    stateTransitions: ['approve'],
    permissionChecks: ['authorization'],
    moneyOrDataMovement: ['email'],
    approvalFlows: ['invoice approval'],
    externalSideEffects: ['sendEmail'],
    reviewQuestions: ['Can the requester approve their own invoice?'],
    risks: [
      {
        title: 'Approval route needs separation-of-duty review',
        severity: 'medium',
        confidence: 0.74,
        workflow: 'invoice approval',
        hypothesis: 'The approval action sends email after a state-changing request.',
        evidence: ['routes.ts'],
        assumptions: ['The sampled route is externally reachable.'],
        exploitPath: 'Submit an approval request as the invoice requester and observe whether the state transition succeeds.',
        validationSteps: ['Verify the requester cannot approve the same invoice.'],
        recommendation: 'Enforce separation of duty before sending approval side effects.'
      }
    ]
  };
}

function mockSynthesis() {
  return {
    summary: 'mock synthesis',
    findingAssessments: [
      {
        findingId: 'business-logic:external-state-transition',
        title: 'External input may drive state transitions',
        source: 'business-logic',
        disposition: 'needs-review',
        severity: 'medium',
        confidence: 0.62,
        rationale: 'The route performs a state-changing action.',
        evidence: ['routes.ts'],
        remediation: 'Add authorization and approval tests.',
        validationSteps: ['Verify initiators cannot approve their own requests.']
      }
    ],
    businessLogicHypotheses: [
      {
        title: 'Approval workflow needs owner validation',
        assessment: 'Review authorization boundaries for state changes.',
        assumptions: ['The route is externally reachable.'],
        validationSteps: ['Add abuse-case tests.']
      }
    ],
    recommendedNextSteps: ['Review generated patch drafts before applying changes.']
  };
}
